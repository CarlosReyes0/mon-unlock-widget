import { useCallback, useEffect, useState } from "react";
import { useFundWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, formatEther, http, parseEther, type Address } from "viem";
import { monad } from "viem/chains";
import {
  CHECKOUT_MESSAGE_SOURCE,
  type CheckoutMessage,
} from "../core/checkout-protocol.js";
import { OnchainUnlockService } from "../core/unlock.js";
import { formatMon, formatUsd, parseMonAmount, parseUsdAmount } from "../core/types.js";
import { monadMainnet } from "../core/chains.js";
import { normalizePaymentAsset, type PaymentAsset } from "../core/payment-asset.js";
import {
  cardFundUsdcConfig,
  openCardBuy,
  openRampBuy,
  receiveFundConfig,
  requestGasDrip,
} from "./funding.js";
import {
  estimateUsdcForMon,
  formatUsdc,
  getUsdcBalance,
  swapUsdcToMon,
} from "../core/swap-usdc-to-mon.js";

type Phase = "ready" | "funding" | "swapping" | "paying" | "done" | "error";

const GAS_RESERVE = parseEther("0.05");

type Props = {
  articleId: string;
  title: string;
  /** MON amount, or USD amount when paymentAsset is "usdc". */
  price: string;
  contract: Address;
  embedSig: string;
  usdEstimate: string | null;
  /** "usdc" = settle USDC to publisher (no swap). "mon" = legacy native MON path. */
  paymentAsset?: PaymentAsset | string;
  onCloseWith: (message: CheckoutMessage) => void;
  disabled?: boolean;
};

