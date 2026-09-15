import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapWalletSendToEthSend,
  newestExternalWalletAddress,
  pickPublisherWallet,
  truncateAddress,
} from "./wallet.js";

const PRIVY = {
  address: "0xfcebfee97aabb2bfb50f02cc919a81fd82750529",
  walletClientType: "privy",
};
const METAMASK = {
  address: "0x5bd447C52E2e854043C1d6F76DB5DEE3587049c5",
  walletClientType: "metamask",
};

describe("pickPublisherWallet", () => {
  it("prefers an external wallet over the Privy embedded wallet", () => {
    assert.equal(pickPublisherWallet([PRIVY, METAMASK])?.address, METAMASK.address);
    assert.equal(pickPublisherWallet([METAMASK, PRIVY])?.address, METAMASK.address);
  });

  it("uses the embedded wallet when it is the only one", () => {
    assert.equal(pickPublisherWallet([PRIVY])?.address, PRIVY.address);
  });

  it("honors a preferred address even when it is the embedded wallet", () => {
    assert.equal(pickPublisherWallet([PRIVY, METAMASK], PRIVY.address)?.address, PRIVY.address);
  });

  it("detects a newly connected external wallet", () => {
    assert.equal(newestExternalWalletAddress([PRIVY.address], [PRIVY, METAMASK]), METAMASK.address);
    assert.equal(newestExternalWalletAddress([PRIVY.address, METAMASK.address], [PRIVY, METAMASK]), null);
  });
});

describe("mapWalletSendToEthSend", () => {
  it("rewrites wallet_sendTransaction to eth_sendTransaction", async () => {
    const calls: Array<{ method: string }> = [];
    const wrapped = mapWalletSendToEthSend({
      request: async (args) => {
        calls.push(args);
        return "0xhash";
      },
    });
    const hash = await wrapped.request({
      method: "wallet_sendTransaction",
      params: [{ from: PRIVY.address, to: METAMASK.address }],
    });
    assert.equal(hash, "0xhash");
    assert.equal(calls[0]?.method, "eth_sendTransaction");
  });

  it("leaves other methods unchanged", async () => {
    const wrapped = mapWalletSendToEthSend({
      request: async (args) => args.method,
    });
    assert.equal(await wrapped.request({ method: "eth_chainId" }), "eth_chainId");
  });
});

describe("truncateAddress", () => {
  it("does not throw for null/undefined (fiat unlocks have no wallet)", () => {
    assert.equal(truncateAddress(null), "Wallet");
    assert.equal(truncateAddress(undefined), "Wallet");
    assert.equal(truncateAddress(""), "Wallet");
  });

  it("truncates a normal address", () => {
    assert.equal(
      truncateAddress("0x1234567890abcdef1234567890abcdef12345678"),
      "0x1234…5678"
    );
  });
});
