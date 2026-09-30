import type { CockpitProvider } from "@/lib/providerCockpit/aggregate";
import { matchesSearch } from "@/shared/utils/turkishText";
import type { CockpitFilterState } from "./CockpitFilters";

/**
 * Apply the cockpit filters. Model-level filters (tier, free, traffic, query on
 * model id) narrow each provider's model list; providers left without models
 * are dropped unless the query matched the provider itself.
 */
export function filterCockpitProviders(
  providers: CockpitProvider[],
  f: CockpitFilterState
): CockpitProvider[] {
  const q = f.query.trim();
  const modelFilterActive = f.tier !== "all" || f.freeOnly || f.withTraffic || q.length > 0;
  const out: CockpitProvider[] = [];
  for (const p of providers) {
    if (f.health !== "all" && p.status !== f.health) continue;
    const providerMatches = q.length > 0 && (matchesSearch(p.id, q) || matchesSearch(p.name, q));
    const models = p.models.filter(
      (m) =>
        (f.tier === "all" || String(m.tier) === f.tier) &&
        (!f.freeOnly || m.costTier === "free") &&
        (!f.withTraffic || m.hasTraffic) &&
        (q.length === 0 || providerMatches || matchesSearch(m.id, q))
    );
    if (modelFilterActive && models.length === 0 && !(providerMatches && p.models.length === 0)) {
      continue;
    }
    out.push({ ...p, models });
  }
  return out;
}
