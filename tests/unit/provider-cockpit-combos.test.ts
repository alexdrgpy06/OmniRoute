import test from "node:test";
import assert from "node:assert/strict";

import {
  COCKPIT_COMBO_PREFIX,
  diffCockpitCombos,
  generateCockpitCombos,
} from "../../src/lib/providerCockpit/combos.ts";
import type {
  CockpitModel,
  CockpitPayload,
  CockpitProvider,
} from "../../src/lib/providerCockpit/aggregate.ts";
import { createComboSchema } from "../../src/shared/validation/schemas/combo.ts";

function model(over: Partial<CockpitModel> & { id: string }): CockpitModel {
  return {
    name: over.id,
    tier: 2,
    costTier: "cheap",
    score: 50,
    requests: 0,
    successRate: null,
    avgLatencyMs: null,
    p50Ms: null,
    p95Ms: null,
    tokensIn: 0,
    tokensOut: 0,
    costPer1MInput: 1,
    costPer1MOutput: 2,
    toolCalling: false,
    supportsReasoning: false,
    supportsVision: false,
    contextWindow: null,
    lockedConnections: 0,
    lastCallAt: null,
    lastErrorAt: null,
    lastError: null,
    inCatalog: true,
    hasTraffic: false,
    eligible: true,
    ...over,
  };
}

function provider(
  id: string,
  models: CockpitModel[],
  over: Partial<CockpitProvider> = {}
): CockpitProvider {
  return {
    id,
    name: id,
    status: "ok",
    breaker: { state: "CLOSED", retryAfterMs: 0, failureCount: 0 },
    connections: { total: 2, active: 2, cooldown: 0, terminal: 0, disabled: 0 },
    usableConnectionIds: [`${id}-c1`, `${id}-c2`],
    requests: 0,
    successRate: null,
    avgLatencyMs: null,
    lastError: null,
    lastErrorAt: null,
    models,
    ...over,
  };
}

function payload(providers: CockpitProvider[]): CockpitPayload {
  return {
    generatedAt: "2026-09-30T12:00:00.000Z",
    kpis: {
      requests: 0,
      successRate: null,
      p50Ms: null,
      p95Ms: null,
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostUsd: 0,
      providers: { total: providers.length, ok: providers.length, degraded: 0, open: 0, down: 0 },
    },
    providers,
  };
}

const fixture = () =>
  payload([
    provider("anthropic", [
      model({
        id: "claude-opus-4-6",
        tier: 1,
        costTier: "premium",
        score: 90,
        toolCalling: true,
        supportsReasoning: true,
      }),
      model({
        id: "claude-sonnet-4-6",
        tier: 1,
        costTier: "premium",
        score: 85,
        toolCalling: true,
      }),
      model({
        id: "claude-3-7-sonnet",
        tier: 1,
        costTier: "premium",
        score: 70,
        toolCalling: true,
      }),
      model({ id: "claude-3-5-haiku", tier: 3, costTier: "cheap", score: 60, p50Ms: 400 }),
    ]),
    provider("openai", [
      model({ id: "gpt-5", tier: 1, costTier: "premium", score: 88, toolCalling: true }),
      model({ id: "gpt-4o-mini", tier: 2, costTier: "cheap", score: 65, p50Ms: 600 }),
    ]),
    provider(
      "groq",
      [
        model({
          id: "llama-3.1-8b-instant",
          tier: 3,
          costTier: "free",
          score: 70,
          p50Ms: 150,
          requests: 50,
          successRate: 0.99,
        }),
        model({ id: "qwen3-32b", tier: 2, costTier: "free", score: 72, p50Ms: 300 }),
      ],
      {
        connections: { total: 0, active: 0, cooldown: 0, terminal: 0, disabled: 0 },
        usableConnectionIds: [],
      }
    ),
    provider(
      "broken",
      [model({ id: "gpt-5", tier: 1, costTier: "premium", score: 99, toolCalling: true })],
      {
        status: "open",
      }
    ),
    provider("anthropic-locked", [
      model({
        id: "claude-opus-4-6",
        tier: 1,
        costTier: "premium",
        score: 99,
        toolCalling: true,
        eligible: false,
      }),
    ]),
  ]);

const byName = (list: ReturnType<typeof generateCockpitCombos>) =>
  Object.fromEntries(list.map((c) => [c.name, c]));

const targetsOf = (combo: { models: unknown[] }) =>
  combo.models.map((m) => {
    const step = m as { kind?: string; model?: string; comboName?: string };
    return step.kind === "combo-ref" ? `ref:${step.comboName}` : String(step.model);
  });

test("every generated combo carries the cockpit- prefix and passes createComboSchema", () => {
  for (const combo of generateCockpitCombos(fixture())) {
    assert.ok(combo.name.startsWith(COCKPIT_COMBO_PREFIX), combo.name);
    const parsed = createComboSchema.safeParse(combo);
    assert.ok(parsed.success, `${combo.name}: ${JSON.stringify(parsed.error?.issues)}`);
  }
});

test("open providers and ineligible models are never targets", () => {
  for (const combo of generateCockpitCombos(fixture())) {
    for (const t of targetsOf(combo)) {
      assert.ok(!t.startsWith("broken/"), `${combo.name} targets open provider: ${t}`);
      assert.ok(!t.startsWith("anthropic-locked/"), `${combo.name} targets locked model: ${t}`);
    }
  }
});

test("flagship-coding: T1 tool models by score, at most 2 per provider", () => {
  const combo = byName(generateCockpitCombos(fixture()))["cockpit-flagship-coding"];
  assert.equal(combo.strategy, "priority");
  assert.deepEqual(targetsOf(combo), [
    "anthropic/claude-opus-4-6",
    "openai/gpt-5",
    "anthropic/claude-sonnet-4-6",
  ]);
  assert.equal(combo.config.targetTimeoutMs, 90_000);
  assert.equal(combo.config.reasoningTokenBufferEnabled, true);
});

