/**
 * Optional MiroShark “simulate how this lands” helper for Write.
 *
 * Open Paywall is the x402aff **builder/affiliate**: we send `X-Builder-Code`
 * on POST /run so MiroShark’s first-party 0xSplits path can pay the documented
 * ~10% cut in USDC on Base. Affiliate settlement is Base even if the sim
 * itself can run on Monad / Base / Solana.
 *
 * Env:
 *   BASE_BUILDER_CODE              — required to enable (never invented)
 *   MIROSHARK_BASE_URL             — default https://x402.miroshark.xyz
 *   MIROSHARK_X402_PRIVATE_KEY     — optional server-side $1 USDC payer
 *
 * With no server payer, Write asks the signed-in wallet to approve the $1
 * USDC authorization on Base, then this module retries POST /run and the
 * browser opens MiroShark’s simulation page.
 *
 * Publish must not call this module.
 */
import { randomBytes } from "node:crypto";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeJsonB64OrJson, encodeJsonB64 } from "./x402.mjs";

export const AFFILIATION_MARKER = "x402aff";
export const BUILDER_CODE_HEADER = "X-Builder-Code";
export const BUILDER_CODE_PATTERN = /^[a-z0-9_]{1,32}$/;
export const DEFAULT_MIROSHARK_BASE_URL = "https://x402.miroshark.xyz";
export const BASE_CAIP2 = "eip155:8453";
export const BASE_CHAIN_ID = 8453;
export const RUN_ID_PATTERN = /^run_[0-9a-f]{12}$/;
export const MISSING_BUILDER_CODE_MESSAGE =
  "Simulate how this lands with MiroShark is off until a Base Builder Code is set. Get one at https://dashboard.base.org (or https://base.dev) → register the app, verify the domain, then Settings → Builder Codes. Set BASE_BUILDER_CODE on Railway. Do not invent a code — the homepage base:app_id meta (6aab87b69b238d5ecd11e976) is only for domain verify.";

const PROMPT_MAX = 4000;
const BODY_SNIPPET = 1600;
const FETCH_MS = 25_000;

export function normalizeBuilderCode(raw) {
  const code = String(raw || "").trim().toLowerCase();
  return BUILDER_CODE_PATTERN.test(code) ? code : "";
}

export function baseBuilderCode() {
  return normalizeBuilderCode(process.env.BASE_BUILDER_CODE);
}

export function mirosharkBaseUrl() {
  const raw = String(process.env.MIROSHARK_BASE_URL || DEFAULT_MIROSHARK_BASE_URL)
    .trim()
    .replace(/\/$/, "");
  return raw || DEFAULT_MIROSHARK_BASE_URL;
}

/** Optional spike/dev payer. Invalid values are treated as unset — never guessed. */
export function mirosharkPayerKey() {
  const raw = String(process.env.MIROSHARK_X402_PRIVATE_KEY || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(raw) ? raw : "";
}

export function markedServiceCodes(code) {
  const primary = normalizeBuilderCode(code);
  if (!primary) return [];
  return primary === AFFILIATION_MARKER ? [primary] : [primary, AFFILIATION_MARKER];
}

export function builderCodeHeaders(code = baseBuilderCode()) {
  const normalized = normalizeBuilderCode(code);
  if (!normalized) return {};
  return { [BUILDER_CODE_HEADER]: normalized };
}

export function splitDraft(raw) {
  const text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return { teaser: "", body: "" };
  const sep = text.search(/^---\s*$/m);
  if (sep >= 0) {
    const teaser = text.slice(0, sep).trim();
    const body = text
      .slice(sep)
      .replace(/^---\s*\n?/, "")
      .trim();
    if (teaser && body) return { teaser, body };
    if (body) return { teaser: body.slice(0, 280).trim(), body };
    return { teaser, body: teaser };
  }
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length >= 2) {
    return { teaser: paras[0], body: paras.slice(1).join("\n\n") };
  }
  const only = paras[0] || text;
  return {
    teaser: only.length <= 280 ? only : only.slice(0, 280).trim(),
    body: only,
  };
}

