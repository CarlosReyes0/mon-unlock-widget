import { useCallback, useEffect, useMemo, useState } from "react";
import { useFundWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, formatEther, http, parseEther, type Address } from "viem";
import { monad } from "viem/chains";
import {
  CHECKOUT_MESSAGE_SOURCE,
  postCheckoutMessage,
  type CheckoutMessage,
} from "../core/checkout-protocol.js";
import { OnchainUnlockService } from "../core/unlock.js";
import { formatMon, parseMonAmount } from "../core/types.js";
import { monadMainnet } from "../core/chains.js";

type CheckoutQuery = {
  articleId: string;
  title: string;
  price: string;
  contract: Address;
  embedSig: string;
  parentOrigin: string;
};

type Phase = "ready" | "funding" | "paying" | "done" | "error";

function readQuery(): CheckoutQuery | null {
  const params = new URLSearchParams(window.location.search);
  const articleId = params.get("articleId")?.trim() ?? "";
  const title = params.get("title")?.trim() || "Article";
  const price = params.get("price")?.trim() ?? "";
  const contract = (params.get("contract")?.trim() ?? "") as Address;
  const embedSig = params.get("embedSig")?.trim() ?? "";
  const parentOrigin = params.get("parentOrigin")?.trim() ?? "";

  if (!articleId || !price || !contract?.startsWith("0x") || !parentOrigin) {
    return null;
  }
  try {
    // Validate origin early.
    new URL(parentOrigin);
  } catch {
    return null;
  }
  return { articleId, title, price, contract, embedSig, parentOrigin };
}

function notifyParent(parentOrigin: string, message: CheckoutMessage) {
  postCheckoutMessage(window.opener ?? window.parent, parentOrigin, message);
}

export function CheckoutApp() {
  const query = useMemo(() => readQuery(), []);
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet();

  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = embedded?.address ?? null;
  const priceWei = query ? parseMonAmount(query.price) : 0n;
  const priceLabel = query ? formatMon(priceWei) : "—";

  const refreshBalance = useCallback(async () => {
    if (!address) {
      setBalanceWei(null);
      return;
    }
    const client = createPublicClient({
      chain: monadMainnet,
      transport: http(monadMainnet.rpcUrls.default.http[0]),
    });
    const bal = await client.getBalance({ address: address as Address });
    setBalanceWei(bal);
    return bal;
  }, [address]);

  useEffect(() => {
    if (authenticated && address) {
      void refreshBalance();
    }
  }, [authenticated, address, refreshBalance]);

  const closeWith = (message: CheckoutMessage) => {
    if (query) notifyParent(query.parentOrigin, message);
    // Prefer closing popup; iframe parent can dismiss overlay on message.
    try {
      window.close();
    } catch {
      /* ignore */
    }
  };

  const onCancel = () => {
    if (!query) {
      window.close();
      return;
    }
    closeWith({
      source: CHECKOUT_MESSAGE_SOURCE,
      type: "mon:checkout-closed",
      articleId: query.articleId,
      reason: "cancelled",
    });
  };

  const ensureFunded = async (): Promise<boolean> => {
    if (!address || !query) return false;
    const gasBuffer = parseEther("0.02");
    const need = priceWei + gasBuffer;
    let bal = (await refreshBalance()) ?? 0n;
    if (bal >= need) return true;

    setPhase("funding");
    setError(null);
    const shortfall = need > bal ? need - bal : need;
    // fundWallet amount is a decimal string of native MON.
    const amountMon = formatEther(shortfall);

    await fundWallet(address, {
      chain: monad,
      amount: amountMon,
      asset: "native-currency",
    });

    // Funding can take a moment to settle — poll briefly.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      bal = (await refreshBalance()) ?? 0n;
      if (bal >= need) return true;
    }
    setError("Funds are still arriving. Wait a moment, then tap Pay again.");
    setPhase("ready");
    return false;
  };

  const pay = async () => {
    if (!query || !address || !embedded) return;
    setError(null);
    try {
      const funded = await ensureFunded();
      if (!funded) return;

      setPhase("paying");
      await embedded.switchChain(monad.id);
      const provider = await embedded.getEthereumProvider();
      const service = new OnchainUnlockService(query.contract);
      service.setProvider(provider);

      const already = await service.checkOnchainAccess(query.articleId, address);
      if (already) {
        setPhase("done");
        closeWith({
          source: CHECKOUT_MESSAGE_SOURCE,
          type: "mon:unlocked",
          articleId: query.articleId,
          address,
        });
        return;
      }

      const record = await service.unlock(
        query.articleId,
        address,
        priceWei,
        query.embedSig || undefined
      );
      setTxHash(record.txHash ?? null);
      setPhase("done");
      closeWith({
        source: CHECKOUT_MESSAGE_SOURCE,
        type: "mon:unlocked",
        articleId: query.articleId,
        address,
        txHash: record.txHash,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Payment failed.";
      // Insufficient funds → offer funding again.
      if (/insufficient|funds|balance/i.test(msg)) {
        setError("Not enough MON yet. Add funds, then try again.");
        setPhase("ready");
        return;
      }
      setError(msg);
      setPhase("error");
    }
  };

  if (!query) {
    return (
      <div className="checkout-shell">
        <div className="checkout-card">
          <p className="checkout-brand">MON Unlock</p>
          <h1>Invalid checkout link</h1>
          <p className="checkout-copy">
            This page must be opened from an article unlock button with a valid article, price, and
            contract.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="checkout-shell">
        <div className="checkout-card">
          <p className="checkout-brand">MON Unlock</p>
          <p className="checkout-copy">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-shell">
      <div className="checkout-card">
        <p className="checkout-brand">MON Unlock</p>
        <h1>Unlock article</h1>
        <p className="checkout-title">{query.title}</p>
        <p className="checkout-price">
          {priceLabel} <span>MON</span>
        </p>

        {!authenticated ? (
          <>
            <p className="checkout-copy">Continue with email or Google to pay. No MetaMask needed.</p>
            <button type="button" className="checkout-btn primary" onClick={() => login()}>
              Continue
            </button>
          </>
        ) : (
          <>
            <p className="checkout-copy">
              Signed in{user?.email?.address ? ` as ${user.email.address}` : ""}.
              {address ? ` Paying from ${address.slice(0, 6)}…${address.slice(-4)}.` : ""}
              {balanceWei !== null ? ` Balance: ${formatMon(balanceWei)} MON.` : ""}
            </p>

            {phase === "funding" ? (
              <p className="checkout-status">Add MON to continue…</p>
            ) : null}
            {phase === "paying" ? <p className="checkout-status">Unlocking…</p> : null}
            {phase === "done" ? (
              <p className="checkout-status ok">Unlocked{txHash ? " — returning to article…" : ""}</p>
            ) : null}

            {error ? <p className="checkout-error">{error}</p> : null}

            <div className="checkout-actions">
              <button
                type="button"
                className="checkout-btn primary"
                disabled={phase === "paying" || phase === "funding" || phase === "done" || !address}
                onClick={() => void pay()}
              >
                {phase === "funding"
                  ? "Adding funds…"
                  : phase === "paying"
                    ? "Paying…"
                    : `Pay ${priceLabel} MON`}
              </button>
              <button
                type="button"
                className="checkout-btn ghost"
                disabled={phase === "paying"}
                onClick={() => void ensureFunded()}
              >
                Buy MON
              </button>
            </div>

            <button type="button" className="checkout-link" onClick={() => logout()}>
              Use a different account
            </button>
          </>
        )}

        <button type="button" className="checkout-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
