/**
 * Bundle the viem entry to vendor/viem.js. The production image copies that
 * file; it is not committed. Vite's rolldown dependency does the bundle so
 * generator / register / dashboard do not import esm.sh.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await rolldown({
  input: path.join(root, "scripts/vendor-viem-entry.mjs"),
  platform: "browser",
});
await bundle.write({
  dir: path.join(root, "vendor"),
  entryFileNames: "viem.js",
  format: "esm",
  minify: true,
  codeSplitting: false,
});
