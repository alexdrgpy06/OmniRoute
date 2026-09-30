"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/shared/components";
import type { CockpitPayload } from "@/lib/providerCockpit/aggregate";
import { formatCount, formatMs, formatRate, formatUsd, rateClass } from "./cockpitFormat";

function Kpi({
  icon,
  tone,
  label,
  children,
}: {
  icon: string;
  tone: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={`flex items-center justify-center size-8 rounded-lg ${tone}`}>
          <span className="material-symbols-outlined text-[18px]">{icon}</span>
        </div>
        <span className="text-sm text-text-muted">{label}</span>
      </div>
      <div className="text-xl font-semibold text-text-main tabular-nums">{children}</div>
    </Card>
  );
}

export default function CockpitKpis({ kpis }: { kpis: CockpitPayload["kpis"] }) {
  const t = useTranslations("providerCockpit");
  const p = kpis.providers;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <Kpi icon="check_circle" tone="bg-green-500/10 text-green-500" label={t("kpiSuccess")}>
        <span className={rateClass(kpis.successRate)}>{formatRate(kpis.successRate)}</span>
        <span className="block text-xs font-normal text-text-muted mt-0.5">
          {t("kpiRequests", { count: formatCount(kpis.requests) })}
        </span>
      </Kpi>
      <Kpi icon="dns" tone="bg-purple-500/10 text-purple-500" label={t("kpiProviders")}>
        <span className="flex items-baseline gap-2 flex-wrap">
          <span>{p.ok}</span>
          <span className="text-xs font-normal text-amber-500">
            {t("kpiDegraded", { count: p.degraded })}
          </span>
          <span className="text-xs font-normal text-red-500">
            {t("kpiUnavailable", { count: p.open + p.down })}
          </span>
        </span>
      </Kpi>
      <Kpi icon="timer" tone="bg-blue-500/10 text-blue-500" label={t("kpiLatency")}>
        {formatMs(kpis.p50Ms)}
        <span className="block text-xs font-normal text-text-muted mt-0.5">
          p95 {formatMs(kpis.p95Ms)}
        </span>
      </Kpi>
      <Kpi icon="token" tone="bg-primary/10 text-primary" label={t("kpiTokens")}>
        {formatCount(kpis.tokensIn + kpis.tokensOut)}
        <span className="block text-xs font-normal text-text-muted mt-0.5">
          {t("kpiTokensSplit", {
            input: formatCount(kpis.tokensIn),
            output: formatCount(kpis.tokensOut),
          })}
        </span>
      </Kpi>
      <Kpi icon="payments" tone="bg-amber-500/10 text-amber-500" label={t("kpiCost")}>
        {formatUsd(kpis.estimatedCostUsd)}
      </Kpi>
    </div>
  );
}
