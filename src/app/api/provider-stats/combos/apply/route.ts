import { NextResponse } from "next/server";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { applyCockpitCombos, cockpitComboRequestSchema } from "@/lib/providerCockpit/applyCombos";

// POST /api/provider-stats/combos/apply — create/update the generated cockpit-* combos.
export async function POST(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(buildErrorBody(400, "Invalid JSON body"), { status: 400 });
  }
  const validation = validateBody(cockpitComboRequestSchema, raw);
  if (isValidationFailure(validation)) {
    return NextResponse.json(buildErrorBody(400, "Invalid cockpit combo request"), {
      status: 400,
    });
  }

  try {
    const { range, names } = validation.data;
    const { results, diff } = await applyCockpitCombos(request, range, names);
    const failed = results.filter((r) => !r.ok).length;
    return NextResponse.json({ results, stale: diff.stale }, { status: failed > 0 ? 207 : 200 });
  } catch (error) {
    console.error("[provider-cockpit] apply failed:", error);
    return NextResponse.json(buildErrorBody(500, "Failed to apply cockpit combos"), {
      status: 500,
    });
  }
}
