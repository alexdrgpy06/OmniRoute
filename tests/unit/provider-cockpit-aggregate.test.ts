import test from "node:test";
import assert from "node:assert/strict";

import { assembleCockpit, type CockpitSources } from "../../src/lib/providerCockpit/aggregate.ts";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

function sources(over: Partial<CockpitSources> = {}): CockpitSources {
  return {
    now: NOW,
    windowStats: [],
    latency: [],
    globalLatency: { p50Ms: null, p95Ms: null },
    breakers: [],
    lockouts: [],
    connections: [],
    catalog: {},
    classifyCost: () => ({ tier: "cheap", costPer1MInput: 1, costPer1MOutput: 2 }),
    contextWindow: () => null,
    displayName: (p) => p.toUpperCase(),
    ...over,
  };
}

const conn = (over: Record<string, unknown>) => ({
  id: "c1",
  provider: "openai",
  isActive: true,
  testStatus: "active",
  rateLimitedUntil: null,
  ...over,
});

test("configured provider lists catalog models even without traffic", () => {
  const payload = assembleCockpit(
    sources({
      connections: [conn({})],
      catalog: { openai: [{ id: "gpt-5", name: "GPT-5", toolCalling: true }] },
    })
  );
  assert.equal(payload.providers.length, 1);
  const p = payload.providers[0];
  assert.equal(p.name, "OPENAI");
  assert.equal(p.status, "ok");
  assert.equal(p.models.length, 1);
  assert.equal(p.models[0].id, "gpt-5");
  assert.equal(p.models[0].hasTraffic, false);
  assert.equal(p.models[0].tier, 1);
  assert.equal(p.models[0].eligible, true);
});

test("traffic merges into catalog models, matching provider-prefixed ids", () => {
  const payload = assembleCockpit(
    sources({
      connections: [conn({})],
      catalog: { openai: [{ id: "gpt-4.1", name: "GPT-4.1" }] },
      windowStats: [
        {
          provider: "openai",
          model: "openai/gpt-4.1",
          requests: 10,
          successfulRequests: 9,
          avgLatencyMs: 800,
          tokensIn: 1000,
          tokensOut: 500,
          lastCallAt: "2026-09-30T11:59:00.000Z",
          lastErrorAt: null,
          lastError: null,
        },
      ],
      latency: [{ provider: "openai", model: "openai/gpt-4.1", p50Ms: 700, p95Ms: 1500 }],
    })
  );
  const models = payload.providers[0].models;
  assert.equal(models.length, 1, "prefixed log model must merge into the catalog entry");
  assert.equal(models[0].requests, 10);
  assert.equal(models[0].successRate, 0.9);
  assert.equal(models[0].p50Ms, 700);
  assert.equal(models[0].p95Ms, 1500);
  assert.equal(payload.kpis.requests, 10);
  assert.equal(payload.kpis.successRate, 0.9);
});

test("OPEN breaker marks the provider open and its models ineligible", () => {
  const payload = assembleCockpit(
    sources({
      connections: [conn({})],
      catalog: { openai: [{ id: "gpt-5", name: "GPT-5" }] },
      breakers: [{ name: "openai", state: "OPEN", retryAfterMs: 5000, failureCount: 12 }],
    })
  );
  const p = payload.providers[0];
  assert.equal(p.status, "open");
  assert.equal(p.breaker.state, "OPEN");
  assert.equal(p.models[0].eligible, false);
  assert.equal(payload.kpis.providers.open, 1);
});

test("connection counts split active / cooldown / terminal / disabled", () => {
  const payload = assembleCockpit(
    sources({
      connections: [
        conn({ id: "a" }),
        conn({ id: "b", rateLimitedUntil: new Date(NOW + 60_000).toISOString() }),
        conn({ id: "c", rateLimitedUntil: new Date(NOW - 60_000).toISOString() }),
        conn({ id: "d", testStatus: "banned" }),
        conn({ id: "e", isActive: false }),
      ],
    })
  );
  const p = payload.providers[0];
  assert.deepEqual(p.connections, { total: 5, active: 2, cooldown: 1, terminal: 1, disabled: 1 });
  assert.deepEqual(p.usableConnectionIds.sort(), ["a", "c"]);
  assert.equal(p.status, "degraded");
});

test("all connections terminal → provider down", () => {
  const payload = assembleCockpit(
    sources({
      connections: [
        conn({ testStatus: "expired" }),
        conn({ id: "x", testStatus: "credits_exhausted" }),
      ],
    })
  );
  assert.equal(payload.providers[0].status, "down");
});

test("model locked on every usable connection is ineligible; partial lock stays eligible", () => {
  const base = {
    connections: [conn({ id: "a" }), conn({ id: "b" })],
    catalog: {
      openai: [
        { id: "gpt-5", name: "GPT-5" },
        { id: "gpt-4.1", name: "GPT-4.1" },
      ],
    },
  };
  const payload = assembleCockpit(
    sources({
      ...base,
      lockouts: [
        {
          provider: "openai",
          connectionId: "a",
          model: "gpt-5",
          reason: "quota",
          remainingMs: 1000,
        },
        {
          provider: "openai",
          connectionId: "b",
          model: "gpt-5",
          reason: "quota",
          remainingMs: 1000,
        },
        {
          provider: "openai",
          connectionId: "a",
          model: "gpt-4.1",
          reason: "quota",
          remainingMs: 1000,
        },
      ],
    })
  );
  const byId = Object.fromEntries(payload.providers[0].models.map((m) => [m.id, m]));
  assert.equal(byId["gpt-5"].eligible, false);
  assert.equal(byId["gpt-5"].lockedConnections, 2);
  assert.equal(byId["gpt-4.1"].eligible, true);
});

test("unconfigured provider with traffic (noAuth) is included and usable", () => {
  const payload = assembleCockpit(
    sources({
      classifyCost: () => ({ tier: "free", costPer1MInput: 0, costPer1MOutput: 0 }),
      windowStats: [
        {
          provider: "pollinations",
          model: "openai-large",
          requests: 4,
          successfulRequests: 4,
          avgLatencyMs: 900,
          tokensIn: 1,
          tokensOut: 1,
          lastCallAt: null,
          lastErrorAt: null,
          lastError: null,
        },
      ],
    })
  );
  const p = payload.providers[0];
  assert.equal(p.id, "pollinations");
  assert.equal(p.status, "ok");
  assert.equal(p.models[0].costTier, "free");
  assert.equal(p.models[0].eligible, true);
});

test("models are ranked by tier then score within each provider", () => {
  const payload = assembleCockpit(
    sources({
      connections: [conn({})],
      catalog: {
        openai: [
          { id: "gpt-4o-mini", name: "mini" },
          { id: "gpt-5", name: "5" },
          { id: "gpt-5-nano", name: "nano" },
        ],
      },
    })
  );
  assert.deepEqual(
    payload.providers[0].models.map((m) => m.id),
    ["gpt-5", "gpt-4o-mini", "gpt-5-nano"]
  );
});

test("estimated cost sums tokens × per-1M prices", () => {
  const payload = assembleCockpit(
    sources({
      classifyCost: () => ({ tier: "premium", costPer1MInput: 2, costPer1MOutput: 8 }),
      windowStats: [
        {
          provider: "openai",
          model: "gpt-5",
          requests: 1,
          successfulRequests: 1,
          avgLatencyMs: 1,
          tokensIn: 1_000_000,
          tokensOut: 500_000,
          lastCallAt: null,
          lastErrorAt: null,
          lastError: null,
        },
      ],
    })
  );
  assert.equal(payload.kpis.estimatedCostUsd, 6);
});
