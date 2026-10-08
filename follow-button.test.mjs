/**
 * Signed-out Follow button. jsdom only — no network, no production writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const KEY = "0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881";
const READER = privateKeyToAccount(KEY);
const WRITER = "0x2222222222222222222222222222222222222222";
const FOLLOW_JS = fs.readFileSync(path.join(ROOT, "follow.js"), "utf8");

function walletToken(id) {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, kind: "wallet", id: String(id).toLowerCase(), exp: Date.now() + 86_400_000 })
  ).toString("base64url");
  return `${payload}.sig`;
}

function hexToUtf8(hex) {
  const raw = String(hex || "").replace(/^0x/, "");
  const bytes = new Uint8Array(raw.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

function json(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

async function settle(pred) {
  for (let i = 0; i < 50; i++) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(pred(), true);
}

function boot(html, { email = false, url = "https://openpaywall.app/articles/demo" } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <p id="followerCount" data-followers="0">0 followers</p>
      <p id="firstLine">Be the first to follow</p>
      <span class="followers" data-writer="${WRITER}">0 followers</span>
      ${html}
    </body></html>`,
    { url, runScripts: "dangerously" }
  );
  const { window } = dom;
  const requests = [];
  const calls = [];
  window.__email = email;
  window.fetch = async (resource, opts = {}) => {
    const href = String(resource);
    const body = opts.body ? JSON.parse(opts.body) : null;
    requests.push({ url: href, method: opts.method || "GET", body, headers: opts.headers || {} });
    if (href.includes("/api/follows/config")) return json({ email: Boolean(window.__email) });
    if (href.includes("/api/follows/me")) return json({ following: [] });
    if (href.includes("/api/follows/session")) return json({ followerToken: walletToken(body.wallet) });
    if (href.includes("/api/follows/wallet") && (opts.method || "GET") === "POST") {
      return json({ following: true, writer: body.writer });
    }
    return json({ error: "not_found" }, 404);
  };
  const script = window.document.createElement("script");
  script.textContent = FOLLOW_JS;
  window.document.body.appendChild(script);
  return { window, requests, calls };
}

function installWallet(window, calls, request) {
  window.ethereum = {
    request: async (args) => {
      calls.push(args);
      return request(args);
    },
  };
}

function followButton(container) {
  return container.querySelector("button.opw-follow[data-writer]");
}

test("follow.js reuses account sign-in and the existing follower message", () => {
  assert.match(FOLLOW_JS, /SIGNIN_URL = "\/follow-signin\.js"/);
  assert.match(FOLLOW_JS, /return import" \+ "\(url\)"/);
  assert.match(FOLLOW_JS, /importSignIn\(SIGNIN_URL\)/);
  assert.doesNotMatch(FOLLOW_JS, /import\s*\(/);
  assert.match(FOLLOW_JS, /signInApi\(window\.OpenPaywallFollowSignIn\)/);
  assert.match(FOLLOW_JS, /__vite_plugin_react_preamble_installed__/);
  assert.doesNotMatch(FOLLOW_JS, /import\("\/dist\/openpaywall\.js"\)/);
  assert.match(FOLLOW_JS, /eth_requestAccounts/);
  assert.match(FOLLOW_JS, /personal_sign/);
  assert.match(FOLLOW_JS, /Open Paywall follower v1/);
  assert.match(FOLLOW_JS, /\/api\/follows\/session/);
  assert.match(FOLLOW_JS, /\/api\/follows\/wallet/);
  assert.match(FOLLOW_JS, /No wallet found in this browser/);
  assert.match(FOLLOW_JS, /Opening sign-in/);
  assert.match(FOLLOW_JS, /privy:id_token/);
  assert.match(FOLLOW_JS, /op_reader_session:/);
  assert.match(FOLLOW_JS, /mon-publisher-preferred-wallet/);
  const signin = fs.readFileSync(path.join(ROOT, "src/publisher/follow-signin.tsx"), "utf8");
  assert.match(signin, /PrivyProvider/);
  assert.match(signin, /publisherPrivyConfig/);
  assert.match(signin, /PublisherAuth/);
  assert.match(signin, /new WalletManager/);
  assert.match(signin, /setWalletConnectProjectId/);
  assert.match(signin, /connectFollowerWallet/);
  assert.match(signin, /OpenPaywallFollowSignIn = \{/);
  assert.match(signin, /\/publisher-auth\.css/);
  assert.doesNotMatch(signin, /openpaywall\.js/);
  const vite = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
  assert.match(vite, /follow-signin/);
  const feed = fs.readFileSync(path.join(ROOT, "articles.html"), "utf8");
  assert.match(feed, /OpenPaywallFollow\.mount/);
  assert.match(feed, /\.meta\s*\{[^}]*z-index:\s*2/);
  assert.match(feed, /title a::after[^}]*z-index:\s*0/);
  assert.match(feed, /closest\("\.follow-slot"\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "article.html"), "utf8"), /OpenPaywallFollow\.mount/);
  assert.match(fs.readFileSync(path.join(ROOT, "writer.html"), "utf8"), /OpenPaywallFollow\.mount/);
});

test("signed-out article, writer, and feed mounts render Follow when email is off", async () => {
  const { window } = boot(`
    <span id="article"></span>
    <span id="writer"></span>
    <span id="feed"></span>
  `);
  const mounts = [
    ["article", { via: "article", allowWallet: true, openEmail: true, offerEmail: true }],
    ["writer", { via: "writer_page", allowWallet: false }],
    ["feed", { via: "feed", allowWallet: false }],
  ];
  for (const [id, extra] of mounts) {
    await window.OpenPaywallFollow.mount(window.document.getElementById(id), {
      writer: WRITER,
      author: "Ada",
      primary: true,
      ...extra,
    });
    const slot = window.document.getElementById(id);
    const button = followButton(slot);
    assert.ok(button, id);
    assert.match(button.textContent, /^Follow$/);
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(slot.querySelector('input[type="email"]'), null, id);
  }
});

test("Follow stays hidden on the viewer's own writer page and own wallet", async () => {
  const byConnected = boot(`<span id="slot"></span>`, {
    url: `https://openpaywall.app/writers/${WRITER}`,
  });
  await byConnected.window.OpenPaywallFollow.mount(byConnected.window.document.getElementById("slot"), {
    writer: WRITER,
    author: "Ada",
    via: "writer_page",
    connectedWallet: WRITER,
  });
  assert.equal(followButton(byConnected.window.document.getElementById("slot")), null);

  const byInjected = boot(`<span id="slot"></span>`, {
    url: `https://openpaywall.app/writers/${WRITER}`,
  });
  installWallet(byInjected.window, byInjected.calls, async ({ method }) => {
    if (method === "eth_accounts") return [WRITER];
    throw new Error(`unexpected ${method}`);
  });
  await byInjected.window.OpenPaywallFollow.mount(byInjected.window.document.getElementById("slot"), {
    writer: WRITER,
    author: "Ada",
    via: "writer_page",
  });
  assert.equal(followButton(byInjected.window.document.getElementById("slot")), null);
  assert.equal(
    byInjected.calls.some((call) => call.method === "eth_requestAccounts"),
    false
  );

  const byToken = boot(`<span id="slot"></span>`, {
    url: `https://openpaywall.app/writers/${WRITER}`,
  });
  byToken.window.localStorage.setItem("opw_follower", walletToken(WRITER));
  await byToken.window.OpenPaywallFollow.mount(byToken.window.document.getElementById("slot"), {
    writer: WRITER,
    author: "Ada",
    via: "writer_page",
  });
  assert.equal(followButton(byToken.window.document.getElementById("slot")), null);
});

test("Follow with no wallet connects, signs, and POSTs /api/follows/wallet", async () => {
  const { window, requests, calls } = boot(`<span id="slot"></span>`);
  installWallet(window, calls, async ({ method, params }) => {
    if (method === "eth_accounts") return [];
    if (method === "eth_requestAccounts") return [READER.address];
    if (method === "personal_sign") {
      const message = hexToUtf8(params[0]);
      assert.equal(String(params[1]).toLowerCase(), READER.address.toLowerCase());
      return READER.signMessage({ message });
    }
    throw new Error(`unexpected ${method}`);
  });
  const slot = window.document.getElementById("slot");
  await window.OpenPaywallFollow.mount(slot, {
    writer: WRITER,
    author: "Ada",
    via: "article",
    allowWallet: true,
    openEmail: true,
  });
  followButton(slot).click();
  await settle(() => followButton(slot)?.getAttribute("aria-pressed") === "true");

  assert.equal(calls.some((call) => call.method === "eth_requestAccounts"), true);
  const signed = calls.find((call) => call.method === "personal_sign");
  assert.ok(signed);
  const session = requests.find((req) => req.url.includes("/api/follows/session"));
  assert.ok(session);
  const message = [
    "Open Paywall follower v1",
    "chain:143",
    `wallet:${READER.address.toLowerCase()}`,
    `origin:openpaywall.app`,
    `issuedAt:${session.body.issuedAt}`,
  ].join("\n");
  assert.equal(hexToUtf8(signed.params[0]), message);
  assert.equal(session.body.origin, "openpaywall.app");
  assert.equal(session.body.wallet.toLowerCase(), READER.address.toLowerCase());
  assert.equal(
    await verifyMessage({ address: READER.address, message, signature: session.body.sig }),
    true
  );

  const follow = requests.find((req) => req.url.includes("/api/follows/wallet") && req.method === "POST");
  assert.ok(follow);
  assert.deepEqual(follow.body, { writer: WRITER, via: "article" });
  assert.match(follow.headers.Authorization, /^Bearer /);
  const button = followButton(slot);
  assert.match(button.textContent, /Following/);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(slot.querySelector('input[type="email"]'), null);
  assert.equal(window.document.getElementById("followerCount").textContent, "1 follower");
  assert.equal(window.document.querySelector(".followers").textContent, "1 follower");
  assert.equal(window.document.getElementById("firstLine").hidden, true);
});

test("cancelling connect or sign leaves the button on Follow", async () => {
  const rejected = Object.assign(new Error("User rejected the request."), { code: 4001 });

  const connectCancel = boot(`<span id="slot"></span>`);
  installWallet(connectCancel.window, connectCancel.calls, async ({ method }) => {
    if (method === "eth_accounts") return [];
    if (method === "eth_requestAccounts") throw rejected;
    throw new Error(`unexpected ${method}`);
  });
  const connectSlot = connectCancel.window.document.getElementById("slot");
  await connectCancel.window.OpenPaywallFollow.mount(connectSlot, {
    writer: WRITER,
    author: "Ada",
    via: "feed",
  });
  followButton(connectSlot).click();
  await settle(() => connectCancel.calls.some((call) => call.method === "eth_requestAccounts") && !followButton(connectSlot).disabled);
  assert.match(followButton(connectSlot).textContent, /^Follow$/);
  assert.equal(connectSlot.querySelector(".opw-error").textContent, "Sign-in was cancelled.");
  assert.equal(followButton(connectSlot).classList.contains("is-busy"), false);
  assert.equal(
    connectCancel.requests.some((req) => req.url.includes("/api/follows/wallet") || req.url.includes("/api/follows/session")),
    false
  );

  const signCancel = boot(`<span id="slot"></span>`);
  installWallet(signCancel.window, signCancel.calls, async ({ method }) => {
    if (method === "eth_accounts") return [];
    if (method === "eth_requestAccounts") return [READER.address];
    if (method === "personal_sign") throw rejected;
    throw new Error(`unexpected ${method}`);
  });
  const signSlot = signCancel.window.document.getElementById("slot");
  await signCancel.window.OpenPaywallFollow.mount(signSlot, {
    writer: WRITER,
    author: "Ada",
    via: "writer_page",
  });
  followButton(signSlot).click();
  await settle(() => signCancel.calls.some((call) => call.method === "personal_sign") && !followButton(signSlot).disabled);
  assert.match(followButton(signSlot).textContent, /^Follow$/);
  assert.equal(signSlot.querySelector(".opw-error").textContent, "Signature was cancelled.");
  assert.equal(followButton(signSlot).classList.contains("is-busy"), false);
  assert.equal(
    signCancel.requests.some((req) => req.url.includes("/api/follows/wallet")),
    false
  );
});

test("no injected wallet shows a short message and does not post a follow", async () => {
  const { window, requests } = boot(`<span id="slot"></span>`);
  const slot = window.document.getElementById("slot");
  await window.OpenPaywallFollow.mount(slot, {
    writer: WRITER,
    author: "Ada",
    via: "writer_page",
    allowWallet: true,
  });
  followButton(slot).click();
  await settle(() => Boolean(slot.querySelector(".opw-error")));
  assert.equal(slot.querySelector(".opw-error").textContent, "No wallet found in this browser.");
  assert.match(followButton(slot).textContent, /^Follow$/);
  assert.equal(followButton(slot).disabled, false);
  assert.equal(followButton(slot).classList.contains("is-busy"), false);
  assert.equal(slot.querySelector('input[type="email"]'), null);
  assert.equal(
    requests.some((req) => req.url.includes("/api/follows/wallet") || req.url.includes("/api/follows/session")),
    false
  );
});

test("email follow stays available when email is on and hidden when it is off", async () => {
  const off = boot(`<span id="slot"></span>`, { email: false });
  const offSlot = off.window.document.getElementById("slot");
  await off.window.OpenPaywallFollow.mount(offSlot, {
    writer: WRITER,
    author: "Ada",
    via: "article",
    openEmail: true,
    prefillEmail: "ada@example.com",
  });
  assert.equal(offSlot.querySelector('input[type="email"]'), null);

  const on = boot(`<span id="slot"></span>`, { email: true });
  const calls = [];
  installWallet(on.window, calls, async ({ method }) => {
    if (method === "eth_accounts") return [];
    throw new Error(`email-on path should not call ${method}`);
  });
  const onSlot = on.window.document.getElementById("slot");
  await on.window.OpenPaywallFollow.mount(onSlot, {
    writer: WRITER,
    author: "Ada",
    via: "article",
    allowWallet: true,
    prefillEmail: "ada@example.com",
  });
  assert.equal(onSlot.querySelector('input[type="email"]'), null);
  followButton(onSlot).click();
  await settle(() => Boolean(onSlot.querySelector('input[type="email"]')));
  const input = onSlot.querySelector('input[type="email"]');
  assert.equal(input.value, "ada@example.com");
  assert.match(onSlot.textContent, /will see your email/);
  assert.equal(
    calls.some((call) => call.method === "eth_requestAccounts" || call.method === "personal_sign"),
    false
  );
  assert.equal(
    on.requests.some((req) => req.url.includes("/api/follows/wallet")),
    false
  );
});

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function setIphone(window) {
  try {
    Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: IPHONE_UA });
  } catch {
    /* jsdom may lock the prototype */
  }
  assert.equal(window.ethereum, undefined);
}

