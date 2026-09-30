"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/shared/components";
import type { CockpitModel, CockpitProvider } from "@/lib/providerCockpit/aggregate";
import {
  STATUS_STYLE,
  TIER_STYLE,
  formatCount,
  formatMs,
  formatPrice,
  formatRate,
  rateClass,
} from "./cockpitFormat";

const STATUS_LABEL_KEY = {
  ok: "statusOk",
  degraded: "statusDegraded",
  open: "statusOpen",
  down: "statusDown",
} as const;

const TIER_LABEL_KEY = { 1: "tier1", 2: "tier2", 3: "tier3" } as const;

function ModelRow({ m }: { m: CockpitModel }) {
  const t = useTranslations("providerCockpit");
  const input = formatPrice(m.costPer1MInput);
  const output = formatPrice(m.costPer1MOutput);
  return (
    <tr
      className={`border-t border-border/20 ${m.hasTraffic ? "" : "opacity-60"} ${
        m.eligible ? "" : "line-through decoration-red-500/40"
      }`}
    >
      <td className="py-1.5 px-3 pl-10">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded border px-1.5 text-[10px] font-semibold ${TIER_STYLE[m.tier]}`}
            title={t(TIER_LABEL_KEY[m.tier])}
          >
            T{m.tier}
          </span>
          <span className="font-mono text-text-main break-all">{m.id}</span>
          {!m.hasTraffic && (
            <span className="text-[10px] text-text-muted" title={t("priorHint")}>
              {t("prior")}
            </span>
          )}
        </div>
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums text-text-main">{m.score.toFixed(1)}</td>
      <td className="py-1.5 px-3 text-right tabular-nums text-text-main">
        {formatCount(m.requests)}
      </td>
      <td className={`py-1.5 px-3 text-right tabular-nums ${rateClass(m.successRate)}`}>
        {formatRate(m.successRate)}
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums text-text-main">
        {formatMs(m.p50Ms ?? m.avgLatencyMs)}
        <span className="text-text-muted"> / {formatMs(m.p95Ms)}</span>
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums text-text-muted">
        {input ?? t("free")}
        {input ? ` / ${output ?? t("free")}` : ""}
      </td>
      <td className="py-1.5 px-3 text-text-muted">
        <span className="flex gap-1">
          {m.toolCalling && (
            <span className="material-symbols-outlined text-[14px]" title={t("capTools")}>
              build
            </span>
          )}
          {m.supportsReasoning && (
            <span className="material-symbols-outlined text-[14px]" title={t("capReasoning")}>
              psychology
            </span>
          )}
          {m.supportsVision && (
            <span className="material-symbols-outlined text-[14px]" title={t("capVision")}>
              visibility
            </span>
          )}
        </span>
      </td>
      <td className="py-1.5 px-3 text-xs">
        {m.lockedConnections > 0 && (
          <span className="text-amber-500" title={t("lockedHint")}>
            {t("locked", { count: m.lockedConnections })}
          </span>
        )}
        {m.lastError && (
          <span className="block text-red-400 truncate max-w-[220px]" title={m.lastError}>
            {m.lastError}
          </span>
        )}
      </td>
    </tr>
  );
}

export default function ProviderMatrix({ providers }: { providers: CockpitProvider[] }) {
  const t = useTranslations("providerCockpit");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary">hub</span>
          {t("matrixTitle")}
        </h2>
        <span className="text-xs text-text-muted">
          {t("matrixCount", { count: providers.length })}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th className="text-left py-2 px-3 font-medium">{t("colProvider")}</th>
              <th className="text-left py-2 px-3 font-medium">{t("colStatus")}</th>
              <th className="text-right py-2 px-3 font-medium">{t("colConnections")}</th>
              <th className="text-right py-2 px-3 font-medium">{t("colRequests")}</th>
              <th className="text-right py-2 px-3 font-medium">{t("colSuccess")}</th>
              <th className="text-right py-2 px-3 font-medium">{t("colLatency")}</th>
              <th className="text-left py-2 px-3 font-medium">{t("colLastError")}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => {
              const isOpen = expanded.has(p.id);
              const style = STATUS_STYLE[p.status];
              return (
                <Fragment key={p.id}>
                  <tr
                    className="border-b border-border/50 hover:bg-surface/50 transition-colors cursor-pointer"
                    onClick={() => toggle(p.id)}
                    aria-expanded={isOpen}
                  >
                    <td className="py-2.5 px-3 font-medium text-text-main">
                      {p.name}
                      <span className="ml-2 text-xs text-text-muted">
                        {t("modelCount", { count: p.models.length })}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${style.chip}`}
                        title={`breaker ${p.breaker.state}`}
                      >
                        <span className={`size-1.5 rounded-full ${style.dot}`} />
                        {t(STATUS_LABEL_KEY[p.status])}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-xs text-text-muted">
                      {p.connections.total === 0 ? (
                        t("noAuth")
                      ) : (
                        <span title={t("connectionsHint")}>
                          <span className="text-green-500">{p.connections.active}</span>
                          {p.connections.cooldown > 0 && (
                            <span className="text-amber-500"> · {p.connections.cooldown}</span>
                          )}
                          {p.connections.terminal > 0 && (
                            <span className="text-red-500"> · {p.connections.terminal}</span>
                          )}
                          <span> / {p.connections.total}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-text-main">
                      {formatCount(p.requests)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right tabular-nums ${rateClass(p.successRate)}`}
                    >
                      {formatRate(p.successRate)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-text-main">
                      {formatMs(p.avgLatencyMs)}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-red-400 max-w-[260px] truncate">
                      <span title={p.lastError ?? undefined}>{p.lastError ?? ""}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`material-symbols-outlined text-[16px] text-text-muted transition-transform ${
                          isOpen ? "rotate-90" : ""
                        }`}
                      >
                        chevron_right
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <div className="bg-black/[0.02] dark:bg-white/[0.02] border-b border-border/30">
                          {p.models.length === 0 ? (
                            <p className="py-3 px-10 text-xs text-text-muted">{t("noModels")}</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-text-muted">
                                  <th className="text-left py-1.5 px-3 pl-10 font-medium">
                                    {t("colModel")}
                                  </th>
                                  <th className="text-right py-1.5 px-3 font-medium">
                                    {t("colScore")}
                                  </th>
                                  <th className="text-right py-1.5 px-3 font-medium">
                                    {t("colRequests")}
                                  </th>
                                  <th className="text-right py-1.5 px-3 font-medium">
                                    {t("colSuccess")}
                                  </th>
                                  <th className="text-right py-1.5 px-3 font-medium">
                                    {t("colP50P95")}
                                  </th>
                                  <th className="text-right py-1.5 px-3 font-medium">
                                    {t("colPrice")}
                                  </th>
                                  <th className="text-left py-1.5 px-3 font-medium">
                                    {t("colCaps")}
                                  </th>
                                  <th className="text-left py-1.5 px-3 font-medium">
                                    {t("colNotes")}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {p.models.map((m) => (
                                  <ModelRow key={m.id} m={m} />
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {providers.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-text-muted">
                  {t("matrixEmpty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