export function buildMirosharkSeed({ title, teaser, body }) {
  const headline = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  const preview = String(teaser || "").trim();
  const snippet = String(body || "").trim().slice(0, BODY_SNIPPET);
  const parts = [
    "How might this unpublished article land with a simulated social audience? Model reader reaction, belief drift, and whether people would pay to finish it.",
    headline ? `Title: ${headline}` : "",
    preview ? `Teaser: ${preview}` : "",
    snippet ? `Excerpt:\n${snippet}` : "",
  ].filter(Boolean);
  const prompt = parts.join("\n\n").slice(0, PROMPT_MAX);
  return { prompt };
}

export function pickBaseAccept(accepts) {
  if (!Array.isArray(accepts)) return null;
  for (const row of accepts) {
    const network = String(row?.network || "")
      .trim()
      .toLowerCase();
    if (network === BASE_CAIP2 || network === "base" || network === `eip155:${BASE_CHAIN_ID}`) {
      return row;
    }
  }
  return null;
}

export function affiliateMeta(code = baseBuilderCode()) {
  const builderCode = normalizeBuilderCode(code);
  return {
    protocol: "x402aff",
    header: BUILDER_CODE_HEADER,
    extension: "builder-code",
    builderCode: builderCode || null,
    settlement: "USDC on Base",
    expectedCut:
      "~10% of the $1 run (~$0.10 USDC) via MiroShark’s 0xSplits path after distribute",
    caveat:
      "Unregistered or unknown codes fall back to an unsplit payment to MiroShark. Affiliate payout is Base-settled even if the sim can run on Monad or Solana.",
  };
}

export function mirosharkPublicStatus() {
  const builderCode = baseBuilderCode();
  const enabled = Boolean(builderCode);
  return {
    ok: true,
    enabled,
    reason: enabled ? null : "missing_builder_code",
    message: enabled
      ? "Simulate how this lands with MiroShark is on. Publish still works without it."
      : MISSING_BUILDER_CODE_MESSAGE,
    builderCode: builderCode || null,
    serverPayer: Boolean(mirosharkPayerKey()),
    baseUrl: mirosharkBaseUrl(),
    amountUsd: "1.00",
    network: BASE_CAIP2,
    asset: "USDC",
    affiliate: affiliateMeta(builderCode),
    docs: "/docs/MIROSHARK.md",
  };
}

function sendJson(res, status, body) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Accept, X-PAYMENT, PAYMENT-SIGNATURE, X-Builder-Code",
  });
  res.end(payload);
}

function readIncomingBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body_too_large"));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return String(headers.get(name) || "").trim();
  }
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === want) {
      return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
    }
  }
  return "";
}

export function parsePaymentRequired(res, text) {
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  const headerRaw =
    headerValue(res?.headers, "payment-required") ||
    headerValue(res?.headers, "PAYMENT-REQUIRED") ||
    headerValue(res?.headers, "x-payment-required");
  const fromHeader = headerRaw ? decodeJsonB64OrJson(headerRaw) : null;
  const challenge =
    body && Array.isArray(body.accepts) && body.accepts.length
      ? body
      : fromHeader && !fromHeader.invalid
        ? fromHeader
        : body;
  return challenge && typeof challenge === "object" ? challenge : null;
}

function echoAppCode(challenge) {
  const info = challenge?.extensions?.["builder-code"]?.info;
  const a = normalizeBuilderCode(info?.a);
  return a || "";
}

export function builderCodePaymentExtensions(code, challenge) {
  const s = markedServiceCodes(code);
  const info = { s };
  const a = echoAppCode(challenge);
  if (a) info.a = a;
  return { "builder-code": { info } };
}