function jwt(payload) {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

function readerSigner(calls) {
  return {
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (method !== "personal_sign") throw new Error(`unexpected ${method}`);
      assert.equal(String(params[1]).toLowerCase(), READER.address.toLowerCase());
      return READER.signMessage({ message: hexToUtf8(params[0]) });
    },
  };
}

test("mobile Safari with no injected wallet opens sign-in, signs, and follows", async () => {
  const { window, requests } = boot(`<span id="slot"></span>`, {
    url: "https://openpaywall.app/articles",
  });
  setIphone(window);
  const calls = [];
  let opened = 0;
  window.OpenPaywallFollowSignIn = {
    async connectFollowerWallet() {
      opened += 1;
      return { address: READER.address, provider: readerSigner(calls), release() {} };
    },
  };
  const slot = window.document.getElementById("slot");
  await window.OpenPaywallFollow.mount(slot, {
    writer: WRITER,
    author: "Ada",
    via: "feed",
  });
  followButton(slot).click();
  await settle(() => followButton(slot)?.getAttribute("aria-pressed") === "true");
  assert.equal(opened, 1);
  assert.equal(calls.some((call) => call.method === "personal_sign"), true);
  const session = requests.find((req) => req.url.includes("/api/follows/session"));
  const message = [
    "Open Paywall follower v1",
    "chain:143",
    `wallet:${READER.address.toLowerCase()}`,
    "origin:openpaywall.app",
    `issuedAt:${session.body.issuedAt}`,
  ].join("\n");
  assert.equal(hexToUtf8(calls.find((call) => call.method === "personal_sign").params[0]), message);
  assert.equal(
    await verifyMessage({ address: READER.address, message, signature: session.body.sig }),
    true
  );
  const follow = requests.find((req) => req.url.includes("/api/follows/wallet") && req.method === "POST");
  assert.deepEqual(follow.body, { writer: WRITER, via: "feed" });
  assert.match(follow.headers.Authorization, /^Bearer /);
  assert.match(followButton(slot).textContent, /Following/);
  assert.equal(followButton(slot).disabled, false);
  assert.equal(slot.querySelector('input[type="email"]'), null);
});

