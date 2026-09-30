import type { ProviderStatus } from "@/lib/providerCockpit/aggregate";

export function formatCount(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatRate(rate: number | null | undefined): string {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "$0";
  return value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

/** $/1M tokens; null signals "free" so the caller can render a translated label. */
export function formatPrice(per1M: number): string | null {
  if (!per1M) return null;
  return `$${per1M < 1 ? per1M.toFixed(2) : per1M.toFixed(per1M < 10 ? 1 : 0)}`;
}

export function rateClass(rate: number | null | undefined): string {
  if (rate == null) return "text-text-muted";
  if (rate >= 0.99) return "text-green-500";
  if (rate >= 0.95) return "text-amber-500";
  return "text-red-500";
}

export const STATUS_STYLE: Record<ProviderStatus, { dot: string; chip: string }> = {
  ok: { dot: "bg-green-500", chip: "bg-green-500/10 text-green-600 dark:text-green-400" },
  degraded: { dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  open: { dot: "bg-red-500", chip: "bg-red-500/10 text-red-600 dark:text-red-400" },
  down: { dot: "bg-zinc-500", chip: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  disabled: { dot: "bg-zinc-400", chip: "bg-transparent border border-border text-text-muted" },
};

export const TIER_STYLE: Record<1 | 2 | 3, string> = {
  1: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
  2: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  3: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30",
};
