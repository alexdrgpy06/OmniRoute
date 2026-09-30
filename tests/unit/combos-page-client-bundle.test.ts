/**
 * Regression guard: the combos dashboard page is a client component. Importing
 * open-sse/services/model.ts drags src/lib/db/* (better-sqlite3, fs, child_process)
 * into the browser bundle and next build fails with ~170 module-not-found errors.
 * Provider alias resolution must go through the client-safe providerAlias module.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve("src/app/(dashboard)/dashboard/combos/page.tsx"),
  "utf8"
);

test("combos page does not import the server-only model service", () => {
  assert.doesNotMatch(source, /from ["']@omniroute\/open-sse\/services\/model(\.ts)?["']/);
});

test("combos page resolves step providers through the client-safe alias module", () => {
  assert.match(source, /from ["']@omniroute\/open-sse\/services\/providerAlias(\.ts)?["']/);
  assert.match(source, /resolveProviderAlias\(aliasOrProvider\)/);
});
