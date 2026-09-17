import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  clampEditionAmount,
  explorerTxUrl,
  fetchArticleNftConfig,
  MAX_EDITION_SUPPLY,
  mintArticleNft,
  type ArticleNftConfig,
  type ArticleNftRole,
} from "../core/article-nft.js";
import type { Eip1193Provider } from "../core/wallet.js";

type Props = {
  slug: string;
  role: ArticleNftRole;
  provider?: Eip1193Provider | null;
  account?: string | null;
  onSkip?: () => void;
  skipLabel?: string;
};

export function ArticleNftMint({
  slug,
  role,
  provider,
  account,
  onSkip,
  skipLabel,
}: Props) {
  const [config, setConfig] = useState<ArticleNftConfig | null>(null);
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [tokenId, setTokenId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchArticleNftConfig().then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const mint = useCallback(async () => {
    setError("");
    if (!config?.configured || !config.contract) {
      setError("Article NFT contract is not set.");
      return;
    }
    if (!provider || !account) {
      setError("Connect a wallet to mint. You pay a little MON for gas.");
      return;
    }
    setBusy(true);
    try {
      const result = await mintArticleNft({
        provider,
        account: account as Address,
        contract: config.contract as Address,
        slug,
        role,
        amount: role === "edition" ? clampEditionAmount(amount) : 1,
      });
      setTxHash(result.txHash);
      setTokenId(result.tokenId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Mint failed.";
      if (!/reject|denied|cancel/i.test(msg)) setError(msg);
      else setError("Mint cancelled.");
    } finally {
      setBusy(false);
    }
  }, [account, amount, config, provider, role, slug]);

  if (config && !config.configured) {
    if (!onSkip) return null;
    return (
      <p className="mon-nft__copy">
        <button type="button" className="mon-nft__skip" onClick={onSkip}>
          {skipLabel || "Continue"}
        </button>
      </p>
    );
  }

  const heading =
    role === "edition" ? "Mint edition on Monad" : "Mint receipt";
  const copy =
    role === "edition"
      ? "Optional 1/1 or small edition you own. Not required to publish or to read. You pay gas."
      : "Optional souvenir of this unlock. Not required to read. You pay a little MON for gas.";

  return (
    <section className="mon-nft" aria-label={heading}>
      <h2 className="mon-nft__title">{heading}</h2>
      <p className="mon-nft__copy">{copy}</p>
      {role === "edition" ? (
        <label className="mon-nft__label">
          Edition size
          <select
            className="mon-nft__select"
            value={amount}
            disabled={busy || Boolean(txHash)}
            onChange={(e) => setAmount(clampEditionAmount(e.target.value))}
          >
            <option value={1}>1/1</option>
            <option value={5}>Edition of 5</option>
            <option value={10}>Edition of 10</option>
            <option value={MAX_EDITION_SUPPLY}>Edition of {MAX_EDITION_SUPPLY}</option>
          </select>
        </label>
      ) : null}
      {error ? <p className="mon-nft__error">{error}</p> : null}
      {txHash ? (
        <p className="mon-nft__ok">
          Minted{tokenId && tokenId !== "0" ? ` token #${tokenId}` : ""}.{" "}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noopener noreferrer">
            View on MonadVision
          </a>
        </p>
      ) : (
        <button
          type="button"
          className="mon-pub-auth__btn mon-pub-auth__btn--primary checkout-btn primary"
          disabled={busy || !provider || !account}
          onClick={() => void mint()}
        >
          {busy ? "Minting…" : heading}
        </button>
      )}
      {onSkip ? (
        <button type="button" className="mon-nft__skip" onClick={onSkip} disabled={busy}>
          {skipLabel || "Skip"}
        </button>
      ) : null}
    </section>
  );
}
