/**
 * Free per-writer Follow button.
 * The button renders for every valid writer wallet. It stays hidden when the
 * viewer is that writer (follower token, connected wallet, or injected account).
 * Email follow stays hidden while /api/follows/config says email is off.
 * With no follower token, Follow connects a wallet, signs the existing
 * "Open Paywall follower v1" message, then POSTs /api/follows/wallet.
 * Injected wallets use eth_requestAccounts. Otherwise the article unlock
 * bundle (WalletManager) is loaded on tap.
 */
(function () {
  const TOKEN_KEY = "opw_follower";
  // Same WalletConnect project id the article unlock widget uses.
  const WALLETCONNECT_PROJECT_ID = "c2a289e11ad2998f8ea4633db536334c";
  let emailEnabled = null;
  let following = null;
  let configPromise = null;

  function injectCss() {
    if (document.getElementById("opw-follow-css")) return;
    const style = document.createElement("style");
    style.id = "opw-follow-css";
    style.textContent = `
      .opw-follow-wrap { position: relative; z-index: 1; display: inline-flex; align-items: center; }
      .opw-follow {
        position: relative; z-index: 1;
        appearance: none; border: 0; cursor: pointer;
        font: inherit; font-size: 0.75rem; font-weight: 600;
        border-radius: 999px; padding: 0.2rem 0.65rem; line-height: 1.4;
        background: #0f766e; color: #fff;
      }
      .opw-follow:focus-visible { outline: 2px solid #0f766e; outline-offset: 2px; }
      .opw-follow:disabled { cursor: progress; opacity: 0.7; }
      .opw-follow.is-on { background: #f5f5f4; color: #115e59; }
      .opw-follow.is-on .off { display: none; }
      .opw-follow.is-on:hover .on, .opw-follow.is-on:focus .on { display: none; }
      .opw-follow.is-on:hover .off, .opw-follow.is-on:focus .off { display: inline; }
      .opw-follow.is-quiet { background: transparent; color: #0f766e; padding-left: 0; }
      .opw-popover {
        position: relative; z-index: 2;
        display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;
        margin-top: 0.35rem;
      }
      .opw-popover input[type="email"] {
        font: inherit; font-size: 0.85rem; padding: 0.35rem 0.55rem;
        border: 1px solid #e7e5e4; border-radius: 8px; min-width: 12rem;
      }
      .opw-note { flex-basis: 100%; margin: 0; font-size: 0.75rem; color: #57534e; }
      .opw-note a { color: #0f766e; }
      .opw-error { color: #b91c1c; }
      .opw-prompt {
        margin-top: 1.25rem; padding: 1rem 0; border-top: 1px solid #e7e5e4;
      }
      .opw-prompt p { margin: 0 0 0.6rem; color: #57534e; }
    `;
    document.head.appendChild(style);
  }

  function token() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
    following = null;
  }

  function readTokenWallet() {
    const raw = token();
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return "";
    try {
      const data = JSON.parse(atob(raw.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/")));
      if (data && data.kind === "wallet" && typeof data.id === "string") return data.id.toLowerCase();
    } catch {
      return "";
    }
    return "";
  }

  function isWriter(writer, wallet) {
    const next = String(wallet || "").toLowerCase();
    return Boolean(next) && next === writer;
  }

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/follows/config")
        .then((res) => (res.ok ? res.json() : { email: false }))
        .then((data) => {
          emailEnabled = Boolean(data && data.email);
          return emailEnabled;
        })
        .catch(() => {
          emailEnabled = false;
          return false;
        });
    }
    return configPromise;
  }

  async function loadFollowing() {
    if (following) return following;
    const bearer = token();
    if (!bearer) {
      following = new Set();
      return following;
    }
    try {
      const res = await fetch("/api/follows/me", {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      if (!res.ok) {
        following = new Set();
        return following;
      }
      const data = await res.json();
      following = new Set((data.following || []).map((w) => String(w).toLowerCase()));
    } catch {
      following = new Set();
    }
    return following;
  }

  function followerOrigin() {
    return location.hostname === "www.openpaywall.app" ? "openpaywall.app" : location.hostname;
  }

  function followerMessage(wallet, issuedAt) {
    return [
      "Open Paywall follower v1",
      "chain:143",
      `wallet:${String(wallet || "").toLowerCase()}`,
      `origin:${followerOrigin()}`,
      `issuedAt:${issuedAt}`,
    ].join("\n");
  }

  function utf8ToHex(text) {
    const bytes = new TextEncoder().encode(text);
    let hex = "0x";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  }

  function errorBits(err) {
    const parts = [];
    let cur = err;
    for (let i = 0; cur && i < 4; i++) {
      if (cur.code != null) parts.push(String(cur.code));
      if (cur.name) parts.push(String(cur.name));
      if (cur.message) parts.push(String(cur.message));
      cur = cur.cause;
    }
    return parts.join(" ").toLowerCase();
  }

  function cancelled(err) {
    const text = errorBits(err);
    if (text.includes("4001") || text.includes("action_rejected") || text.includes("userrejected")) return true;
    return /user rejected|user denied|user cancelled|user canceled|rejected the request|request reset|modal closed|closed the modal|connection declined|disapproved/.test(
      text
    );
  }

  function missingWallet(err) {
    if (err && err.code === "no_wallet") return true;
    const text = errorBits(err);
    return (
      text.includes("no_wallet") ||
      text.includes("install a web3 wallet") ||
      text.includes("no account") ||
      text.includes("no wallet")
    );
  }

  function noWalletError() {
    const err = new Error("no_wallet");
    err.code = "no_wallet";
    return err;
  }

  function injectedProvider() {
    const eth = window.ethereum;
    if (eth && typeof eth.request === "function") return eth;
    return null;
  }

  async function readAccounts(provider, method) {
    const accounts = await provider.request({ method });
    return Array.isArray(accounts) ? accounts : [];
  }

  async function silentViewerWallet() {
    const injected = injectedProvider();
    if (!injected) return "";
    try {
      const accounts = await readAccounts(injected, "eth_accounts");
      return String(accounts[0] || "").toLowerCase();
    } catch {
      return "";
    }
  }

  async function connectInjected(provider) {
    let accounts = [];
    try {
      accounts = await readAccounts(provider, "eth_accounts");
    } catch {
      accounts = [];
    }
    if (!accounts[0]) accounts = await readAccounts(provider, "eth_requestAccounts");
    if (!accounts[0]) throw noWalletError();
    return { address: String(accounts[0]), provider };
  }

  async function connectReaderWallet() {
    const injected = injectedProvider();
    if (injected) return connectInjected(injected);

    let mod;
    try {
      mod = await import("/dist/openpaywall.js");
    } catch {
      throw noWalletError();
    }
    const Manager = mod && mod.WalletManager;
    if (typeof Manager !== "function") throw noWalletError();
    const manager = new Manager();
    if (typeof manager.setWalletConnectProjectId === "function") {
      manager.setWalletConnectProjectId(WALLETCONNECT_PROJECT_ID);
    }
    const state = await manager.connect();
    const address = state && state.address;
    const provider = typeof manager.getProvider === "function" ? manager.getProvider() : null;
    if (!address || !provider) throw noWalletError();
    return { address: String(address), provider };
  }

  async function signFollower(wallet, provider) {
    const eth = provider || window.ethereum;
    if (!eth || !wallet) throw noWalletError();
    const issuedAt = new Date().toISOString();
    const origin = followerOrigin();
    const message = followerMessage(wallet, issuedAt);
    const sig = await eth.request({
      method: "personal_sign",
      params: [utf8ToHex(message), wallet],
    });
    const res = await fetch("/api/follows/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, issuedAt, sig, origin }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const err = new Error("rate_limited");
      err.code = "rate_limited";
      throw err;
    }
    if (!res.ok || !data.followerToken) throw new Error(data.error || "session_failed");
    saveToken(data.followerToken);
    return data.followerToken;
  }

  function buttonLabel(state) {
    if (state === "following") {
      return `<span class="on">Following ✓</span><span class="off">Unfollow</span>`;
    }
    if (state === "pending") return "Check your inbox";
    return "Follow";
  }

  function readCount(el) {
    if (el.dataset && el.dataset.followers !== undefined && el.dataset.followers !== "") {
      const parsed = Number(el.dataset.followers);
      if (Number.isFinite(parsed)) return parsed;
    }
    const match = String(el.textContent || "").match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function bumpFollowerCount(writer, delta) {
    const nodes = [];
    const pageCount = document.getElementById("followerCount");
    if (pageCount) nodes.push(pageCount);
    document.querySelectorAll(".followers[data-writer]").forEach((el) => {
      if ((el.getAttribute("data-writer") || "").toLowerCase() === writer) nodes.push(el);
    });
    for (const el of nodes) {
      const next = Math.max(0, readCount(el) + delta);
      el.dataset.followers = String(next);
      el.textContent = next === 1 ? "1 follower" : `${next} followers`;
    }
    const first = document.getElementById("firstLine");
    if (first && pageCount) first.hidden = readCount(pageCount) !== 0;
  }

  function applyState(node, state, authorName) {
    node.classList.toggle("is-on", state === "following");
    node.innerHTML = buttonLabel(state);
    node.setAttribute("aria-pressed", state === "following" ? "true" : "false");
    node.setAttribute("aria-label", state === "following" ? `Unfollow ${authorName}` : `Follow ${authorName}`);
  }

  async function mount(container, options) {
    if (!container) return;
    injectCss();
    const writer = String(options.writer || "").toLowerCase();
    const author = options.author || "this writer";
    const via = options.via || "feed";
    if (!/^0x[a-f0-9]{40}$/.test(writer)) {
      container.replaceChildren();
      return;
    }
    if (isWriter(writer, readTokenWallet()) || isWriter(writer, options.connectedWallet)) {
      container.replaceChildren();
      return;
    }
    if (isWriter(writer, await silentViewerWallet())) {
      container.replaceChildren();
      return;
    }
    await loadConfig();
    const set = await loadFollowing();
    const canEmail = emailEnabled === true;

    const wrap = document.createElement("span");
    wrap.className = "opw-follow-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opw-follow" + (options.primary === false ? " is-quiet" : "");
    btn.dataset.writer = writer;
    btn.dataset.author = author;
    const pop = document.createElement("span");
    pop.className = "opw-popover";
    pop.hidden = true;
    let signingProvider = null;

    function paint(state) {
      applyState(btn, state, author);
    }

    function syncButtons(state) {
      document.querySelectorAll(`button.opw-follow[data-writer="${writer}"]`).forEach((node) => {
        applyState(node, state, node.dataset.author || author);
      });
    }

    function showError(message) {
      pop.hidden = false;
      pop.innerHTML = "";
      const note = document.createElement("p");
      note.className = "opw-note opw-error";
      note.textContent = message;
      pop.appendChild(note);
    }

    function showEmailForm(prefill) {
      pop.hidden = false;
      pop.innerHTML = "";
      const input = document.createElement("input");
      input.type = "email";
      input.required = true;
      input.autocomplete = "email";
      input.placeholder = "you@email.com";
      input.setAttribute("aria-label", "Email");
      if (prefill) input.value = prefill;
      const go = document.createElement("button");
      go.type = "button";
      go.className = "opw-follow";
      go.textContent = "Follow";
      const note = document.createElement("p");
      note.className = "opw-note";
      note.append(`Free. ${author} will see your email. Unsubscribe anytime. `);
      const privacy = document.createElement("a");
      privacy.href = "/privacy";
      privacy.textContent = "Privacy";
      note.appendChild(privacy);
      pop.append(input, go, note);
      go.addEventListener("click", () => submitEmail(input.value, go));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitEmail(input.value, go);
        }
      });
    }

    async function submitEmail(value, go) {
      go.disabled = true;
      const res = await fetch("/api/follows/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writer, email: value, via }),
      });
      const data = await res.json().catch(() => ({}));
      go.disabled = false;
      if (res.status === 429) {
        showError("Too many tries. Try again in a bit.");
        return;
      }
      if (res.status === 503) {
        showError("Email follow is not available yet.");
        return;
      }
      if (!res.ok) {
        showError("Check the email address and try again.");
        return;
      }
      if (data.status === "check_inbox") paint("pending");
      pop.hidden = true;
    }

    function release() {
      if (btn.isConnected) btn.disabled = false;
    }

    async function followWithToken() {
      btn.disabled = true;
      try {
        let bearer = token();
        const connected = options.connectedWallet && String(options.connectedWallet).toLowerCase();
        if (connected && connected !== writer && readTokenWallet() !== connected) {
          try {
            if (!signingProvider && !injectedProvider()) {
              const result = await connectReaderWallet();
              const address = String(result.address || "").toLowerCase();
              if (!/^0x[a-f0-9]{40}$/.test(address)) throw noWalletError();
              if (address === writer) {
                container.replaceChildren();
                return;
              }
              signingProvider = result.provider || null;
              options.connectedWallet = address;
            }
            bearer = await signFollower(String(options.connectedWallet || connected).toLowerCase(), signingProvider);
          } catch (err) {
            if (cancelled(err)) return;
            if (err?.code === "rate_limited" || err?.message === "rate_limited") {
              showError("Too many tries. Try again in a bit.");
              return;
            }
            if (canEmail) {
              showEmailForm(options.prefillEmail || "");
              return;
            }
            if (missingWallet(err)) {
              showError("No wallet found in this browser.");
              return;
            }
            showError("Could not follow right now.");
            return;
          }
        }
        if (!bearer) {
          if (canEmail) showEmailForm(options.prefillEmail || "");
          return;
        }
        const res = await fetch("/api/follows/wallet", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({ writer, via }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          showError("Too many tries. Try again in a bit.");
          return;
        }
        if (res.status === 400 && data.error === "self_follow") {
          container.replaceChildren();
          return;
        }
        if (!res.ok) {
          if (canEmail) showEmailForm(options.prefillEmail || "");
          else showError("Could not follow right now.");
          return;
        }
        const wasFollowing = set.has(writer);
        set.add(writer);
        syncButtons("following");
        pop.hidden = true;
        if (!wasFollowing) bumpFollowerCount(writer, 1);
        if (canEmail && options.offerEmail) showEmailForm(options.prefillEmail || "");
      } finally {
        release();
      }
    }

    async function connectAndFollow() {
      btn.disabled = true;
      pop.hidden = true;
      pop.replaceChildren();
      try {
        const result = await connectReaderWallet();
        const address = String(result.address || "").toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(address)) throw noWalletError();
        if (address === writer) {
          container.replaceChildren();
          return;
        }
        signingProvider = result.provider || null;
        options.connectedWallet = address;
        await followWithToken();
      } catch (err) {
        if (cancelled(err)) return;
        if (missingWallet(err)) {
          showError("No wallet found in this browser.");
          return;
        }
        showError("Could not connect a wallet.");
      } finally {
        release();
      }
    }

    async function unfollow() {
      const bearer = token();
      if (!bearer) return;
      btn.disabled = true;
      try {
        const res = await fetch("/api/follows/wallet", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({ writer }),
        });
        if (res.status === 429) {
          showError("Too many tries. Try again in a bit.");
          return;
        }
        if (!res.ok) return;
        if (set.has(writer)) {
          set.delete(writer);
          bumpFollowerCount(writer, -1);
        }
        syncButtons("idle");
      } finally {
        release();
      }
    }

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled) return;
      if (btn.classList.contains("is-on")) {
        void unfollow();
        return;
      }
      if (btn.textContent === "Check your inbox") return;
      if (token() || options.connectedWallet) {
        void followWithToken();
        return;
      }
      if (canEmail) {
        showEmailForm(options.prefillEmail || "");
        return;
      }
      void connectAndFollow();
    });

    paint(set.has(writer) ? "following" : "idle");
    wrap.append(btn, pop);
    container.replaceChildren(wrap);
    if (options.openEmail && canEmail && !set.has(writer)) {
      showEmailForm(options.prefillEmail || "");
    }
  }

  window.OpenPaywallFollow = {
    mount,
    saveToken,
    token,
    loadConfig,
  };
})();
