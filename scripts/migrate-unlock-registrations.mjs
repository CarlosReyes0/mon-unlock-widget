/**
 * Re-register articles on the new unlock contracts.
 *
 * Dry-run by default. Pass --confirm to broadcast registerArticleFor from the
 * relayer wallet. RELAYER_PRIVATE_KEY is read from the environment only and
 * is never printed.
 *
 *   node scripts/migrate-unlock-registrations.mjs
 *   node scripts/migrate-unlock-registrations.mjs --source=both
 *   node scripts/migrate-unlock-registrations.mjs --confirm --source=db
 *
 * Sources:
 *   --source=chain   ArticleRegistered logs, then getArticle for the current
 *                    publisher, price, and active flag (default)
 *   --source=db      Supabase articles rows
 *   --source=both    union; chain getArticle wins when both have the article
 *
 * Env (names only here — do not log values):
 *   OLD_MON_UNLOCK_CONTRACT    default 0x27cA0c23835328e2Ab1424b66330be86fe177FA6
 *   OLD_USDC_UNLOCK_CONTRACT   default 0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f
 *   NEW_MON_UNLOCK_CONTRACT
 *   NEW_USDC_UNLOCK_CONTRACT
 *   MONAD_RPC_URL              optional, default https://rpc.monad.xyz
 *   MIGRATE_FROM_BLOCK         optional start block for log scan
 *   SUPABASE_URL               required for --source=db or both
 *   SUPABASE_SERVICE_ROLE_KEY  required for --source=db or both
 *   RELAYER_PRIVATE_KEY        required for --confirm
 *   UNLOCK_LEGACY_OWNER_RELAYER  only if the destination has no relayer()
 *
 * Publisher remap (not committed). Copy scripts/publisher-remap.example.json
 * to scripts/publisher-remap.json, or pass --remap=path. Each key is the
 * publisher on the old contract. The value is the address registerArticleFor
 * should use. Omitted publishers keep their original address.
 * {
 *   "publishers": {
 *     "0x1111111111111111111111111111111111111111": "0x2222222222222222222222222222222222222222"
 *   }
 * }
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_OLD_MON = "0x27cA0c23835328e2Ab1424b66330be86fe177FA6";
const DEFAULT_OLD_USDC = "0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f";
const ZERO = "0x0000000000000000000000000000000000000000";
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function parseArgs(argv) {
  let confirm = false;
  let source = "chain";
  let remapPath = "scripts/publisher-remap.json";
  let fromBlock = null;
  for (const arg of argv) {
    if (arg === "--confirm") confirm = true;
    else if (arg === "--dry-run") confirm = false;
    else if (arg.startsWith("--source=")) source = arg.slice("--source=".length);
    else if (arg.startsWith("--remap=")) remapPath = arg.slice("--remap=".length);
    else if (arg.startsWith("--from-block=")) fromBlock = arg.slice("--from-block=".length);
    else throw new Error("unknown_arg");
  }
  if (!["chain", "db", "both"].includes(source)) throw new Error("invalid_source");
  if (fromBlock != null && !/^\d+$/.test(fromBlock)) throw new Error("invalid_from_block");
  return { confirm, source, remapPath, fromBlock };
}

export function loadRemap(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("remap_invalid");
  }
  const publishers = parsed && typeof parsed === "object" ? parsed.publishers || {} : null;
  if (!publishers || typeof publishers !== "object" || Array.isArray(publishers)) {
    throw new Error("remap_invalid");
  }
  const out = {};
  for (const [from, to] of Object.entries(publishers)) {
    if (!ADDRESS.test(from) || !ADDRESS.test(String(to || ""))) throw new Error("remap_invalid");
    out[from.toLowerCase()] = String(to).toLowerCase();
  }
  return out;
}

export function readRemapFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return loadRemap(fs.readFileSync(filePath, "utf8"));
}

export function applyPublisherRemap(publisher, remap) {
  const key = String(publisher || "").trim().toLowerCase();
  if (!ADDRESS.test(key)) return "";
  const next = remap && remap[key];
  if (!next) return key;
  return String(next).toLowerCase();
}

function asBigInt(value) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * @param {Array<{
 *   articleIdHash: string,
 *   publisher: string,
 *   priceWei: string | bigint,
 *   paymentAsset: string,
 *   active: boolean,
 * }>} rows
 */
