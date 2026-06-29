/**
 * Standalone test — run without OpenClaw:
 *   cd skills/mon-unlock-embed && npm install && npm test
 *
 * On-chain test (costs gas):
 *   MON_UNLOCK_PRIVATE_KEY=0x... npm run test:onchain
 */
import {
  buildGenerateResult,
  generateEmbed,
  getOnChainStatus,
  publishArticle,
  registerOnChain,
  toArticleIdHash,
} from "./embed.ts";

const PUBLISHER = "0x340f00000000000000000000000000000000659f";

const sample = {
  title: "July 3 11pm",
  articleId: "july-3-11pm-test",
  teaser: "walking home in the rain",
  body: "The streets were empty except for one guy with a massive umbrella.",
  author: "Carlos",
  price: "1",
  publisher: PUBLISHER,
};

// 1. Embed shape
const embed = generateEmbed(sample);
if (!embed.includes('article-id="july-3-11pm-test"')) throw new Error("missing article-id");
if (embed.includes('slot="body"')) throw new Error("body should NOT be in embed");
console.log("✓ embed format OK");

// 2. Hash
const { articleIdHash } = buildGenerateResult(sample);
console.log("✓ articleIdHash OK:", articleIdHash);

// 3. Supabase sync (no on-chain)
const result = await publishArticle(sample, { publisher: PUBLISHER });
if (!result.metadataSynced) {
  console.warn("⚠ metadata sync failed:", result.metadataError);
} else {
  console.log("✓ metadata synced to Supabase");
}

if (result.onChainRegistered) {
  console.log("✓ already registered on-chain");
} else {
  console.log("ℹ not registered on-chain (expected without privateKey)");
}

console.log("\n--- Embed ---\n");
console.log(result.embed);

// Optional on-chain registration test
if (process.env.MON_UNLOCK_PRIVATE_KEY) {
  console.log("\n--- On-chain test ---");
  const pk = process.env.MON_UNLOCK_PRIVATE_KEY;
  const hash = toArticleIdHash(`onchain-test-${Date.now()}`);
  const reg = await registerOnChain({
    articleIdHash: hash,
    priceWei: "1000000000000000000",
    privateKey: pk,
  });
  if (!reg.ok) throw new Error(reg.error);
  console.log("✓ on-chain registration OK:", reg.txHash || "(already registered)");

  const status = await getOnChainStatus(hash);
  if (!status.registered) throw new Error("not registered after tx");
  console.log("✓ on-chain status verified");
}
