/**
 * Free per-writer Follow button.
 * The button renders for every valid writer wallet. It is removed (not faded)
 * when the viewer is that writer: follower token, connected wallet, injected
 * account, stored reader session, or Privy / account session.
 * Email follow stays hidden while /api/follows/config says email is off.
 * With no follower token, Follow signs the existing "Open Paywall follower v1"
 * message, then POSTs /api/follows/wallet.
 * An injected wallet uses eth_requestAccounts. Otherwise a tap lazy-loads the
 * same Privy email / embedded-wallet sign-in as /account, which also offers
 * WalletConnect. "No wallet found in this browser." is only the fallback when
 * that sign-in cannot load.
 * The faded look (opacity) is only the in-flight state and is always cleared.
 */
(function () {
  const TOKEN_KEY = "opw_follower";
  const SIGNIN_URL = "/follow-signin.js";
  const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
  let emailEnabled = null;
  let following = null;
  let configPromise = null;
  let peekPromise = null;

  function injectCss() {
    if (document.getElementById("opw-follow-css")) return;
    const style = document.createElement("style");
    style.id = "opw-follow-css";
    style.textContent = `
      .opw-follow-wrap { position: relative; z-index: 3; display: inline-flex; align-items: center; pointer-events: auto; }
      .opw-follow {
        position: relative; z-index: 3;
        appearance: none; border: 0; cursor: pointer; touch-action: manipulation;
        font: inherit; font-size: 0.75rem; font-weight: 600;
        border-radius: 999px; padding: 0.2rem 0.65rem; line-height: 1.4;
        background: #0f766e; color: #fff;
      }
      .opw-follow:focus-visible { outline: 2px solid #0f766e; outline-offset: 2px; }
      /* In-flight only. release() always clears this so it cannot stay faded. */
      .opw-follow:disabled, .opw-follow.is-busy { cursor: progress; opacity: 0.7; }
      .opw-follow.is-on { background: #f5f5f4; color: #115e59; }
      .opw-follow.is-on .off { display: none; }
      .opw-follow.is-on:hover .on, .opw-follow.is-on:focus .on { display: none; }
      .opw-follow.is-on:hover .off, .opw-follow.is-on:focus .off { display: inline; }
      .opw-follow.is-quiet { background: transparent; color: #0f766e; padding-left: 0; }
      .opw-popover {
        position: absolute; z-index: 5; top: calc(100% + 0.35rem); left: 0;
        display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center;
        min-width: 14rem; max-width: 18rem; padding: 0.45rem 0.6rem;
        background: #fff; border: 1px solid #e7e5e4; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      }
      .opw-popover[hidden] { display: none !important; }
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

  function pushWallet(into, value) {
    const next = String(value || "").trim().toLowerCase();
    if (ADDRESS_RE.test(next)) into.add(next);
  }

  function decodeB64UrlJson(segment) {
    try {
      let body = String(segment || "").replace(/-/g, "+").replace(/_/g, "/");
      if (!body) return null;
      const pad = body.length % 4 === 0 ? "" : "=".repeat(4 - (body.length % 4));
      return JSON.parse(atob(body + pad));
    } catch {
      return null;
    }
  }

  function readCookie(name) {
    const parts = String(document.cookie || "").split(";");
    for (const part of parts) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq <= 0 || trimmed.slice(0, eq) !== name) continue;
      const raw = trimmed.slice(eq + 1);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
    return "";
  }

  function walletFromReaderToken(token) {
    const data = decodeB64UrlJson(String(token || "").split(".")[0]);
    if (!data || data.v !== 1) return "";
    const exp = Number(data.exp);
    if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return "";
    const addr = String(data.addr || "").toLowerCase();
    return ADDRESS_RE.test(addr) ? addr : "";
  }

  function addLinkedAccounts(value, into) {
    let accounts = value;
    if (typeof accounts === "string") {
      try {
        accounts = JSON.parse(accounts);
      } catch {
        return;
      }
    }
    if (!Array.isArray(accounts)) return;
    for (const account of accounts) {
      if (!account || typeof account !== "object") continue;
      const type = String(account.type || "").toLowerCase();
      if (type === "wallet" || account.chain_type === "ethereum" || account.chainType === "ethereum") {
        pushWallet(into, account.address);
      }
    }
  }

  function addJwtWallets(raw, into) {
    const token = String(raw || "").trim().replace(/^"|"$/g, "");
    const parts = token.split(".");
    if (parts.length < 2) return;
    const payload = decodeB64UrlJson(parts[1]);
    if (!payload || typeof payload !== "object") return;
    addLinkedAccounts(payload.linked_accounts || payload.linkedAccounts, into);
  }

  function storageGet(storage, key) {
    try {
      return storage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function readReaderSessionWallets(into) {
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (storage) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) || "";
        if (!key.startsWith("op_reader_session:")) continue;
        let data = null;
        try {
          data = JSON.parse(storageGet(storage, key) || "null");
        } catch {
          data = null;
        }
        if (!data || typeof data !== "object") continue;
        const exp = Number(data.expiresAt);
        if (Number.isFinite(exp) && exp <= nowSec + 30) continue;
        pushWallet(into, data.address);
        pushWallet(into, walletFromReaderToken(data.token));
        pushWallet(into, key.split(":").pop());
      }
    }
    pushWallet(into, walletFromReaderToken(readCookie("op_reader")));
  }

  function readPrivyWallets(into) {
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    if (storage) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) || "";
        if (key === "privy:id_token") addJwtWallets(storageGet(storage, key), into);
        else if (key === "privy:connections") {
          let rows = null;
          try {
            rows = JSON.parse(storageGet(storage, key) || "null");
          } catch {
            rows = null;
          }
          if (Array.isArray(rows)) {
            for (const row of rows) {
              if (row && typeof row === "object") pushWallet(into, row.address);
            }
          }
        } else {
          const prefixed = key.match(/^privy:wallet:(0x[a-fA-F0-9]{40})$/);
          if (prefixed) pushWallet(into, prefixed[1]);
        }
      }
    }
    addJwtWallets(readCookie("privy-id-token"), into);
    try {
      pushWallet(into, sessionStorage.getItem("mon-publisher-preferred-wallet"));
    } catch {
      /* private mode */
    }
    pushWallet(into, window.__monPublisherAddress);
  }

  function readKnownWallets() {
    const found = new Set();
    pushWallet(found, readTokenWallet());
    readReaderSessionWallets(found);
    readPrivyWallets(found);
    return found;
  }

  function privySessionHint() {
    try {
      if (
        localStorage.getItem("privy:token") ||
        localStorage.getItem("privy:id_token") ||
        localStorage.getItem("privy:refresh_token")
      ) {
        return true;
      }
    } catch {
      /* private mode */
    }
    return Boolean(readCookie("privy-token") || readCookie("privy-id-token") || readCookie("privy-session"));
  }

  function viewerIsWriter(writer, options) {
    if (isWriter(writer, readTokenWallet()) || isWriter(writer, options && options.connectedWallet)) return true;
    return readKnownWallets().has(writer);
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
    if (text.includes("signin_cancelled")) return true;
    return /user rejected|user denied|user cancelled|user canceled|was cancelled|was canceled|rejected the request|request reset|modal closed|closed the modal|connection declined|disapproved/.test(
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

  function failureMessage(err, phase) {
    if (err && (err.code === "rate_limited" || err.message === "rate_limited")) {
      return "Too many tries. Try again in a bit.";
    }
    if (cancelled(err)) {
      return phase === "sign" ? "Signature was cancelled." : "Sign-in was cancelled.";
    }
    if (missingWallet(err) || (err && (err.code === "no_wallet" || err.code === "signin_unavailable"))) {
      return "No wallet found in this browser.";
    }
    if (phase === "sign") {
      const text = String((err && (err.message || err.code)) || "");
      if (/session_failed|invalid|signature/.test(text)) return "Could not follow right now.";
      return "Could not sign the follow message.";
    }
    if (phase === "api") return "Could not follow right now.";
    return "Could not connect a wallet.";
  }

  function withTimeout(promise, ms, code) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(code);
        err.code = code;
        reject(err);
      }, ms);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  function signInApi(value) {
    if (!value) return null;
    if (typeof value.connectFollowerWallet === "function" || typeof value.peekFollowerWallet === "function") return value;
    return null;
  }

  function importSignIn(url) {
    // follow.js is a classic script. Vite rewrites a direct dynamic import into
    // an ESM header, and then the script tag never runs.
    return new Function("url", "return import" + "(url)")(url);
  }

  async function ensureDevReactPreamble() {
    if (window.__vite_plugin_react_preamble_installed__) return;
    const host = location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return;
    try {
      const mod = await new Function("return import" + "('/@react-refresh')")();
      const runtime = mod.default || mod;
      if (!runtime || typeof runtime.injectIntoGlobalHook !== "function") return;
      runtime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = function () {};
      window.$RefreshSig$ = function () {
        return function (type) {
          return type;
        };
      };
      window.__vite_plugin_react_preamble_installed__ = true;
    } catch {
      /* built bundle, or not the Vite dev server */
    }
  }

  function loadFollowerSignIn() {
    const hooked = signInApi(window.OpenPaywallFollowSignIn);
    if (hooked) return Promise.resolve(hooked);
    return ensureDevReactPreamble().then(() => importSignIn(SIGNIN_URL)).then(
      (mod) => signInApi(mod) || signInApi(window.OpenPaywallFollowSignIn) || mod,
      (err) => {
        const after = signInApi(window.OpenPaywallFollowSignIn);
        if (after) return after;
        throw err;
      }
    );
  }

  function privyWalletsFound() {
    const found = new Set();
    readPrivyWallets(found);
    return found.size > 0;
  }

  function peekedPrivyWallet() {
    if (!privySessionHint() || privyWalletsFound()) return Promise.resolve("");
    if (!peekPromise) {
      peekPromise = (async () => {
        try {
          const mod = await withTimeout(loadFollowerSignIn(), 8000, "signin_unavailable");
          if (!mod || typeof mod.peekFollowerWallet !== "function") return "";
          return String((await mod.peekFollowerWallet()) || "").toLowerCase();
        } catch {
          return "";
        }
      })();
    }
    return peekPromise;
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
      mod = await withTimeout(loadFollowerSignIn(), 20000, "signin_unavailable");
    } catch {
      throw noWalletError();
    }
    if (!mod || typeof mod.connectFollowerWallet !== "function") throw noWalletError();
    return mod.connectFollowerWallet();
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
    if (viewerIsWriter(writer, options)) {
      container.replaceChildren();
      return;
    }
    if (isWriter(writer, await peekedPrivyWallet())) {
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
    let signInRelease = null;

    function holdSession(session) {
      if (session && typeof session.release === "function") signInRelease = session.release;
      return session;
    }

    function releaseSignIn() {
      const fn = signInRelease;
      signInRelease = null;
      if (typeof fn !== "function") return;
      try {
        fn();
      } catch {
        /* already closed */
      }
    }

    function paint(state) {
      applyState(btn, state, author);
    }

    function syncButtons(state) {
      document.querySelectorAll(`button.opw-follow[data-writer="${writer}"]`).forEach((node) => {
        applyState(node, state, node.dataset.author || author);
      });
    }

    function showNote(message, isError) {
      pop.hidden = false;
      pop.replaceChildren();
      const note = document.createElement("p");
      note.className = "opw-note" + (isError ? " opw-error" : " opw-status");
      note.setAttribute("role", isError ? "alert" : "status");
      note.textContent = message;
      pop.appendChild(note);
    }

    function showError(message) {
      showNote(message, true);
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

    function markBusy() {
      btn.disabled = true;
      btn.classList.add("is-busy");
      btn.setAttribute("aria-busy", "true");
    }

    function release() {
      if (!btn.isConnected) return;
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.removeAttribute("aria-busy");
    }

    async function followWithToken() {
      markBusy();
      try {
        let bearer = token();
        const connected = options.connectedWallet && String(options.connectedWallet).toLowerCase();
        if (connected && connected !== writer && readTokenWallet() !== connected) {
          let phase = "connect";
          try {
            if (!signingProvider && !injectedProvider()) {
              const result = holdSession(await connectReaderWallet());
              const address = String(result.address || "").toLowerCase();
              if (!ADDRESS_RE.test(address)) throw noWalletError();
              if (address === writer) {
                container.replaceChildren();
                return;
              }
              signingProvider = result.provider || null;
              options.connectedWallet = address;
            }
            phase = "sign";
            showNote("Confirm the signature in your wallet…");
            bearer = await signFollower(String(options.connectedWallet || connected).toLowerCase(), signingProvider);
          } catch (err) {
            if (canEmail && !cancelled(err) && !(err && (err.code === "rate_limited" || err.message === "rate_limited"))) {
              showEmailForm(options.prefillEmail || "");
              return;
            }
            showError(failureMessage(err, phase));
            return;
          }
        }
        if (!bearer) {
          if (canEmail) showEmailForm(options.prefillEmail || "");
          else showError("Could not follow right now.");
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
        releaseSignIn();
        release();
      }
    }

    async function connectAndFollow() {
      markBusy();
      showNote("Opening sign-in…");
      try {
        const result = holdSession(await connectReaderWallet());
        const address = String(result && result.address || "").toLowerCase();
        if (!ADDRESS_RE.test(address)) throw noWalletError();
        if (address === writer) {
          container.replaceChildren();
          return;
        }
        signingProvider = result.provider || null;
        options.connectedWallet = address;
        showNote("Confirm the signature in your wallet…");
        await followWithToken();
      } catch (err) {
        showError(failureMessage(err, "connect"));
      } finally {
        releaseSignIn();
        release();
      }
    }

    async function unfollow() {
      const bearer = token();
      if (!bearer) {
        showError("Sign in to unfollow.");
        return;
      }
      markBusy();
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
        if (!res.ok) {
          showError("Could not unfollow right now.");
          return;
        }
        if (set.has(writer)) {
          set.delete(writer);
          bumpFollowerCount(writer, -1);
        }
        syncButtons("idle");
      } finally {
        release();
      }
    }

    let touchLock = 0;
    function onActivate(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "click" && Date.now() - touchLock < 700) return;
      if (event.type === "touchend") touchLock = Date.now();
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
    }
    btn.addEventListener("click", onActivate);
    btn.addEventListener("touchend", onActivate);
    btn.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
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
