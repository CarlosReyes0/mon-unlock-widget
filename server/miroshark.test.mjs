import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AFFILIATION_MARKER,
  BASE_CAIP2,
  BUILDER_CODE_HEADER,
  MISSING_BUILDER_CODE_MESSAGE,
  affiliateMeta,
  baseBuilderCode,
  buildMirosharkSeed,
  builderCodeHeaders,
  builderCodePaymentExtensions,
  markedServiceCodes,
  mirosharkPayerKey,
  normalizeBuilderCode,
  parsePaymentRequired,
  pickBaseAccept,
  pickPayAccept,
  requestMirosharkPreview,
  signBaseExactPayment,
  signExactPayment,
  buildClientPayment,
  mirosharkPublicStatus,
  DEFAULT_PAY_NETWORK,
  splitDraft,
  summarizeReportMarkdown,
} from "./miroshark.mjs";
import { decodeJsonB64OrJson } from "./x402.mjs";
import { privateKeyToAccount } from "viem/accounts";

const PREV_CODE = process.env.BASE_BUILDER_CODE;
const PREV_KEY = process.env.MIROSHARK_X402_PRIVATE_KEY;
const PREV_URL = process.env.MIROSHARK_BASE_URL;

test.afterEach(() => {
  if (PREV_CODE === undefined) delete process.env.BASE_BUILDER_CODE;
  else process.env.BASE_BUILDER_CODE = PREV_CODE;
  if (PREV_KEY === undefined) delete process.env.MIROSHARK_X402_PRIVATE_KEY;
  else process.env.MIROSHARK_X402_PRIVATE_KEY = PREV_KEY;
  if (PREV_URL === undefined) delete process.env.MIROSHARK_BASE_URL;
  else process.env.MIROSHARK_BASE_URL = PREV_URL;
});

test("normalizeBuilderCode accepts Base codes and rejects junk", () => {
  assert.equal(normalizeBuilderCode("bc_b7k3p9da"), "bc_b7k3p9da");
  assert.equal(normalizeBuilderCode("  LEAP_WALLET "), "leap_wallet");
  assert.equal(normalizeBuilderCode(""), "");
  assert.equal(normalizeBuilderCode("not a code"), "");
  assert.equal(normalizeBuilderCode("bc-with-dash"), "");
});

test("never invents a Builder Code from env miss or app id fallbacks", () => {
  delete process.env.BASE_BUILDER_CODE;
  assert.equal(baseBuilderCode(), "");
  assert.equal(builderCodeHeaders("")[BUILDER_CODE_HEADER], undefined);
  assert.equal(affiliateMeta("").builderCode, null);
});

test("markedServiceCodes stamps x402aff as the second s", () => {
  assert.deepEqual(markedServiceCodes("bc_openpaywall"), [
    "bc_openpaywall",
    AFFILIATION_MARKER,
  ]);
  assert.deepEqual(markedServiceCodes(AFFILIATION_MARKER), [AFFILIATION_MARKER]);
});

test("buildMirosharkSeed uses title, teaser, and a body snippet", () => {
  const seed = buildMirosharkSeed({
    title: "July rain walk",
    teaser: "Walking home in the rain.",
    body: "The rest of the piece continues after the fold.\n".repeat(80),
  });
  assert.match(seed.prompt, /July rain walk/);
  assert.match(seed.prompt, /Walking home/);
  assert.match(seed.prompt, /How might this unpublished article land/);
  assert.ok(seed.prompt.length <= 4000);
  assert.ok(seed.prompt.length >= 4);
});

test("splitDraft respects --- fold like Write", () => {
  const split = splitDraft("Free teaser\n---\nPaid body here");
  assert.equal(split.teaser, "Free teaser");
  assert.equal(split.body, "Paid body here");
});

