import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  UnlockService,
  OnchainUnlockService,
  WalletManager,
  monadMainnet,
  formatMon,
  parseMonAmount,
  truncateAddress,
  type Article,
  type WalletState,
} from "../core/index.js";
import "./styles.css";

/**
 * Embeddable paywall — paste on any site, no JavaScript required.
 *
 * <mon-unlock article-id="post-1" title="..." author="..." price="5">
 *   <div slot="teaser">Free preview...</div>
 *   <div slot="body">Full article...</div>
 * </mon-unlock>
 */
@customElement("mon-unlock")
export class MonUnlock extends LitElement {
  @property({ type: String, attribute: "article-id" }) articleId = "";
  @property({ type: String }) title = "";
  @property({ type: String }) author = "";
  /** Price in MON, e.g. "5" or "0.5" */
  @property({ type: String }) price = "1";
  @property({ type: String }) theme: "light" | "dark" = "light";
  /** Contract address (enables real on-chain payments) */
  @property({ type: String, attribute: "unlock-contract" }) unlockContract = "";
  /** WalletConnect Project ID (enables mobile connection via WalletConnect) */
  @property({ type: String, attribute: "walletconnect-project-id" }) walletConnectProjectId = "";

  @state() private article: Article | null = null;
  @state() private wallet: WalletState = { connected: false, address: null };
  @state() private unlocked = false;
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private txHash: string | null = null;
  @state() private fetchedBody: string | null = null;

  private walletManager = new WalletManager();
  private unlockService: UnlockService | OnchainUnlockService = new UnlockService();
  private isOnchain = false;
  private unsubWallet?: () => void;

