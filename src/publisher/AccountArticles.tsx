import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, type Address } from "viem";
import { ArticleNftMint } from "./ArticleNftMint.js";
import { monadMainnet } from "../core/chains.js";
import { formatMon } from "../core/types.js";
import { buildListingAuthMessage, supabaseFunctionHeaders } from "../core/publish-auth.js";
import type { Eip1193Provider } from "../core/wallet.js";

const SUPABASE_URL = "https://flczjqljgntmkanipugo.supabase.co";
const UPDATE_LISTING_URL = `${SUPABASE_URL}/functions/v1/update-listing`;

type ArticleRow = {
  articleId: string;
  title: string;
  author: string;
  priceWei: bigint;
  paymentAsset: "usdc" | "mon";
  unlockCount: number;
  revenue: bigint;
  listingStatus: string;
  allowALaCarte: boolean;
  externalUrl: string;
  hasSlug: boolean;
};

type Props = {
  wallet: string;
};

function money(asset: "usdc" | "mon", amount: bigint): string {
  if (asset === "usdc") {
    const whole = amount / 1_000_000n;
    const frac = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
    return `$${whole}.${frac} USDC`;
  }
  return `${formatMon(amount)} MON`;
}

function revenueLabel(rows: ArticleRow[]): string {
  const usdc = rows.filter((row) => row.paymentAsset === "usdc").reduce((sum, row) => sum + row.revenue, 0n);
  const mon = rows.filter((row) => row.paymentAsset !== "usdc").reduce((sum, row) => sum + row.revenue, 0n);
  const parts = [];
  if (usdc > 0n) parts.push(money("usdc", usdc));
  if (mon > 0n) parts.push(money("mon", mon));
  return parts.join(" · ") || "0";
}

