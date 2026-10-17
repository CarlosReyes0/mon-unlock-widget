import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { encodeFunctionData, encodeFunctionResult, keccak256, toBytes } from "viem";
import {
  ARTICLE_NFT_CHAIN_ID,
  NFT_BALANCE_OF_ABI,
  NFT_OWNER_OF_ABI,
  TOKEN_META_ABI,
  articleIdFromSlug,
  articleNftConfigured,
  buildTokenMetadata,
  getNftConfig,
  metadataHasPaidBody,
  parseMetadataPath,
  parseRecordBody,
  recordMint,
  roleFromOnchain,
} from "./article-nft.mjs";

test("parseMetadataPath only matches /api/article-nfts/metadata/{id}", () => {
  assert.equal(parseMetadataPath("/api/article-nfts/metadata/12"), "12");
  assert.equal(parseMetadataPath("/api/article-nfts/metadata/12/"), "12");
  assert.equal(parseMetadataPath("/api/article-nfts/metadata/abc"), null);
  assert.equal(parseMetadataPath("/api/article-nfts/config"), null);
  assert.equal(parseMetadataPath("/api/articles/demo/download"), null);
});

test("buildTokenMetadata never includes paid body", () => {
  const meta = buildTokenMetadata({
    slug: "july-rain-walk",
    role: "edition",
    title: "July rain",
    teaser: "A free preview.",
    body: "SECRET PAID BODY SHOULD NOT APPEAR",
    paid_body: "nope",
    articleBody: "nope",
    priceLabel: "$0.50 USDC",
    origin: "https://example.test",
  });
  assert.equal(meta.name, "July rain — Writer edition");
  assert.equal(meta.description, "A free preview.");
  assert.equal(meta.external_url, "https://example.test/articles/july-rain-walk");
  assert.match(meta.image, /\/og\/july-rain-walk\.jpg/);
  assert.deepEqual(
    meta.attributes.find((a) => a.trait_type === "role"),
    { trait_type: "role", value: "edition" }
  );
  assert.deepEqual(
    meta.attributes.find((a) => a.trait_type === "articleSlug"),
    { trait_type: "articleSlug", value: "july-rain-walk" }
  );
  assert.deepEqual(
    meta.attributes.find((a) => a.trait_type === "price"),
    { trait_type: "price", value: "$0.50 USDC" }
  );
  assert.equal(metadataHasPaidBody(meta), false);
  assert.equal("body" in meta, false);
  assert.doesNotMatch(JSON.stringify(meta), /SECRET PAID BODY/);
});

test("receipt metadata uses the article URL not the unlock contract", () => {
  const meta = buildTokenMetadata({
    slug: "july-rain-walk",
    role: "receipt",
    title: "July rain",
    origin: "https://example.test",
  });
  assert.match(meta.name, /Unlock receipt/);
  assert.match(meta.description, /Not required to read/);
  assert.equal(meta.external_url, "https://example.test/articles/july-rain-walk");
});

test("roleFromOnchain maps 0/1", () => {
  assert.equal(roleFromOnchain(0), "edition");
  assert.equal(roleFromOnchain(1n), "receipt");
});

test("parseRecordBody requires slug, role, minter, tokenId", () => {
  const parsed = parseRecordBody({
    slug: "july-rain-walk",
    role: "edition",
    minter: "0x1111111111111111111111111111111111111111",
    tokenId: "3",
    txHash: "0x" + "ab".repeat(32),
  });
  assert.equal(parsed.slug, "july-rain-walk");
  assert.equal(parsed.role, "edition");
  assert.equal(parsed.tokenId, "3");
  assert.throws(() => parseRecordBody({ role: "edition", minter: "0x11", tokenId: "1" }));
  assert.throws(() =>
    parseRecordBody({
      slug: "x",
      role: "gate",
      minter: "0x1111111111111111111111111111111111111111",
      tokenId: "1",
    })
  );
});

test("getNftConfig reports unconfigured without ARTICLE_NFT_CONTRACT", () => {
  const prev = process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.VITE_ARTICLE_NFT_CONTRACT;
  try {
    assert.equal(articleNftConfigured(), false);
    const cfg = getNftConfig();
    assert.equal(cfg.configured, false);
    assert.equal(cfg.chainId, ARTICLE_NFT_CHAIN_ID);
    assert.equal(cfg.mintAuth, "user-wallet");
    assert.match(cfg.note, /No server private key/);
  } finally {
    if (prev) process.env.ARTICLE_NFT_CONTRACT = prev;
  }
});

