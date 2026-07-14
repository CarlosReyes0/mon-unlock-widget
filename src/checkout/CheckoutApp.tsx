import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import {
  CHECKOUT_MESSAGE_SOURCE,
  postCheckoutMessage,
  type CheckoutMessage,
} from "../core/checkout-protocol.js";
import { formatMon, parseMonAmount } from "../core/types.js";
import { estimateUsdcForMon, formatUsdc } from "../core/swap-usdc-to-mon.js";
import { StripeFiatPay, stripeFiatEnabled } from "./StripeFiatPay.js";
import { CryptoPaySection, cryptoPrivyConfigured } from "./CryptoPaySection.js";

type CheckoutQuery = {
  articleId: string;
  title: string;
  price: string;
  contract: Address;
  embedSig: string;
  parentOrigin: string;
};

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
  const [error, setError] = useState<string | null>(null);
  const [usdEstimate, setUsdEstimate] = useState<string | null>(null);
  const [fiatBusy, setFiatBusy] = useState(false);
  const [phaseDone, setPhaseDone] = useState(false);
  const [showCrypto, setShowCrypto] = useState(!stripeFiatEnabled());

  const priceWei = query ? parseMonAmount(query.price) : 0n;
  const priceLabel = query ? formatMon(priceWei) : "—";
  const hasPrivy = cryptoPrivyConfigured();

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

  const amountUsdCents = usdEstimate
    ? Math.max(50, Math.round(Number.parseFloat(usdEstimate) * 100))
    : null;

  const onFiatUnlocked = (sessionToken: string) => {
    setPhaseDone(true);
    closeWith({
      source: CHECKOUT_MESSAGE_SOURCE,
      type: "mon:unlocked",
      articleId: query.articleId,
      fiatSession: sessionToken,
      mode: "fiat",
    });
  };

  return (
    <div className="checkout-shell">
      <div className="checkout-card">
        <p className="checkout-brand">MON Unlock</p>
        <h1>Unlock article</h1>
        <p className="checkout-title">{query.title}</p>
        <p className="checkout-price">
          {usdEstimate ? (
            <>
              ${usdEstimate} <span>USD</span>
              <span className="checkout-usd"> · {priceLabel} MON</span>
            </>
          ) : (
            <>
              {priceLabel} <span>MON</span>
            </>
          )}
        </p>

        {stripeFiatEnabled() && amountUsdCents ? (
          <>
            <p className="checkout-copy">Pay with Apple Pay, Google Pay, or card. No wallet needed.</p>
            {error ? <p className="checkout-error">{error}</p> : null}
            {phaseDone ? (
              <p className="checkout-status ok">Unlocked — returning to article…</p>
            ) : (
              <StripeFiatPay
                articleId={query.articleId}
                title={query.title}
                amountUsdCents={amountUsdCents}
                onUnlocked={onFiatUnlocked}
                onError={setError}
                onBusy={setFiatBusy}
              />
            )}
            {hasPrivy && !showCrypto ? (
              <button
                type="button"
                className="checkout-link"
                disabled={fiatBusy}
                onClick={() => setShowCrypto(true)}
              >
                Or pay with crypto
              </button>
            ) : null}
            {hasPrivy && showCrypto ? <p className="checkout-divider">Crypto</p> : null}
          </>
        ) : null}

        {showCrypto && hasPrivy ? (
          <CryptoPaySection
            articleId={query.articleId}
            title={query.title}
            price={query.price}
            contract={query.contract}
            embedSig={query.embedSig}
            usdEstimate={usdEstimate}
            onCloseWith={closeWith}
            disabled={fiatBusy || phaseDone}
          />
        ) : null}

        {showCrypto && !hasPrivy && !stripeFiatEnabled() ? (
          <p className="checkout-copy">Crypto checkout is not configured.</p>
        ) : null}

        <button type="button" className="checkout-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