export function buildPlan(rows, { newMon, newUsdc, remap }) {
  const plans = [];
  const skipped = [];
  const seen = new Set();
  for (const row of rows) {
    const articleIdHash = String(row.articleIdHash || "").trim().toLowerCase();
    const paymentAsset = String(row.paymentAsset || "").trim().toLowerCase() === "usdc" ? "usdc" : "mon";
    const key = `${paymentAsset}:${articleIdHash}`;
    if (!articleIdHash || seen.has(key)) continue;
    seen.add(key);
    const originalPublisher = String(row.publisher || "").trim().toLowerCase();
    if (!row.active) {
      skipped.push({ articleIdHash, paymentAsset, reason: "inactive" });
      continue;
    }
    const priceWei = asBigInt(row.priceWei);
    if (priceWei <= 0n) {
      skipped.push({ articleIdHash, paymentAsset, reason: "invalid_price" });
      continue;
    }
    const publisher = applyPublisherRemap(originalPublisher, remap);
    if (!ADDRESS.test(publisher) || publisher === ZERO) {
      skipped.push({ articleIdHash, paymentAsset, reason: "invalid_publisher" });
      continue;
    }
    const target = paymentAsset === "usdc" ? newUsdc || null : newMon || null;
    plans.push({
      articleIdHash,
      paymentAsset,
      priceWei: priceWei.toString(),
      originalPublisher,
      publisher,
      remapped: publisher !== originalPublisher,
      target,
    });
  }
  return { plans, skipped };
}

/** Chain rows replace DB rows for the same asset and article id. */
export function mergeRows(chainRows, dbRows) {
  const map = new Map();
  for (const row of dbRows || []) {
    const asset = String(row.paymentAsset || "mon").toLowerCase() === "usdc" ? "usdc" : "mon";
    map.set(`${asset}:${String(row.articleIdHash || "").toLowerCase()}`, { ...row, paymentAsset: asset });
  }
  for (const row of chainRows || []) {
    const asset = String(row.paymentAsset || "mon").toLowerCase() === "usdc" ? "usdc" : "mon";
    map.set(`${asset}:${String(row.articleIdHash || "").toLowerCase()}`, { ...row, paymentAsset: asset });
  }
  return [...map.values()];
}

export function normalizeDbArticle(row) {
  return {
    articleIdHash: String(row.article_id_hash || row.articleIdHash || "").toLowerCase(),
    publisher: String(row.publisher || "").toLowerCase(),
    priceWei: String(row.price_wei ?? row.priceWei ?? "0"),
    paymentAsset: String(row.payment_asset || row.paymentAsset || "mon").toLowerCase() === "usdc" ? "usdc" : "mon",
    active: row.active !== false,
  };
}

function addressEnv(name, fallback = "") {
  const raw = String(process.env[name] || fallback).trim();
  if (!raw) return "";
  if (!ADDRESS.test(raw)) throw new Error("invalid_address_env");
  return raw;
}

function safeError(error) {
  const msg = String(error?.shortMessage || error?.message || "failed");
  if (/0x[a-fA-F0-9]{64}/.test(msg) || /private[_ ]?key/i.test(msg)) return "failed";
  return msg.slice(0, 180);
}

const GET_ARTICLE_ABI = [
  {
    name: "getArticle",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "articleId", type: "bytes32" }],
    outputs: [
      { name: "priceWei", type: "uint256" },
      { name: "publisher", type: "address" },
      { name: "active", type: "bool" },
    ],
  },
];

const REGISTER_FOR_ABI = [
  {
    name: "registerArticleFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "articleId", type: "bytes32" },
      { name: "priceWei", type: "uint256" },
      { name: "publisher", type: "address" },
    ],
    outputs: [],
  },
];