  override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.unsubWallet = this.walletManager.subscribe((s) => {
      this.wallet = s;
      // Re-check access (local cache or on-chain) whenever wallet changes
      if (this.isOnchain) {
        void this.verifyOnchain();
      } else {
        this.checkAccess();
      }
    });
    this.loadArticle();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubWallet?.();
  }

  override updated(changed: Map<string, unknown>) {
    if (
      changed.has("articleId") ||
      changed.has("title") ||
      changed.has("author") ||
      changed.has("price")
    ) {
      this.loadArticle();
    }
  }

  private slotText(name: string): string {
    const el = this.querySelector(`[slot="${name}"]`);
    return el?.textContent?.trim() ?? "";
  }

  private slotHtml(name: string): string {
    const el = this.querySelector(`[slot="${name}"]`);
    return el?.innerHTML?.trim() ?? "";
  }

  private loadArticle() {
    this.error = null;

    if (!this.articleId?.trim()) {
      this.article = null;
      this.error = "Add article-id to the widget tag.";
      return;
    }

    const teaser = this.slotText("teaser");
    const body = this.slotHtml("body");

    if (!this.title?.trim()) {
      this.article = null;
      this.error = "Add a title=\"...\" on the widget tag.";
      return;
    }
    if (!teaser) {
      this.article = null;
      this.error = 'Add a free preview: <div slot="teaser">...</div>';
      return;
    }
    // Body is now optional — if not provided via slot, it will be fetched after unlock.

    this.article = {
      id: this.articleId.trim(),
      title: this.title.trim(),
      author: (this.author || "Author").trim(),
      teaser,
      body, // may be empty string when body will be fetched after unlock
      priceMon: parseMonAmount(this.price),
      publishedAt: new Date().toISOString(),
    };

    // Switch to on-chain service if contract address is provided
    if (this.unlockContract?.trim()) {
      this.isOnchain = true;
      this.unlockService = new OnchainUnlockService(this.unlockContract.trim() as `0x${string}`);
    } else {
      this.isOnchain = false;
      this.unlockService = new UnlockService();
    }

    this.checkAccess();

    // Phase 1.3: if we already have a wallet and on-chain mode, verify immediately
    if (this.isOnchain && this.wallet.address) {
      void this.verifyOnchain();
    }

    // Passive on-chain check: if the user has previously authorized this wallet on this domain,
    // detect it silently via eth_accounts (no popup) and verify unlock status automatically.
    // This makes cross-site unlocks (localhost → production, etc.) appear without clicking Connect.
    if (this.isOnchain) {
      this.attemptSilentOnchainCheck();
    }
  }

  /** Attempt to discover an already-authorized account without prompting the user.
   *  Used so that on-chain unlocks done on another domain become visible immediately.
   */
  private attemptSilentOnchainCheck() {
    const eth = (globalThis as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) return;

    eth.request({ method: "eth_accounts" })
      .then((accounts: unknown) => {
        const list = accounts as string[] | undefined;
        if (list && list.length > 0) {
          const addr = list[0];
          this.wallet = { connected: true, address: addr };
          void this.verifyOnchain();
        }
      })
      .catch(() => {
        /* No accounts exposed yet – user has not connected on this origin */
      });
  }

  private checkAccess() {
    if (!this.article?.id || !this.wallet.address) {
      this.unlocked = false;
      return;
    }
    this.unlocked = this.unlockService.hasAccess(this.article.id, this.wallet.address);
  }

  /** Phase 1.3: verify on-chain when a contract address is configured.
   *  Always authoritative: sets unlocked based on chain result (true or false).
   */
  private async verifyOnchain() {
    if (!this.isOnchain || !this.article?.id || !this.wallet.address) {
      this.unlocked = false;
      this.txHash = null;
      return;
    }

    const onchain = await (this.unlockService as OnchainUnlockService).checkOnchainAccess(
      this.article.id,
      this.wallet.address
    );

    this.unlocked = onchain;
    if (onchain) {
      this.txHash = null; // confirmed via chain, original tx unknown here
      // Attempt to fetch body if we don't have a slotted one
      void this.fetchBodyIfNeeded();
    } else {
      this.txHash = null;
    }
  }

  /** If the publisher did not provide a slotted body, fetch the real content
   *  from the article-body Edge Function after a successful unlock.
   */
  private async fetchBodyIfNeeded() {
    if (!this.article || this.fetchedBody) return;
    const slottedBody = this.slotHtml("body");
    if (slottedBody) return; // already have body from the embed — no need to fetch

    if (!this.wallet.address) return;

    const apiBase = "https://flczjqljgntmkanipugo.supabase.co/functions/v1";
    const anonKey =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4";

    const params = new URLSearchParams({
      article_id: this.article.id,
      reader: this.wallet.address,
    });
    if (this.unlockContract?.trim()) {
      params.set("unlock_contract", this.unlockContract.trim());
    }

    const url = `${apiBase}/article-body?${params.toString()}`;

    // Retry briefly — covers RPC propagation right after a fresh payment.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
        });

        if (res.ok) {
          const data = (await res.json()) as { body?: string };
          if (data.body) {
            this.fetchedBody = data.body;
          }
          return;
        }

        if (res.status !== 403 || attempt === 2) {
          console.warn("[mon-unlock] article-body fetch returned", res.status);
          return;
        }
      } catch (e) {
        if (attempt === 2) {
          console.warn("[mon-unlock] failed to fetch body after unlock", e);
          return;
        }
      }

      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }

  private emit(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private isMobile(): boolean {
    if (typeof navigator === "undefined") return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }


  private async connect() {
    if (!this.article) {
      this.loadArticle();
      if (!this.article) return;
    }

    this.loading = true;
    this.error = null;
    this.txHash = null;

    try {
      if (this.walletConnectProjectId) {
        this.walletManager.setWalletConnectProjectId(this.walletConnectProjectId);
      }
      const s = await this.walletManager.connect();
      this.wallet = s;

      // Ensure MetaMask is on the correct chain for on-chain payments
      if (this.isOnchain) {
        await this.walletManager.ensureChain(monadMainnet);
      }

      const address = s.address!;

      // Decide whether payment is needed.
      // On-chain mode: authoritative check against the contract.
      // Demo mode: check local cache only.
      let needsPayment: boolean;
      if (this.isOnchain) {
        needsPayment = !(await (this.unlockService as OnchainUnlockService).checkOnchainAccess(
          this.article.id,
          address
        ));
      } else {
        needsPayment = !this.unlockService.hasAccess(this.article.id, address);
      }

      if (needsPayment) {
        const record = await this.unlockService.unlock(this.article.id, address, this.article.priceMon);
        if (record.txHash) this.txHash = record.txHash;
        this.emit("mon:unlocked", { article: this.article, record });
      }

      this.unlocked = true;

      // Phase 1.3: double-check on-chain after a fresh payment
      if (this.isOnchain) {
        await this.verifyOnchain();
      }

      // If no slotted body was provided, fetch it from the service now that we are unlocked
      await this.fetchBodyIfNeeded();

      this.emit("mon:connected", s);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Could not connect wallet.";
      this.unlocked = false;
    } finally {
      this.loading = false;
    }
  }

  override render() {
    if (!this.article && !this.error) {
      return html`<div class="mon-card p-6 text-sm text-stone-500">Loading…</div>`;
    }
    if (!this.article) {
      return html`
        <div class="mon-card p-6">
          <p class="text-sm font-medium text-red-600">Setup needed</p>
          <p class="mt-2 text-sm text-stone-600">${this.error}</p>
        </div>
      `;
    }

    const a = this.article;
    const price = formatMon(a.priceMon);

    return html`
      <article class="mon-card ${classMap({ dark: this.theme === "dark" })}">
        <header class="border-b border-stone-100 px-6 py-5 dark:border-zinc-800">
          <p class="mon-badge mb-2">Unlock with MON</p>
          <h1 class="font-serif text-2xl font-semibold leading-tight" style="color:#000">${a.title}</h1>
          <p class="mt-2 text-sm text-black dark:text-zinc-400">
            ${a.author} · ${new Date(a.publishedAt).toLocaleDateString()}
          </p>
        </header>

        <div class="px-6 py-5">
          ${this.error
            ? html`<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">${this.error}</p>`
            : nothing}

          ${this.unlocked
            ? html`
                <div class="mb-6 whitespace-pre-wrap text-base" style="color:#000">${a.teaser}</div>
                <div class="mon-body text-black">${unsafeHTML(this.fetchedBody || a.body)}</div>
                <p class="mt-6 text-xs text-black">
                  Unlocked · ${truncateAddress(this.wallet.address!)}
                  ${this.txHash
                    ? html`· <a href="https://monadvision.com/tx/${this.txHash}" target="_blank" class="underline">Paid ${price} MON ↗</a>`
                    : nothing}
                </p>
              `
            : html`
                <div class="mon-title-box whitespace-pre-wrap">${a.teaser}</div>
                <div class="mt-6 rounded-xl border border-violet-100 bg-violet-50/80 p-5 dark:border-violet-900/40 dark:bg-violet-950/30">
                  <p class="text-sm font-medium">
                    Unlock for <span class="text-violet-700 dark:text-violet-300">${price} MON</span>
                  </p>
                  <p class="mt-1 text-xs text-stone-500">
                    ${this.isOnchain
                      ? "Pay with MON on Monad. Connect wallet to continue."
                      : "Demo: connect wallet to read the rest (payment simulated)."}
                  </p>
                  <div class="mt-4">
                    <button
                      class="mon-btn mon-btn-primary"
                      ?disabled=${this.loading}
                      @click=${() => this.connect()}
                    >
                      ${this.loading ? "Connecting…" : "Connect wallet to unlock"}
                    </button>
                  </div>
                </div>
              `}
        </div>
      </article>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mon-unlock": MonUnlock;
  }
}
