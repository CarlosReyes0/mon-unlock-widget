/**
 * Phase 2 dual-support: copy canonical mon-unlock build artifacts to openpaywall.*
 * Existing embeds keep loading mon-unlock.*; new embeds may use openpaywall.*.
 */
import { copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

const pairs = [
  ["mon-unlock.js", "openpaywall.js"],
  ["mon-unlock.css", "openpaywall.css"],
  ["mon-unlock.umd.cjs", "openpaywall.umd.cjs"],
];

for (const [from, to] of pairs) {
  const src = resolve(dist, from);
  const dest = resolve(dist, to);
  if (!existsSync(src)) {
    console.warn(`[alias-widget-assets] skip ${to}: missing ${from}`);
    continue;
  }
  copyFileSync(src, dest);
  console.log(`[alias-widget-assets] ${from} → ${to}`);
}