function eip3009Types() {
  return {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
}

/**
 * Sign a Base USDC EIP-3009 authorization for the 402’s payTo (often the
 * x402aff split). Tests inject fetch so this never hits mainnet in CI.
 */
export async function signBaseExactPayment({ accept, challenge, builderCode, privateKey, nowMs }) {
  const account = privateKeyToAccount(privateKey);
  const payTo = String(accept.payTo || "");
  const amount = String(accept.amount || accept.maxAmountRequired || "1000000");
  const asset = String(accept.asset || "");
  const extra = accept.extra && typeof accept.extra === "object" ? accept.extra : {};
  const timeout = Number(accept.maxTimeoutSeconds) || 300;
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor((nowMs || Date.now()) / 1000) + timeout);
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const value = BigInt(amount);
  const signature = await account.signTypedData({
    domain: {
      name: extra.name || "USD Coin",
      version: extra.version || "2",
      chainId: BASE_CHAIN_ID,
      verifyingContract: asset,
    },
    types: eip3009Types(),
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: payTo,
      value,
      validAfter,
      validBefore,
      nonce,
    },
  });
  const envelope = {
    x402Version: 2,
    accepted: accept,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: payTo,
        value: amount,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
      },
    },
    extensions: builderCodePaymentExtensions(builderCode, challenge),
  };
  if (challenge?.resource) envelope.resource = challenge.resource;
  return { envelope, header: encodeJsonB64(envelope), from: account.address };
}

function amountUsdFromBaseUnits(amount) {
  try {
    const raw = BigInt(amount);
    const whole = raw / 1_000_000n;
    const frac = (raw % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
    return `${whole}.${frac}`;
  } catch {
    return "1.00";
  }
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

/**
 * Signable $1 (or whatever the 402 charges) for the writer’s wallet.
 * `from` is filled in by the browser before eth_signTypedData_v4.
 */
export function buildClientPayment(accept, nowMs = Date.now()) {
  if (!accept || typeof accept !== "object") return null;
  const payTo = String(accept.payTo || "");
  const amount = String(accept.amount || accept.maxAmountRequired || "");
  const asset = String(accept.asset || "");
  if (!isAddress(payTo) || !/^\d+$/.test(amount) || amount === "0" || !isAddress(asset)) return null;
  const extra = accept.extra && typeof accept.extra === "object" ? accept.extra : {};
  const timeout = Number(accept.maxTimeoutSeconds);
  const windowSec = Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 86_400) : 300;
  const validBefore = String(Math.floor(Number(nowMs) / 1000) + windowSec);
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  return {
    chainId: BASE_CHAIN_ID,
    amountUsd: amountUsdFromBaseUnits(amount),
    asset,
    payTo,
    amount,
    domain: {
      name: String(extra.name || "USD Coin"),
      version: String(extra.version || "2"),
      chainId: BASE_CHAIN_ID,
      verifyingContract: asset,
    },
    types: eip3009Types(),
    primaryType: "TransferWithAuthorization",
    message: {
      to: payTo,
      value: amount,
      validAfter: "0",
      validBefore,
      nonce,
    },
  };
}

function authorizationMatchesAccept(accept, authorization) {
  if (!authorization || typeof authorization !== "object") return false;
  const payTo = String(accept?.payTo || "").toLowerCase();
  const amount = String(accept?.amount || accept?.maxAmountRequired || "");
  const to = String(authorization.to || "").toLowerCase();
  if (!isAddress(payTo) || !isAddress(authorization.from) || !isAddress(to)) return false;
  if (to !== payTo) return false;
  try {
    if (BigInt(authorization.value) !== BigInt(amount)) return false;
  } catch {
    return false;
  }
  return true;
}

function authorizationDeadlineOk(authorization, nowMs) {
  let validAfter;
  let validBefore;
  try {
    validAfter = BigInt(authorization.validAfter);
    validBefore = BigInt(authorization.validBefore);
  } catch {
    return false;
  }
  const now = BigInt(Math.floor(Number(nowMs) / 1000));
  if (validAfter < 0n || validAfter > now + 120n) return false;
  if (validBefore <= now) return false;
  if (validBefore > now + 86_400n) return false;
  return /^0x[a-fA-F0-9]{64}$/.test(String(authorization.nonce || ""));
}

/**
 * Rebuild the x402 v2 envelope from a writer’s wallet signature.
 * The signed `to` and `value` must match this 402’s Base accept.
 */
export async function envelopeFromClientPayment({ accept, challenge, builderCode, payment, nowMs }) {
  const authorization = payment?.authorization;
  const signature = String(payment?.signature || "");
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    return { ok: false, code: "payment_invalid", message: "Could not read the wallet approval. Publish still works." };
  }
  if (!authorizationMatchesAccept(accept, authorization)) {
    return {
      ok: false,
      code: "payment_invalid",
      message: "That approval was not for this $1 USDC charge. Publish still works.",
    };
  }
  if (!authorizationDeadlineOk(authorization, nowMs || Date.now())) {
    return {
      ok: false,
      code: "payment_invalid",
      message: "That approval expired. Tap Simulate again. Publish still works.",
    };
  }
  const extra = accept.extra && typeof accept.extra === "object" ? accept.extra : {};
  let recovered;
  try {
    recovered = await recoverTypedDataAddress({
      domain: {
        name: String(extra.name || "USD Coin"),
        version: String(extra.version || "2"),
        chainId: BASE_CHAIN_ID,
        verifyingContract: accept.asset,
      },
      types: eip3009Types(),
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
      signature,
    });
  } catch {
    return { ok: false, code: "payment_invalid", message: "Could not verify the wallet approval. Publish still works." };
  }
  if (recovered.toLowerCase() !== String(authorization.from).toLowerCase()) {
    return {
      ok: false,
      code: "payment_invalid",
      message: "The approval did not come from the signed-in wallet. Publish still works.",
    };
  }
  const envelope = {
    x402Version: 2,
    accepted: accept,
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: String(authorization.value),
        validAfter: String(authorization.validAfter),
        validBefore: String(authorization.validBefore),
        nonce: authorization.nonce,
      },
    },
    extensions: builderCodePaymentExtensions(builderCode, challenge),
  };
  if (challenge?.resource) envelope.resource = challenge.resource;
  return { ok: true, envelope, header: encodeJsonB64(envelope), from: recovered };
}