test("pickBaseAccept prefers eip155:8453 even when Monad/Solana are listed", () => {
  const accept = pickBaseAccept([
    { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "1000000" },
    { network: "eip155:143", amount: "1000000" },
    { network: "eip155:8453", amount: "1000000", payTo: "0xabc" },
  ]);
  assert.equal(accept.network, BASE_CAIP2);
  assert.equal(accept.payTo, "0xabc");
});

test("missing builder code fails soft without calling MiroShark", async () => {
  delete process.env.BASE_BUILDER_CODE;
  let called = 0;
  const out = await requestMirosharkPreview({
    title: "Hello",
    body: "A draft with enough text to simulate.",
    fetchImpl: async () => {
      called += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, 0);
  assert.equal(out.ok, false);
  assert.equal(out.code, "missing_builder_code");
  assert.match(out.message, /BASE_BUILDER_CODE/);
  assert.match(MISSING_BUILDER_CODE_MESSAGE, /do not invent a code/i);
});

test("402 without a payer returns the challenge and still sent X-Builder-Code", async () => {
  process.env.BASE_BUILDER_CODE = "bc_testcode";
  delete process.env.MIROSHARK_X402_PRIVATE_KEY;
  const seen = [];
  const challenge = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "1000000",
        payTo: "0x1111111111111111111111111111111111111111",
        extra: { name: "USD Coin", version: "2" },
      },
    ],
    extensions: { "builder-code": { info: { a: "bc_r3g1wwdh" } } },
  };
  const out = await requestMirosharkPreview({
    title: "Hello",
    body: "Enough body text for a preview seed.",
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), headers: init.headers, hasSig: Boolean(init.headers["PAYMENT-SIGNATURE"]) });
      return {
        status: 402,
        ok: false,
        headers: { get: () => null, entries: () => [] },
        text: async () => JSON.stringify(challenge),
      };
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "payment_required");
  assert.equal(out.builderCodeAttached, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers[BUILDER_CODE_HEADER], "bc_testcode");
  assert.equal(seen[0].hasSig, false);
  assert.equal(out.affiliate.builderCode, "bc_testcode");
  assert.match(out.affiliate.expectedCut, /10%/);
  assert.equal(out.clientPayment.payTo, "0x1111111111111111111111111111111111111111");
  assert.equal(out.clientPayment.amount, "1000000");
  assert.equal(out.clientPayment.amountUsd, "1.00");
  assert.equal(out.clientPayment.message.to, out.clientPayment.payTo);
  assert.equal(out.clientPayment.message.value, "1000000");
  assert.equal(out.clientPayment.domain.chainId, 8453);
});

test("optional server payer retries with PAYMENT-SIGNATURE, Base accept, and x402aff s", async () => {
  process.env.BASE_BUILDER_CODE = "bc_testcode";
  process.env.MIROSHARK_X402_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const seen = [];
  const accept = {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "1000000",
    payTo: "0x2222222222222222222222222222222222222222",
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };
  const challenge = {
    x402Version: 2,
    resource: { url: "https://x402.miroshark.xyz/run" },
    accepts: [
      { network: "eip155:143", amount: "1000000", payTo: "0x0000CE08fa224696A819877070BF378e8B131ACF" },
      accept,
    ],
    extensions: { "builder-code": { info: { a: "bc_r3g1wwdh" } } },
  };
  const out = await requestMirosharkPreview({
    title: "Hello",
    body: "Enough body text for a preview seed.",
    network: "base",
    nowMs: 1_700_000_000_000,
    fetchImpl: async (url, init) => {
      const sig = init.headers["PAYMENT-SIGNATURE"] || "";
      seen.push({
        url: String(url),
        builder: init.headers[BUILDER_CODE_HEADER],
        sig,
      });
      if (!sig) {
        return {
          status: 402,
          ok: false,
          headers: {},
          text: async () => JSON.stringify(challenge),
        };
      }
      return {
        status: 202,
        ok: true,
        headers: {},
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              run_id: "run_aaaaaaaaaaaa",
              status: "queued",
              wait_url: "https://x402.example/wait/run_aaaaaaaaaaaa",
              status_url: "https://x402.example/status/run_aaaaaaaaaaaa",
            },
          }),
      };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.paid, true);
  assert.equal(out.run.runId, "run_aaaaaaaaaaaa");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].builder, "bc_testcode");
  assert.equal(seen[1].builder, "bc_testcode");
  assert.ok(seen[1].sig);
  const decoded = decodeJsonB64OrJson(seen[1].sig);
  assert.equal(decoded.x402Version, 2);
  assert.equal(decoded.accepted.network, BASE_CAIP2);
  assert.equal(decoded.accepted.payTo, accept.payTo);
  assert.deepEqual(decoded.extensions["builder-code"].info.s, [
    "bc_testcode",
    "x402aff",
  ]);
  assert.equal(decoded.extensions["builder-code"].info.a, "bc_r3g1wwdh");
});