const RELAYER_ABI = [
  {
    name: "relayer",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

const OWNER_ABI = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

async function viem() {
  return import("viem");
}

function chainOf(rpcUrl) {
  return {
    id: 143,
    name: "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

async function scanRegisteredIds(client, contract, fromBlock, parseAbiItem) {
  const latest = await client.getBlockNumber();
  let chunk = 2000n;
  const ids = new Set();
  let from = fromBlock;
  while (from <= latest) {
    const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;
    try {
      const logs = await client.getLogs({
        address: contract,
        event: parseAbiItem(
          "event ArticleRegistered(bytes32 indexed articleId, uint256 priceWei, address indexed publisher)"
        ),
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        if (log.args?.articleId) ids.add(String(log.args.articleId).toLowerCase());
      }
      from = to + 1n;
    } catch (error) {
      if (chunk <= 100n) throw new Error(`chain_log_failed:${safeError(error)}`);
      chunk = chunk / 2n < 100n ? 100n : chunk / 2n;
    }
  }
  return [...ids];
}

async function readChainArticles(paymentAsset, contract, fromBlock) {
  const { createPublicClient, http, parseAbiItem } = await viem();
  const rpcUrl = (process.env.MONAD_RPC_URL || "https://rpc.monad.xyz").trim() || "https://rpc.monad.xyz";
  const client = createPublicClient({ chain: chainOf(rpcUrl), transport: http(rpcUrl) });
  const ids = await scanRegisteredIds(client, contract, fromBlock, parseAbiItem);
  const rows = [];
  for (const articleIdHash of ids) {
    const article = await client.readContract({
      address: contract,
      abi: GET_ARTICLE_ABI,
      functionName: "getArticle",
      args: [articleIdHash],
    });
    rows.push({
      articleIdHash,
      priceWei: article[0].toString(),
      publisher: String(article[1] || "").toLowerCase(),
      active: Boolean(article[2]),
      paymentAsset,
    });
  }
  return rows;
}

async function readDbArticles() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("db_not_configured");
  const rows = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const endpoint = new URL("/rest/v1/articles", url);
    endpoint.searchParams.set(
      "select",
      "article_id_hash,publisher,price_wei,payment_asset,active"
    );
    endpoint.searchParams.set("order", "id.asc");
    endpoint.searchParams.set("limit", String(page));
    endpoint.searchParams.set("offset", String(offset));
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!res.ok) throw new Error(`db_read_failed:${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error("db_read_failed");
    rows.push(...batch.map(normalizeDbArticle));
    if (batch.length < page) break;
  }
  return rows;
}

async function assertDestinationRelayer(client, contract) {
  const { assertRelayerRole, legacyOwnerRelayerEnabled, relayerAccount } = await import(
    "../server/relay-register.mjs"
  );
  const account = relayerAccount();
  if (!account) throw new Error("relayer_not_configured");
  let relayerOnContract = null;
  try {
    relayerOnContract = await client.readContract({
      address: contract,
      abi: RELAYER_ABI,
      functionName: "relayer",
    });
  } catch {
    relayerOnContract = null;
  }
  let ownerOnContract = null;
  if (relayerOnContract == null) {
    try {
      ownerOnContract = await client.readContract({
        address: contract,
        abi: OWNER_ABI,
        functionName: "owner",
      });
    } catch {
      ownerOnContract = null;
    }
  }
  assertRelayerRole({
    account: account.address,
    relayerOnContract,
    ownerOnContract,
    legacyOwnerRelayer: legacyOwnerRelayerEnabled(),
  });
  return account;
}

async function broadcastPlan(plans) {
  const { createPublicClient, createWalletClient, http } = await viem();
  const rpcUrl = (process.env.MONAD_RPC_URL || "https://rpc.monad.xyz").trim() || "https://rpc.monad.xyz";
  const chain = chainOf(rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const byTarget = new Map();
  for (const plan of plans) {
    if (!plan.target) throw new Error("missing_new_contract");
    if (!byTarget.has(plan.target)) byTarget.set(plan.target, []);
    byTarget.get(plan.target).push(plan);
  }
  const results = [];
  for (const [target, group] of byTarget) {
    const account = await assertDestinationRelayer(publicClient, target);
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
    for (const plan of group) {
      let existingPublisher = ZERO;
      try {
        const existing = await publicClient.readContract({
          address: target,
          abi: GET_ARTICLE_ABI,
          functionName: "getArticle",
          args: [plan.articleIdHash],
        });
        existingPublisher = String(existing[1] || "").toLowerCase();
      } catch {
        existingPublisher = ZERO;
      }
      if (existingPublisher && existingPublisher !== ZERO) {
        results.push({
          ...plan,
          status: existingPublisher === plan.publisher ? "already_registered" : "conflict",
          txHash: null,
        });
        continue;
      }
      try {
        const txHash = await walletClient.writeContract({
          address: target,
          abi: REGISTER_FOR_ABI,
          functionName: "registerArticleFor",
          args: [plan.articleIdHash, BigInt(plan.priceWei), plan.publisher],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        results.push({ ...plan, status: "registered", txHash });
      } catch (error) {
        throw new Error(`broadcast_failed:${safeError(error)}`);
      }
    }
  }
  return results;
}

export async function runMigration(options, deps = {}) {
  const remap = deps.remap ?? readRemapFile(options.remapPath);
  const fromBlock = BigInt(options.fromBlock ?? process.env.MIGRATE_FROM_BLOCK ?? "0");
  const oldMon = addressEnv("OLD_MON_UNLOCK_CONTRACT", DEFAULT_OLD_MON);
  const oldUsdc = addressEnv("OLD_USDC_UNLOCK_CONTRACT", DEFAULT_OLD_USDC);
  const newMon = addressEnv("NEW_MON_UNLOCK_CONTRACT");
  const newUsdc = addressEnv("NEW_USDC_UNLOCK_CONTRACT");

  let chainRows = deps.chainRows;
  let dbRows = deps.dbRows;
  if (!chainRows && (options.source === "chain" || options.source === "both")) {
    chainRows = [
      ...(await readChainArticles("mon", oldMon, fromBlock)),
      ...(await readChainArticles("usdc", oldUsdc, fromBlock)),
    ];
  }
  if (!dbRows && (options.source === "db" || options.source === "both")) {
    dbRows = await readDbArticles();
  }
  const rows =
    options.source === "both"
      ? mergeRows(chainRows || [], dbRows || [])
      : options.source === "db"
        ? dbRows || []
        : chainRows || [];
  const plan = buildPlan(rows, { newMon, newUsdc, remap });
  if (!options.confirm) {
    return { dryRun: true, ...plan };
  }
  const missing = plan.plans.filter((item) => !item.target);
  if (missing.length) throw new Error("missing_new_contract");
  const results = deps.broadcast ? await deps.broadcast(plan.plans) : await broadcastPlan(plan.plans);
  return { dryRun: false, ...plan, results };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await runMigration(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirect) {
  main();
}
