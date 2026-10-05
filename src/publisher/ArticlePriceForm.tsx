import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  ARTICLE_PRICE_PRESETS_CENTS,
  MIN_ARTICLE_PRICE_CENTS,
  formatUsdFromCents,
  needsHighPriceConfirm,
  parseUsdToCents,
  presetLabel,
  priceNetLine,
} from "../core/article-price.js";

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function ArticlePriceForm({
  cents,
  onChange,
}: {
  cents: number;
  onChange: (cents: number) => void;
}) {
  const [draft, setDraft] = useState(() => dollars(cents));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (focused) return;
    setDraft(dollars(cents));
  }, [cents, focused]);

  const typed = parseUsdToCents(draft);
  const preview = pending ?? (typed != null ? typed : cents);

  function apply(next: number) {
    setError("");
    setPending(null);
    setDraft(dollars(next));
    if (next !== cents) flushSync(() => onChange(next));
  }

  function tryApply(raw: string) {
    const parsed = parseUsdToCents(raw);
    if (parsed == null) {
      setError("Enter a USD amount.");
      setPending(null);
      return;
    }
    if (parsed < MIN_ARTICLE_PRICE_CENTS) {
      setError("Minimum is $0.50.");
      setPending(null);
      return;
    }
    if (needsHighPriceConfirm(parsed) && parsed !== cents) {
      setError("");
      setPending(parsed);
      return;
    }
    apply(parsed);
  }

  return (
    <div className="mon-price">
      <div className="mon-price__presets" role="group" aria-label="Price presets">
        {ARTICLE_PRICE_PRESETS_CENTS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`mon-price__preset${cents === preset ? " is-active" : ""}`}
            aria-pressed={cents === preset}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(preset)}
          >
            {presetLabel(preset)}
          </button>
        ))}
      </div>
      <input
        className="mon-price__custom"
        inputMode="decimal"
        aria-label="Custom price in USD"
        placeholder="Custom USD"
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setPending(null);
          setError("");
        }}
        onBlur={(event) => {
          setFocused(false);
          tryApply(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            tryApply(event.currentTarget.value);
          }
        }}
      />
      {error ? <p className="mon-price__error">{error}</p> : null}
      {pending != null ? (
        <div className="mon-price__confirm">
          <p>Are you sure? {formatUsdFromCents(pending)}</p>
          <button type="button" className="mon-price__preset is-active" onClick={() => apply(pending)}>
            Yes
          </button>
          <button type="button" className="mon-price__preset" onClick={() => setPending(null)}>
            Back
          </button>
        </div>
      ) : null}
      <p className="mon-price__net">{priceNetLine(preview)}</p>
    </div>
  );
}