test("recordMint without a contract is nft_not_configured", async () => {
  const prev = process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.ARTICLE_NFT_CONTRACT;
  delete process.env.VITE_ARTICLE_NFT_CONTRACT;
  try {
    await assert.rejects(
      () =>
        recordMint({
          slug: "july-rain-walk",
          role: "receipt",
          minter: "0x1111111111111111111111111111111111111111",
          tokenId: "1",
        }),
      /nft_not_configured/
    );
  } finally {
    if (prev) process.env.ARTICLE_NFT_CONTRACT = prev;
  }
});

const CONTRACT = "0x2222222222222222222222222222222222222222";
const MINTER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x3333333333333333333333333333333333333333";
const SLUG = "july-rain-walk";
const TOKEN_ID = "9";
const TX = "0x" + "ab".repeat(32);
const OTHER_TX = "0x" + "cd".repeat(32);
const RPC_URL = "http://127.0.0.1:9";

function selector(abi, functionName, args) {
  return encodeFunctionData({ abi, functionName, args }).slice(0, 10);
}

const SELECTOR = {
  meta: selector(TOKEN_META_ABI, "tokenMeta", [1n]),
  balance: selector(NFT_BALANCE_OF_ABI, "balanceOf", [MINTER, 1n]),
  owner: selector(NFT_OWNER_OF_ABI, "ownerOf", [1n]),
};

function jsonRpc(result, { error } = {}) {
  const payload = error
    ? { jsonrpc: "2.0", id: 1, error }
    : { jsonrpc: "2.0", id: 1, result };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenMetaResult({ slug = SLUG, role = 0, supply = 1n } = {}) {
  return encodeFunctionResult({
    abi: TOKEN_META_ABI,
    functionName: "tokenMeta",
    result: [articleIdFromSlug(slug), role, slug, supply],
  });
}

function balanceResult(value) {
  return encodeFunctionResult({
    abi: NFT_BALANCE_OF_ABI,
    functionName: "balanceOf",
    result: BigInt(value),
  });
}

function ownerResult(address) {
  return encodeFunctionResult({
    abi: NFT_OWNER_OF_ABI,
    functionName: "ownerOf",
    result: address,
  });
}

function receipt({ to = CONTRACT, status = "0x1", hash = TX } = {}) {
  return {
    transactionHash: hash,
    status,
    to,
    blockNumber: "0x10",
    logs: [],
  };
}

/**
 * Mock JSON-RPC. Never dials a chain. `mode` selects the failure under test.
 * ownerOf reverts unless mode is "erc721" or "owner-mismatch", because ArticleNFT is ERC-1155.
 */
function mockRpc(mode = "ok", { balance = 1n, txHash = TX } = {}) {
  const calls = [];
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    if (mode === "rpc-down") throw new Error("connect ECONNREFUSED");
    const body = JSON.parse(init.body);
    calls.push(body.method);
    if (mode === "rpc-error") {
      return jsonRpc(null, { error: { code: -32000, message: "header not found" } });
    }
    if (body.method === "eth_chainId") {
      return jsonRpc(mode === "wrong-chain" ? "0x1" : "0x8f");
    }
    if (body.method === "eth_getTransactionReceipt") {
      if (mode === "receipt-missing") return jsonRpc(null);
      const status = mode === "tx-failed" ? "0x0" : "0x1";
      const to = mode === "wrong-contract" ? OTHER : CONTRACT;
      const hash = String(body.params[0] || txHash);
      return jsonRpc(receipt({ to, status, hash }));
    }
    if (body.method === "eth_call") {
      const to = String(body.params?.[0]?.to || "").toLowerCase();
      assert.equal(to, CONTRACT, "ownership and metadata must be read on the configured contract");
      const data = String(body.params?.[0]?.data || "");
      const sel = data.slice(0, 10);
      if (sel === SELECTOR.meta) {
        return jsonRpc(tokenMetaResult());
      }
      if (sel === SELECTOR.balance) {
        if (mode === "erc721" || mode === "owner-mismatch") {
          return jsonRpc(null, { error: { code: 3, message: "execution reverted" } });
        }
        const value = mode === "wrong-owner" ? 0n : balance;
        return jsonRpc(balanceResult(value));
      }
      if (sel === SELECTOR.owner) {
        if (mode === "owner-mismatch") return jsonRpc(ownerResult(OTHER));
        if (mode === "erc721") return jsonRpc(ownerResult(MINTER));
        return jsonRpc(null, { error: { code: 3, message: "execution reverted" } });
      }
      return jsonRpc(null, { error: { code: 3, message: "execution reverted" } });
    }
    return jsonRpc(null, { error: { code: -32601, message: "method not found" } });
  };
  return { fetchImpl, calls, urls };
}

