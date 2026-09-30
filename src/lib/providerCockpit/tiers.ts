/**
 * Provider Cockpit — hybrid capability tiers + efficiency score.
 *
 * Pure, framework-free. The cost dimension comes from the routing tier
 * resolver (`open-sse/services/tierResolver.ts::classifyTier` → free/cheap/premium);
 * this module adds a *capability* tier (T1 flagship / T2 balanced / T3 light)
 * and a 0..100 score that blends capability, observed success, latency and cost.
 */

export type CostTier = "free" | "cheap" | "premium";
export type CapabilityTier = 1 | 2 | 3;

export interface CockpitModelMeta {
  model: string;
  costTier: CostTier;
  toolCalling: boolean;
  supportsReasoning: boolean;
  contextWindow: number | null;
}

export interface CockpitScoreInput {
  tier: CapabilityTier;
  /** Observed success ratio in [0,1]; ignored when samples === 0. */
  successRate: number;
  samples: number;
  /** Observed median latency; null when unknown (neutral). */
  p50Ms: number | null;
  /** Blended $/1M tokens; 0 for free. */
  costPer1M: number;
}

// Light models: explicit "small" markers. Checked first so e.g. "flash-lite"
// never matches the balanced "flash" marker.
const LIGHT_PATTERN = /(^|[-_.:/])(lite|nano|tiny|haiku|small|micro)([-_.:/]|$)/i;
// Balanced markers.
const BALANCED_PATTERN = /(^|[-_.:/])(mini|flash|turbo|air|medium|instant)([-_.:/]|$)/i;
// Flagship markers.
const FLAGSHIP_PATTERN =
  /(^|[-_.:/])(opus|fable|sonnet|pro|ultra|max|large|r1|k2|reasoner|thinking)([-_.:/]|$)|gpt-5(?![-.]?(mini|nano))|(^|[-_/])o[134](?![-.]?mini)([-_.:/]|$)|grok-4|deepseek-v3/i;
// Parameter-size marker such as "-8b", ":70b", "-480b" (not "a3b" MoE active size).
const PARAM_SIZE_PATTERN = /(?:^|[-_.:/])(\d+(?:\.\d+)?)b(?:[-_.:/]|$)/i;

const SUCCESS_PRIOR = 0.9;
const PRIOR_WEIGHT = 20;
const TIER_WEIGHT: Record<CapabilityTier, number> = { 1: 1, 2: 0.7, 3: 0.45 };

export function capabilityTier(meta: CockpitModelMeta): CapabilityTier {
  const name = meta.model;

  const size = PARAM_SIZE_PATTERN.exec(name);
  if (size) {
    const billions = Number(size[1]);
    if (billions >= 200) return 1;
    if (billions <= 14) return 3;
  }

  if (LIGHT_PATTERN.test(name)) return 3;
  if (BALANCED_PATTERN.test(name)) return 2;
  if (FLAGSHIP_PATTERN.test(name)) return 1;

  if (meta.costTier === "premium" && meta.toolCalling && meta.supportsReasoning) return 1;
  if (meta.costTier === "free" && !meta.toolCalling && !meta.supportsReasoning) return 3;
  return 2;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function cockpitScore(input: CockpitScoreInput): number {
  const samples = Math.max(0, input.samples || 0);
  const observed = clamp01(input.successRate);
  // Bayesian shrinkage: few samples stay close to the neutral prior.
  const success = (observed * samples + SUCCESS_PRIOR * PRIOR_WEIGHT) / (samples + PRIOR_WEIGHT);
  const latency =
    input.p50Ms === null || !Number.isFinite(input.p50Ms)
      ? 0.5
      : 1 / (1 + Math.max(0, input.p50Ms) / 3000);
  const cost = 1 / (1 + Math.max(0, input.costPer1M || 0) / 5);

  const raw =
    0.35 * TIER_WEIGHT[input.tier] + 0.35 * success + 0.15 * clamp01(latency) + 0.15 * cost;
  return Math.round(clamp01(raw) * 1000) / 10;
}

export function rankModels<T extends { tier: CapabilityTier; score: number }>(models: T[]): T[] {
  return models
    .map((model, index) => ({ model, index }))
    .sort(
      (a, b) => a.model.tier - b.model.tier || b.model.score - a.model.score || a.index - b.index
    )
    .map(({ model }) => model);
}