function publicRun(data) {
  const row = data && typeof data === "object" ? data : {};
  const nested = row.data && typeof row.data === "object" ? row.data : row;
  return {
    runId: nested.run_id || nested.runId || null,
    status: nested.status || null,
    waitUrl: nested.wait_url || nested.waitUrl || null,
    statusUrl: nested.status_url || nested.statusUrl || null,
    shareUrl: nested.share_url || nested.shareUrl || null,
    progress: nested.progress ?? null,
    message: nested.message || nested.current_stage || null,
    error: nested.error || null,
    paymentNetwork: nested.payment_network || nested.paymentNetwork || null,
  };
}

export function summarizeReportMarkdown(markdown) {
  const text = String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!text) return "";
  return text.length > 720 ? `${text.slice(0, 720).trim()}…` : text;
}

async function fetchJson(fetchImpl, url, init, timeoutMs = FETCH_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { res, text, json };
  } finally {
    clearTimeout(timer);
  }
}

function failSoft(code, message, extra = {}) {
  return {
    ok: false,
    code,
    message,
    ...extra,
  };
}

async function submitPaidRun({
  fetchImpl,
  runUrl,
  headers,
  payload,
  paymentHeader,
  from,
  builderCode,
  challenge,
  rejectedMessage,
}) {
  let second;
  try {
    second = await fetchJson(fetchImpl, runUrl, {
      method: "POST",
      headers: {
        ...headers,
        "PAYMENT-SIGNATURE": paymentHeader,
      },
      body: payload,
    });
  } catch (e) {
    return failSoft(
      "miroshark_unreachable",
      "MiroShark did not accept the payment. Publish still works without a preview.",
      { error: e?.message || "fetch_failed", affiliate: affiliateMeta(builderCode) }
    );
  }

  if (second.res.status === 202 || second.res.status === 200) {
    return {
      ok: true,
      run: publicRun(second.json),
      affiliate: affiliateMeta(builderCode),
      paid: true,
      payer: from,
      paymentNetwork: BASE_CAIP2,
    };
  }

  return failSoft(
    "payment_rejected",
    rejectedMessage ||
      "MiroShark did not accept the $1 USDC payment. This wallet needs $1 USDC on Base. Publish still works.",
    {
      status: second.res.status,
      affiliate: affiliateMeta(builderCode),
      paymentRequired: parsePaymentRequired(second.res, second.text) || challenge,
    }
  );
}