function memoryDb(initial = []) {
  const rows = initial.map((row) => ({ ...row }));
  let inserts = 0;
  return {
    rows,
    get inserts() {
      return inserts;
    },
    async find(contract, tokenId) {
      return (
        rows.find(
          (row) => row.contract === contract && String(row.token_id) === String(tokenId)
        ) || null
      );
    },
    async insert(row) {
      inserts += 1;
      const clash = rows.find(
        (existing) =>
          existing.contract === row.contract && String(existing.token_id) === String(row.token_id)
      );
      if (clash) {
        const err = new Error("duplicate");
        err.status = 409;
        throw err;
      }
      const stored = { ...row };
      rows.push(stored);
      return stored;
    },
  };
}

function recordBody(overrides = {}) {
  return {
    slug: SLUG,
    role: "edition",
    minter: MINTER,
    tokenId: TOKEN_ID,
    txHash: TX,
    amount: "1",
    ...overrides,
  };
}

function depsFor(mode, { db = memoryDb(), balance = 1n, txHash = TX } = {}) {
  const rpc = mockRpc(mode, { balance, txHash });
  return {
    rpc,
    deps: {
      contract: CONTRACT,
      rpcUrl: RPC_URL,
      fetchImpl: rpc.fetchImpl,
      db,
      verifyOnchain: async () => true,
    },
  };
}

async function expectReject(mode, message, status, extra) {
  const db = memoryDb();
  const { deps, rpc } = depsFor(mode, { db, ...extra });
  await assert.rejects(
    () => recordMint(recordBody(extra?.body), deps),
    (err) => {
      assert.equal(err.message, message);
      assert.equal(err.status, status);
      return true;
    }
  );
  assert.equal(db.inserts, 0);
  assert.equal(db.rows.length, 0);
  assert.ok(rpc.urls.every((url) => url === RPC_URL));
  return rpc;
}

test("record source does not fail open or upsert over an existing token", () => {
  const src = fs.readFileSync(new URL("./article-nft.mjs", import.meta.url), "utf8");
  assert.equal(src.includes("merge-duplicates"), false);
  assert.equal(src.includes("on_conflict"), false);
  assert.equal(src.includes("verifyOnchain"), false);
  assert.equal(src.includes("still persist"), false);
  assert.equal(keccak256(toBytes(SLUG)), articleIdFromSlug(SLUG));
});

test("recordMint rejects when the RPC call fails and does not write", async () => {
  const rpc = await expectReject("rpc-down", "rpc_failed", 502);
  assert.equal(rpc.calls.length, 0);
  await expectReject("rpc-error", "rpc_failed", 502);
});

test("recordMint rejects the wrong owner and does not write", async () => {
  const rpc = await expectReject("wrong-owner", "not_owner", 400);
  assert.ok(rpc.calls.includes("eth_call"));
  await expectReject("owner-mismatch", "not_owner", 400);
});

test("recordMint rejects a receipt for the wrong contract and does not write", async () => {
  const rpc = await expectReject("wrong-contract", "wrong_contract", 400);
  assert.deepEqual(rpc.calls, ["eth_chainId", "eth_getTransactionReceipt"]);
});

