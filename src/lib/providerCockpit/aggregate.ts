/**
 * Provider Cockpit — unified provider × model payload.
 *
 * `assembleCockpit()` is pure: it merges windowed call stats, live resilience
 * state (provider breakers, connection cooldowns, model lockouts) and the static
 * catalog into one ranked structure. `loadCockpit()` wires the real sources.
 */

import {
  capabilityTier,
  cockpitScore,
  rankModels,
  type CapabilityTier,
  type CostTier,
} from "./tiers";
import type { ModelLatencyPercentile, ModelWindowStat } from "@/lib/db/providerStats";

export type CockpitRange = "1h" | "24h" | "7d";
export const COCKPIT_RANGE_MS: Record<CockpitRange, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

export type ProviderStatus = "ok" | "degraded" | "open" | "down";

export interface CockpitBreaker {
  name: string;
  state: string;
  retryAfterMs: number;
  failureCount: number;
}

export interface CockpitLockout {
  provider: string;
  connectionId: string;
  model: string;
  reason: string;
  remainingMs: number;
}

export interface CockpitConnection {
  id: string;
  provider: string;
  isActive?: boolean | null;
  testStatus?: string | null;
  rateLimitedUntil?: string | number | null;
}

export interface CockpitCatalogModel {
  id: string;
  name?: string;
  toolCalling?: boolean;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
}

export interface CockpitCost {
  tier: CostTier;
  costPer1MInput: number;
  costPer1MOutput: number;
}

export interface CockpitSources {
  now: number;
  windowStats: ModelWindowStat[];
  latency: ModelLatencyPercentile[];
  globalLatency: { p50Ms: number | null; p95Ms: number | null };
  breakers: CockpitBreaker[];
  lockouts: CockpitLockout[];
  connections: CockpitConnection[];
  catalog: Record<string, readonly CockpitCatalogModel[]>;
  classifyCost: (provider: string, model: string) => CockpitCost;
  contextWindow: (model: string) => number | null;
  displayName: (provider: string) => string;
}

export interface CockpitModel {
  id: string;
  name: string;
  tier: CapabilityTier;
  costTier: CostTier;
  score: number;
  requests: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  tokensIn: number;
  tokensOut: number;
  costPer1MInput: number;
  costPer1MOutput: number;
  toolCalling: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  contextWindow: number | null;
  lockedConnections: number;
  lastCallAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  inCatalog: boolean;
  hasTraffic: boolean;
  eligible: boolean;
}

export interface CockpitProvider {
  id: string;
  name: string;
  status: ProviderStatus;
  breaker: { state: string; retryAfterMs: number; failureCount: number };
  connections: {
    total: number;
    active: number;
    cooldown: number;
    terminal: number;
    disabled: number;
  };
  usableConnectionIds: string[];
  requests: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  models: CockpitModel[];
}

export interface CockpitPayload {
  generatedAt: string;
  kpis: {
    requests: number;
    successRate: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
    providers: { total: number; ok: number; degraded: number; open: number; down: number };
  };
  providers: CockpitProvider[];
}

const TERMINAL_STATUSES = new Set(["banned", "expired", "credits_exhausted"]);
const DEGRADED_SUCCESS_RATE = 0.8;
const DEGRADED_MIN_SAMPLES = 10;