/** Privy + Coinbase crypto unlock (must render inside PrivyProvider). */
export function CryptoPaySection({
  articleId,
  price,
  contract,
  embedSig,
  usdEstimate,
  paymentAsset: paymentAssetProp = "mon",
  onCloseWith,
  disabled = false,
}: Props) {
  const settleUsdc = normalizePaymentAsset(paymentAssetProp) === "usdc";

  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet();

  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const address = embedded?.address ?? null;

  const priceUnits = settleUsdc ? parseUsdAmount(price) : parseMonAmount(price);
  const priceLabel = settleUsdc ? formatUsd(priceUnits) : formatMon(priceUnits);

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
    if (authenticated && address) void refreshBalances();
  }, [authenticated, address, refreshBalances]);

  const ensureGasMon = async (): Promise<boolean> => {
    if (!address) return false;
    const { mon } = await refreshBalances();
    if (mon >= GAS_RESERVE) return true;
    setPhase("funding");
    setError(null);

    // Same RELAYER_PRIVATE_KEY as writer registration. Do not open Coinbase for MON —
    // that is what showed "Buy Monad" on Pay with USDC.
    const dripped = await requestGasDrip(address);
    if (dripped) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const { mon: m } = await refreshBalances();
        if (m >= GAS_RESERVE) return true;
      }
    }
    setError(
      "Could not add MON for network fees. Try Pay with USDC again, or Receive MON (gas)."
    );
    setPhase("ready");
    return false;
  };

  const buyUsdcAmount = async (amount: string) => {
    if (!address) return;
    setPhase("funding");
    setError(null);
    try {
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
      setError(e instanceof Error ? e.message : "Could not open USDC checkout.");
    } finally {
      setPhase("ready");
    }
  };

  const buyUsdc = async () => {
    if (settleUsdc) {
      await buyUsdcAmount(formatUsd(priceUnits));
      return;
    }
    try {
      const need = await estimateUsdcForMon(priceUnits + GAS_RESERVE);
      await buyUsdcAmount(formatUsdc(need));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open USDC checkout.");
    }
  };

  const receiveMon = async () => {
    if (!address) return;
    setPhase("funding");
    setError(null);
    try {
      const { mon } = await refreshBalances();
      const need = settleUsdc ? GAS_RESERVE : priceUnits + GAS_RESERVE;
      const shortfall = need > mon ? need - mon : need;
      await fundWallet({
        address,
        options: receiveFundConfig(formatEther(shortfall)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open receive screen.");
    } finally {
      setPhase("ready");
    }
  };

  /** Legacy: fund/swap USDC → MON, then native unlock. */
  const convertUsdcAndPrepare = async (): Promise<boolean> => {
    if (!address || !embedded) return false;

    setPhase("swapping");
    setError(null);

    let { mon, usdc } = await refreshBalances();
    const needMon = priceUnits + GAS_RESERVE;
    if (mon >= needMon) return true;

    const monShortfall = needMon > mon ? needMon - mon : needMon;
    let usdcNeeded = await estimateUsdcForMon(monShortfall);

    if (usdc < usdcNeeded) {
      setPhase("funding");
      void requestGasDrip(address);
      const amount = formatUsdc(usdcNeeded);
      const viaCoinbase = await openCardBuy(address, "USDC", amount);
      if (!viaCoinbase) {
        try {
          await fundWallet({ address, options: cardFundUsdcConfig(amount) });
        } catch {
          openRampBuy(address, "MONAD_USDC");
        }
      }
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        ({ mon, usdc } = await refreshBalances());
        if (mon >= needMon) return true;
        usdcNeeded = await estimateUsdcForMon(needMon > mon ? needMon - mon : needMon);
        if (usdc >= usdcNeeded) break;
      }
      if (usdc < usdcNeeded) {
        setError("Finish buying USDC in Coinbase, then tap Pay with USDC again.");
        setPhase("ready");
        return false;
      }
    }

    const gasOk = await ensureGasMon();
    if (!gasOk) return false;

    ({ mon, usdc } = await refreshBalances());
    if (mon >= needMon) return true;
    const stillNeedMon = needMon > mon ? needMon - mon : needMon;
    usdcNeeded = await estimateUsdcForMon(stillNeedMon);
    if (usdc < usdcNeeded) {
      setError("USDC is still arriving. When it shows in your balance, tap Pay with USDC.");
      setPhase("ready");
      return false;
    }

    setPhase("swapping");
    const provider = await embedded.getEthereumProvider();
    await embedded.switchChain(monad.id);
    await swapUsdcToMon({
      provider,
      account: address as Address,
      usdcAmount: usdcNeeded,
      minMonOut: stillNeedMon,
    });
    ({ mon } = await refreshBalances());
    if (mon < priceUnits) {
      setError("Swap finished but MON balance is still short. Tap Pay with USDC again.");
      setPhase("ready");
      return false;
    }
    return true;
  };

  const emitUnlocked = (addr: string, hash?: string | null) => {
    onCloseWith({
      source: CHECKOUT_MESSAGE_SOURCE,
      type: "mon:unlocked",
      articleId,
      address: addr,
      ...(hash ? { txHash: hash } : {}),
      mode: "onchain",
    });
  };

  const payWithMon = async () => {
    if (!address || !embedded) return;
    setError(null);
    try {
      const { mon } = await refreshBalances();
      if (mon < priceUnits + parseEther("0.01")) {
        setError("Not enough MON. Use Pay with USDC, or Receive MON.");
        return;
      }

      setPhase("paying");
      await embedded.switchChain(monad.id);
      const provider = await embedded.getEthereumProvider();
      const service = new OnchainUnlockService(contract);
      service.setProvider(provider);

      const already = await service.checkOnchainAccess(articleId, address);
      if (already) {
        setPhase("done");
        emitUnlocked(address);
        return;
      }

      const record = await service.unlock(articleId, address, priceUnits, embedSig || undefined);
      setTxHash(record.txHash ?? null);
      setPhase("done");
      emitUnlocked(address, record.txHash);
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

  /** Settle USDC on ArticleUnlockUsdc — publisher receives USDC (no MON conversion). */
  const paySettleUsdc = async () => {
    if (!address || !embedded) return;
    setError(null);
    try {
      let { usdc } = await refreshBalances();
      if (usdc < priceUnits) {
        setPhase("funding");
        // Drip gas in the background so Coinbase opens on USDC, not Monad.
        void requestGasDrip(address);
        const amount = formatUsd(priceUnits);
        const viaCoinbase = await openCardBuy(address, "USDC", amount);
        if (!viaCoinbase) {
          try {
            await fundWallet({ address, options: cardFundUsdcConfig(amount) });
          } catch {
            openRampBuy(address, "MONAD_USDC");
          }
        }
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          ({ usdc } = await refreshBalances());
          if (usdc >= priceUnits) break;
        }
        if (usdc < priceUnits) {
          setError("Finish buying USDC in Coinbase, then tap Pay with USDC again.");
          setPhase("ready");
          return;
        }
      }

      const gasOk = await ensureGasMon();
      if (!gasOk) return;

      setPhase("paying");
      await embedded.switchChain(monad.id);
      const provider = await embedded.getEthereumProvider();
      const service = new OnchainUnlockService(contract);
      service.setProvider(provider);

      const already = await service.checkOnchainAccess(articleId, address);
      if (already) {
        setPhase("done");
        emitUnlocked(address);
        return;
      }

      const record = await service.unlockWithUsdc(
        articleId,
        address,
        priceUnits,
        embedSig || undefined
      );
      setTxHash(record.txHash ?? null);
      setPhase("done");
      emitUnlocked(address, record.txHash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "USDC payment failed.");
      setPhase("error");
    }
  };

  const payWithUsdcButton = async () => {
    if (settleUsdc) {
      await paySettleUsdc();
      return;
    }
    setError(null);
    try {
      const readyToPay = await convertUsdcAndPrepare();
      if (!readyToPay) return;
      await payWithMon();
    } catch (e) {
      setError(e instanceof Error ? e.message : "USDC payment failed.");
      setPhase("error");
    }
  };

  const pay = async () => {
    if (!address) return;
    if (settleUsdc) {
      await paySettleUsdc();
      return;
    }
    const { mon } = await refreshBalances();
    if (mon >= priceUnits + parseEther("0.01")) {
      await payWithMon();
      return;
    }
    await payWithUsdcButton();
  };

  if (!ready) {
    return <p className="checkout-copy">Loading crypto checkout…</p>;
  }

  const busy =
    disabled || phase === "paying" || phase === "funding" || phase === "swapping" || phase === "done";

  if (!authenticated) {
    return (
      <>
        <p className="checkout-copy">
          Continue with email or Google to pay USDC. Lower fees than card. No MetaMask needed.
        </p>
        <button type="button" className="checkout-btn primary" onClick={() => login()}>
          Continue with email to pay USDC
        </button>
      </>
    );
  }

  const primaryLabel = settleUsdc
    ? phase === "funding"
      ? "Adding funds…"
      : phase === "paying"
        ? "Paying…"
        : `Pay $${priceLabel} USDC`
    : phase === "funding"
      ? "Adding funds…"
      : phase === "swapping"
        ? "Converting…"
        : phase === "paying"
          ? "Paying…"
          : usdEstimate
            ? `Pay ≈ $${usdEstimate} (crypto)`
            : `Pay ${priceLabel} MON`;

  return (
    <>
      <p className="checkout-copy">
        Signed in{user?.email?.address ? ` as ${user.email.address}` : ""}.
        {address ? ` Paying from ${address.slice(0, 6)}…${address.slice(-4)}.` : ""}
        {balanceWei !== null ? ` MON: ${formatMon(balanceWei)}.` : ""}
        {usdcBal !== null ? ` USDC: ${formatUsdc(usdcBal)}.` : ""}
      </p>

      {phase === "funding" ? <p className="checkout-status">Opening funding…</p> : null}
      {phase === "swapping" ? <p className="checkout-status">Converting USDC → MON…</p> : null}
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
          {primaryLabel}
        </button>
        {!settleUsdc ? (
          <button
            type="button"
            className="checkout-btn ghost"
            disabled={busy || !address}
            onClick={() => void payWithUsdcButton()}
          >
            Pay with USDC
          </button>
        ) : null}
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
          {settleUsdc ? "Receive MON (gas)" : "Receive MON"}
        </button>
      </div>
      <p className="checkout-hint">
        {settleUsdc
          ? "You pay USDC. The writer receives USDC. Network fees come from the platform relayer, not Coinbase."
          : "Legacy path: may convert USDC to MON, then pay on-chain."}
      </p>
      <button type="button" className="checkout-link" onClick={() => logout()}>
        Use a different account
      </button>
    </>
  );
}

export function cryptoPrivyConfigured(): boolean {
  return Boolean((import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim());
}
