import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { monadMainnet } from "./chains.js";
import {
  DEFAULT_MIROSHARK_NETWORK,
  MirosharkPayError,
  PAY_NETWORK_CHOICES,
  chainParamsForPay,
  initialPayNetwork,
  paymentForNetwork,
  signMirosharkUsdc,
  typedDataForWallet,
  type MirosharkClientPayment,
  type MirosharkNetworkOffers,
} from "./miroshark-pay.js";

const KEY = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;
const account = privateKeyToAccount(KEY);

const types = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

function paymentFor(network: "monad" | "base"): MirosharkClientPayment {
  const monad = network === "monad";
  const chainId = monad ? 143 : 8453;
  const asset = monad
    ? "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"
    : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  return {
    network,
    chainId,
    amountUsd: "1.00",
    asset,
    payTo: "0x4444444444444444444444444444444444444444",
    amount: "1000000",
    domain: {
      name: monad ? "USDC" : "USD Coin",
      version: "2",
      chainId,
      verifyingContract: asset,
    },
    types,
    primaryType: "TransferWithAuthorization",
    message: {
      to: "0x4444444444444444444444444444444444444444",
      value: "1000000",
      validAfter: "0",
      validBefore: "1999999999",
      nonce: `0x${"11".repeat(32)}`,
    },
  };
}

const payment = paymentFor("base");
const monadPayment = paymentFor("monad");

function offers(both = true): MirosharkNetworkOffers {
  return {
    monad: {
      id: "monad",
      label: "Monad",
      network: "eip155:143",
      chainId: 143,
      asset: "USDC",
      amountUsd: "1.00",
      available: both,
      clientPayment: both ? monadPayment : null,
    },
    base: {
      id: "base",
      label: "Base",
      network: "eip155:8453",
      chainId: 8453,
      asset: "USDC",
      amountUsd: "1.00",
      available: true,
      clientPayment: payment,
    },
  };
}

function fetchBalance(raw: bigint): typeof fetch {
  return (async (url: string) =>
    ({
      url,
      json: async () => ({ result: `0x${raw.toString(16)}` }),
    }) as unknown as Response) as typeof fetch;
}

function wallet(opts: {
  start?: string;
  switchError?: unknown;
  addError?: unknown;
  signError?: unknown;
  record?: string[];
  added?: unknown[];
}) {
  let chain = opts.start || "0x1";
  return {
    request: async (args: { method: string; params?: unknown[] }) => {
      opts.record?.push(args.method);
      if (args.method === "eth_chainId") return chain;
      if (args.method === "wallet_switchEthereumChain") {
        if (opts.switchError) throw opts.switchError;
        chain = String((args.params?.[0] as { chainId: string }).chainId);
        return null;
      }
      if (args.method === "wallet_addEthereumChain") {
        opts.added?.push(args.params?.[0]);
        if (opts.addError) throw opts.addError;
        chain = String((args.params?.[0] as { chainId: string }).chainId);
        return null;
      }
      if (args.method === "eth_signTypedData_v4") {
        if (opts.signError) throw opts.signError;
        const typed = JSON.parse(String(args.params?.[1]));
        return account.signTypedData({
          domain: typed.domain,
          types: typed.types,
          primaryType: typed.primaryType,
          message: {
            from: typed.message.from,
            to: typed.message.to,
            value: BigInt(typed.message.value),
            validAfter: BigInt(typed.message.validAfter),
            validBefore: BigInt(typed.message.validBefore),
            nonce: typed.message.nonce,
          },
        });
      }
      throw new Error(`unexpected ${args.method}`);
    },
  };
}

describe("network selection", () => {
  it("defaults to Monad and still selects Base", () => {
    assert.equal(DEFAULT_MIROSHARK_NETWORK, "monad");
    assert.deepEqual(
      PAY_NETWORK_CHOICES.map((row) => row.label),
      ["Pay on Monad", "Pay on Base"]
    );
    const rows = offers(true);
    assert.equal(initialPayNetwork(rows), "monad");
    assert.equal(paymentForNetwork(rows, "base")?.network, "base");
    assert.equal(paymentForNetwork(rows, "monad")?.domain.chainId, 143);
    assert.equal(initialPayNetwork(offers(false)), "base");
  });
});

describe("typed data", () => {
  it("keeps the 402 domain for Monad and Base", () => {
    const monad = typedDataForWallet(monadPayment, account.address);
    assert.equal(monad.domain.chainId, 143);
    assert.equal(monad.domain.name, "USDC");
    assert.equal(monad.domain.version, "2");
    assert.equal(monad.domain.verifyingContract, monadPayment.asset);
    assert.equal(monad.message.from, account.address);
    const base = typedDataForWallet(payment, account.address);
    assert.equal(base.domain.chainId, 8453);
    assert.equal(base.domain.name, "USD Coin");
  });
});

