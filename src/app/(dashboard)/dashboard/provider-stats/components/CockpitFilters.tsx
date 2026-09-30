"use client";

import { useTranslations } from "next-intl";
import type { CockpitRange, ProviderStatus } from "@/lib/providerCockpit/aggregate";

export interface CockpitFilterState {
  query: string;
  tier: "all" | "1" | "2" | "3";
  health: "all" | ProviderStatus;
  freeOnly: boolean;
  withTraffic: boolean;
}

export const DEFAULT_FILTERS: CockpitFilterState = {
  query: "",
  tier: "all",
  health: "all",
  freeOnly: false,
  withTraffic: false,
};

const RANGES: CockpitRange[] = ["1h", "24h", "7d"];

const controlClass =
  "h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-primary";

export default function CockpitFilters({
  value,
  onChange,
  range,
  onRangeChange,
}: {
  value: CockpitFilterState;
  onChange: (next: CockpitFilterState) => void;
  range: CockpitRange;
  onRangeChange: (range: CockpitRange) => void;
}) {
  const t = useTranslations("providerCockpit");
  const set = <K extends keyof CockpitFilterState>(key: K, v: CockpitFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <span className="material-symbols-outlined text-[16px] text-text-muted absolute left-2 top-1/2 -translate-y-1/2">
          search
        </span>
        <input
          value={value.query}
          onChange={(e) => set("query", e.target.value)}
          placeholder={t("filterSearch")}
          aria-label={t("filterSearch")}
          className={`${controlClass} w-full pl-7`}
        />
      </div>
      <select
        value={value.tier}
        onChange={(e) => set("tier", e.target.value as CockpitFilterState["tier"])}
        aria-label={t("filterTier")}
        className={controlClass}
      >
        <option value="all">{t("filterTierAll")}</option>
        <option value="1">{t("tier1")}</option>
        <option value="2">{t("tier2")}</option>
        <option value="3">{t("tier3")}</option>
      </select>
      <select
        value={value.health}
        onChange={(e) => set("health", e.target.value as CockpitFilterState["health"])}
        aria-label={t("filterHealth")}
        className={controlClass}
      >
        <option value="all">{t("filterHealthAll")}</option>
        <option value="ok">{t("statusOk")}</option>
        <option value="degraded">{t("statusDegraded")}</option>
        <option value="open">{t("statusOpen")}</option>
        <option value="down">{t("statusDown")}</option>
        <option value="disabled">{t("statusDisabled")}</option>
      </select>
      <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.freeOnly}
          onChange={(e) => set("freeOnly", e.target.checked)}
        />
        {t("filterFree")}
      </label>
      <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.withTraffic}
          onChange={(e) => set("withTraffic", e.target.checked)}
        />
        {t("filterTraffic")}
      </label>
      <div
        className="ml-auto flex rounded-lg border border-border overflow-hidden"
        role="group"
        aria-label={t("filterRange")}
      >
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onRangeChange(r)}
            aria-pressed={range === r}
            className={`h-8 px-3 text-xs transition-colors ${
              range === r ? "bg-primary/15 text-primary" : "text-text-muted hover:bg-surface"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