export function AccountArticles({ wallet }: Props) {
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [status, setStatus] = useState("Loading your articles…");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listOn, setListOn] = useState(false);
  const [allowBuy, setAllowBuy] = useState(true);
  const [externalUrl, setExternalUrl] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const publisher = wallet.trim().toLowerCase();
    if (!publisher) return;
    setStatus("Loading your articles…");
    try {
      const articleRes = await fetch(
        `${SUPABASE_URL}/rest/v1/articles?select=article_id,article_id_hash,publisher,price_wei,payment_asset,title,author,listing_status,allow_a_la_carte,external_url&publisher=eq.${encodeURIComponent(publisher)}`,
        { headers: supabaseFunctionHeaders() }
      );
      if (!articleRes.ok) throw new Error("articles_" + articleRes.status);
      const articles = (await articleRes.json()) as Array<Record<string, unknown>>;
      const hashes = articles
        .map((row) => String(row.article_id_hash || ""))
        .filter(Boolean);
      const stats = new Map<string, { count: number; revenue: bigint }>();
      if (hashes.length) {
        const unlockRes = await fetch(
          `${SUPABASE_URL}/rest/v1/unlocks?select=article_id_hash,amount_wei&article_id_hash=in.(${hashes.map(encodeURIComponent).join(",")})`,
          { headers: supabaseFunctionHeaders() }
        );
        if (unlockRes.ok) {
          const unlocks = (await unlockRes.json()) as Array<Record<string, unknown>>;
          for (const unlock of unlocks) {
            const hash = String(unlock.article_id_hash || "");
            const current = stats.get(hash) || { count: 0, revenue: 0n };
            current.count += 1;
            try {
              current.revenue += BigInt(String(unlock.amount_wei || "0"));
            } catch {
              /* ignore a bad amount */
            }
            stats.set(hash, current);
          }
        }
      }
      setRows(
        articles.map((row) => {
          const hash = String(row.article_id_hash || "");
          const stat = stats.get(hash);
          const slug = String(row.article_id || "").trim();
          let priceWei = 0n;
          try {
            priceWei = BigInt(String(row.price_wei || "0"));
          } catch {
            priceWei = 0n;
          }
          return {
            articleId: slug,
            title: String(row.title || slug || "Untitled"),
            author: String(row.author || ""),
            priceWei,
            paymentAsset: row.payment_asset === "usdc" ? "usdc" : "mon",
            unlockCount: stat?.count || 0,
            revenue: stat?.revenue || 0n,
            listingStatus: String(row.listing_status || "unlisted"),
            allowALaCarte: row.allow_a_la_carte !== false,
            externalUrl: String(row.external_url || ""),
            hasSlug: Boolean(slug),
          };
        })
      );
      setStatus("");
    } catch {
      setRows([]);
      setStatus("Could not load your articles.");
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  function openListing(row: ArticleRow) {
    setSelectedId(row.articleId);
    setListOn(row.listingStatus === "listed");
    setAllowBuy(row.allowALaCarte);
    setExternalUrl(row.externalUrl);
    setSaveMsg("");
  }

  async function saveListing(row: ArticleRow) {
    const provider = window.__monPublisherProvider as Eip1193Provider | undefined;
    if (!provider) {
      setSaveMsg("Connect a wallet to save the listing.");
      return;
    }
    setSaving(true);
    setSaveMsg("Approve the listing signature…");
    try {
      const url = externalUrl.trim() || null;
      const message = buildListingAuthMessage({
        slug: row.articleId,
        publisher: wallet,
        listOnOpenPaywall: listOn,
        externalUrl: url,
      });
      const account = wallet as Address;
      const walletClient = createWalletClient({
        account,
        chain: monadMainnet,
        transport: custom(provider),
      });
      const listingSig = await walletClient.signMessage({ account, message });
      const res = await fetch(UPDATE_LISTING_URL, {
        method: "POST",
        headers: supabaseFunctionHeaders(),
        body: JSON.stringify({
          slug: row.articleId,
          publisher: wallet,
          listOnOpenPaywall: listOn,
          externalUrl: url,
          listingSig,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "save_failed");
      await fetch("/api/articles/a-la-carte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: row.articleId,
          publisher: wallet,
          allowALaCarte: allowBuy,
        }),
      });
      setSaveMsg("Listing saved.");
      await load();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const unlocks = rows.reduce((sum, row) => sum + row.unlockCount, 0);
  const selected = rows.find((row) => row.articleId === selectedId) || null;

  return (
    <div className="mon-pub-shell__card mon-pub-articles">
      <h2 className="mon-pub-shell__card-title">Your articles</h2>
      <p className="mon-pub-auth__hint">Unlocks and revenue for the wallet you are signed in with.</p>
      <div className="mon-pub-articles__stats">
        <div>
          <div className="mon-pub-articles__stat-label">Unlocks</div>
          <div className="mon-pub-articles__stat">{unlocks}</div>
        </div>
        <div>
          <div className="mon-pub-articles__stat-label">Revenue</div>
          <div className="mon-pub-articles__stat">{revenueLabel(rows)}</div>
        </div>
      </div>
      {status ? <p className="mon-pub-auth__hint">{status}</p> : null}
      {!status && rows.length === 0 ? (
        <p className="mon-pub-auth__hint">
          No articles yet. <a href="/write">Write</a> one to publish it.
        </p>
      ) : null}
      <div className="mon-pub-articles__list">
        {rows.map((row) => (
          <div key={row.articleId || row.title} className="mon-pub-articles__row">
            <div>
              <p className="mon-pub-articles__title">{row.title}</p>
              <p className="mon-pub-articles__meta">
                {money(row.paymentAsset, row.priceWei)} · {row.unlockCount} unlocks ·{" "}
                {row.listingStatus === "listed" ? "Listed" : row.listingStatus === "hidden" ? "Hidden" : "Unlisted"}
              </p>
            </div>
            {row.hasSlug ? (
              <button type="button" className="mon-pub-auth__btn" onClick={() => openListing(row)}>
                Listing
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {selected ? (
        <div className="mon-pub-articles__editor">
          <p className="mon-pub-articles__title">{selected.articleId}</p>
          <label className="mon-pub-shell__check">
            <input type="checkbox" checked={listOn} onChange={(e) => setListOn(e.target.checked)} />
            List on Open Paywall
          </label>
          <label className="mon-pub-shell__check">
            <input type="checkbox" checked={allowBuy} onChange={(e) => setAllowBuy(e.target.checked)} />
            Allow pay-per-article on this piece
          </label>
          <label className="mon-pub-shell__field-label" htmlFor="accountListingUrl">
            Your site URL (optional)
          </label>
          <input
            id="accountListingUrl"
            className="mon-pub-shell__input mon-pub-articles__url"
            type="url"
            value={externalUrl}
            placeholder="https://yoursite.com/this-post"
            onChange={(e) => setExternalUrl(e.target.value)}
          />
          <div className="mon-pub-shell__links">
            <button
              type="button"
              className="mon-pub-auth__btn mon-pub-auth__btn--primary"
              disabled={saving}
              onClick={() => void saveListing(selected)}
            >
              {saving ? "Saving…" : "Save listing"}
            </button>
            <a href={listOn ? `/articles/${encodeURIComponent(selected.articleId)}` : "/articles"}>
              {listOn ? "Open hosted page" : "View feed"}
            </a>
          </div>
          {saveMsg ? <p className="mon-pub-auth__hint">{saveMsg}</p> : null}
          <ArticleNftMint
            slug={selected.articleId}
            role="edition"
            provider={window.__monPublisherProvider as Eip1193Provider | undefined}
            account={wallet}
          />
        </div>
      ) : null}
    </div>
  );
}
