/**
 * Provider Cockpit — /api/provider-stats (cockpit field) + combos preview/apply routes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-cockpit-routes-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const combosDb = await import("../../src/lib/db/combos.ts");
const statsRoute = await import("../../src/app/api/provider-stats/route.ts");
const previewRoute = await import("../../src/app/api/provider-stats/combos/preview/route.ts");
const applyRoute = await import("../../src/app/api/provider-stats/combos/apply/route.ts");

function insertCallLog(row: Record<string, unknown>) {
  core
    .getDbInstance()
    .prepare(
      `INSERT INTO call_logs (id, timestamp, method, path, status, model, provider, duration,
         tokens_in, tokens_out)
       VALUES (@id, @timestamp, 'POST', '/v1/chat/completions', @status, @model, @provider,
         @duration, 10, 20)`
    )
    .run({
      id: `log-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      status: 200,
      duration: 300,
      ...row,
    });
}

const post = (url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
  });

test.before(() => {
  core.resetDbInstance();
  for (let i = 0; i < 6; i++) {
    insertCallLog({ provider: "groq", model: "llama-3.1-8b-instant", duration: 150 });
    insertCallLog({ provider: "groq", model: "qwen3-32b", duration: 400 });
  }
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("GET /api/provider-stats keeps legacy fields and adds the cockpit payload", async () => {
  const res = await statsRoute.GET(new Request("http://localhost/api/provider-stats?range=1h"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.providers));
  assert.ok(Array.isArray(body.models));
  assert.ok(body.cockpit, "cockpit payload expected");
  const groq = body.cockpit.providers.find((p: { id: string }) => p.id === "groq");
  assert.ok(groq);
  assert.equal(groq.requests, 12);
  assert.equal(body.cockpit.kpis.requests, 12);
});

test("GET /api/provider-stats rejects an unknown range", async () => {
  const res = await statsRoute.GET(new Request("http://localhost/api/provider-stats?range=5y"));
  assert.equal(res.status, 400);
});

test("preview → apply → preview is idempotent", async () => {
  const first = await (
    await previewRoute.POST(post("/api/provider-stats/combos/preview", { range: "1h" }))
  ).json();
  const names = first.combos.map((c: { name: string }) => c.name);
  assert.ok(names.includes("cockpit-free-unlimited"), names.join(","));
  assert.ok(names.includes("cockpit-universal-safeguard"), names.join(","));
  assert.equal(first.diff.create.length, names.length);

  const applyRes = await applyRoute.POST(post("/api/provider-stats/combos/apply", { range: "1h" }));
  const applied = await applyRes.json();
  assert.equal(applyRes.status, 200, JSON.stringify(applied));
  assert.ok(
    applied.results.every((r: { ok: boolean }) => r.ok),
    JSON.stringify(applied.results)
  );

  const stored = await combosDb.getComboByName("cockpit-universal-safeguard");
  assert.ok(stored, "universal combo stored");

  const second = await (
    await previewRoute.POST(post("/api/provider-stats/combos/preview", { range: "1h" }))
  ).json();
  assert.equal(
    second.diff.create.length,
    0,
    JSON.stringify(second.diff.create.map((c: { name: string }) => c.name))
  );
  assert.equal(second.diff.update.length, 0, JSON.stringify(second.diff.update));
  assert.equal(second.diff.unchanged.length, names.length);

  // Applying again is a no-op.
  const again = await (
    await applyRoute.POST(post("/api/provider-stats/combos/apply", { range: "1h" }))
  ).json();
  assert.equal(again.results.length, 0);
});

test("invalid bodies return 400 without leaking stack traces", async () => {
  for (const body of ["{not json", { range: "forever" }, { extra: true }]) {
    const res = await previewRoute.POST(post("/api/provider-stats/combos/preview", body));
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.ok(!String(json.error?.message).includes("at /"));
  }
  const res = await applyRoute.POST(post("/api/provider-stats/combos/apply", { names: "x" }));
  assert.equal(res.status, 400);
});