test("a writer wallet signature pays the Base accept and opens a run", async () => {
  process.env.BASE_BUILDER_CODE = "bc_testcode";
  delete process.env.MIROSHARK_X402_PRIVATE_KEY;
  const account = privateKeyToAccount(
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  );
  const seen = [];
  const accept = {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "1000000",
    payTo: "0x2222222222222222222222222222222222222222",
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };
  const challenge = {
    x402Version: 2,
    accepts: [accept],
    extensions: { "builder-code": { info: { a: "bc_r3g1wwdh" } } },
  };
  const clientPayment = buildClientPayment(accept, 1_700_000_000_000);
  const signature = await account.signTypedData({
    domain: clientPayment.domain,
    types: clientPayment.types,
    primaryType: clientPayment.primaryType,
    message: {
      from: account.address,
      to: clientPayment.message.to,
      value: BigInt(clientPayment.message.value),
      validAfter: BigInt(clientPayment.message.validAfter),
      validBefore: BigInt(clientPayment.message.validBefore),
      nonce: clientPayment.message.nonce,
    },
  });
  const out = await requestMirosharkPreview({
    title: "Hello",
    body: "Enough body text for a preview seed.",
    nowMs: 1_700_000_000_000,
    payment: {
      signature,
      authorization: { from: account.address, ...clientPayment.message },
    },
    fetchImpl: async (_url, init) => {
      const sig = init.headers["PAYMENT-SIGNATURE"] || "";
      seen.push(sig);
      if (!sig) {
        return {
          status: 402,
          ok: false,
          headers: {},
          text: async () => JSON.stringify(challenge),
        };
      }
      return {
        status: 202,
        ok: true,
        headers: {},
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              run_id: "run_cccccccccccc",
              status: "queued",
              wait_url: "https://x402.example/wait/run_cccccccccccc",
            },
          }),
      };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.paid, true);
  assert.equal(out.run.waitUrl, "https://x402.example/wait/run_cccccccccccc");
  assert.equal(out.payer.toLowerCase(), account.address.toLowerCase());
  const decoded = decodeJsonB64OrJson(seen[1]);
  assert.equal(decoded.accepted.payTo, accept.payTo);
  assert.deepEqual(decoded.extensions["builder-code"].info.s, ["bc_testcode", "x402aff"]);
});

