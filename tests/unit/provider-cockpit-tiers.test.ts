import test from "node:test";
import assert from "node:assert/strict";

import {
  capabilityTier,
  cockpitScore,
  rankModels,
  type CockpitModelMeta,
} from "../../src/lib/providerCockpit/tiers.ts";

const meta = (over: Partial<CockpitModelMeta>): CockpitModelMeta => ({
  model: "some-model",
  costTier: "cheap",
  toolCalling: false,
  supportsReasoning: false,
  contextWindow: null,
  ...over,
});

test("capabilityTier: flagship name patterns land in T1", () => {
  assert.equal(capabilityTier(meta({ model: "claude-opus-4-6", costTier: "premium" })), 1);
  assert.equal(capabilityTier(meta({ model: "gemini-2.5-pro", costTier: "premium" })), 1);
  assert.equal(capabilityTier(meta({ model: "gpt-5", costTier: "premium" })), 1);
  assert.equal(capabilityTier(meta({ model: "claude-fable-5", costTier: "premium" })), 1);
});

test("capabilityTier: light name patterns land in T3", () => {
  assert.equal(capabilityTier(meta({ model: "gemini-2.5-flash-lite" })), 3);
  assert.equal(capabilityTier(meta({ model: "llama-3.1-8b-instant", costTier: "free" })), 3);
  assert.equal(capabilityTier(meta({ model: "claude-3-5-haiku" })), 3);
});

test("capabilityTier: balanced names land in T2", () => {
  assert.equal(capabilityTier(meta({ model: "gpt-4o-mini" })), 2);
  assert.equal(capabilityTier(meta({ model: "gemini-2.5-flash" })), 2);
});

test("capabilityTier: unknown premium model with reasoning+tools is promoted to T1", () => {
  assert.equal(
    capabilityTier(
      meta({ model: "acme-x", costTier: "premium", toolCalling: true, supportsReasoning: true })
    ),
    1
  );
});

test("capabilityTier: unknown free model without capabilities is T3", () => {
  assert.equal(capabilityTier(meta({ model: "acme-x", costTier: "free" })), 3);
});

test("capabilityTier: free flagship keeps T1 (e.g. free gateway serving a pro model)", () => {
  assert.equal(capabilityTier(meta({ model: "qwen3-coder-480b", costTier: "free" })), 1);
});

test("cockpitScore: stays within 0..100", () => {
  for (const s of [
    { tier: 1, successRate: 1, samples: 1000, p50Ms: 1, costPer1M: 0 },
    { tier: 3, successRate: 0, samples: 1000, p50Ms: 120000, costPer1M: 500 },
  ] as const) {
    const v = cockpitScore(s);
    assert.ok(v >= 0 && v <= 100, `score ${v} out of range`);
  }
});

test("cockpitScore: no samples uses the neutral prior (no success penalty)", () => {
  const cold = cockpitScore({ tier: 2, successRate: 0, samples: 0, p50Ms: null, costPer1M: 1 });
  const warmGood = cockpitScore({
    tier: 2,
    successRate: 1,
    samples: 500,
    p50Ms: null,
    costPer1M: 1,
  });
  const warmBad = cockpitScore({
    tier: 2,
    successRate: 0.2,
    samples: 500,
    p50Ms: null,
    costPer1M: 1,
  });
  assert.ok(warmGood > cold, "observed good success should beat the prior");
  assert.ok(cold > warmBad, "prior should beat observed bad success");
});

test("cockpitScore: few samples shrink toward the prior", () => {
  const oneFail = cockpitScore({ tier: 2, successRate: 0, samples: 1, p50Ms: null, costPer1M: 1 });
  const manyFail = cockpitScore({
    tier: 2,
    successRate: 0,
    samples: 500,
    p50Ms: null,
    costPer1M: 1,
  });
  assert.ok(oneFail > manyFail);
});

test("cockpitScore: lower latency and lower cost score higher", () => {
  const base = { tier: 2 as const, successRate: 0.95, samples: 200 };
  assert.ok(
    cockpitScore({ ...base, p50Ms: 400, costPer1M: 1 }) >
      cockpitScore({ ...base, p50Ms: 8000, costPer1M: 1 })
  );
  assert.ok(
    cockpitScore({ ...base, p50Ms: 1000, costPer1M: 0 }) >
      cockpitScore({ ...base, p50Ms: 1000, costPer1M: 30 })
  );
});

test("rankModels: sorts by tier ascending, then score descending, stable on ties", () => {
  const ranked = rankModels([
    { id: "a", tier: 2, score: 50 },
    { id: "b", tier: 1, score: 10 },
    { id: "c", tier: 2, score: 80 },
    { id: "d", tier: 1, score: 10 },
  ]);
  assert.deepEqual(
    ranked.map((m) => m.id),
    ["b", "d", "c", "a"]
  );
});