export async function requestMirosharkPreview({
  title,
  body,
  payment,
  fetchImpl = fetch,
  nowMs = Date.now(),
} = {}) {
  const builderCode = baseBuilderCode();
  if (!builderCode) {
    return failSoft("missing_builder_code", MISSING_BUILDER_CODE_MESSAGE, {
      affiliate: affiliateMeta(""),
    });
  }

  const draft = splitDraft(body);
  const seed = buildMirosharkSeed({
    title,
    teaser: draft.teaser,
    body: draft.body || String(body || ""),
  });
  if (String(seed.prompt || "").length < 4) {
    return failSoft(
      "need_draft",
      "Add a title and a few sentences first. Preview never blocks Publish."
    );
  }

  const origin = mirosharkBaseUrl();
  const runUrl = `${origin}/run`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...builderCodeHeaders(builderCode),
  };
  const payload = JSON.stringify(seed);

  let first;
  try {
    first = await fetchJson(fetchImpl, runUrl, {
      method: "POST",
      headers,
      body: payload,
    });
  } catch (e) {
    return failSoft(
      "miroshark_unreachable",
      "MiroShark did not respond. Publish still works without a preview.",
      { error: e?.message || "fetch_failed", affiliate: affiliateMeta(builderCode) }
    );
  }

  if (first.res.status === 202 || first.res.status === 200) {
    return {
      ok: true,
      run: publicRun(first.json),
      affiliate: affiliateMeta(builderCode),
      paid: Boolean(headers["PAYMENT-SIGNATURE"]),
    };
  }

  if (first.res.status !== 402) {
    return failSoft(
      "miroshark_error",
      "MiroShark preview failed. Publish still works without it.",
      {
        status: first.res.status,
        affiliate: affiliateMeta(builderCode),
      }
    );
  }

  const challenge = parsePaymentRequired(first.res, first.text);
  const accept = pickBaseAccept(challenge?.accepts);
  const clientPayment = buildClientPayment(accept, nowMs);
  const paymentRequired = {
    ok: false,
    code: "payment_required",
    message: clientPayment
      ? "Approve $1 USDC on Base to open the simulation. Publish still works."
      : "MiroShark’s $1 charge had no Base USDC option. Publish still works.",
    amountUsd: clientPayment?.amountUsd || "1.00",
    network: BASE_CAIP2,
    asset: "USDC",
    builderCodeAttached: true,
    affiliate: affiliateMeta(builderCode),
    paymentRequired: challenge,
    clientPayment,
    miroshark: { method: "POST", url: runUrl },
  };

  if (payment?.signature || payment?.authorization) {
    if (!accept) {
      return failSoft(
        "base_accept_missing",
        "MiroShark’s 402 had no Base (eip155:8453) accept, so the wallet payment cannot be sent. Publish still works.",
        { affiliate: affiliateMeta(builderCode), paymentRequired: challenge }
      );
    }
    const built = await envelopeFromClientPayment({
      accept,
      challenge,
      builderCode,
      payment,
      nowMs,
    });
    if (!built.ok) {
      return failSoft(built.code, built.message, {
        affiliate: affiliateMeta(builderCode),
        clientPayment,
      });
    }
    return submitPaidRun({
      fetchImpl,
      runUrl,
      headers,
      payload,
      paymentHeader: built.header,
      from: built.from,
      builderCode,
      challenge,
      rejectedMessage:
        "MiroShark did not accept the $1 USDC payment. This wallet needs $1 USDC on Base. Publish still works.",
    });
  }

  const payerKey = mirosharkPayerKey();
  if (!payerKey) return paymentRequired;
  if (!accept) {
    return failSoft(
      "base_accept_missing",
      "MiroShark’s 402 had no Base (eip155:8453) accept, so the affiliate path cannot pay. Publish still works.",
      { affiliate: affiliateMeta(builderCode), paymentRequired: challenge }
    );
  }

  let signed;
  try {
    signed = await signBaseExactPayment({
      accept,
      challenge,
      builderCode,
      privateKey: payerKey,
      nowMs,
    });
  } catch (e) {
    return failSoft(
      "payer_sign_failed",
      "Could not sign the $1 USDC x402 payment. Publish still works.",
      { error: e?.message || "sign_failed", affiliate: affiliateMeta(builderCode) }
    );
  }

  return submitPaidRun({
    fetchImpl,
    runUrl,
    headers,
    payload,
    paymentHeader: signed.header,
    from: signed.from,
    builderCode,
    challenge,
    rejectedMessage:
      "MiroShark rejected the server-side $1 payment. Publish still works.",
  });
}

