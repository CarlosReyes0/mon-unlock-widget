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
  parseUsdAmount,
  truncateAddress,
  hasReliableInjectedProvider,
  buildCheckoutUrl,
  getCheckoutBaseUrl,
  isCheckoutMessage,
  readFiatReturnFromLocation,
  clearFiatReturnParams,
  type Article,
  type WalletState,
  looksLikeHtml,
  sanitizeRichHtml,
  resolvePaymentAsset,
  resolveSubscriptionContract,
  subscribeOnchain,
  transferUsdcToWriter,
  parseUsdAmount,
} from "../core/index.js";
import type { Address } from "viem";
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
  /** Publisher signature authorizing this embed (required with unlock-contract) */
  @property({ type: String, attribute: "embed-sig" }) embedSig = "";
  /** "usdc" = USD price settled in USDC; omit/mon = legacy MON */
  @property({ type: String, attribute: "payment-asset" }) paymentAsset = "";
  /** WalletConnect Project ID (enables mobile connection via WalletConnect) */
  @property({ type: String, attribute: "walletconnect-project-id" }) walletConnectProjectId = "";
  /** Writer wallet — used for subscribe-to-this-writer */
  @property({ type: String }) publisher = "";
  /** Monthly plan label override, e.g. "5" meaning $5/mo */
  @property({ type: String, attribute: "subscription-price" }) subscriptionPrice = "";
  /** "false" hides the one-article buy button */
  @property({ type: String, attribute: "allow-a-la-carte" }) allowALaCarteAttr = "";

  @state() private article: Article | null = null;
  @state() private wallet: WalletState = { connected: false, address: null };
  @state() private unlocked = false;
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private txHash: string | null = null;
  @state() private fetchedBody: string | null = null;
  @state() private fiatSession: string | null = null;
  @state() private accessReason: "purchase" | "subscription" | "locked" | "subscribe_only" | null =
    null;
  @state() private canPurchase = true;
  @state() private planOffered = false;
  @state() private planLabel = "";
  @state() private planUsdc = "0";
  @state() private writerAddress = "";
  @state() private subscriptionBusy = false;

  @state() private urlCopied = false;
  @state() private checkoutOpen = false;
  @state() private showMetaMaskHelp = false;

  private walletManager = new WalletManager();
  private unlockService: UnlockService | OnchainUnlockService = new UnlockService();
  private isOnchain = false;
  private unsubWallet?: () => void;
  private checkoutPopup: Window | null = null;
  private loadingSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  private onCheckoutMessage = (event: MessageEvent) => {
    void this.handleCheckoutMessage(event);
  };
  /** Safari back/forward cache can freeze the page mid-checkout with buttons stuck. */
  private onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted && !this.checkoutOpen) return;
    this.checkoutOpen = false;
    this.checkoutPopup = null;
    if (this.unlocked) return;
    this.loading = false;
    this.clearLoadingSafetyTimer();
    if (this.fiatSession) {
      void this.verifyFiatAccess();
    } else {
      this.restoreFiatSession();
    }
  };

  override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.onCheckoutMessage);
    window.addEventListener("pageshow", this.onPageShow);
    this.unsubWallet = this.walletManager.subscribe((s) => {
      this.wallet = s;
      void this.refreshPlanAndAccess();
      if (this.isOnchain) {
        void this.verifyOnchain();
      } else {
        this.checkAccess();
      }
    });
    this.loadArticle();
    this.consumeFiatReturnParams();
    this.restoreFiatSession();
    void this.refreshPlanAndAccess();
  }

  /** After mobile same-tab checkout, article URL includes mon_fiat_session. */
  private consumeFiatReturnParams() {
    const returned = readFiatReturnFromLocation();
    if (!returned) return;
    if (this.articleId && returned.articleId !== this.articleId.trim()) {
      return;
    }
    this.persistFiatSession(returned.fiatSession);
    clearFiatReturnParams();
    // Do not rely only on localStorage restore — Safari private mode / quota
    // can fail writes while this.fiatSession is already set in memory.
    void this.verifyFiatAccess();
  }

  private fiatStorageKey(articleId: string) {
    return `mon-fiat-session:${articleId}`;
  }

  private restoreFiatSession() {
    if (!this.articleId || typeof localStorage === "undefined") return;
    try {
      const token = localStorage.getItem(this.fiatStorageKey(this.articleId));
      if (token) {
        const alreadyLoaded = this.fiatSession === token;
        this.fiatSession = token;
        // consumeFiatReturnParams may have already started verify for this token.
        if (!alreadyLoaded) void this.verifyFiatAccess();
      }
    } catch {
      /* ignore */
    }
  }

  private persistFiatSession(token: string) {
    this.fiatSession = token;
    if (!this.articleId || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(this.fiatStorageKey(this.articleId), token);
    } catch {
      /* ignore */
    }
  }

  private clearLoadingSafetyTimer() {
    if (this.loadingSafetyTimer != null) {
      clearTimeout(this.loadingSafetyTimer);
      this.loadingSafetyTimer = null;
    }
  }

  private armLoadingSafetyTimer(message: string) {
    this.clearLoadingSafetyTimer();
    this.loadingSafetyTimer = setTimeout(() => {
      this.loadingSafetyTimer = null;
      if (!this.loading || this.unlocked) return;
      this.loading = false;
      this.checkoutOpen = false;
      this.error = message;
    }, 20_000);
  }

  /** Status line after unlock — must never throw (fiat has no wallet address). */
  private unlockedStatusLabel(): string {
    if (this.wallet.address) return truncateAddress(this.wallet.address);
    if (this.fiatSession) return "Card / Apple Pay";
    return "Paid";
  }

  /** Fiat (Stripe) entitlement — no wallet required. */
  private async verifyFiatAccess() {
    if (!this.article || !this.fiatSession) return;
    this.loading = true;
    this.error = null;
    this.checkoutOpen = false;
    this.armLoadingSafetyTimer("Unlock is taking too long. Pull to refresh and try again.");
    try {
      const slotted = this.slotHtml("body");
      const ok = await this.fetchBodyIfNeeded({ fiatSession: this.fiatSession, maxAttempts: 4 });
      if (ok || slotted) {
        this.unlocked = true;
        this.emit("mon:unlocked", {
          article: this.article,
          record: {
            articleId: this.article.id,
            wallet: null,
            unlockedAt: Date.now(),
            mode: "fiat" as const,
            fiatSession: this.fiatSession,
          },
        });
      } else {
        this.error = "Payment received, but the article could not be loaded. Refresh and try again.";
      }
    } finally {
      this.clearLoadingSafetyTimer();
      this.loading = false;
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this.onCheckoutMessage);
    window.removeEventListener("pageshow", this.onPageShow);
    this.clearLoadingSafetyTimer();
    this.closeCheckoutUi();
    this.unsubWallet?.();
  }

  override updated(changed: Map<string, unknown>) {
    if (
      changed.has("articleId") ||
      changed.has("title") ||
      changed.has("author") ||
      changed.has("price") ||
      changed.has("unlockContract") ||
      changed.has("paymentAsset") ||
      changed.has("embedSig")
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

  private renderBody(body: string) {
    if (!body) return nothing;
    if (looksLikeHtml(body)) {
      return html`<div class="mon-body text-black">${unsafeHTML(sanitizeRichHtml(body))}</div>`;
    }
    return html`<div class="mon-body text-black whitespace-pre-wrap">${body}</div>`;
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
      this.bindOnchainProvider();
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
   *  @returns true when body was fetched or already present / slotted.
   */
  private async fetchBodyIfNeeded(opts?: {
    fiatSession?: string;
    maxAttempts?: number;
  }): Promise<boolean> {
    if (!this.article) return false;
    if (this.fetchedBody) return true;
    const slottedBody = this.slotHtml("body");
    if (slottedBody) return true; // already have body from the embed — no need to fetch

    const fiatSession = opts?.fiatSession || this.fiatSession;
    const reader = this.wallet.address;
    if (!fiatSession && !reader) return false;

    const apiBase = "https://flczjqljgntmkanipugo.supabase.co/functions/v1";
    const anonKey =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4";

    const params = new URLSearchParams({
      article_id: this.article.id,
    });
    if (reader) params.set("reader", reader);
    if (fiatSession) params.set("fiat_session", fiatSession);
    if (this.unlockContract?.trim()) {
      params.set("unlock_contract", this.unlockContract.trim());
    }

    const cdnUrl = `${getCheckoutBaseUrl()}/api/article-body?${params.toString()}`;
    const edgeUrl = `${apiBase}/article-body?${params.toString()}`;
    const maxAttempts = Math.max(1, opts?.maxAttempts ?? (fiatSession ? 4 : 10));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), 8_000);
        let res: Response;
        try {
          res = await fetch(cdnUrl, { signal: controller.signal });
          if (!res.ok) {
            res = await fetch(edgeUrl, {
              signal: controller.signal,
              headers: {
                apikey: anonKey,
                Authorization: `Bearer ${anonKey}`,
              },
            });
          }
        } finally {
          clearTimeout(abortTimer);
        }

        if (res.ok) {
          const data = (await res.json()) as { body?: string };
          if (data.body) {
            this.fetchedBody = data.body;
          }
          return true;
        }

        if (res.status !== 403) {
          console.warn("[mon-unlock] article-body fetch returned", res.status);
          return false;
        }
      } catch (e) {
        if (attempt === maxAttempts - 1) {
          console.warn("[mon-unlock] failed to fetch body after unlock", e);
          return false;
        }
      }

      const delay = Math.floor(300 * Math.pow(1.5, attempt));
      await new Promise((r) => setTimeout(r, delay));
    }
    console.warn("[mon-unlock] exhausted retries fetching body after unlock");
    return false;
  }

  private writerForPlan(): string {
    const fromAttr = (this.publisher || "").trim().toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(fromAttr)) return fromAttr;
    return this.writerAddress;
  }

  private async refreshPlanAndAccess() {
    const writer = this.writerForPlan();
    if (writer) {
      try {
        const res = await fetch(`${getCheckoutBaseUrl()}/api/writers/${writer}/plan`);
        if (res.ok) {
          const data = (await res.json()) as {
            plan?: {
              offered?: boolean;
              monthlyPriceLabel?: string;
              monthlyPriceUsdc?: string;
              allowALaCarte?: boolean;
              publisher?: string;
            };
          };
          const plan = data.plan;
          this.planOffered = Boolean(plan?.offered);
          this.planLabel = plan?.monthlyPriceLabel || this.subscriptionPrice || "";
          this.planUsdc = plan?.monthlyPriceUsdc || "0";
          this.writerAddress = plan?.publisher || writer;
          if (this.allowALaCarteAttr !== "false" && plan?.allowALaCarte === false) {
            this.canPurchase = false;
          }
        }
      } catch {
        /* plan optional */
      }
    }
    if (this.allowALaCarteAttr === "false") this.canPurchase = false;
    await this.applyServerAccess();
  }

  private async applyServerAccess() {
    if (!this.article?.id) return;
    const reader = this.wallet.address;
    if (!reader && !this.fiatSession) return;
    try {
      const params = new URLSearchParams({ article_id: this.article.id });
      if (reader) params.set("reader", reader);
      if (this.fiatSession) params.set("fiat_session", this.fiatSession);
      const res = await fetch(`${getCheckoutBaseUrl()}/api/access?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        allowed?: boolean;
        reason?: "purchase" | "subscription" | "locked" | "subscribe_only";
        canPurchase?: boolean;
        writer?: string;
        plan?: { offered?: boolean; monthlyPriceLabel?: string; monthlyPriceUsdc?: string };
      };
      this.accessReason = data.reason || null;
      if (typeof data.canPurchase === "boolean") this.canPurchase = data.canPurchase;
      if (data.writer) this.writerAddress = data.writer;
      if (data.plan) {
        this.planOffered = Boolean(data.plan.offered);
        this.planLabel = data.plan.monthlyPriceLabel || this.planLabel;
        this.planUsdc = data.plan.monthlyPriceUsdc || this.planUsdc;
      }
      if (data.allowed) {
        this.unlocked = true;
        void this.fetchBodyIfNeeded();
      } else if (this.accessReason === "locked" || this.accessReason === "subscribe_only") {
        // Server says no live sub and no purchase — do not keep a stale unlocked view.
        if (!this.fiatSession) this.unlocked = false;
      }
    } catch {
      /* keep local/on-chain result */
    }
  }

  private async subscribeWithCard() {
    const reader = this.wallet.address;
    const writer = this.writerForPlan();
    if (!reader) {
      this.error = "Sign in or connect a wallet to subscribe.";
      return;
    }
    if (!writer) {
      this.error = "This writer has no subscription plan yet.";
      return;
    }
    this.subscriptionBusy = true;
    this.error = null;
    try {
      const returnUrl = window.location.href;
      const res = await fetch(`${getCheckoutBaseUrl()}/api/subscriptions/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reader,
          writer,
          successUrl: returnUrl,
          cancelUrl: returnUrl,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start subscription.");
      window.location.assign(data.url);
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Could not start card subscription.";
    } finally {
      this.subscriptionBusy = false;
    }
  }

  private async subscribeWithUsdc() {
    const reader = this.wallet.address;
    const writer = this.writerForPlan();
    if (!reader || !writer) {
      this.error = "Connect a wallet to subscribe with USDC.";
      return;
    }
    this.subscriptionBusy = true;
    this.error = null;
    try {
      if (!this.wallet.connected) {
        await this.walletManager.connect();
      }
      this.bindOnchainProvider();
      await this.walletManager.ensureChain(monadMainnet);
      const provider = this.walletManager.getProvider();
      if (!provider) throw new Error("No wallet provider.");
      const price = this.planUsdc && this.planUsdc !== "0" ? BigInt(this.planUsdc) : parseUsdAmount("5");
      const contract = resolveSubscriptionContract();
      const txHash = contract
        ? await subscribeOnchain({
            provider,
            contract,
            reader: reader as Address,
            writer: writer as Address,
            priceUsdc: price,
          })
        : await transferUsdcToWriter({
            provider,
            reader: reader as Address,
            writer: writer as Address,
            priceUsdc: price,
          });
      const confirm = await fetch(`${getCheckoutBaseUrl()}/api/subscriptions/crypto/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reader, writer, txHash }),
      });
      const body = (await confirm.json()) as { error?: string };
      if (!confirm.ok) throw new Error(body.error || "Subscription payment was not recorded.");
      await this.applyServerAccess();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "USDC subscribe failed.";
    } finally {
      this.subscriptionBusy = false;
    }
  }

  private renderSubscribeActions() {
    if (!this.planOffered && !this.subscriptionPrice) return nothing;
    const label = this.planLabel || (this.subscriptionPrice ? `$${this.subscriptionPrice}/mo` : "Subscribe");
    return html`
      <div class="mon-sub-actions" style="margin-top:0.75rem;">
        <p class="text-sm font-medium text-stone-800 dark:text-stone-200" style="margin:0 0 0.5rem;">
          Subscribe to this writer · ${label}
        </p>
        <div class="mon-unlock-actions">
          <button
            type="button"
            class="mon-btn mon-btn-primary"
            ?disabled=${this.subscriptionBusy || this.loading}
            @click=${() => this.subscribeWithCard()}
          >
            ${this.subscriptionBusy ? "Working…" : "Subscribe with card"}
          </button>
          <button
            type="button"
            class="mon-btn mon-btn-secondary"
            ?disabled=${this.subscriptionBusy || this.loading}
            @click=${() => this.subscribeWithUsdc()}
          >
            Subscribe with USDC
          </button>
        </div>
      </div>
    `;
  }

  private emit(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private isMobileViewport(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
    // iPadOS 13+ often reports as Macintosh.
    if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)) return true;
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
      return true;
    }
    return false;
  }

  private closeCheckoutUi() {
    this.checkoutOpen = false;
    if (this.checkoutPopup && !this.checkoutPopup.closed) {
      try {
        this.checkoutPopup.close();
      } catch {
        /* ignore */
      }
    }
    this.checkoutPopup = null;
  }

  private async handleCheckoutMessage(event: MessageEvent) {
    if (!isCheckoutMessage(event.data)) return;
    if (!this.article) return;

    // Only accept messages for this article.
    if (event.data.articleId !== this.article.id) return;

    // Origin must match our checkout host.
    let expectedOrigin: string;
    try {
      expectedOrigin = new URL(buildCheckoutUrl({
        articleId: this.article.id,
        title: this.article.title,
        price: this.price,
        contract: this.unlockContract.trim(),
        embedSig: this.embedSig,
        parentOrigin: window.location.origin,
        paymentAsset: resolvePaymentAsset({
          explicit: this.paymentAsset,
          contract: this.unlockContract.trim(),
        }),
      })).origin;
    } catch {
      return;
    }
    if (event.origin !== expectedOrigin) return;

    if (event.data.type === "mon:checkout-closed") {
      this.closeCheckoutUi();
      return;
    }

    // mon:unlocked — fiat session or on-chain wallet.
    this.closeCheckoutUi();
    this.loading = true;
    this.error = null;
    this.armLoadingSafetyTimer("Unlock is taking too long. Pull to refresh and try again.");
    try {
      if (event.data.fiatSession) {
        this.persistFiatSession(event.data.fiatSession);
        const slotted = this.slotHtml("body");
        const ok = await this.fetchBodyIfNeeded({
          fiatSession: event.data.fiatSession,
          maxAttempts: 4,
        });
        if (!ok && !slotted) {
          this.error = "Payment received, but article is not available yet. Refresh in a moment.";
          this.unlocked = false;
          return;
        }
        this.unlocked = true;
        this.emit("mon:unlocked", {
          article: this.article,
          record: {
            articleId: this.article.id,
            wallet: null,
            unlockedAt: Date.now(),
            mode: "fiat" as const,
            fiatSession: event.data.fiatSession,
          },
        });
        return;
      }

      const address = event.data.address;
      if (!address) {
        this.error = "Unlock message missing wallet or session.";
        return;
      }
      this.wallet = { connected: true, address };
      if (event.data.txHash) this.txHash = event.data.txHash;

      if (this.isOnchain) {
        const ok = await (this.unlockService as OnchainUnlockService).checkOnchainAccess(
          this.article.id,
          address
        );
        if (!ok) {
          this.error =
            "Payment received, but unlock is not visible yet. Tap Continue again in a moment.";
          this.unlocked = false;
          return;
        }
        this.unlocked = true;
        await this.fetchBodyIfNeeded();
      } else {
        this.unlocked = true;
      }
      this.emit("mon:unlocked", {
        article: this.article,
        record: {
          articleId: this.article.id,
          wallet: address,
          unlockedAt: Date.now(),
          mode: "onchain" as const,
          txHash: event.data.txHash,
        },
      });
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Could not confirm unlock.";
    } finally {
      this.clearLoadingSafetyTimer();
      this.loading = false;
    }
  }

  private openPrivyCheckout() {
    if (!this.article) return;
    if (!this.isOnchain || !this.unlockContract.trim()) {
      // Demo mode: fall back to existing connect flow.
      void this.connect();
      return;
    }

    this.error = null;
    const url = buildCheckoutUrl({
      articleId: this.article.id,
      title: this.article.title,
      price: this.price,
      contract: this.unlockContract.trim(),
      embedSig: this.embedSig,
      parentOrigin: window.location.origin,
      returnUrl: window.location.href,
      paymentAsset: resolvePaymentAsset({
        explicit: this.paymentAsset,
        contract: this.unlockContract.trim(),
      }),
    });

    // Mobile: same-tab navigation so Apple Pay can return to the article reliably.
    // Desktop: popup when allowed; fall back to same-tab if blocked.
    if (this.isMobileViewport()) {
      this.checkoutOpen = true;
      window.location.assign(url);
      return;
    }

    this.checkoutOpen = true;
    const popup = window.open(
      url,
      "mon-unlock-checkout",
      "popup=yes,width=420,height=720,noopener=no"
    );
    if (!popup) {
      window.location.assign(url);
      return;
    }
    this.checkoutPopup = popup;
  }

  private startMetaMaskPath() {
    const inWalletBrowser = hasReliableInjectedProvider();
    if (this.isMobileViewport() && !inWalletBrowser) {
      this.showMetaMaskHelp = true;
      return;
    }
    this.showMetaMaskHelp = false;
    void this.connect();
  }

  private priceDisplay(): { amount: string; unit: string; label: string } {
    const asset = resolvePaymentAsset({
      explicit: this.paymentAsset,
      contract: this.unlockContract.trim(),
    });
    const amount =
      asset === "usdc"
        ? this.price
        : this.article
          ? formatMon(this.article.priceMon)
          : this.price;
    const unit = asset === "usdc" ? "USDC" : "MON";
    return { amount, unit, label: `${amount} ${unit}` };
  }

  private renderUnlockActions() {
    const onchain = this.isOnchain;
    const { label: priceLabel } = this.priceDisplay();

    // Demo mode: single connect button (simulated unlock).
    if (!onchain) {
      return html`
        ${this.canPurchase
          ? html`
              <button
                class="mon-btn mon-btn-primary"
                ?disabled=${this.loading}
                @click=${() => this.connect()}
              >
                ${this.loading ? "Connecting…" : "Connect wallet to unlock"}
              </button>
            `
          : nothing}
        ${this.renderSubscribeActions()}
      `;
    }

    return html`
      <div class="mon-unlock-actions">
        ${this.canPurchase
          ? html`
              <button
                type="button"
                class="mon-btn mon-btn-primary"
                ?disabled=${this.loading || this.checkoutOpen}
                @click=${() => this.openPrivyCheckout()}
              >
                ${this.checkoutOpen
                  ? "Checkout open…"
                  : this.loading
                    ? "Unlocking…"
                    : `Pay ${priceLabel}`}
              </button>

              <button
                type="button"
                class="mon-btn mon-btn-secondary"
                ?disabled=${this.loading || this.checkoutOpen}
                @click=${() => this.startMetaMaskPath()}
              >
                Use MetaMask
              </button>
            `
          : nothing}

        ${this.showMetaMaskHelp
          ? html`
              <div class="mon-metamask-hint mt-3">
                <p class="text-sm font-medium text-stone-800 dark:text-stone-200">
                  Open this page in MetaMask
                </p>
                <p class="mt-1 text-xs text-stone-600 dark:text-stone-400">
                  On mobile, MetaMask works best inside its browser. Copy the link, then paste it in
                  MetaMask → Browser.
                </p>
                <ol class="mon-metamask-steps">
                  <li>Copy page link</li>
                  <li>Open MetaMask → Browser</li>
                  <li>Paste the link and load this page</li>
                  <li>Tap Use MetaMask again</li>
                </ol>
                <button
                  type="button"
                  class="mon-btn mon-btn-primary"
                  @click=${() => this.copyPageUrl()}
                >
                  ${this.urlCopied ? "Link copied!" : "Copy page link"}
                </button>
              </div>
            `
          : nothing}
      </div>
      ${this.renderSubscribeActions()}
    `;
  }

  private async copyPageUrl(): Promise<void> {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    this.urlCopied = true;
    window.setTimeout(() => {
      this.urlCopied = false;
    }, 2500);
  }

  private bindOnchainProvider() {
    if (!this.isOnchain) return;
    const provider = this.walletManager.getProvider();
    if (provider) {
      (this.unlockService as OnchainUnlockService).setProvider(provider);
    }
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
      this.bindOnchainProvider();

      // Ensure wallet is on Monad for on-chain payments (skip if already there).
      if (this.isOnchain) {
        try {
          await this.walletManager.ensureChain(monadMainnet);
        } catch (chainErr) {
          const msg =
            chainErr instanceof Error ? chainErr.message : "Could not switch to Monad network.";
          throw new Error(msg);
        }
      }

      const address = s.address!;

      // Decide whether payment is needed.
      // On-chain mode: authoritative check against the contract.
      // Demo mode: check local cache only.
      await this.applyServerAccess();
      if (this.unlocked) {
        await this.fetchBodyIfNeeded();
        this.emit("mon:connected", s);
        return;
      }
      if (!this.canPurchase) {
        throw new Error("This article is subscribe-only. Subscribe to the writer to read it.");
      }

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
        const asset = resolvePaymentAsset({
          explicit: this.paymentAsset,
          contract: this.unlockContract.trim(),
        });
        const onchain = this.unlockService as OnchainUnlockService;
        const record =
          asset === "usdc" && this.isOnchain
            ? await onchain.unlockWithUsdc(
                this.article.id,
                address,
                parseUsdAmount(this.price),
                this.embedSig || undefined
              )
            : await this.unlockService.unlock(
                this.article.id,
                address,
                this.article.priceMon,
                this.embedSig || undefined
              );
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
    const asset = resolvePaymentAsset({
      explicit: this.paymentAsset,
      contract: this.unlockContract.trim(),
    });
    const { label: priceLabel } = this.priceDisplay();
    const paidLine = this.txHash
      ? html`· <a href="https://monadvision.com/tx/${this.txHash}" target="_blank" class="underline">Paid ${priceLabel} ↗</a>`
      : html`· Paid ${priceLabel}`;

    return html`
      <article class="mon-card ${classMap({ dark: this.theme === "dark" })}">
        <header class="border-b border-stone-100 px-6 py-5 dark:border-zinc-800">
          <p class="mon-badge mb-2">
            ${this.canPurchase
              ? asset === "usdc"
                ? "Unlock with USDC or card"
                : "Unlock with MON or card"
              : "Subscribe to this writer"}
          </p>
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
                ${this.renderBody(this.fetchedBody || a.body)}
                <p class="mt-6 text-xs text-black">
                  ${this.accessReason === "subscription"
                    ? "Unlocked with subscription"
                    : "Unlocked"}
                  · ${this.unlockedStatusLabel()}
                  ${this.accessReason === "subscription" ? nothing : paidLine}
                </p>
              `
            : html`
                <div class="mon-title-box whitespace-pre-wrap">${a.teaser}</div>
                <div class="mt-6 rounded-xl border border-violet-100 bg-violet-50/80 p-5 dark:border-violet-900/40 dark:bg-violet-950/30">
                  ${this.isOnchain
                    ? nothing
                    : html`<p class="mb-3 text-xs text-stone-500">Demo: connect wallet to read the rest (payment simulated).</p>`}
                  <div>${this.renderUnlockActions()}</div>
                </div>
              `}
        </div>
      </article>
    `;
  }
}

/**
 * Open Paywall alias — same component, second tag name.
 * Custom Elements require a distinct constructor per tag, so subclass.
 */
@customElement("open-paywall")
export class OpenPaywall extends MonUnlock {}

declare global {
  interface HTMLElementTagNameMap {
    "mon-unlock": MonUnlock;
    "open-paywall": OpenPaywall;
  }
}