test("mobile tap shows Opening sign-in, then each failure, and does not stay faded", async () => {
  const cases = [
    {
      name: "load",
      connect: null,
      expect: "No wallet found in this browser.",
    },
    {
      name: "connect reject",
      connect: async () => {
        const err = new Error("User rejected the request.");
        err.code = 4001;
        throw err;
      },
      expect: "Sign-in was cancelled.",
    },
    {
      name: "connect failure",
      connect: async () => {
        throw new Error("WalletConnect initialization timed out.");
      },
      expect: "Could not connect a wallet.",
    },
    {
      name: "sign reject",
      connect: async () => ({
        address: READER.address,
        provider: {
          request: async () => {
            const err = new Error("User rejected the request.");
            err.code = 4001;
            throw err;
          },
        },
        release() {},
      }),
      expect: "Signature was cancelled.",
    },
  ];
  for (const item of cases) {
    const { window, requests } = boot(`<span id="slot"></span>`);
    setIphone(window);
    if (item.connect) window.OpenPaywallFollowSignIn = { connectFollowerWallet: item.connect };
    const slot = window.document.getElementById("slot");
    await window.OpenPaywallFollow.mount(slot, { writer: WRITER, author: "Ada", via: "feed" });
    let sawOpening = false;
    if (item.connect) {
      const orig = window.OpenPaywallFollowSignIn.connectFollowerWallet;
      window.OpenPaywallFollowSignIn.connectFollowerWallet = async () => {
        sawOpening = /Opening sign-in/.test(slot.textContent || "");
        return orig();
      };
    }
    followButton(slot).click();
    await settle(() => slot.querySelector(".opw-error")?.textContent === item.expect);
    if (item.connect) assert.equal(sawOpening, true, item.name);
    assert.match(followButton(slot).textContent, /^Follow$/, item.name);
    assert.equal(followButton(slot).disabled, false, item.name);
    assert.equal(followButton(slot).classList.contains("is-busy"), false, item.name);
    assert.equal(
      requests.some((req) => req.method === "POST" && req.url.includes("/api/follows/wallet")),
      false,
      item.name
    );
  }
});

