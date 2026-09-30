"use client";

/**
 * Provider Stats — Provider & Model Cockpit
 *
 * One fetch of /api/provider-stats feeds two views:
 *  - Cockpit: live provider × model matrix (breakers, cooldowns, lockouts,
 *    hybrid tiers, windowed metrics) + recommended combo suite.
 *  - History: the all-time call_logs tables, combo metrics and telemetry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { SegmentedControl } from "@/shared/components";
import type { CockpitPayload, CockpitRange } from "@/lib/providerCockpit/aggregate";
import CockpitKpis from "./components/CockpitKpis";
import CockpitFilters, {
  DEFAULT_FILTERS,
  type CockpitFilterState,
} from "./components/CockpitFilters";
import ProviderMatrix from "./components/ProviderMatrix";
import RecommendedCombos from "./components/RecommendedCombos";
import HistoryView, { type HistoryData } from "./components/HistoryView";
import { filterCockpitProviders } from "./components/cockpitFilter";

type Tab = "cockpit" | "history";
type StatsResponse = HistoryData & { cockpit: CockpitPayload | null };

export default function ProviderStatsPage() {
  const t = useTranslations("providerStats");
  const tc = useTranslations("providerCockpit");
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [tab, setTab] = useState<Tab>("cockpit");
  const [range, setRange] = useState<CockpitRange>("24h");
  const [filters, setFilters] = useState<CockpitFilterState>(DEFAULT_FILTERS);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/provider-stats?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unknownError"));
    }
  }, [range, t]);

  useEffect(() => {
    // Async continuation — see react-hooks/set-state-in-effect.
    void (async () => {
      await fetchData();
    })();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const visibleProviders = useMemo(
    () => (data?.cockpit ? filterCockpitProviders(data.cockpit.providers, filters) : []),
    [data, filters]
  );

  if (!data && !error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <p className="text-text-muted mt-4">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
        <span className="material-symbols-outlined text-red-500 text-[32px] mb-2">error</span>
        <p className="text-red-400">{t("loadFailed", { error })}</p>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm hover:bg-primary/20 transition-colors"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          options={[
            { value: "cockpit", label: tc("tabCockpit"), icon: "monitor_heart" },
            { value: "history", label: tc("tabHistory"), icon: "history" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          aria-label={tc("tabsLabel")}
        />
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-text-muted">
              {t("updated", { time: lastRefresh.toLocaleTimeString() })}
            </span>
          )}
          <button
            onClick={fetchData}
            className="p-2 rounded-lg bg-surface hover:bg-surface/80 text-text-muted hover:text-text-main transition-colors"
            title={t("refresh")}
            aria-label={t("refresh")}
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
          </button>
        </div>
      </div>

      {tab === "cockpit" &&
        (data?.cockpit ? (
          <>
            <CockpitKpis kpis={data.cockpit.kpis} />
            <CockpitFilters
              value={filters}
              onChange={setFilters}
              range={range}
              onRangeChange={setRange}
            />
            <ProviderMatrix providers={visibleProviders} />
            <RecommendedCombos range={range} onApplied={fetchData} />
          </>
        ) : (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400">
            {tc("unavailable")}
          </p>
        ))}

      {tab === "history" && data && <HistoryView data={data} />}
    </div>
  );
}
