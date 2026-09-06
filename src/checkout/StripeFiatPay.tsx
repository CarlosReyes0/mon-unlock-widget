import { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  BillingAddressElement,
  CheckoutElementsProvider,
  ExpressCheckoutElement,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";

const publishableKey =
  (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? "";

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise() {
  if (!publishableKey) return null;
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export function stripeFiatEnabled(): boolean {
  return Boolean(publishableKey);
}

type CreateCheckoutResult = {
  clientSecret: string;
  sessionId: string;
  sessionToken: string;
  amountUsdCents: number;
};

function fiatIntentErrorMessage(code: string | undefined): string {
  switch (code) {
    case "missing_embed_sig":
      return "This embed is missing a publisher signature. Get a new embed from the generator.";
    case "invalid_embed_sig":
    case "unsupported_contract":
      return "This embed was modified. Payments are blocked for your safety.";
    case "article_not_found":
      return "This article is not registered for payments yet.";
    case "a_la_carte_disabled":
      return "This writer only offers subscriptions.";
    default:
      return code || "Could not start card checkout.";
  }
}

function checkoutReturnUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("payment_intent");
  url.searchParams.delete("payment_intent_client_secret");
  url.searchParams.delete("redirect_status");
  url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  return url.toString();
}

async function createCheckout(input: {
  articleId: string;
  title: string;
  amountUsdCents: number;
  embedSig: string;
  contract: string;
  buyerEmail?: string;
}): Promise<CreateCheckoutResult> {
  const res = await fetch("/api/stripe/create-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, returnUrl: checkoutReturnUrl() }),
  });
  const data = (await res.json()) as CreateCheckoutResult & { error?: string };
  if (!res.ok) {
    throw new Error(fiatIntentErrorMessage(data.error));
  }
  if (!data.clientSecret || !data.sessionId) {
    throw new Error("Invalid payment response.");
  }
  return data;
}

async function confirmUnlock(input: { sessionId?: string; paymentIntentId?: string }): Promise<string> {
  const res = await fetch("/api/stripe/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { sessionToken?: string; error?: string };
  if (!res.ok || !data.sessionToken) {
    throw new Error(data.error || "Payment succeeded but unlock was not recorded.");
  }
  return data.sessionToken;
}

function readReturnedCheckout(): { sessionId: string } | { paymentIntentId: string; status: string } | null {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id")?.trim() ?? "";
  if (sessionId.startsWith("cs_")) return { sessionId };
  const paymentIntentId = params.get("payment_intent")?.trim() ?? "";
  const status = params.get("redirect_status")?.trim() ?? "";
  if (paymentIntentId.startsWith("pi_")) return { paymentIntentId, status };
  return null;
}

type InnerProps = {
  sessionId: string;
  onUnlocked: (sessionToken: string) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
};

function TaxLine() {
  const state = useCheckoutElements();
  if (state.type !== "success") return null;
  const tax = state.checkout.total?.taxExclusive;
  if (!tax || tax.minorUnitsAmount <= 0) return null;
  return <p className="checkout-hint">Tax {tax.amount}</p>;
}

function ExpressPayInner({ sessionId, onUnlocked, onError, onBusy }: InnerProps) {
  const checkoutState = useCheckoutElements();
  const [methodsReady, setMethodsReady] = useState(false);

  const finish = useCallback(async () => {
    const sessionToken = await confirmUnlock({ sessionId });
    onUnlocked(sessionToken);
  }, [onUnlocked, sessionId]);

  const onConfirm = useCallback(async () => {
    if (checkoutState.type !== "success") return;
    onBusy(true);
    onError("");
    try {
      const result = await checkoutState.checkout.confirm();
      if (result.type === "error") {
        onError(result.error.message || "Payment cancelled.");
        return;
      }
      await finish();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Payment failed.");
    } finally {
      onBusy(false);
    }
  }, [checkoutState, finish, onBusy, onError]);

  if (checkoutState.type === "loading") {
    return <p className="checkout-status">Preparing card checkout…</p>;
  }
  if (checkoutState.type === "error") {
    return <p className="checkout-error">{checkoutState.error.message}</p>;
  }

  return (
    <div className="checkout-fiat">
      <ExpressCheckoutElement
        options={{
          paymentMethods: {
            applePay: "always",
            googlePay: "always",
            link: "auto",
            paypal: "never",
            amazonPay: "auto",
            klarna: "auto",
          },
          buttonTheme: {
            applePay: "black",
          },
          layout: {
            maxColumns: 2,
            maxRows: 3,
            overflow: "auto",
          },
        }}
        onReady={({ availablePaymentMethods }) => {
          setMethodsReady(Boolean(availablePaymentMethods));
          if (availablePaymentMethods && !availablePaymentMethods.applePay) {
            console.info(
              "[mon-unlock] Apple Pay unavailable here. Use Safari on a Mac/iPhone with Wallet set up, and register mon-unlock-widget-production.up.railway.app in Stripe → Payment method domains."
            );
          }
        }}
        onConfirm={() => {
          void onConfirm();
        }}
      />
      <BillingAddressElement />
      <PaymentElement />
      <TaxLine />
      <button
        type="button"
        className="checkout-btn primary"
        disabled={!checkoutState.checkout.canConfirm}
        onClick={() => {
          void onConfirm();
        }}
      >
        Pay
      </button>
      {!methodsReady ? (
        <p className="checkout-hint">
          Apple Pay and Google Pay show when available on this device. Otherwise use the card form.
        </p>
      ) : null}
    </div>
  );
}

type Props = {
  articleId: string;
  title: string;
  amountUsdCents: number;
  embedSig: string;
  contract: string;
  onUnlocked: (sessionToken: string) => void;
  onError: (message: string) => void;
  onBusy?: (busy: boolean) => void;
};

/**
 * Apple Pay / Google Pay / card via Checkout Sessions (elements) + Stripe Tax.
 */
export function StripeFiatPay({
  articleId,
  title,
  amountUsdCents,
  embedSig,
  contract,
  onUnlocked,
  onError,
  onBusy = () => {},
}: Props) {
  const promise = useMemo(() => getStripePromise(), []);
  const [session, setSession] = useState<CreateCheckoutResult | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [finishingRedirect, setFinishingRedirect] = useState(false);

  useEffect(() => {
    const redirected = readReturnedCheckout();
    if (!redirected) return;
    let cancelled = false;
    setFinishingRedirect(true);
    onBusy(true);
    void (async () => {
      try {
        if ("status" in redirected && redirected.status && redirected.status !== "succeeded") {
          throw new Error("Payment was not completed. You can try again.");
        }
        const sessionToken = await confirmUnlock(redirected);
        if (!cancelled) onUnlocked(sessionToken);
      } catch (e) {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : "Could not finish payment.");
          setBootError(e instanceof Error ? e.message : "Could not finish payment.");
        }
      } finally {
        if (!cancelled) {
          setFinishingRedirect(false);
          onBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onBusy, onError, onUnlocked]);

  useEffect(() => {
    if (finishingRedirect) return;
    if (readReturnedCheckout()) return;
    if (!promise || amountUsdCents < 50) return;
    let cancelled = false;
    onBusy(true);
    void createCheckout({ articleId, title, amountUsdCents, embedSig, contract })
      .then((created) => {
        if (cancelled) return;
        setSession(created);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Stripe unavailable.";
        setBootError(msg);
        onError(msg);
      })
      .finally(() => {
        if (!cancelled) onBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    promise,
    articleId,
    title,
    amountUsdCents,
    embedSig,
    contract,
    onBusy,
    onError,
    finishingRedirect,
  ]);

  if (!promise) return null;

  if (finishingRedirect) {
    return <p className="checkout-status">Confirming payment…</p>;
  }

  if (bootError) {
    return <p className="checkout-error">{bootError}</p>;
  }

  if (!session) {
    return <p className="checkout-status">Preparing card checkout…</p>;
  }

  return (
    <CheckoutElementsProvider
      stripe={promise}
      options={{
        clientSecret: session.clientSecret,
        elementsOptions: {
          appearance: {
            theme: "stripe",
            variables: {
              colorPrimary: "#5b7c5a",
              borderRadius: "12px",
            },
          },
        },
      }}
    >
      <ExpressPayInner
        sessionId={session.sessionId}
        onUnlocked={onUnlocked}
        onError={onError}
        onBusy={onBusy}
      />
    </CheckoutElementsProvider>
  );
}
