import { NextResponse } from "next/server";
import { buildErrorBody } from "@omniroute/open-sse/utils/error";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { cockpitComboRequestSchema, previewCockpitCombos } from "@/lib/providerCockpit/applyCombos";

// POST /api/provider-stats/combos/preview — generated cockpit combos + diff vs stored combos.
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
    return NextResponse.json(await previewCockpitCombos(validation.data.range));
  } catch (error) {
    console.error("[provider-cockpit] preview failed:", error);
    return NextResponse.json(buildErrorBody(500, "Failed to preview cockpit combos"), {
      status: 500,
    });
  }
}
