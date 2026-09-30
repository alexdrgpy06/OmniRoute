import { getDbInstance } from "./core";

/**
 * Provider/model call statistics aggregated from `call_logs`.
 *
 * Hard Rule #5: routes must not embed raw SQL — these queries live here so the
 * /api/provider-stats route can delegate. Read-only aggregation; no writes.
 */

export interface ProviderCallStat {
  provider: string;
  nodeName: string | null;
  totalRequests: number;
  successfulRequests: number;
  avgLatencyMs: number | null;
  totalTokensIn: number | null;
  totalTokensOut: number | null;
}

export interface ModelCallStat {
  provider: string;
  nodeName: string | null;
  model: string;
  requests: number;
  avgLatencyMs: number | null;
  successfulRequests: number;
}

export function getProviderCallStats(): ProviderCallStat[] {
  const db = getDbInstance();
  return db
    .prepare(
      `SELECT
         c.provider,
         pn.name AS nodeName,
         COUNT(*) AS totalRequests,
         SUM(CASE WHEN c.status >= 200 AND c.status < 400 THEN 1 ELSE 0 END) AS successfulRequests,
         ROUND(AVG(c.duration)) AS avgLatencyMs,
         SUM(c.tokens_in) AS totalTokensIn,
         SUM(c.tokens_out) AS totalTokensOut
       FROM call_logs c
       LEFT JOIN provider_nodes pn ON pn.id = c.provider
       WHERE c.provider IS NOT NULL AND c.provider != '-'
       GROUP BY c.provider
       ORDER BY totalRequests DESC`
    )
    .all() as ProviderCallStat[];
}

export function getModelCallStats(): ModelCallStat[] {
  const db = getDbInstance();
  return db
    .prepare(
      `SELECT
         c.provider,
         pn.name AS nodeName,
         c.model,
         COUNT(*) AS requests,
         ROUND(AVG(c.duration)) AS avgLatencyMs,
         SUM(CASE WHEN c.status >= 200 AND c.status < 400 THEN 1 ELSE 0 END) AS successfulRequests
       FROM call_logs c
       LEFT JOIN provider_nodes pn ON pn.id = c.provider
       WHERE c.provider IS NOT NULL AND c.model IS NOT NULL
       GROUP BY c.provider, c.model
       ORDER BY c.provider, requests DESC`
    )
    .all() as ModelCallStat[];
}

/** Per-(provider, model) aggregates restricted to `timestamp >= sinceIso` (Provider Cockpit). */
export interface ModelWindowStat {
  provider: string;
  model: string;
  requests: number;
  successfulRequests: number;
  avgLatencyMs: number | null;
  tokensIn: number;
  tokensOut: number;
  lastCallAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export interface ModelLatencyPercentile {
  provider: string;
  model: string;
  p50Ms: number | null;
  p95Ms: number | null;
}

export function getModelWindowStats(sinceIso: string): ModelWindowStat[] {
  const db = getDbInstance();
  return db
    .prepare(
      `WITH windowed AS (
         SELECT provider, model, status, duration, tokens_in, tokens_out, timestamp, error_summary
         FROM call_logs
         WHERE timestamp >= @since
           AND provider IS NOT NULL AND provider != '-' AND model IS NOT NULL
       ),
       last_errors AS (
         SELECT provider, model, timestamp AS lastErrorAt, error_summary AS lastError,
                ROW_NUMBER() OVER (PARTITION BY provider, model ORDER BY timestamp DESC) AS rn
         FROM windowed
         WHERE status IS NULL OR status < 200 OR status >= 400
       )
       SELECT
         w.provider,
         w.model,
         COUNT(*) AS requests,
         SUM(CASE WHEN w.status >= 200 AND w.status < 400 THEN 1 ELSE 0 END) AS successfulRequests,
         ROUND(AVG(w.duration)) AS avgLatencyMs,
         COALESCE(SUM(w.tokens_in), 0) AS tokensIn,
         COALESCE(SUM(w.tokens_out), 0) AS tokensOut,
         MAX(w.timestamp) AS lastCallAt,
         le.lastErrorAt,
         le.lastError
       FROM windowed w
       LEFT JOIN last_errors le
         ON le.provider = w.provider AND le.model = w.model AND le.rn = 1
       GROUP BY w.provider, w.model
       ORDER BY w.provider, requests DESC`
    )
    .all({ since: sinceIso }) as ModelWindowStat[];
}

export function getModelLatencyPercentiles(sinceIso: string): ModelLatencyPercentile[] {
  const db = getDbInstance();
  return db
    .prepare(
      `WITH ok AS (
         SELECT provider, model, duration,
                ROW_NUMBER() OVER (PARTITION BY provider, model ORDER BY duration) AS rn,
                COUNT(*) OVER (PARTITION BY provider, model) AS cnt
         FROM call_logs
         WHERE timestamp >= @since
           AND provider IS NOT NULL AND provider != '-' AND model IS NOT NULL
           AND status >= 200 AND status < 400
       )
       SELECT
         provider,
         model,
         MAX(CASE WHEN rn = (cnt * 50 + 99) / 100 THEN duration END) AS p50Ms,
         MAX(CASE WHEN rn = (cnt * 95 + 99) / 100 THEN duration END) AS p95Ms
       FROM ok
       GROUP BY provider, model`
    )
    .all({ since: sinceIso }) as ModelLatencyPercentile[];
}

/** Global p50/p95 over successful calls in the window (Provider Cockpit KPIs). */
export function getGlobalLatencyPercentiles(sinceIso: string): {
  p50Ms: number | null;
  p95Ms: number | null;
} {
  const db = getDbInstance();
  const row = db
    .prepare(
      `WITH ok AS (
         SELECT duration,
                ROW_NUMBER() OVER (ORDER BY duration) AS rn,
                COUNT(*) OVER () AS cnt
         FROM call_logs
         WHERE timestamp >= @since
           AND provider IS NOT NULL AND provider != '-'
           AND status >= 200 AND status < 400
       )
       SELECT
         MAX(CASE WHEN rn = (cnt * 50 + 99) / 100 THEN duration END) AS p50Ms,
         MAX(CASE WHEN rn = (cnt * 95 + 99) / 100 THEN duration END) AS p95Ms
       FROM ok`
    )
    .get({ since: sinceIso }) as { p50Ms: number | null; p95Ms: number | null } | undefined;
  return { p50Ms: row?.p50Ms ?? null, p95Ms: row?.p95Ms ?? null };
}
