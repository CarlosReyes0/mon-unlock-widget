import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasReliableInjectedProvider,
  mapWalletSendToEthSend,
  newestExternalWalletAddress,
  pickPublisherWallet,
  readPublisherWallet,
  truncateAddress,
  WalletManager,
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

describe("readPublisherWallet", () => {
  it("reads the shared publisher session and ignores a provider without request", () => {
    const provider = { request: async () => "0x1" };
    const session = readPublisherWallet({
      MonPublisherAuth: {
        getAddress: () => "0xabc",
        getProvider: () => provider,
      },
    });
    assert.equal(session?.address, "0xabc");
    assert.equal(session?.provider, provider);
    assert.equal(
      readPublisherWallet({ __monPublisherAddress: "0xabc", __monPublisherProvider: {} as never }),
      null
    );
  });
});

describe("MetaMask injected provider", () => {
  const ADDRESS = "0x5bd447C52E2e854043C1d6F76DB5DEE3587049c5";

  it("treats a mock MetaMask EIP-1193 provider as the desktop/in-app path and signs", async () => {
    const calls: string[] = [];
    const ethereum = {
      isMetaMask: true,
      request: async (args: { method: string }) => {
        calls.push(args.method);
        if (args.method === "eth_requestAccounts" || args.method === "eth_accounts") return [ADDRESS];
        if (args.method === "personal_sign") return "0xsig";
        return null;
      },
    };
    const previous = (globalThis as { ethereum?: unknown }).ethereum;
    (globalThis as { ethereum?: unknown }).ethereum = ethereum;
    try {
      assert.equal(hasReliableInjectedProvider(), true);
      const manager = new WalletManager();
      const state = await manager.connect();
      assert.equal(state.connected, true);
      assert.equal(state.address, ADDRESS);
      assert.equal(manager.isUsingWalletConnect(), false);
      const signature = await manager.getProvider()?.request({
        method: "personal_sign",
        params: ["Open Paywall", ADDRESS],
      });
      assert.equal(signature, "0xsig");
      assert.ok(calls.includes("personal_sign"));
      assert.ok(calls.includes("eth_requestAccounts"));
    } finally {
      if (previous === undefined) delete (globalThis as { ethereum?: unknown }).ethereum;
      else (globalThis as { ethereum?: unknown }).ethereum = previous;
    }
  });

  it("does not treat a bare injected provider as the MetaMask in-app browser", () => {
    const previous = (globalThis as { ethereum?: unknown }).ethereum;
    (globalThis as { ethereum?: unknown }).ethereum = { request: async () => [] };
    try {
      assert.equal(hasReliableInjectedProvider(), false);
    } finally {
      if (previous === undefined) delete (globalThis as { ethereum?: unknown }).ethereum;
      else (globalThis as { ethereum?: unknown }).ethereum = previous;
    }
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
