/**
 * GHSA-w5hq-g745-h8pq (uuid < 11.1.1) entered the tree through
 * @metamask/sdk, which wagmi 2 pulled in via @wagmi/connectors 6.
 * wagmi 3 / connectors 8 make @metamask/connect-evm an optional peer.
 * That peer still depends on uuid 9, so it must stay uninstalled.
 * MetaMask login uses the injected EIP-1193 provider and WalletConnect.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const packages = lock.packages || {};

function versionLessThan(version, minimum) {
  const parse = (value) => String(value).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(version);
  const right = parse(minimum);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = left[i] || 0;
    const b = right[i] || 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

test("wagmi 3 replaces the @metamask/sdk connector tree", () => {
  const wagmi = packages["node_modules/wagmi"];
  const connectors = packages["node_modules/@wagmi/connectors"];
  const core = packages["node_modules/@wagmi/core"];
  assert.equal(wagmi?.version, "3.7.7");
  assert.equal(connectors?.version, "8.2.0");
  assert.equal(core?.version, "3.6.5");
  assert.equal(packages["node_modules/@metamask/sdk"], undefined);
  assert.equal(packages["node_modules/@metamask/sdk-communication-layer"], undefined);
  assert.equal(packages["node_modules/@metamask/connect-evm"], undefined);
});

test("no installed uuid package is below 11.1.1", () => {
  const uuids = Object.entries(packages).filter(
    ([name]) => name === "node_modules/uuid" || name.endsWith("/node_modules/uuid")
  );
  for (const [name, pkg] of uuids) {
    assert.equal(
      versionLessThan(pkg.version, "11.1.1"),
      false,
      `${name}@${pkg.version} is still inside GHSA-w5hq-g745-h8pq`
    );
  }
});