export async function fetchMirosharkRun(runId, { fetchImpl = fetch } = {}) {
  const id = String(runId || "").trim();
  if (!RUN_ID_PATTERN.test(id)) {
    return failSoft("invalid_run_id", "That run id does not look like a MiroShark run.");
  }
  const origin = mirosharkBaseUrl();
  let status;
  try {
    status = await fetchJson(fetchImpl, `${origin}/status/${id}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    return failSoft("miroshark_unreachable", "Could not poll MiroShark status.", {
      error: e?.message || "fetch_failed",
    });
  }
  if (status.res.status === 404) {
    return failSoft("run_not_found", "MiroShark does not know that run id.");
  }
  if (!status.res.ok) {
    return failSoft("miroshark_error", "MiroShark status failed.", {
      status: status.res.status,
    });
  }
  const run = publicRun(status.json);
  let summary = "";
  if (run.status === "completed") {
    try {
      const report = await fetchJson(fetchImpl, `${origin}/report/${id}?format=json`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const markdown =
        report.json?.data?.report_markdown ||
        report.json?.report_markdown ||
        (typeof report.json?.data === "string" ? report.json.data : "");
      summary = summarizeReportMarkdown(markdown);
    } catch {
      summary = "";
    }
  }
  return { ok: true, run, summary };
}

/**
 * Connect-style handler for production (`server/index.mjs`) and Vite `npm run dev`.
 * Returns true if the request was fully answered.
 */
export async function tryHandleMirosharkRequest(req, res) {
  const method = req.method || "GET";
  const pathOnly = String(req.url || "").split("?")[0];
  if (!pathOnly.startsWith("/api/miroshark")) return false;

  if (method === "OPTIONS") {
    sendJson(res, 204, {});
    return true;
  }

  if ((method === "GET" || method === "HEAD") && pathOnly === "/api/miroshark/status") {
    const body = mirosharkPublicStatus();
    if (method === "HEAD") {
      sendJson(res, 200, body);
      return true;
    }
    sendJson(res, 200, body);
    return true;
  }

  if (method === "POST" && pathOnly === "/api/miroshark/preview") {
    let parsed = {};
    try {
      const raw = await readIncomingBody(req);
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      sendJson(res, e?.message === "body_too_large" ? 413 : 400, {
        ok: false,
        code: "invalid_json",
        message: "Could not read the draft. Publish still works.",
      });
      return true;
    }
    try {
      const result = await requestMirosharkPreview({
        title: parsed.title,
        body: parsed.body,
        payment: parsed.payment,
      });
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 200, failSoft("preview_failed", "Preview failed. Publish still works.", {
        error: e?.message || "preview_failed",
      }));
    }
    return true;
  }

  const runMatch = pathOnly.match(/^\/api\/miroshark\/runs\/([^/]+)$/);
  if ((method === "GET" || method === "HEAD") && runMatch) {
    try {
      const result = await fetchMirosharkRun(runMatch[1]);
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 200, failSoft("preview_failed", "Could not load the sim. Publish still works.", {
        error: e?.message || "preview_failed",
      }));
    }
    return true;
  }

  sendJson(res, 404, { ok: false, code: "not_found" });
  return true;
}