test("session and follow API errors stay visible and re-enable Follow", async () => {
  async function failApi(which) {
    const { window, requests } = boot(`<span id="slot"></span>`);
    const calls = [];
    installWallet(window, calls, async ({ method, params }) => {
      if (method === "eth_accounts") return [];
      if (method === "eth_requestAccounts") return [READER.address];
      if (method === "personal_sign") return READER.signMessage({ message: hexToUtf8(params[0]) });
      throw new Error(method);
    });
    const orig = window.fetch;
    window.fetch = async (resource, opts) => {
      const href = String(resource);
      if (which === "session" && href.includes("/api/follows/session")) return json({ error: "session_failed" }, 500);
      if (which === "wallet" && href.includes("/api/follows/wallet")) return json({ error: "nope" }, 500);
      return orig(resource, opts);
    };
    const slot = window.document.getElementById("slot");
    await window.OpenPaywallFollow.mount(slot, { writer: WRITER, author: "Ada", via: "article" });
    followButton(slot).click();
    await settle(() => slot.querySelector(".opw-error")?.textContent === "Could not follow right now.");
    assert.equal(followButton(slot).disabled, false, which);
    assert.match(followButton(slot).textContent, /^Follow$/, which);
    assert.equal(
      requests.some((req) => req.method === "POST" && req.url.includes("/api/follows/wallet") && which === "session"),
      false
    );
  }
  await failApi("session");
  await failApi("wallet");
});