test("a mismatched wallet approval is not forwarded to MiroShark", async () => {
  process.env.BASE_BUILDER_CODE = "bc_testcode";
  delete process.env.MIROSHARK_X402_PRIVATE_KEY;
  const seen = [];
  const out = await requestMirosharkPreview({
    title: "Hello",
    body: "Enough body text for a preview seed.",
    nowMs: 1_700_000_000_000,
    payment: {
      signature: `0x${"ab".repeat(65)}`,
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x9999999999999999999999999999999999999999",
        value: "1000000",
        validAfter: "0",
        validBefore: "1700000300",
        nonce: `0x${"11".repeat(32)}`,
      },
    },
    fetchImpl: async (_url, init) => {
      seen.push(Boolean(init.headers["PAYMENT-SIGNATURE"]));
      return {
        status: 402,
        ok: false,
        headers: {},
        text: async () =>
          JSON.stringify({
            accepts: [
              {
                network: "eip155:8453",
                asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                amount: "1000000",
                payTo: "0x2222222222222222222222222222222222222222",
                extra: { name: "USD Coin", version: "2" },
              },
            ],
          }),
      };
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "payment_invalid");
  assert.deepEqual(seen, [false]);
});

test("sim errors fail soft and never throw", async () => {
  process.env.BASE_BUILDER_CODE = "bc_testcode";
  const out = await requestMirosharkPreview({
    title: "Hello",
    body: "Enough body text for a preview seed.",
    fetchImpl: async () => {
      const err = new Error("ECONNREFUSED");
      throw err;
    },
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "miroshark_unreachable");
});

test("invalid payer key is treated as unset, not invented", () => {
  process.env.MIROSHARK_X402_PRIVATE_KEY = "not-a-key";
  assert.equal(mirosharkPayerKey(), "");
});

test("summarizeReportMarkdown shortens a report", () => {
  const summary = summarizeReportMarkdown("# Headline\n\n" + "Readers argued. ".repeat(80));
  assert.ok(summary.length <= 730);
  assert.match(summary, /Readers argued/);
});

test("parsePaymentRequired reads JSON body accepts", () => {
  const challenge = parsePaymentRequired(
    { headers: {} },
    JSON.stringify({
      x402Version: 2,
      accepts: [{ network: "eip155:8453", amount: "1000000" }],
    })
  );
  assert.equal(challenge.accepts[0].network, BASE_CAIP2);
});

test("signBaseExactPayment pays the 402 payTo (split) on Base", async () => {
  process.env.BASE_BUILDER_CODE = "bc_testcode";
  const accept = {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "1000000",
    payTo: "0x3333333333333333333333333333333333333333",
    extra: { name: "USD Coin", version: "2" },
  };
  const signed = await signBaseExactPayment({
    accept,
    challenge: { extensions: { "builder-code": { info: { a: "bc_seller" } } } },
    builderCode: "bc_testcode",
    privateKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nowMs: 1_700_000_000_000,
  });
  assert.equal(signed.envelope.payload.authorization.to, accept.payTo);
  assert.equal(signed.envelope.accepted.network, BASE_CAIP2);
  assert.ok(signed.envelope.payload.signature.startsWith("0x"));
});

const SAMPLE_402 = [
  {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "1000000",
    payTo: "0x2222222222222222222222222222222222222222",
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  },
  {
    scheme: "exact",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: "1000000",
    payTo: "9vWbPNMvt8ui1cNN8jWWPUWT5LPmeXzq7nr3vry1vMPH",
    extra: { feePayer: "GVJJ7rdGiXr5xaYbRwRbjfaJL7fmwRygFi1H6aGqDveb" },
  },
  {
    scheme: "exact",
    network: "eip155:143",
    asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    amount: "1000000",
    payTo: "0x0000CE08fa224696A819877070BF378e8B131ACF",
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  },
];

test("pickPayAccept defaults to Monad and can select Base from a three-network 402", () => {
  assert.equal(DEFAULT_PAY_NETWORK, "monad");
  const monad = pickPayAccept(SAMPLE_402);
  assert.equal(monad.network, "eip155:143");
  assert.equal(monad.payTo, "0x0000CE08fa224696A819877070BF378e8B131ACF");
  assert.equal(monad.extra.name, "USDC");
  const base = pickPayAccept(SAMPLE_402, "base");
  assert.equal(base.network, "eip155:8453");
  assert.equal(base.payTo, "0x2222222222222222222222222222222222222222");
  assert.equal(pickPayAccept(SAMPLE_402, "solana").network, "eip155:143");
  assert.equal(pickBaseAccept(SAMPLE_402).network, "eip155:8453");
});

test("per-network typed data uses the 402 chainId and EIP-712 domain", () => {
  const monad = buildClientPayment(pickPayAccept(SAMPLE_402), 1_700_000_000_000);
  assert.equal(monad.network, "monad");
  assert.equal(monad.chainId, 143);
  assert.equal(monad.domain.chainId, 143);
  assert.equal(monad.domain.name, "USDC");
  assert.equal(monad.domain.version, "2");
  assert.equal(monad.domain.verifyingContract, "0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
  const base = buildClientPayment(pickPayAccept(SAMPLE_402, "base"), 1_700_000_000_000);
  assert.equal(base.network, "base");
  assert.equal(base.chainId, 8453);
  assert.equal(base.domain.chainId, 8453);
  assert.equal(base.domain.name, "USD Coin");
  assert.equal(base.domain.version, "2");
  assert.equal(base.domain.verifyingContract, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
});

test("status endpoint reports Monad and Base availability, price, and asset", () => {
  delete process.env.BASE_BUILDER_CODE;
  const status = mirosharkPublicStatus();
  assert.equal(status.defaultNetwork, "monad");
  assert.equal(status.network, "eip155:143");
  assert.equal(status.asset, "USDC");
  assert.equal(status.networks.monad.available, true);
  assert.equal(status.networks.monad.asset, "USDC");
  assert.equal(status.networks.monad.amountUsd, "1.00");
  assert.equal(status.networks.monad.chainId, 143);
  assert.equal(status.networks.monad.affiliate, false);
  assert.equal(status.networks.base.available, true);
  assert.equal(status.networks.base.asset, "USDC");
  assert.equal(status.networks.base.amountUsd, "1.00");
  assert.equal(status.networks.base.network, "eip155:8453");
  assert.equal(status.networks.base.affiliate, true);
});

test("builder split is attached only when the paid network is Base", async () => {
  process.env.BASE_BUILDER_CODE = "bc_testcode";
  delete process.env.MIROSHARK_X402_PRIVATE_KEY;
  const account = privateKeyToAccount(
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  );
  const challenge = {
    x402Version: 2,
    accepts: SAMPLE_402,
    extensions: { "builder-code": { info: { a: "bc_r3g1wwdh" } } },
  };
  async function pay(network) {
    const seen = [];
    const preview = await requestMirosharkPreview({
      title: "Hello",
      body: "Enough body text for a preview seed.",
      nowMs: 1_700_000_000_000,
      fetchImpl: async () => ({
        status: 402,
        ok: false,
        headers: {},
        text: async () => JSON.stringify(challenge),
      }),
    });
    const clientPayment = preview.networks[network].clientPayment;
    const signature = await account.signTypedData({
      domain: clientPayment.domain,
      types: clientPayment.types,
      primaryType: clientPayment.primaryType,
      message: {
        from: account.address,
        to: clientPayment.message.to,
        value: BigInt(clientPayment.message.value),
        validAfter: BigInt(clientPayment.message.validAfter),
        validBefore: BigInt(clientPayment.message.validBefore),
        nonce: clientPayment.message.nonce,
      },
    });
    const out = await requestMirosharkPreview({
      title: "Hello",
      body: "Enough body text for a preview seed.",
      network,
      nowMs: 1_700_000_000_000,
      payment: {
        signature,
        authorization: { from: account.address, ...clientPayment.message },
      },
      fetchImpl: async (_url, init) => {
        seen.push({
          builder: init.headers[BUILDER_CODE_HEADER] || "",
          sig: init.headers["PAYMENT-SIGNATURE"] || "",
        });
        if (!init.headers["PAYMENT-SIGNATURE"]) {
          return {
            status: 402,
            ok: false,
            headers: {},
            text: async () => JSON.stringify(challenge),
          };
        }
        return {
          status: 202,
          ok: true,
          headers: {},
          text: async () =>
            JSON.stringify({
              success: true,
              data: { run_id: "run_dddddddddddd", status: "queued", wait_url: "https://x402.example/wait/run_dddddddddddd" },
            }),
        };
      },
    });
    return { out, seen, clientPayment };
  }

  const monad = await pay("monad");
  assert.equal(monad.out.ok, true);
  assert.equal(monad.out.affiliateApplied, false);
  assert.equal(monad.out.paymentNetwork, "eip155:143");
  assert.equal(monad.seen[0].builder, "bc_testcode");
  assert.equal(monad.seen[1].builder, "");
  const monadDecoded = decodeJsonB64OrJson(monad.seen[1].sig);
  assert.equal(monadDecoded.accepted.network, "eip155:143");
  assert.equal(monadDecoded.extensions, undefined);
  assert.equal(monad.clientPayment.domain.name, "USDC");
  assert.equal(monad.clientPayment.domain.chainId, 143);

  const base = await pay("base");
  assert.equal(base.out.ok, true);
  assert.equal(base.out.affiliateApplied, true);
  assert.equal(base.out.paymentNetwork, "eip155:8453");
  assert.equal(base.seen[1].builder, "bc_testcode");
  const baseDecoded = decodeJsonB64OrJson(base.seen[1].sig);
  assert.equal(baseDecoded.accepted.network, "eip155:8453");
  assert.deepEqual(baseDecoded.extensions["builder-code"].info.s, ["bc_testcode", "x402aff"]);
  assert.equal(base.clientPayment.domain.name, "USD Coin");
  assert.equal(base.clientPayment.domain.chainId, 8453);
});

test("server payer defaults to Monad and does not attach the builder split", async () => {
  process.env.BASE_BUILDER_CODE = "bc_testcode";
  process.env.MIROSHARK_X402_PRIVATE_KEY =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const seen = [];
  const out = await requestMirosharkPreview({
    title: "Hello",
    body: "Enough body text for a preview seed.",
    nowMs: 1_700_000_000_000,
    fetchImpl: async (_url, init) => {
      const sig = init.headers["PAYMENT-SIGNATURE"] || "";
      seen.push({ builder: init.headers[BUILDER_CODE_HEADER] || "", sig });
      if (!sig) {
        return {
          status: 402,
          ok: false,
          headers: {},
          text: async () =>
            JSON.stringify({
              x402Version: 2,
              accepts: SAMPLE_402,
            }),
        };
      }
      return {
        status: 202,
        ok: true,
        headers: {},
        text: async () =>
          JSON.stringify({
            success: true,
            data: { run_id: "run_eeeeeeeeeeee", status: "queued" },
          }),
      };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.paymentNetwork, "eip155:143");
  assert.equal(out.affiliateApplied, false);
  assert.equal(seen[1].builder, "");
  const decoded = decodeJsonB64OrJson(seen[1].sig);
  assert.equal(decoded.accepted.network, "eip155:143");
  assert.equal(decoded.accepted.payTo, "0x0000CE08fa224696A819877070BF378e8B131ACF");
  assert.equal(decoded.extensions, undefined);
  const signed = await signExactPayment({
    accept: pickPayAccept(SAMPLE_402, "monad"),
    challenge: {},
    builderCode: "bc_testcode",
    privateKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nowMs: 1_700_000_000_000,
  });
  assert.equal(signed.envelope.extensions, undefined);
  assert.equal(signed.envelope.accepted.network, "eip155:143");
});

test("builderCodePaymentExtensions mirrors x402aff buyer_client", () => {
  const ext = builderCodePaymentExtensions("bc_testcode", {
    extensions: { "builder-code": { info: { a: "bc_seller" } } },
  });
  assert.deepEqual(ext["builder-code"].info.s, ["bc_testcode", "x402aff"]);
  assert.equal(ext["builder-code"].info.a, "bc_seller");
});
