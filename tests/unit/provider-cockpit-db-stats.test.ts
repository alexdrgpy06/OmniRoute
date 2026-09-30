/**
 * Provider Cockpit — windowed per-model call statistics (src/lib/db/providerStats.ts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-cockpit-db-stats-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const stats = await import("../../src/lib/db/providerStats.ts");

function insertCallLog(row: Record<string, unknown>) {
  const full = {
    status: 200,
    model: "gpt-4.1",
    provider: "openai",
    duration: 100,
    tokens_in: 10,
    tokens_out: 20,
    error_summary: null,
    ...row,
    id: row.id ?? `log-${Math.random().toString(16).slice(2)}`,
    timestamp: row.timestamp ?? new Date().toISOString(),
  };
  core
    .getDbInstance()
    .prepare(
      `INSERT INTO call_logs (id, timestamp, method, path, status, model, provider, duration,
         tokens_in, tokens_out, error_summary)
       VALUES (@id, @timestamp, 'POST', '/v1/chat/completions', @status, @model, @provider,
         @duration, @tokens_in, @tokens_out, @error_summary)`
    )
    .run(full);
}

const HOUR = 3600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

test.before(() => {
  core.resetDbInstance();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("getModelWindowStats aggregates only rows inside the window", () => {
  insertCallLog({ provider: "openai", model: "gpt-4.1", status: 200, duration: 100 });
  insertCallLog({ provider: "openai", model: "gpt-4.1", status: 200, duration: 300 });
  insertCallLog({
    provider: "openai",
    model: "gpt-4.1",
    status: 429,
    duration: 50,
    error_summary: "rate limited",
    timestamp: iso(60_000),
  });
  // Outside a 1h window.
  insertCallLog({ provider: "openai", model: "gpt-4.1", status: 500, timestamp: iso(5 * HOUR) });
  // Placeholder provider rows are ignored.
  insertCallLog({ provider: "-", model: "gpt-4.1" });

  const rows = stats.getModelWindowStats(iso(HOUR));
  const row = rows.find((r) => r.provider === "openai" && r.model === "gpt-4.1");
  assert.ok(row, "expected an openai/gpt-4.1 row");
  assert.equal(row.requests, 3);
  assert.equal(row.successfulRequests, 2);
  assert.equal(row.tokensIn, 30);
  assert.equal(row.tokensOut, 60);
  assert.equal(row.lastError, "rate limited");
  assert.ok(row.lastErrorAt);
  assert.ok(row.lastCallAt);
  assert.equal(
    rows.some((r) => r.provider === "-"),
    false
  );
});

test("getModelLatencyPercentiles computes p50/p95 over successful calls only", () => {
  for (let i = 1; i <= 20; i++) {
    insertCallLog({ provider: "groq", model: "llama-3.1-8b", status: 200, duration: i * 100 });
  }
  insertCallLog({ provider: "groq", model: "llama-3.1-8b", status: 500, duration: 999_999 });

  const rows = stats.getModelLatencyPercentiles(iso(HOUR));
  const row = rows.find((r) => r.provider === "groq" && r.model === "llama-3.1-8b");
  assert.ok(row);
  assert.equal(row.p50Ms, 1000);
  assert.equal(row.p95Ms, 1900);
});

test("getGlobalLatencyPercentiles returns nulls for an empty window and values otherwise", () => {
  assert.deepEqual(stats.getGlobalLatencyPercentiles(new Date(Date.now() + HOUR).toISOString()), {
    p50Ms: null,
    p95Ms: null,
  });
  const g = stats.getGlobalLatencyPercentiles(iso(HOUR));
  assert.equal(typeof g.p50Ms, "number");
  assert.ok((g.p95Ms ?? 0) >= (g.p50Ms ?? 0));
});
