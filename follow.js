/**
 * Free per-writer Follow button.
 * Email path hides when /api/follows/config says email is off.
 * Feed and writer pages do not load a wallet; they use a stored follower token.
 * The article page can pass a connected wallet for one signature per device.
 */
(function () {
  const TOKEN_KEY = "opw_follower";
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

  function followerMessage(wallet, issuedAt) {
    const host = location.hostname === "www.openpaywall.app" ? "openpaywall.app" : location.hostname;
    return [
      "Open Paywall follower v1",
      "chain:143",
      `wallet:${String(wallet || "").toLowerCase()}`,
      `origin:${host}`,
      `issuedAt:${issuedAt}`,
    ].join("\n");
  }

  async function signFollower(wallet) {
    const eth = window.ethereum;
    if (!eth || !wallet) throw new Error("no_wallet");
    const issuedAt = new Date().toISOString();
    const origin = location.hostname === "www.openpaywall.app" ? "openpaywall.app" : location.hostname;
    const message = followerMessage(wallet, issuedAt);
    const { createWalletClient, custom } = await import("https://esm.sh/viem@2");
    const walletClient = createWalletClient({
      account: wallet,
      chain: {
        id: 143,
        name: "Monad",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
      },
      transport: custom(eth),
    });
    const sig = await walletClient.signMessage({ account: wallet, message });
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

  async function mount(container, options) {
    if (!container) return;
    injectCss();
    const writer = String(options.writer || "").toLowerCase();
    const author = options.author || "this writer";
    const via = options.via || "feed";
    const allowWallet = Boolean(options.allowWallet);
    if (!/^0x[a-f0-9]{40}$/.test(writer)) {
      container.replaceChildren();
      return;
    }
    if (readTokenWallet() && readTokenWallet() === writer) {
      container.replaceChildren();
      return;
    }
    await loadConfig();
    const set = await loadFollowing();
    const hasWalletToken = Boolean(readTokenWallet());
    const canEmail = emailEnabled === true;
    const canAct = canEmail || hasWalletToken || (allowWallet && options.connectedWallet);
    if (!canAct && !set.has(writer)) {
      container.replaceChildren();
      return;
    }

    const wrap = document.createElement("span");
    wrap.className = "opw-follow-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opw-follow" + (options.primary === false ? " is-quiet" : "");
    const pop = document.createElement("span");
    pop.className = "opw-popover";
    pop.hidden = true;

    function paint(state) {
      btn.classList.toggle("is-on", state === "following");
      btn.innerHTML = buttonLabel(state);
      btn.setAttribute("aria-pressed", state === "following" ? "true" : "false");
      btn.setAttribute(
        "aria-label",
        state === "following" ? `Unfollow ${author}` : `Follow ${author}`
      );
    }

    paint(set.has(writer) ? "following" : "idle");

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

    async function followWithToken() {
      let bearer = token();
      const connected = options.connectedWallet && String(options.connectedWallet).toLowerCase();
      if (allowWallet && connected && connected !== writer && readTokenWallet() !== connected) {
        try {
          bearer = await signFollower(connected);
        } catch (err) {
          if (err?.code === "rate_limited" || err?.message === "rate_limited") {
            showError("Too many tries. Try again in a bit.");
            return;
          }
          if (canEmail) {
            showEmailForm(options.prefillEmail || "");
            return;
          }
          showError("Connect a wallet to follow, or try email.");
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
        return;
      }
      set.add(writer);
      paint("following");
      pop.hidden = true;
      if (canEmail && options.offerEmail) showEmailForm(options.prefillEmail || "");
    }

    async function unfollow() {
      const bearer = token();
      if (!bearer) return;
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
      set.delete(writer);
      paint("idle");
    }

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.classList.contains("is-on")) {
        unfollow();
        return;
      }
      if (btn.textContent === "Check your inbox") return;
      const bearer = token();
      if (bearer) {
        followWithToken();
        return;
      }
      if (allowWallet && options.connectedWallet) {
        followWithToken();
        return;
      }
      if (canEmail) showEmailForm(options.prefillEmail || "");
    });

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
