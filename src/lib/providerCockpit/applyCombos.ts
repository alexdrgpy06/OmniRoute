/**
 * Provider Cockpit — preview/apply the generated combo suite.
 *
 * Writes are delegated to the canonical `/api/combos` handlers (POST create,
 * PUT update) in-process, so Zod validation, step normalization, DAG checks,
 * invariants and cloud sync stay single-sourced there.
 */

import { z } from "zod";
import { getCombos } from "@/lib/db/combos";
import { COCKPIT_RANGE_MS, loadCockpit, type CockpitRange } from "./aggregate";
import {
  diffCockpitCombos,
  generateCockpitCombos,
  type CockpitCombo,
  type CockpitComboDiff,
  type ExistingCombo,
} from "./combos";

export const cockpitRangeSchema = z.enum(
  Object.keys(COCKPIT_RANGE_MS) as [CockpitRange, ...CockpitRange[]]
);

export const cockpitComboRequestSchema = z
  .object({
    range: cockpitRangeSchema.optional().default("24h"),
    /** Restrict apply to these generated combo names (default: all creates + updates). */
    names: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  })
  .strict();

export async function previewCockpitCombos(range: CockpitRange): Promise<{
  combos: CockpitCombo[];
  diff: CockpitComboDiff;
}> {
  const payload = await loadCockpit(range);
  const combos = generateCockpitCombos(payload);
  const existing = (await getCombos()) as unknown as ExistingCombo[];
  return { combos, diff: diffCockpitCombos(combos, existing) };
}

export interface CockpitApplyResult {
  name: string;
  action: "create" | "update";
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Headers for the in-process `/api/combos` calls. The outer request already
 * passed the authz pipeline (which replaces raw machine tokens with trusted
 * `x-omniroute-auth-*` stamps), so every header is carried over — dropping the
 * stamps would make the inner handlers see an unauthenticated caller.
 */
export function buildInnerRequestHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return headers;
}

async function readError(response: Response): Promise<string | undefined> {
  if (response.ok) return undefined;
  try {
    const body = (await response.json()) as { error?: unknown };
    const err = body?.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) return String(err.message);
  } catch {
    // non-JSON body
  }
  return `HTTP ${response.status}`;
}

export async function applyCockpitCombos(
  request: Request,
  range: CockpitRange,
  names?: string[]
): Promise<{ results: CockpitApplyResult[]; diff: CockpitComboDiff }> {
  const { combos, diff } = await previewCockpitCombos(range);
  const wanted = names ? new Set(names) : null;
  const updateByName = new Map(diff.update.map((u) => [u.combo.name, u.id]));
  const createNames = new Set(diff.create.map((c) => c.name));

  const [{ POST: createCombo }, { PUT: updateCombo }] = await Promise.all([
    import("@/app/api/combos/route"),
    import("@/app/api/combos/[id]/route"),
  ]);

  const results: CockpitApplyResult[] = [];
  // Generation order: referenced use-case combos come before the universal one.
  for (const combo of combos) {
    if (wanted && !wanted.has(combo.name)) continue;
    const origin = new URL(request.url).origin;
    if (createNames.has(combo.name)) {
      const res = await createCombo(
        new Request(`${origin}/api/combos`, {
          method: "POST",
          headers: buildInnerRequestHeaders(request),
          body: JSON.stringify(combo),
        })
      );
      results.push({
        name: combo.name,
        action: "create",
        ok: res.ok,
        status: res.status,
        error: await readError(res),
      });
    } else if (updateByName.has(combo.name)) {
      const id = updateByName.get(combo.name) as string;
      const res = await updateCombo(
        new Request(`${origin}/api/combos/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: buildInnerRequestHeaders(request),
          body: JSON.stringify(combo),
        }),
        { params: Promise.resolve({ id }) }
      );
      results.push({
        name: combo.name,
        action: "update",
        ok: res.ok,
        status: res.status,
        error: await readError(res),
      });
    }
  }
  return { results, diff };
}
