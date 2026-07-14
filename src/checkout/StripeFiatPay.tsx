import { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  ExpressCheckoutElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

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

type CreateIntentResult = {
  clientSecret: string;
  paymentIntentId: string;
  sessionToken: string;
  amountUsdCents: number;
};

async function createIntent(input: {
  articleId: string;
  title: string;
  amountUsdCents: number;
  buyerEmail?: string;
}): Promise<CreateIntentResult> {
  const res = await fetch("/api/stripe/create-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as CreateIntentResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || "Could not start card checkout.");
  }
  if (!data.clientSecret || !data.paymentIntentId) {
    throw new Error("Invalid payment response.");
  }
  return data;
}

async function confirmUnlock(paymentIntentId: string): Promise<string> {
  const res = await fetch("/api/stripe/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentIntentId }),
  });
  const data = (await res.json()) as { sessionToken?: string; error?: string };
  if (!res.ok || !data.sessionToken) {
    throw new Error(data.error || "Payment succeeded but unlock was not recorded.");
  }
  return data.sessionToken;
}

/** Stripe may bounce back to unlock.html with payment_intent + redirect_status. */
function readStripeRedirectIntent(): { paymentIntentId: string; status: string } | null {
  const params = new URLSearchParams(window.location.search);
  const paymentIntentId = params.get("payment_intent")?.trim() ?? "";
  const status = params.get("redirect_status")?.trim() ?? "";
  if (!paymentIntentId.startsWith("pi_")) return null;
  return { paymentIntentId, status };
}

type InnerProps = {
  paymentIntentId: string;
  onUnlocked: (sessionToken: string) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
};

function ExpressPayInner({ paymentIntentId, onUnlocked, onError, onBusy }: InnerProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [methodsReady, setMethodsReady] = useState(false);

  const onConfirm = useCallback(async () => {
    if (!stripe || !elements) return;
    onBusy(true);
    onError("");
    try {
      // Keep full unlock query (incl. returnUrl) so a redirect can finish unlock.
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: window.location.href,
        },
      });
      if (error) {
        onError(error.message || "Payment cancelled.");
        return;
      }
      const piId = paymentIntent?.id || paymentIntentId;
      if (paymentIntent && paymentIntent.status !== "succeeded") {
        onError("Payment is still processing. Try again in a moment.");
        return;
      }
      const sessionToken = await confirmUnlock(piId);
      onUnlocked(sessionToken);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Payment failed.");
    } finally {
      onBusy(false);
    }
  }, [stripe, elements, paymentIntentId, onBusy, onError, onUnlocked]);

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
      {!methodsReady ? (
        <p className="checkout-hint">
          Apple Pay and Google Pay show when available on this device. Otherwise use the wallets
          Stripe presents.
        </p>
      ) : null}
    </div>
  );
}

type Props = {
  articleId: string;
  title: string;
  amountUsdCents: number;
  onUnlocked: (sessionToken: string) => void;
  onError: (message: string) => void;
  onBusy?: (busy: boolean) => void;
};

/**
 * Apple Pay / Google Pay / Link via Stripe Express Checkout Element.
 * Also completes unlock when Stripe redirects back with payment_intent in the URL.
 */
export function StripeFiatPay({
  articleId,
  title,
  amountUsdCents,
  onUnlocked,
  onError,
  onBusy = () => {},
}: Props) {
  const promise = useMemo(() => getStripePromise(), []);
  const [intent, setIntent] = useState<CreateIntentResult | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [finishingRedirect, setFinishingRedirect] = useState(false);

  // Complete payment when Stripe redirected back to unlock.html.
  useEffect(() => {
    const redirected = readStripeRedirectIntent();
    if (!redirected) return;
    let cancelled = false;
    setFinishingRedirect(true);
    onBusy(true);
    void (async () => {
      try {
        if (redirected.status && redirected.status !== "succeeded") {
          throw new Error("Payment was not completed. You can try again.");
        }
        const sessionToken = await confirmUnlock(redirected.paymentIntentId);
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
    if (readStripeRedirectIntent()) return;
    if (!promise || amountUsdCents < 50) return;
    let cancelled = false;
    onBusy(true);
    void createIntent({ articleId, title, amountUsdCents })
      .then((created) => {
        if (cancelled) return;
        setIntent(created);
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
  }, [promise, articleId, title, amountUsdCents, onBusy, onError, finishingRedirect]);

  if (!promise) return null;

  if (finishingRedirect) {
    return <p className="checkout-status">Confirming payment…</p>;
  }

  if (bootError) {
    return <p className="checkout-error">{bootError}</p>;
  }

  if (!intent) {
    return <p className="checkout-status">Preparing card checkout…</p>;
  }

  return (
    <Elements
      stripe={promise}
      options={{
        clientSecret: intent.clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#5b7c5a",
            borderRadius: "12px",
          },
        },
      }}
    >
      <ExpressPayInner
        paymentIntentId={intent.paymentIntentId}
        onUnlocked={onUnlocked}
        onError={onError}
        onBusy={onBusy}
      />
    </Elements>
  );
}
