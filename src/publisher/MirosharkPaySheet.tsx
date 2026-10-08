import {
  PAY_NETWORK_CHOICES,
  shortWallet,
  type MirosharkNetworkOffers,
  type MirosharkPayNetwork,
} from "../core/miroshark-pay.js";
import { readPublisherWallet } from "../core/wallet.js";

type Props = {
  offers: MirosharkNetworkOffers;
  selected: MirosharkPayNetwork;
  busy: boolean;
  error: string;
  onSelect: (network: MirosharkPayNetwork) => void;
  onApprove: () => void;
  onClose: () => void;
};

export function MirosharkPaySheet({
  offers,
  selected,
  busy,
  error,
  onSelect,
  onApprove,
  onClose,
}: Props) {
  const session = readPublisherWallet();
  const from = session?.address || "";
  const offer = offers[selected];
  const amount = offer?.clientPayment?.amountUsd || offer?.amountUsd || "1.00";
  const unavailable = Boolean(offer && !offer.available);
  return (
    <div className="mon-sim-pay" role="presentation" onClick={onClose}>
      <section
        className="mon-sim-pay__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sim-pay-title"
        data-pay-network={selected}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mon-sim-pay__handle" />
        <p className="mon-sim-pay__kicker">MiroShark</p>
        <h2 id="sim-pay-title">Run this simulation?</h2>
        <p className="mon-sim-pay__copy">
          25 agents read the draft and react. You pay once, in USDC. Publish stays separate.
        </p>
        <div className="mon-sim-pay__networks" role="radiogroup" aria-label="Pay with USDC">
          {PAY_NETWORK_CHOICES.map((choice) => {
            const row = offers[choice.id];
            const on = choice.id === selected;
            return (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-network={choice.id}
                className={on ? "mon-sim-pay__network is-selected" : "mon-sim-pay__network"}
                disabled={busy || !row?.available}
                onClick={() => onSelect(choice.id)}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        <div className="mon-sim-pay__price">
          <b>${amount} USDC</b>
          <span>{offer?.label || "USDC"}</span>
        </div>
        <div className="mon-sim-pay__row">
          <span>From</span>
          <b>{from ? shortWallet(from) : "Sign in to choose a wallet"}</b>
        </div>
        {unavailable ? (
          <p className="mon-sim-pay__error" role="alert">
            USDC on {offer?.label || "this network"} is not available for this charge.
          </p>
        ) : null}
        {error ? (
          <p className="mon-sim-pay__error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="mon-pub-auth__btn mon-pub-auth__btn--primary mon-sim-pay__approve"
          disabled={busy || !from || unavailable}
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