test("fast-economy: non-premium T2/T3, fastest first, p2c", () => {
  const combo = byName(generateCockpitCombos(fixture()))["cockpit-fast-economy"];
  assert.equal(combo.strategy, "p2c");
  assert.deepEqual(targetsOf(combo), [
    "groq/llama-3.1-8b-instant",
    "groq/qwen3-32b",
    "anthropic/claude-3-5-haiku",
    "openai/gpt-4o-mini",
  ]);
  assert.equal(combo.config.targetTimeoutMs, 45_000);
});

test("free-unlimited: free models only, round-robin", () => {
  const combo = byName(generateCockpitCombos(fixture()))["cockpit-free-unlimited"];
  assert.equal(combo.strategy, "round-robin");
  assert.deepEqual(targetsOf(combo).sort(), ["groq/llama-3.1-8b-instant", "groq/qwen3-32b"]);
  // Timeout follows the best tier present (qwen3-32b is T2).
  assert.equal(combo.config.targetTimeoutMs, 45_000);
});

test("provider-resilient: one per healthy provider with ≥2 eligible models, scoped to usable connections", () => {
  const combos = byName(generateCockpitCombos(fixture()));
  assert.ok(combos["cockpit-anthropic-resilient"]);
  assert.ok(combos["cockpit-openai-resilient"]);
  assert.ok(combos["cockpit-groq-resilient"]);
  assert.equal(combos["cockpit-broken-resilient"], undefined);
  assert.equal(combos["cockpit-anthropic-locked-resilient"], undefined);

  const anthropic = combos["cockpit-anthropic-resilient"];
  assert.equal(targetsOf(anthropic)[0], "anthropic/claude-opus-4-6");
  for (const step of anthropic.models as Array<{ allowedConnectionIds?: string[] }>) {
    assert.deepEqual(step.allowedConnectionIds, ["anthropic-c1", "anthropic-c2"]);
  }
  // noAuth provider without stored connections: no connection scoping.
  for (const step of combos["cockpit-groq-resilient"].models as Array<{
    allowedConnectionIds?: string[];
  }>) {
    assert.equal(step.allowedConnectionIds, undefined);
  }
});

test("universal-safeguard chains the use-case combos then a stable free last resort", () => {
  const list = generateCockpitCombos(fixture());
  const universal = byName(list)["cockpit-universal-safeguard"];
  assert.deepEqual(targetsOf(universal), [
    "ref:cockpit-flagship-coding",
    "ref:cockpit-fast-economy",
    "ref:cockpit-free-unlimited",
    "groq/llama-3.1-8b-instant",
  ]);
  assert.equal(universal.config.nestedComboMode, "execute");
  assert.equal(universal.config.maxComboDepth, 3);
  // Referenced combos are emitted before the universal one (apply order).
  const idx = (n: string) => list.findIndex((c) => c.name === n);
  assert.ok(idx("cockpit-flagship-coding") < idx("cockpit-universal-safeguard"));
  assert.ok(idx("cockpit-free-unlimited") < idx("cockpit-universal-safeguard"));
});

test("safeguards are applied to every combo", () => {
  for (const combo of generateCockpitCombos(fixture())) {
    assert.equal(combo.config.maxGlobalAttempts, 12, combo.name);
    assert.equal(combo.config.maxRetries, 1, combo.name);
    assert.equal(combo.config.retryDelayMs, 500, combo.name);
    assert.equal(combo.config.fallbackDelayMs, 250, combo.name);
    assert.equal(combo.config.healthCheckEnabled, true, combo.name);
    assert.equal(combo.config.trackMetrics, true, combo.name);
  }
});

test("empty combos are skipped and universal only references emitted combos", () => {
  const list = generateCockpitCombos(
    payload([
      provider("openai", [model({ id: "gpt-5", tier: 1, costTier: "premium", toolCalling: true })]),
    ])
  );
  const names = list.map((c) => c.name);
  assert.ok(!names.includes("cockpit-free-unlimited"));
  assert.ok(!names.includes("cockpit-fast-economy"));
  const universal = byName(list)["cockpit-universal-safeguard"];
  assert.deepEqual(targetsOf(universal), ["ref:cockpit-flagship-coding"]);
});

test("nothing eligible → no combos at all", () => {
  assert.deepEqual(generateCockpitCombos(payload([])), []);
});

test("diff: create, update, unchanged and stale (never deletes hand-made combos)", () => {
  const generated = generateCockpitCombos(fixture());
  const first = diffCockpitCombos(generated, []);
  assert.equal(first.create.length, generated.length);
  assert.equal(first.update.length + first.unchanged.length, 0);

  // Re-running against what was just created is a no-op (idempotent).
  const existing = generated.map((c, i) => ({ id: `id-${i}`, ...structuredClone(c) }));
  existing.push({
    id: "hand",
    name: "my-combo",
    models: ["openai/gpt-5"],
    strategy: "priority",
    config: {},
  } as never);
  existing.push({
    id: "old",
    name: "cockpit-gone",
    models: ["x/y"],
    strategy: "priority",
    config: {},
  } as never);
  const second = diffCockpitCombos(generated, existing);
  assert.equal(second.create.length, 0);
  assert.equal(second.update.length, 0);
  assert.equal(second.unchanged.length, generated.length);
  assert.deepEqual(second.stale, ["cockpit-gone"]);

  existing[0].strategy = "weighted";
  const third = diffCockpitCombos(generated, existing);
  assert.equal(third.update.length, 1);
  assert.equal(third.update[0].id, "id-0");
});
