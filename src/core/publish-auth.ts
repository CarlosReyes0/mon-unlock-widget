/**
 * Auth material for register-article, update-listing, article-body,
 * writer plan updates, and per-article à la carte updates.
 *
 * Browser pages import the compiled /dist/core/publish-auth.js.
 * Supabase Edge Functions import this TypeScript source.
 * Message text is the signed payload — do not reorder lines.
 *
 * Plan, à la carte, Connect onboarding, gas, media, and voice-draft messages
 * are mirrored in server/writer-mutation-auth.mjs (the Railway server cannot
 * import this TypeScript). Keep both copies identical, including the issuedAt line.
 */

export const PUBLISH_AUTH_PREFIX = "Open Paywall publish v1";
export const LISTING_AUTH_PREFIX = "Open Paywall listing v1";
export const PLAN_AUTH_PREFIX = "Open Paywall plan v1";
export const A_LA_CARTE_AUTH_PREFIX = "Open Paywall a-la-carte v1";
export const CONNECT_AUTH_PREFIX = "Open Paywall connect v1";
export const GAS_AUTH_PREFIX = "Open Paywall gas v1";
export const MEDIA_AUTH_PREFIX = "Open Paywall media v1";
export const VOICE_AUTH_PREFIX = "Open Paywall voice v1";
export const FOLLOWER_AUTH_PREFIX = "Open Paywall follower v1";
export const FOLLOWERS_EXPORT_AUTH_PREFIX = "Open Paywall followers export v1";
export const MONAD_CHAIN_ID = 143;

/** ArticleUnlock (native MON) used by current embeds. Replace at cutover; do not edit LEGACY_ below. */
export const MON_UNLOCK_CONTRACT = "0x31282ceFbC656CA8DbCFf1398906a1AEF81Af167";
/** ArticleUnlockUsdc on Monad mainnet. Replace at cutover; do not edit LEGACY_ below. */
export const USDC_UNLOCK_CONTRACT = "0xa27bb0c25D12DE778bA135162ebAE665593786b2";

/**
 * Unlock contracts that stay readable after a cutover.
 * hasUnlocked on these addresses still counts. Do not point these at the new contracts.
 */
export const LEGACY_MON_UNLOCK_CONTRACT = "0x27cA0c23835328e2Ab1424b66330be86fe177FA6";
export const LEGACY_USDC_UNLOCK_CONTRACT = "0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f";

/**
 * Public anon JWT already shipped in the widget and dashboard.
 * This is not a secret. verify_jwt accepts it, so every edge function
 * must enforce its own check in the handler.
 */
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4";

export function supabaseFunctionHeaders(
  extra?: Record<string, string>
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...(extra || {}),
  };
}

/** Constant-time string compare. Empty values never match. */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = provided.trim();
  const b = expected.trim();
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(aa.length, bb.length);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * True when headerName or Authorization: Bearer equals expectedSecret.
 * With verify_jwt enabled, Authorization must stay the anon/user JWT and the
 * shared secret belongs in headerName (the gateway rejects a non-JWT bearer).
 */
export function requestHasSecret(
  headers: { get(name: string): string | null },
  expectedSecret: string,
  headerName: string
): boolean {
  const expected = expectedSecret.trim();
  if (!expected) return false;
  const fromHeader = (headers.get(headerName) || "").trim();
  if (fromHeader && secretsMatch(fromHeader, expected)) return true;
  const auth = headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)/i.exec(auth.trim());
  if (match && secretsMatch(match[1], expected)) return true;
  return false;
}

