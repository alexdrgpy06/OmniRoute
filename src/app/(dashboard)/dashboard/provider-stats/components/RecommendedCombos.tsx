"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/shared/components";
import type { CockpitRange } from "@/lib/providerCockpit/aggregate";
import type { CockpitCombo, CockpitComboDiff } from "@/lib/providerCockpit/combos";
import type { CockpitApplyResult } from "@/lib/providerCockpit/applyCombos";

type Action = "create" | "update" | "unchanged";

interface Preview {
  combos: CockpitCombo[];
  diff: CockpitComboDiff;
}

const ACTION_STYLE: Record<Action, string> = {
  create: "bg-green-500/10 text-green-600 dark:text-green-400",
  update: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  unchanged: "bg-zinc-500/10 text-text-muted",
};

const ACTION_LABEL_KEY: Record<Action, string> = {
  create: "actionCreate",
  update: "actionUpdate",
  unchanged: "actionUnchanged",
};

function stepLabel(step: CockpitCombo["models"][number]): string {
  return step.kind === "combo-ref" ? `↳ ${step.comboName}` : step.model;
}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok && res.status !== 207) {
    const message = (json as { error?: { message?: string } })?.error?.message;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return { status: res.status, json };
}

export default function RecommendedCombos({
  range,
  onApplied,
}: {
  range: CockpitRange;
  onApplied?: () => void;
}) {
  const t = useTranslations("providerCockpit");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [results, setResults] = useState<CockpitApplyResult[] | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actionOf = (name: string): Action => {
    if (!preview) return "unchanged";
    if (preview.diff.create.some((c) => c.name === name)) return "create";
    if (preview.diff.update.some((u) => u.combo.name === name)) return "update";
    return "unchanged";
  };
  const pending = preview ? preview.diff.create.length + preview.diff.update.length : 0;

  const loadPreview = async () => {
    setBusy("preview");
    setError(null);
    setResults(null);
    setConfirming(false);
    try {
      const { json } = await postJson<Preview>("/api/provider-stats/combos/preview", { range });
      setPreview(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy("apply");
    setError(null);
    setConfirming(false);
    try {
      const { json } = await postJson<{ results: CockpitApplyResult[] }>(
        "/api/provider-stats/combos/apply",
        { range }
      );
      setResults(json.results);
      onApplied?.();
      const { json: fresh } = await postJson<Preview>("/api/provider-stats/combos/preview", {
        range,
      });
      setPreview(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary">account_tree</span>
            {t("combosTitle")}
          </h2>
          <p className="text-xs text-text-muted mt-1">{t("combosSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPreview}
            disabled={busy !== null}
            className="h-8 px-3 rounded-lg bg-surface border border-border text-xs text-text-main hover:bg-surface/80 disabled:opacity-50"
          >
            {busy === "preview" ? t("loadingPreview") : t("previewButton")}
          </button>
          {preview && (
            <button
              type="button"
              onClick={apply}
              disabled={busy !== null || pending === 0}
              className={`h-8 px-3 rounded-lg text-xs disabled:opacity-50 transition-colors ${
                confirming
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-primary text-white hover:bg-primary/90"
              }`}
            >
              {busy === "apply"
                ? t("applying")
                : confirming
                  ? t("applyConfirm", { count: pending })
                  : t("applyButton", { count: pending })}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {!preview && !error && <p className="text-sm text-text-muted">{t("combosIdle")}</p>}

      {preview && preview.combos.length === 0 && (
        <p className="text-sm text-text-muted">{t("combosEmpty")}</p>
      )}

      {preview && preview.combos.length > 0 && (
        <ul className="divide-y divide-border/40">
          {preview.combos.map((combo) => {
            const action = actionOf(combo.name);
            const result = results?.find((r) => r.name === combo.name);
            const shown = combo.models.slice(0, 5);
            return (
              <li key={combo.name} className="py-2.5 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-text-main">{combo.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${ACTION_STYLE[action]}`}>
                    {t(ACTION_LABEL_KEY[action])}
                  </span>
                  <span className="text-[10px] text-text-muted">{combo.strategy}</span>
                  <span className="text-[10px] text-text-muted">
                    {t("comboTimeout", { seconds: combo.config.targetTimeoutMs / 1000 })}
                  </span>
                  {result && (
                    <span
                      className={`text-[10px] ${result.ok ? "text-green-500" : "text-red-400"}`}
                      title={result.error}
                    >
                      {result.ok ? t("resultOk") : t("resultFailed", { status: result.status })}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 text-[11px] font-mono text-text-muted">
                  {shown.map((step, i) => (
                    <span key={`${combo.name}-${i}`} className="rounded bg-surface px-1.5 py-0.5">
                      {i + 1}. {stepLabel(step)}
                    </span>
                  ))}
                  {combo.models.length > shown.length && (
                    <span className="px-1.5 py-0.5">
                      {t("moreTargets", { count: combo.models.length - shown.length })}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview && preview.diff.stale.length > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          {t("staleCombos", { names: preview.diff.stale.join(", ") })}
        </p>
      )}
    </Card>
  );
}