function stripProviderPrefix(provider: string, model: string): string {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

function untilMs(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function ratio(ok: number, total: number): number | null {
  return total > 0 ? ok / total : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface ModelAccumulator {
  id: string;
  name: string;
  catalog: CockpitCatalogModel | null;
  stat: ModelWindowStat | null;
  latency: ModelLatencyPercentile | null;
}

export function assembleCockpit(src: CockpitSources): CockpitPayload {
  const providerIds = new Set<string>();
  for (const c of src.connections) providerIds.add(c.provider);
  for (const s of src.windowStats) providerIds.add(s.provider);

  const breakerByName = new Map(src.breakers.map((b) => [b.name, b]));
  let estimatedCostUsd = 0;
  let totalRequests = 0;
  let totalOk = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  const providers: CockpitProvider[] = [];
  for (const providerId of providerIds) {
    const conns = src.connections.filter((c) => c.provider === providerId);
    const counts = { total: conns.length, active: 0, cooldown: 0, terminal: 0, disabled: 0 };
    const usableConnectionIds: string[] = [];
    for (const c of conns) {
      const status = (c.testStatus || "").trim().toLowerCase();
      if (c.isActive === false) counts.disabled++;
      else if (TERMINAL_STATUSES.has(status)) counts.terminal++;
      else if (untilMs(c.rateLimitedUntil) > src.now) counts.cooldown++;
      else {
        counts.active++;
        usableConnectionIds.push(c.id);
      }
    }

    // Models: catalog entries (configured providers) ∪ observed traffic.
    const models = new Map<string, ModelAccumulator>();
    for (const m of src.catalog[providerId] ?? []) {
      models.set(m.id, { id: m.id, name: m.name || m.id, catalog: m, stat: null, latency: null });
    }
    for (const s of src.windowStats.filter((row) => row.provider === providerId)) {
      const id = stripProviderPrefix(providerId, s.model);
      const acc = models.get(id) ?? { id, name: id, catalog: null, stat: null, latency: null };
      acc.stat = s;
      models.set(id, acc);
    }
    for (const l of src.latency.filter((row) => row.provider === providerId)) {
      const acc = models.get(stripProviderPrefix(providerId, l.model));
      if (acc) acc.latency = l;
    }

    const breaker = breakerByName.get(providerId);
    const breakerState = (breaker?.state || "CLOSED").toUpperCase();
    const providerRequests = [...models.values()].reduce((n, m) => n + (m.stat?.requests ?? 0), 0);
    const providerOk = [...models.values()].reduce(
      (n, m) => n + (m.stat?.successfulRequests ?? 0),
      0
    );
    const providerSuccess = ratio(providerOk, providerRequests);

    let status: ProviderStatus = "ok";
    if (breakerState === "OPEN") status = "open";
    else if (counts.total > 0 && counts.active === 0 && counts.cooldown === 0) status = "down";
    else if (
      breakerState === "DEGRADED" ||
      breakerState === "HALF_OPEN" ||
      counts.cooldown > 0 ||
      (providerSuccess !== null &&
        providerRequests >= DEGRADED_MIN_SAMPLES &&
        providerSuccess < DEGRADED_SUCCESS_RATE)
    ) {
      status = "degraded";
    }
    const providerUsable = status !== "open" && status !== "down";
    // Providers with no stored connections (noAuth/free gateways) are usable as a whole.
    const lockableConnectionIds = counts.total > 0 ? new Set(usableConnectionIds) : null;

    const built: CockpitModel[] = [];
    let latencyWeighted = 0;
    let latencyWeight = 0;
    let lastError: string | null = null;
    let lastErrorAt: string | null = null;
    for (const acc of models.values()) {
      const cost = src.classifyCost(providerId, acc.id);
      const stat = acc.stat;
      const requests = stat?.requests ?? 0;
      const successRate = ratio(stat?.successfulRequests ?? 0, requests);
      const toolCalling = acc.catalog?.toolCalling === true;
      const supportsReasoning = acc.catalog?.supportsReasoning === true;
      const contextWindow = src.contextWindow(acc.id);
      const tier = capabilityTier({
        model: acc.id,
        costTier: cost.tier,
        toolCalling,
        supportsReasoning,
        contextWindow,
      });
      const p50Ms = acc.latency?.p50Ms ?? null;
      const score = cockpitScore({
        tier,
        successRate: successRate ?? 0,
        samples: requests,
        p50Ms: p50Ms ?? stat?.avgLatencyMs ?? null,
        costPer1M: (cost.costPer1MInput + cost.costPer1MOutput) / 2,
      });

      const lockedOn = new Set(
        src.lockouts
          .filter(
            (l) => l.provider === providerId && stripProviderPrefix(providerId, l.model) === acc.id
          )
          .map((l) => l.connectionId)
      );
      const lockedAll =
        lockableConnectionIds !== null &&
        lockableConnectionIds.size > 0 &&
        [...lockableConnectionIds].every((id) => lockedOn.has(id));

      if (stat) {
        estimatedCostUsd +=
          (stat.tokensIn * cost.costPer1MInput + stat.tokensOut * cost.costPer1MOutput) / 1_000_000;
        totalTokensIn += stat.tokensIn;
        totalTokensOut += stat.tokensOut;
        if (stat.avgLatencyMs !== null) {
          latencyWeighted += stat.avgLatencyMs * requests;
          latencyWeight += requests;
        }
        if (stat.lastErrorAt && (!lastErrorAt || stat.lastErrorAt > lastErrorAt)) {
          lastErrorAt = stat.lastErrorAt;
          lastError = stat.lastError;
        }
      }

      built.push({
        id: acc.id,
        name: acc.name,
        tier,
        costTier: cost.tier,
        score,
        requests,
        successRate,
        avgLatencyMs: stat?.avgLatencyMs ?? null,
        p50Ms,
        p95Ms: acc.latency?.p95Ms ?? null,
        tokensIn: stat?.tokensIn ?? 0,
        tokensOut: stat?.tokensOut ?? 0,
        costPer1MInput: cost.costPer1MInput,
        costPer1MOutput: cost.costPer1MOutput,
        toolCalling,
        supportsReasoning,
        supportsVision: acc.catalog?.supportsVision === true,
        contextWindow,
        lockedConnections: lockedOn.size,
        lastCallAt: stat?.lastCallAt ?? null,
        lastErrorAt: stat?.lastErrorAt ?? null,
        lastError: stat?.lastError ?? null,
        inCatalog: acc.catalog !== null,
        hasTraffic: requests > 0,
        eligible: providerUsable && !lockedAll,
      });
    }

    totalRequests += providerRequests;
    totalOk += providerOk;
    providers.push({
      id: providerId,
      name: src.displayName(providerId),
      status,
      breaker: {
        state: breakerState,
        retryAfterMs: breaker?.retryAfterMs ?? 0,
        failureCount: breaker?.failureCount ?? 0,
      },
      connections: counts,
      usableConnectionIds,
      requests: providerRequests,
      successRate: providerSuccess,
      avgLatencyMs: latencyWeight > 0 ? Math.round(latencyWeighted / latencyWeight) : null,
      lastError,
      lastErrorAt,
      models: rankModels(built),
    });
  }

  providers.sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));
  const byStatus = { ok: 0, degraded: 0, open: 0, down: 0 };
  for (const p of providers) byStatus[p.status]++;

  return {
    generatedAt: new Date(src.now).toISOString(),
    kpis: {
      requests: totalRequests,
      successRate: ratio(totalOk, totalRequests),
      p50Ms: src.globalLatency.p50Ms,
      p95Ms: src.globalLatency.p95Ms,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      estimatedCostUsd: round2(estimatedCostUsd),
      providers: { total: providers.length, ...byStatus },
    },
    providers,
  };
}

/** Wire the real runtime sources. Each optional source degrades to empty on failure. */
export async function loadCockpit(range: CockpitRange = "24h"): Promise<CockpitPayload> {
  const now = Date.now();
  const sinceIso = new Date(now - COCKPIT_RANGE_MS[range]).toISOString();

  const [statsDb, providersDb, registry, tierResolver, modelSpecs, providersConst] =
    await Promise.all([
      import("@/lib/db/providerStats"),
      import("@/lib/db/providers"),
      import("@omniroute/open-sse/config/providerRegistry.ts"),
      import("@omniroute/open-sse/services/tierResolver.ts"),
      import("@/shared/constants/modelSpecs"),
      import("@/shared/constants/providers"),
    ]);

  const safe = async <T>(fn: () => T | Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  const breakers = await safe(async () => {
    const { getAllCircuitBreakerStatuses } = await import("@/shared/utils/circuitBreaker");
    return getAllCircuitBreakerStatuses() as CockpitBreaker[];
  }, []);
  const lockouts = await safe(async () => {
    const { getAllModelLockouts } = await import("@omniroute/open-sse/services/accountFallback");
    return getAllModelLockouts() as CockpitLockout[];
  }, []);
  const connections = (await safe(
    () => providersDb.getProviderConnections(),
    []
  )) as unknown as CockpitConnection[];

  const catalog: Record<string, readonly CockpitCatalogModel[]> = {};
  for (const providerId of new Set(connections.map((c) => c.provider))) {
    const entry = registry.getRegistryEntry(providerId);
    if (entry?.models?.length) catalog[providerId] = entry.models;
  }

  const aiProviders = providersConst.AI_PROVIDERS as Record<string, { name?: string } | undefined>;

  return assembleCockpit({
    now,
    windowStats: statsDb.getModelWindowStats(sinceIso),
    latency: statsDb.getModelLatencyPercentiles(sinceIso),
    globalLatency: statsDb.getGlobalLatencyPercentiles(sinceIso),
    breakers,
    lockouts,
    connections,
    catalog,
    classifyCost: (provider, model) => {
      const t = tierResolver.classifyTier(provider, model);
      return {
        tier: t.tier as CostTier,
        costPer1MInput: t.costPer1MInput || 0,
        costPer1MOutput: t.costPer1MOutput || 0,
      };
    },
    contextWindow: (model) => modelSpecs.getAuthoritativeContextWindow(model),
    displayName: (provider) => aiProviders[provider]?.name || provider,
  });
}
