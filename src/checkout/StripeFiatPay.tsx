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
        onReady={({ availablePaymentMethods }) => {
          setMethodsReady(Boolean(availablePaymentMethods));
        }}
        onConfirm={() => {
          void onConfirm();
        }}
      />
      {!methodsReady ? (
        <p className="checkout-hint">
          Apple Pay and Google Pay show when available on this device. Otherwise use the card option
          Stripe presents.
        </p>
      ) : null}
    </div>
  );
}

type Props = {
  articleId: string;
  title: string;
  /** USD cents charged via Stripe (from MON≈USD estimate). */
  amountUsdCents: number;
  onUnlocked: (sessionToken: string) => void;
  onError: (message: string) => void;
  onBusy?: (busy: boolean) => void;
};

/**
 * Apple Pay / Google Pay / Link via Stripe Express Checkout Element.
 * Mounts when VITE_STRIPE_PUBLISHABLE_KEY is set and amount ≥ $0.50.
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

  useEffect(() => {
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
  }, [promise, articleId, title, amountUsdCents, onBusy, onError]);

  if (!promise) return null;

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