describe("signMirosharkUsdc", () => {
  it("stops before the wallet when Base USDC is short", async () => {
    let called = false;
    await assert.rejects(
      () =>
        signMirosharkUsdc(
          {
            request: async () => {
              called = true;
              return null;
            },
          },
          account.address,
          payment,
          fetchBalance(0n)
        ),
      (err: unknown) => {
        assert.ok(err instanceof MirosharkPayError);
        assert.equal(err.code, "insufficient_usdc");
        assert.match(err.message, /\$0\.00 USDC on Base/);
        return true;
      }
    );
    assert.equal(called, false);
  });

  it("stops before the wallet when Monad USDC is short", async () => {
    const calls: string[] = [];
    await assert.rejects(
      () =>
        signMirosharkUsdc(
          wallet({ record: calls }),
          account.address,
          monadPayment,
          fetchBalance(0n)
        ),
      (err: unknown) => {
        assert.ok(err instanceof MirosharkPayError);
        assert.equal(err.code, "insufficient_usdc");
        assert.match(err.message, /USDC on Monad/);
        return true;
      }
    );
    assert.deepEqual(calls, []);
  });

  it("switches to chain 143 before signing Monad", async () => {
    const calls: string[] = [];
    const eth = wallet({ start: "0x1", record: calls });
    const signed = await signMirosharkUsdc(eth, account.address, monadPayment, fetchBalance(2_000_000n));
    assert.equal(calls[0], "eth_chainId");
    assert.equal(calls[1], "wallet_switchEthereumChain");
    assert.equal(calls.at(-1), "eth_signTypedData_v4");
    assert.match(signed.signature, /^0x[a-fA-F0-9]{130}$/);
    assert.equal(signed.authorization.from, account.address);
  });

  it("adds Monad mainnet when the wallet does not know chain 143", async () => {
    const added: unknown[] = [];
    const calls: string[] = [];
    await signMirosharkUsdc(
      wallet({
        start: "0x1",
        record: calls,
        added,
        switchError: { code: 4902, message: "unrecognized chain" },
      }),
      account.address,
      monadPayment,
      fetchBalance(2_000_000n)
    );
    assert.ok(calls.includes("wallet_addEthereumChain"));
    const params = chainParamsForPay(143);
    assert.equal(params?.chainIdHex, "0x8f");
    assert.equal(params?.rpc, monadMainnet.rpcUrls.default.http[0]);
    assert.deepEqual(added[0], params?.add);
    assert.equal((added[0] as { nativeCurrency: { symbol: string } }).nativeCurrency.symbol, "MON");
    assert.equal((added[0] as { rpcUrls: string[] }).rpcUrls[0], "https://rpc.monad.xyz");
    assert.equal(
      (added[0] as { blockExplorerUrls: string[] }).blockExplorerUrls[0],
      "https://monadvision.com"
    );
  });

  it("reports a wrong chain when the wallet will not switch", async () => {
    await assert.rejects(
      () =>
        signMirosharkUsdc(
          wallet({ start: "0x1", switchError: { code: -32000, message: "switch failed" } }),
          account.address,
          monadPayment,
          fetchBalance(2_000_000n)
        ),
      (err: unknown) => {
        assert.ok(err instanceof MirosharkPayError);
        assert.equal(err.code, "wrong_chain");
        assert.match(err.message, /chain 143/);
        return true;
      }
    );
  });

  it("reports a cancelled approval when the chain switch is rejected", async () => {
    await assert.rejects(
      () =>
        signMirosharkUsdc(
          wallet({ start: "0x1", switchError: { code: 4001, message: "User rejected" } }),
          account.address,
          monadPayment,
          fetchBalance(2_000_000n)
        ),
      (err: unknown) => {
        assert.ok(err instanceof MirosharkPayError);
        assert.equal(err.code, "user_rejected");
        assert.match(err.message, /Approval cancelled/);
        return true;
      }
    );
  });

  it("reports a cancelled approval when the signer rejects", async () => {
    await assert.rejects(
      () =>
        signMirosharkUsdc(
          wallet({
            start: "0x8f",
            signError: { code: 4001, message: "User rejected the request" },
          }),
          account.address,
          monadPayment,
          fetchBalance(2_000_000n)
        ),
      (err: unknown) => {
        assert.ok(err instanceof MirosharkPayError);
        assert.equal(err.code, "user_rejected");
        assert.match(err.message, /Approval cancelled/);
        return true;
      }
    );
  });

  it("asks the wallet to sign the $1 authorization on Base", async () => {
    let method = "";
    const eth = {
      request: async (args: { method: string; params?: unknown[] }) => {
        method = args.method;
        if (args.method === "eth_chainId") return "0x2105";
        if (args.method === "wallet_switchEthereumChain") return null;
        const typed = JSON.parse(String(args.params?.[1]));
        return account.signTypedData({
          domain: typed.domain,
          types: typed.types,
          primaryType: typed.primaryType,
          message: {
            from: typed.message.from,
            to: typed.message.to,
            value: BigInt(typed.message.value),
            validAfter: BigInt(typed.message.validAfter),
            validBefore: BigInt(typed.message.validBefore),
            nonce: typed.message.nonce,
          },
        });
      },
    };
    const signed = await signMirosharkUsdc(eth, account.address, payment, fetchBalance(2_000_000n));
    assert.equal(method, "eth_signTypedData_v4");
    assert.equal(signed.authorization.from, account.address);
    assert.match(signed.signature, /^0x[a-fA-F0-9]{130}$/);
  });
});