test("recordMint rejects a failed transaction and a missing receipt", async () => {
  const failed = await expectReject("tx-failed", "tx_failed", 400);
  assert.deepEqual(failed.calls, ["eth_chainId", "eth_getTransactionReceipt"]);
  await expectReject("receipt-missing", "receipt_missing", 400);
  const { deps, rpc } = depsFor("ok");
  await assert.rejects(
    () => recordMint(recordBody({ txHash: "" }), deps),
    (err) => err.message === "receipt_missing" && err.status === 400
  );
  assert.equal(rpc.calls.length, 0);
});

test("recordMint rejects the wrong chain and does not write", async () => {
  const rpc = await expectReject("wrong-chain", "wrong_chain", 400);
  assert.deepEqual(rpc.calls, ["eth_chainId"]);
  const { deps } = depsFor("ok");
  await assert.rejects(
    () => recordMint(recordBody({ chainId: 1 }), deps),
    (err) => err.message === "wrong_chain" && err.status === 400
  );
});

test("recordMint writes once on the valid path and returns 409 instead of overwriting", async () => {
  const db = memoryDb();
  const first = depsFor("ok", { db });
  const saved = await recordMint(recordBody(), first.deps);
  assert.equal(saved.recorded, true);
  assert.equal(saved.idempotent, false);
  assert.equal(saved.nft.article_slug, SLUG);
  assert.equal(saved.nft.minter, MINTER);
  assert.equal(saved.nft.contract, CONTRACT);
  assert.equal(saved.nft.tx_hash, TX);
  assert.equal(db.inserts, 1);
  assert.equal(db.rows.length, 1);
  assert.ok(first.rpc.calls.includes("eth_chainId"));
  assert.ok(first.rpc.calls.includes("eth_getTransactionReceipt"));
  assert.ok(first.rpc.calls.includes("eth_call"));

  const again = depsFor("ok", { db });
  const retry = await recordMint(recordBody(), again.deps);
  assert.equal(retry.recorded, true);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.nft.tx_hash, TX);
  assert.equal(db.inserts, 1);
  assert.equal(db.rows.length, 1);

  const clash = depsFor("ok", { db, txHash: OTHER_TX });
  await assert.rejects(
    () => recordMint(recordBody({ txHash: OTHER_TX }), clash.deps),
    (err) => err.message === "nft_record_exists" && err.status === 409
  );
  assert.equal(db.inserts, 1);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].tx_hash, TX);
  assert.equal(db.rows[0].article_slug, SLUG);
});

test("an insert conflict is idempotent only when the stored row matches exactly", async () => {
  const stored = {
    token_id: TOKEN_ID,
    contract: CONTRACT,
    article_slug: SLUG,
    role: "edition",
    minter: MINTER,
    amount: "1",
    tx_hash: TX,
  };
  let finds = 0;
  const db = {
    rows: [stored],
    inserts: 0,
    async find() {
      finds += 1;
      return finds === 1 ? null : stored;
    },
    async insert() {
      this.inserts += 1;
      const err = new Error("duplicate");
      err.status = 409;
      throw err;
    },
  };
  const same = depsFor("ok", { db });
  const retry = await recordMint(recordBody(), same.deps);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.nft.tx_hash, TX);
  assert.equal(db.inserts, 1);

  finds = 0;
  stored.article_slug = "someone-elses-essay";
  const clash = depsFor("ok", { db });
  await assert.rejects(
    () => recordMint(recordBody(), clash.deps),
    (err) => err.message === "nft_record_exists" && err.status === 409
  );
  assert.equal(stored.article_slug, "someone-elses-essay");
});

test("ownerOf on the configured chain is enough when balanceOf reverts", async () => {
  const db = memoryDb();
  const { deps } = depsFor("erc721", { db });
  const saved = await recordMint(recordBody(), deps);
  assert.equal(saved.recorded, true);
  assert.equal(saved.nft.minter, MINTER);
  assert.equal(db.rows.length, 1);
});

test("a chain-valid record is not persisted when the database is not configured", async () => {
  const { deps, rpc } = depsFor("ok", { db: null });
  const result = await recordMint(recordBody(), {
    contract: CONTRACT,
    rpcUrl: RPC_URL,
    fetchImpl: rpc.fetchImpl,
    verifyOnchain: false,
  });
  assert.equal(result.recorded, false);
  assert.equal(result.reason, "supabase_not_configured");
  assert.equal(deps.db, null);
});