export function dedupeAddresses(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const c = String(raw || "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(c)) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function allowedUnlockContracts(
  extra: Array<string | null | undefined> = []
): string[] {
  return dedupeAddresses([
    MON_UNLOCK_CONTRACT,
    USDC_UNLOCK_CONTRACT,
    LEGACY_MON_UNLOCK_CONTRACT,
    LEGACY_USDC_UNLOCK_CONTRACT,
    ...extra,
  ]);
}

/** Current MON contract, the pre-cutover MON contract, and any extra MON address. */
export function monReadContracts(extra: Array<string | null | undefined> = []): string[] {
  return dedupeAddresses([MON_UNLOCK_CONTRACT, LEGACY_MON_UNLOCK_CONTRACT, ...extra]);
}

/** Current USDC contract, the pre-cutover USDC contract, and any extra USDC address. */
export function usdcReadContracts(extra: Array<string | null | undefined> = []): string[] {
  const other = new Set(
    [MON_UNLOCK_CONTRACT, LEGACY_MON_UNLOCK_CONTRACT].map((c) => c.toLowerCase())
  );
  const filtered = extra.filter((raw) => !other.has(String(raw || "").trim().toLowerCase()));
  return dedupeAddresses([USDC_UNLOCK_CONTRACT, LEGACY_USDC_UNLOCK_CONTRACT, ...filtered]);
}

/**
 * Contracts whose hasUnlocked counts for this payment asset.
 * MON reads do not include the USDC contracts, and the reverse.
 * An unknown asset checks both families. Extras that are the other asset's
 * known addresses are dropped so a shared env list cannot cross the asset.
 */
export function readContractsForAsset(
  paymentAsset: string | null | undefined,
  extra: Array<string | null | undefined> = []
): string[] {
  const asset = String(paymentAsset ?? "").trim().toLowerCase();
  if (asset === "mon") {
    const other = new Set(
      [USDC_UNLOCK_CONTRACT, LEGACY_USDC_UNLOCK_CONTRACT].map((c) => c.toLowerCase())
    );
    const filtered = extra.filter((raw) => !other.has(String(raw || "").trim().toLowerCase()));
    return monReadContracts(filtered);
  }
  if (asset === "usdc") return usdcReadContracts(extra);
  return dedupeAddresses([...monReadContracts(extra), ...usdcReadContracts(extra)]);
}

/**
 * Widget path: the embed contract picks the family.
 * A primary that is not in either family is checked on its own.
 * A known MON or USDC primary is checked together with its legacy twin.
 */
export function readContractsForPrimary(primary: string | null | undefined): string[] {
  const p = String(primary || "").trim().toLowerCase();
  const mon = monReadContracts();
  const usdc = usdcReadContracts();
  if (p && usdc.some((c) => c.toLowerCase() === p)) return usdc;
  if (p && mon.some((c) => c.toLowerCase() === p)) return mon;
  if (p && /^0x[a-f0-9]{40}$/.test(p)) return [String(primary).trim()];
  return dedupeAddresses([...mon, ...usdc]);
}

export function isAllowedUnlockContract(
  value: string | null | undefined,
  extra: Array<string | null | undefined> = []
): boolean {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return allowedUnlockContracts(extra).some((c) => c.toLowerCase() === v);
}

/** Address bound into a publish signature. Anything other than "mon" is USDC. */
export function publishContractForAsset(paymentAsset: string | null | undefined): string {
  const v = String(paymentAsset ?? "").trim().toLowerCase();
  if (v === "mon") return MON_UNLOCK_CONTRACT.toLowerCase();
  return USDC_UNLOCK_CONTRACT.toLowerCase();
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function listFlag(value: unknown): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

export type PublishAuthFields = {
  slug: unknown;
  publisher: unknown;
  articleIdHash: unknown;
  priceWei: unknown;
  paymentAsset?: unknown;
  title?: unknown;
  author?: unknown;
  teaser?: unknown;
  body?: unknown;
  listOnOpenPaywall?: unknown;
  externalUrl?: unknown;
};

export function canonicalPublishContent(input: PublishAuthFields): string {
  return [
    `slug:${asText(input.slug).trim()}`,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `articleIdHash:${asText(input.articleIdHash).trim().toLowerCase()}`,
    `priceWei:${asText(input.priceWei).trim()}`,
    `paymentAsset:${asText(input.paymentAsset).trim().toLowerCase()}`,
    `title:${asText(input.title).trim()}`,
    `author:${asText(input.author).trim()}`,
    `teaser:${asText(input.teaser)}`,
    `body:${asText(input.body)}`,
    `list:${listFlag(input.listOnOpenPaywall)}`,
    `externalUrl:${asText(input.externalUrl).trim()}`,
  ].join("\n");
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildPublishAuthMessage(input: PublishAuthFields): Promise<string> {
  const hash = await sha256Hex(canonicalPublishContent(input));
  return [
    PUBLISH_AUTH_PREFIX,
    `chain:${MONAD_CHAIN_ID}`,
    `contract:${publishContractForAsset(asText(input.paymentAsset))}`,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `article:${asText(input.slug).trim()}`,
    `priceWei:${asText(input.priceWei).trim()}`,
    `sha256:${hash}`,
  ].join("\n");
}

export type ListingAuthFields = {
  slug: unknown;
  publisher: unknown;
  listOnOpenPaywall?: unknown;
  externalUrl?: unknown;
  title?: unknown;
  author?: unknown;
  embedSig?: unknown;
  /** Appended only when a listing update sets a price, so older signatures still verify. */
  priceCents?: unknown;
};

/** One signature per device. Do not reorder lines. */
export function buildFollowerAuthMessage(input: {
  wallet: unknown;
  origin: unknown;
  issuedAt: unknown;
}): string {
  return [
    FOLLOWER_AUTH_PREFIX,
    `chain:${MONAD_CHAIN_ID}`,
    `wallet:${asText(input.wallet).trim().toLowerCase()}`,
    `origin:${asText(input.origin).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/** Writer CSV export. Do not reorder lines. */
export function buildFollowersExportAuthMessage(input: {
  writer: unknown;
  issuedAt: unknown;
}): string {
  return [
    FOLLOWERS_EXPORT_AUTH_PREFIX,
    `chain:${MONAD_CHAIN_ID}`,
    `writer:${asText(input.writer).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

export function buildListingAuthMessage(input: ListingAuthFields): string {
  const lines = [
    LISTING_AUTH_PREFIX,
    `slug:${asText(input.slug).trim()}`,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `list:${listFlag(input.listOnOpenPaywall)}`,
    `url:${asText(input.externalUrl).trim()}`,
    `title:${asText(input.title)}`,
    `author:${asText(input.author)}`,
    `embedSig:${asText(input.embedSig).trim()}`,
  ];
  if (input.priceCents != null && input.priceCents !== "") {
    lines.push(`priceCents:${asText(input.priceCents).trim()}`);
  }
  return lines.join("\n");
}

export type PlanAuthFields = {
  publisher: unknown;
  monthlyPriceCents: unknown;
  allowALaCarte?: unknown;
  /** ISO-8601 timestamp. POST /api/writers/plan rejects it outside a 10-minute window. */
  issuedAt: unknown;
};

/** Binds the writer, the plan fields, and issuedAt that POST /api/writers/plan checks. */
export function buildPlanAuthMessage(input: PlanAuthFields): string {
  return [
    PLAN_AUTH_PREFIX,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `monthlyPriceCents:${asText(input.monthlyPriceCents).trim()}`,
    `allowALaCarte:${listFlag(input.allowALaCarte)}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

export type ALaCarteAuthFields = {
  articleId: unknown;
  publisher: unknown;
  allowALaCarte?: unknown;
  /** ISO-8601 timestamp. POST /api/articles/a-la-carte rejects it outside a 10-minute window. */
  issuedAt: unknown;
};

/** Binds the article, its publisher, the flag, and issuedAt. */
export function buildALaCarteAuthMessage(input: ALaCarteAuthFields): string {
  return [
    A_LA_CARTE_AUTH_PREFIX,
    `article:${asText(input.articleId).trim()}`,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `allowALaCarte:${listFlag(input.allowALaCarte)}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

export type ConnectAuthFields = {
  publisher: unknown;
  issuedAt: unknown;
};

/** Binds the writer and the issuedAt that POST /api/stripe/connect/onboard checks. */
export function buildConnectAuthMessage(input: ConnectAuthFields): string {
  return [
    CONNECT_AUTH_PREFIX,
    `publisher:${asText(input.publisher).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

export type RecentWalletAuthFields = {
  address: unknown;
  issuedAt: unknown;
};

export type GasAuthFields = RecentWalletAuthFields & {
  articleId: unknown;
};

/**
 * Unlock-attempt proof for a gas drip. Binds one article, the reader address,
 * and issuedAt. A registration or session signature is a different message.
 */
export function buildGasAuthMessage(input: GasAuthFields): string {
  return [
    GAS_AUTH_PREFIX,
    `article:${asText(input.articleId).trim()}`,
    `address:${asText(input.address).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/** Writer proof for POST /api/media. Do not reorder lines. */
export function buildMediaAuthMessage(input: RecentWalletAuthFields): string {
  return [
    MEDIA_AUTH_PREFIX,
    `address:${asText(input.address).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/** Writer proof for POST /api/voice-drafts. Do not reorder lines. */
export function buildVoiceAuthMessage(input: RecentWalletAuthFields): string {
  return [
    VOICE_AUTH_PREFIX,
    `address:${asText(input.address).trim().toLowerCase()}`,
    `issuedAt:${asText(input.issuedAt).trim()}`,
  ].join("\n");
}

/**
 * A reserve that is not yet confirmRegistered must not flip listing_status.
 * The publish signature still covers the intended list flag so the confirm
 * call can reuse it.
 */
export function shouldApplyListing(input: {
  confirmRegistered?: unknown;
  priorStatus?: string | null;
  existingListingStatus?: string | null;
}): boolean {
  if (input.confirmRegistered === true) return true;
  if (input.priorStatus === "registered") return true;
  const status = input.existingListingStatus;
  return status === "listed" || status === "hidden";
}
