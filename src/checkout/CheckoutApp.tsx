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
import {
  cardFundGasMonConfig,
  cardFundUsdcConfig,
  openCardBuy,
  openRampBuy,
  receiveFundConfig,
} from "./funding.js";
import {
  estimateUsdcForMon,
  formatUsdc,
  getUsdcBalance,
  swapUsdcToMon,
} from "../core/swap-usdc-to-mon.js";

type CheckoutQuery = {
  articleId: string;
  title: string;
  price: string;
  contract: Address;
  embedSig: string;
  parentOrigin: string;
};

type Phase = "ready" | "funding" | "swapping" | "paying" | "done" | "error";

/** Enough MON to cover approve + swap + unlock gas on Monad. */
const GAS_RESERVE = parseEther("0.05");

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
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [usdEstimate, setUsdEstimate] = useState<string | null>(null);

  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = embedded?.address ?? null;
  const priceWei = query ? parseMonAmount(query.price) : 0n;
  const priceLabel = query ? formatMon(priceWei) : "—";

  const refreshBalances = useCallback(async () => {
    if (!address) {
      setBalanceWei(null);
      setUsdcBal(null);
      return { mon: 0n, usdc: 0n };
    }
    const client = createPublicClient({
      chain: monadMainnet,
      transport: http(monadMainnet.rpcUrls.default.http[0]),
    });
    const [mon, usdc] = await Promise.all([
      client.getBalance({ address: address as Address }),
      getUsdcBalance(address as Address),
    ]);
    setBalanceWei(mon);
    setUsdcBal(usdc);
    return { mon, usdc };
  }, [address]);

  useEffect(() => {
    if (authenticated && address) {
      void refreshBalances();
    }
  }, [authenticated, address, refreshBalances]);

  useEffect(() => {
    if (!query || priceWei <= 0n) {
      setUsdEstimate(null);
      return;
    }
    let cancelled = false;
    void estimateUsdcForMon(priceWei)
      .then((usdc) => {
        if (!cancelled) setUsdEstimate(formatUsdc(usdc));
      })
      .catch(() => {
        if (!cancelled) setUsdEstimate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [query, priceWei]);

  const closeWith = (message: CheckoutMessage) => {
    if (query) notifyParent(query.parentOrigin, message);
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

  const ensureGasMon = async (): Promise<boolean> => {
    if (!address) return false;
    const { mon } = await refreshBalances();
    if (mon >= GAS_RESERVE) return true;
    setPhase("funding");
    setError(null);
    // Coinbase first (Texas). Privy fundWallet second. Ramp last (not Texas).
    const viaCoinbase = await openCardBuy(address, "MON", "0.05");
    if (!viaCoinbase) {
      try {
        await fundWallet({ address, options: cardFundGasMonConfig("0.05") });
      } catch {
        openRampBuy(address, "MONAD_MON");
        setError(
          "Need a tiny bit of MON for network fees. Finish the buy tab, then tap Pay with USDC again."
        );
        setPhase("ready");
        return false;
      }
    } else {
      setError(
        "Need a tiny bit of MON for network fees. Finish buying ~0.05 MON in Coinbase, then tap Pay with USDC again."
      );
    }
    // Poll briefly for gas MON.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const { mon: m } = await refreshBalances();
      if (m >= GAS_RESERVE) return true;
    }
    setError("MON for fees is still arriving. Wait a moment, then try again.");
    setPhase("ready");
    return false;
  };

  const buyUsdc = async () => {
    if (!address) return;
    setPhase("funding");
    setError(null);
    try {
      const need = await estimateUsdcForMon(priceWei + GAS_RESERVE);
      const amount = formatUsdc(need);
      const viaCoinbase = await openCardBuy(address, "USDC", amount);
      if (viaCoinbase) {
        setError("Finish buying USDC in the Coinbase tab, then tap Pay with USDC.");
      } else {
        try {
          await fundWallet({ address, options: cardFundUsdcConfig(amount) });
        } catch {
          openRampBuy(address, "MONAD_USDC");
          setError("Finish buying USDC in the open tab, then tap Pay with USDC.");
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not open USDC checkout.";
      setError(msg);
    } finally {
      setPhase("ready");
    }
  };

  const receiveMon = async () => {
    if (!address) return;
    setPhase("funding");
    setError(null);
    try {
      const { mon } = await refreshBalances();
      const need = priceWei + GAS_RESERVE;
      const shortfall = need > mon ? need - mon : need;
      await fundWallet({
        address,
        options: receiveFundConfig(formatEther(shortfall)),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not open receive screen.";
      setError(msg);
    } finally {
      setPhase("ready");
    }
  };

  const convertUsdcAndPrepare = async (): Promise<boolean> => {
    if (!address || !embedded || !query) return false;

    const gasOk = await ensureGasMon();
    if (!gasOk) return false;

    setPhase("swapping");
    setError(null);

    let { mon, usdc } = await refreshBalances();
    const needMon = priceWei + GAS_RESERVE;
    if (mon >= needMon) return true;

    const monShortfall = needMon > mon ? needMon - mon : needMon;
    let usdcNeeded = await estimateUsdcForMon(monShortfall);

    if (usdc < usdcNeeded) {
      setPhase("funding");
      const amount = formatUsdc(usdcNeeded);
      const viaCoinbase = await openCardBuy(address, "USDC", amount);
      if (!viaCoinbase) {
        try {
          await fundWallet({ address, options: cardFundUsdcConfig(amount) });
        } catch {
          openRampBuy(address, "MONAD_USDC");
        }
      }
      // Poll for USDC arrival.
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        ({ mon, usdc } = await refreshBalances());
        if (mon >= needMon) return true;
        usdcNeeded = await estimateUsdcForMon(needMon > mon ? needMon - mon : needMon);
        if (usdc >= usdcNeeded) break;
      }
      if (usdc < usdcNeeded) {
        setError("USDC is still arriving. When it shows in your balance, tap Pay with USDC.");
        setPhase("ready");
        return false;
      }
    }

    setPhase("swapping");
    const provider = await embedded.getEthereumProvider();
    await embedded.switchChain(monad.id);
    await swapUsdcToMon({
      provider,
      account: address as Address,
      usdcAmount: usdcNeeded,
      minMonOut: monShortfall,
    });
    ({ mon } = await refreshBalances());
    if (mon < priceWei) {
      setError("Swap finished but MON balance is still short. Tap Pay with USDC again.");
      setPhase("ready");
      return false;
    }
    return true;
  };

  const payWithMon = async () => {
    if (!query || !address || !embedded) return;
    setError(null);
    try {
      const { mon } = await refreshBalances();
      if (mon < priceWei + parseEther("0.01")) {
        setError("Not enough MON. Use Pay with USDC, or Receive MON.");
        return;
      }

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
      if (/insufficient|funds|balance/i.test(msg)) {
        setError("Not enough MON. Try Pay with USDC.");
        setPhase("ready");
        return;
      }
      setError(msg);
      setPhase("error");
    }
  };

  const payWithUsdc = async () => {
    if (!query || !address || !embedded) return;
    setError(null);
    try {
      const readyToPay = await convertUsdcAndPrepare();
      if (!readyToPay) return;
      await payWithMon();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "USDC payment failed.";
      setError(msg);
      setPhase("error");
    }
  };

  const pay = async () => {
    if (!address) return;
    const { mon } = await refreshBalances();
    if (mon >= priceWei + parseEther("0.01")) {
      await payWithMon();
      return;
    }
    await payWithUsdc();
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

  const busy = phase === "paying" || phase === "funding" || phase === "swapping" || phase === "done";

  return (
    <div className="checkout-shell">
      <div className="checkout-card">
        <p className="checkout-brand">MON Unlock</p>
        <h1>Unlock article</h1>
        <p className="checkout-title">{query.title}</p>
        <p className="checkout-price">
          {priceLabel} <span>MON</span>
          {usdEstimate ? <span className="checkout-usd"> ≈ ${usdEstimate}</span> : null}
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
              {balanceWei !== null ? ` MON: ${formatMon(balanceWei)}.` : ""}
              {usdcBal !== null ? ` USDC: ${formatUsdc(usdcBal)}.` : ""}
            </p>

            {phase === "funding" ? <p className="checkout-status">Opening funding…</p> : null}
            {phase === "swapping" ? (
              <p className="checkout-status">Converting USDC → MON…</p>
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
                disabled={busy || !address}
                onClick={() => void pay()}
              >
                {phase === "funding"
                  ? "Adding funds…"
                  : phase === "swapping"
                    ? "Converting…"
                    : phase === "paying"
                      ? "Paying…"
                      : usdEstimate
                        ? `Pay ≈ $${usdEstimate}`
                        : `Pay ${priceLabel} MON`}
              </button>
              <button
                type="button"
                className="checkout-btn ghost"
                disabled={busy || !address}
                onClick={() => void payWithUsdc()}
              >
                Pay with USDC
              </button>
              <button
                type="button"
                className="checkout-btn ghost"
                disabled={busy || !address}
                onClick={() => void buyUsdc()}
              >
                Buy USDC
              </button>
              <button
                type="button"
                className="checkout-btn ghost"
                disabled={busy || !address}
                onClick={() => void receiveMon()}
              >
                Receive MON
              </button>
            </div>
            <p className="checkout-hint">
              Pay with USDC buys dollars (when needed), swaps to MON on Monad, then unlocks — no new
              contract. Card buys use Coinbase (works in Texas). A tiny bit of MON is needed for
              network fees.
            </p>

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
