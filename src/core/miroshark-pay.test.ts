import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  signMirosharkUsdc,
  typedDataForWallet,
  type MirosharkClientPayment,
} from "./miroshark-pay.js";

const KEY = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;
const account = privateKeyToAccount(KEY);

const payment: MirosharkClientPayment = {
  chainId: 8453,
  amountUsd: "1.00",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x4444444444444444444444444444444444444444",
  amount: "1000000",
  domain: {
    name: "USD Coin",
    version: "2",
    chainId: 8453,
    verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    to: "0x4444444444444444444444444444444444444444",
    value: "1000000",
    validAfter: "0",
    validBefore: "1999999999",
    nonce: `0x${"11".repeat(32)}`,
  },
};

function fetchBalance(raw: bigint): typeof fetch {
  return (async () =>
    ({
      json: async () => ({ result: `0x${raw.toString(16)}` }),
    }) as Response) as typeof fetch;
}

describe("signMirosharkUsdc", () => {
  it("puts the signed-in wallet on the approval", () => {
    const typed = typedDataForWallet(payment, account.address);
    assert.equal(typed.message.from, account.address);
    assert.equal(typed.message.to, payment.payTo);
    assert.equal(typed.message.value, "1000000");
  });

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
      /\$0\.00 USDC on Base/
    );
    assert.equal(called, false);
  });

  it("asks the wallet to sign the $1 authorization", async () => {
    let method = "";
    const eth = {
      request: async (args: { method: string; params?: unknown[] }) => {
        method = args.method;
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
