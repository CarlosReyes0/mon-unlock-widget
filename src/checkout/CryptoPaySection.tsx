import { useCallback, useEffect, useState } from "react";
import { useFundWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, formatEther, http, parseEther, type Address } from "viem";
import { monad } from "viem/chains";
import {
  CHECKOUT_MESSAGE_SOURCE,
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

type Phase = "ready" | "funding" | "swapping" | "paying" | "done" | "error";

const GAS_RESERVE = parseEther("0.05");

type Props = {
  articleId: string;
  title: string;
  price: string;
  contract: Address;
  embedSig: string;
  usdEstimate: string | null;
  onCloseWith: (message: CheckoutMessage) => void;
  disabled?: boolean;
};

/** Privy + Coinbase crypto unlock path (must render inside PrivyProvider). */
export function CryptoPaySection({
  articleId,
  price,
  contract,
  embedSig,
  usdEstimate,
  onCloseWith,
  disabled = false,
}: Props) {
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
  const priceWei = parseMonAmount(price);
  const priceLabel = formatMon(priceWei);

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
      setError(e instanceof Error ? e.message : "Could not open USDC checkout.");
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
      setError(e instanceof Error ? e.message : "Could not open receive screen.");
    } finally {
      setPhase("ready");
    }
  };

  const convertUsdcAndPrepare = async (): Promise<boolean> => {
    if (!address || !embedded) return false;
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
    if (!address || !embedded) return;
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
      const service = new OnchainUnlockService(contract);
      service.setProvider(provider);

      const already = await service.checkOnchainAccess(articleId, address);
      if (already) {
        setPhase("done");
        onCloseWith({
          source: CHECKOUT_MESSAGE_SOURCE,
          type: "mon:unlocked",
          articleId,
          address,
          mode: "onchain",
        });
        return;
      }

      const record = await service.unlock(articleId, address, priceWei, embedSig || undefined);
      setTxHash(record.txHash ?? null);
      setPhase("done");
      onCloseWith({
        source: CHECKOUT_MESSAGE_SOURCE,
        type: "mon:unlocked",
        articleId,
        address,
        txHash: record.txHash,
        mode: "onchain",
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
    if (!address || !embedded) return;
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
    const { mon } = await refreshBalances();
    if (mon >= priceWei + parseEther("0.01")) {
      await payWithMon();
      return;
    }
    await payWithUsdc();
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
          Continue with email or Google to pay on Monad. No MetaMask needed.
        </p>
        <button type="button" className="checkout-btn primary" onClick={() => login()}>
          Continue with crypto
        </button>
      </>
    );
  }

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
          {phase === "funding"
            ? "Adding funds…"
            : phase === "swapping"
              ? "Converting…"
              : phase === "paying"
                ? "Paying…"
                : usdEstimate
                  ? `Pay ≈ $${usdEstimate} (crypto)`
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
        Crypto path funds via Coinbase, settles MON on-chain to the publisher.
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
