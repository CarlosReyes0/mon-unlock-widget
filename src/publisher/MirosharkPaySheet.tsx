import { shortWallet, type MirosharkClientPayment } from "../core/miroshark-pay.js";

type Props = {
  payment: MirosharkClientPayment;
  from: string;
  busy: boolean;
  error: string;
  onApprove: () => void;
  onClose: () => void;
};

export function MirosharkPaySheet({ payment, from, busy, error, onApprove, onClose }: Props) {
  const amount = payment.amountUsd || "1.00";
  return (
    <div className="mon-sim-pay" role="presentation" onClick={onClose}>
      <section
        className="mon-sim-pay__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-pay-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mon-sim-pay__handle" />
        <p className="mon-sim-pay__kicker">MiroShark</p>
        <h2 id="sim-pay-title">Run this simulation?</h2>
        <p className="mon-sim-pay__copy">
          25 agents read the draft and react. You pay once, on Base. Publish stays separate.
        </p>
        <div className="mon-sim-pay__price">
          <b>${amount} USDC</b>
          <span>on Base</span>
        </div>
        <div className="mon-sim-pay__row">
          <span>From</span>
          <b>{from ? shortWallet(from) : "Sign in to choose a wallet"}</b>
        </div>
        {error ? (
          <p className="mon-sim-pay__error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="mon-pub-auth__btn mon-pub-auth__btn--primary mon-sim-pay__approve"
          disabled={busy || !from}
          onClick={onApprove}
        >
          {busy ? "Waiting for wallet…" : "Approve in wallet"}
        </button>
        <button type="button" className="mon-pub-auth__btn mon-sim-pay__later" disabled={busy} onClick={onClose}>
          Not now
        </button>
      </section>
    </div>
  );
}