test("feed card Follow tap does not navigate", async () => {
  const { window } = boot(`
    <article class="item">
      <a id="card" href="/articles/bankr-is-the-storefront-the-account-is-still-missing-ki2j5z">
        <span id="slot"></span>
      </a>
    </article>
  `);
  setIphone(window);
  let navigated = false;
  window.document.getElementById("card").addEventListener("click", () => {
    navigated = true;
  });
  window.OpenPaywallFollowSignIn = {
    connectFollowerWallet: () => new Promise(() => {}),
  };
  const slot = window.document.getElementById("slot");
  await window.OpenPaywallFollow.mount(slot, {
    writer: WRITER,
    author: "openpaywall",
    via: "feed",
  });
  followButton(slot).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await settle(() => /Opening sign-in/.test(slot.textContent || ""));
  assert.equal(navigated, false);
  assert.equal(window.location.pathname, "/articles/demo");
  assert.match(followButton(slot).textContent, /^Follow$/);
});

test("own-writer Follow stays hidden for stored reader, Privy, and account identities", async () => {
  async function hides(setup) {
    const { window } = boot(`<span id="slot"></span>`);
    setup(window);
    const slot = window.document.getElementById("slot");
    await window.OpenPaywallFollow.mount(slot, { writer: WRITER, author: "Ada", via: "feed" });
    assert.equal(followButton(slot), null);
  }

  await hides((window) => {
    window.localStorage.setItem(
      `op_reader_session:openpaywall.app:${WRITER}`,
      JSON.stringify({
        token: "t",
        address: WRITER,
        domain: "openpaywall.app",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      })
    );
  });
  await hides((window) => {
    window.localStorage.setItem(
      "privy:id_token",
      jwt({
        linked_accounts: JSON.stringify([
          { type: "wallet", address: WRITER, wallet_client_type: "privy", chain_type: "ethereum" },
        ]),
      })
    );
  });
  await hides((window) => {
    window.localStorage.setItem("privy:connections", JSON.stringify([{ address: WRITER, walletClientType: "privy" }]));
  });
  await hides((window) => {
    window.sessionStorage.setItem("mon-publisher-preferred-wallet", WRITER);
  });
  await hides((window) => {
    window.__monPublisherAddress = WRITER;
  });
  await hides((window) => {
    window.localStorage.setItem("privy:token", "opaque-session");
    window.OpenPaywallFollowSignIn = { peekFollowerWallet: async () => WRITER };
  });

  const expired = boot(`<span id="slot"></span>`);
  expired.window.localStorage.setItem(
    `op_reader_session:openpaywall.app:${WRITER}`,
    JSON.stringify({ address: WRITER, expiresAt: Math.floor(Date.now() / 1000) - 60 })
  );
  const slot = expired.window.document.getElementById("slot");
  await expired.window.OpenPaywallFollow.mount(slot, { writer: WRITER, author: "Ada", via: "article" });
  assert.ok(followButton(slot));
});

test("sign-in as the writer hides Follow and does not post", async () => {
  const { window, requests } = boot(`<span id="slot"></span>`);
  setIphone(window);
  window.OpenPaywallFollowSignIn = {
    async connectFollowerWallet() {
      return {
        address: WRITER,
        provider: { request: async () => { throw new Error("should not sign"); } },
        release() {},
      };
    },
  };
  const slot = window.document.getElementById("slot");
  await window.OpenPaywallFollow.mount(slot, { writer: WRITER, author: "openpaywall", via: "article" });
  followButton(slot).click();
  await settle(() => followButton(slot) == null);
  assert.equal(
    requests.some((req) => req.url.includes("/api/follows/wallet") || req.url.includes("/api/follows/session")),
    false
  );
});
