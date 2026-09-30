import test from "node:test";
import assert from "node:assert/strict";

import { filterCockpitProviders } from "../../src/app/(dashboard)/dashboard/provider-stats/components/cockpitFilter.ts";
import { DEFAULT_FILTERS } from "../../src/app/(dashboard)/dashboard/provider-stats/components/CockpitFilters.tsx";
import type { CockpitModel, CockpitProvider } from "../../src/lib/providerCockpit/aggregate.ts";

const m = (id: string, over: Partial<CockpitModel> = {}) =>
  ({ id, tier: 2, costTier: "cheap", hasTraffic: false, ...over }) as CockpitModel;
const p = (id: string, models: CockpitModel[], over: Partial<CockpitProvider> = {}) =>
  ({ id, name: id.toUpperCase(), status: "ok", models, ...over }) as CockpitProvider;

const providers = [
  p("openai", [m("gpt-5", { tier: 1, hasTraffic: true }), m("gpt-4o-mini")]),
  p("groq", [m("llama-3.1-8b", { tier: 3, costTier: "free" })], { status: "degraded" }),
  p("empty", []),
];

test("default filters keep everything, including providers without models", () => {
  assert.equal(filterCockpitProviders(providers, DEFAULT_FILTERS).length, 3);
});

test("tier filter narrows models and drops providers left empty", () => {
  const out = filterCockpitProviders(providers, { ...DEFAULT_FILTERS, tier: "1" });
  assert.deepEqual(
    out.map((x) => [x.id, x.models.map((y) => y.id)]),
    [["openai", ["gpt-5"]]]
  );
});

test("health, free and traffic filters", () => {
  assert.deepEqual(
    filterCockpitProviders(providers, { ...DEFAULT_FILTERS, health: "degraded" }).map((x) => x.id),
    ["groq"]
  );
  assert.deepEqual(
    filterCockpitProviders(providers, { ...DEFAULT_FILTERS, freeOnly: true }).map((x) => x.id),
    ["groq"]
  );
  assert.deepEqual(
    filterCockpitProviders(providers, { ...DEFAULT_FILTERS, withTraffic: true }).map((x) => x.id),
    ["openai"]
  );
});

test("query matches provider (keeps all its models) or model id", () => {
  const byProvider = filterCockpitProviders(providers, { ...DEFAULT_FILTERS, query: "OpenAI" });
  assert.equal(byProvider.length, 1);
  assert.equal(byProvider[0].models.length, 2);
  const byModel = filterCockpitProviders(providers, { ...DEFAULT_FILTERS, query: "llama" });
  assert.deepEqual(
    byModel.map((x) => x.id),
    ["groq"]
  );
  const emptyProvider = filterCockpitProviders(providers, { ...DEFAULT_FILTERS, query: "empt" });
  assert.deepEqual(
    emptyProvider.map((x) => x.id),
    ["empty"]
  );
});
