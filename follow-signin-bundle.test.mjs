/**
 * Loads the production publisher build of follow-signin.js (no window.ethereum)
 * and checks the sign-in sheet actually mounts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const APP_ID = "cmrd2bkpa00no0cjxge5rgdet";
const BUILT = path.join(ROOT, "dist-publisher", "follow-signin.js");

const built = spawnSync(
  process.execPath,
  [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--mode", "publisher", "--logLevel", "silent"],
  {
    cwd: ROOT,
    env: { ...process.env, VITE_PRIVY_APP_ID: APP_ID },
    stdio: "inherit",
  }
);
if (built.status !== 0) {
  throw new Error(`publisher build failed with status ${built.status}`);
}

test("built follow-signin bundle opens the sheet when no wallet is injected", async () => {
  const source = fs.readFileSync(BUILT, "utf8");
  assert.match(source, /connectFollowerWallet/);
  assert.match(source, /OpenPaywallFollowSignIn/);
  assert.match(source, new RegExp(APP_ID));
  assert.doesNotMatch(source, /new Function/);

  const dom = new JSDOM(`<!doctype html><html><head></head><body></body></html>`, {
    url: "http://localhost:5173/articles",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  installBrowserGlobals(window);
  assert.equal(window.ethereum, undefined);

  const mod = await import(pathToFileURL(BUILT).href);
  assert.equal(typeof mod.connectFollowerWallet, "function");
  assert.equal(typeof window.OpenPaywallFollowSignIn.connectFollowerWallet, "function");

  const pending = mod.connectFollowerWallet();
  const sheet = await waitFor(() => window.document.querySelector('[aria-label="Sign in to follow"]'));
  const text = sheet.textContent || "";
  assert.match(text, /Sign in to follow/);
  assert.match(text, /Email creates a wallet in this browser/);
  assert.doesNotMatch(text, /No wallet found/);
  assert.equal(window.ethereum, undefined);
  const cancel = [...window.document.querySelectorAll("button")].find((node) => node.textContent === "Cancel");
  assert.ok(cancel);
  cancel.click();
  await assert.rejects(pending, (err) => err && err.code === "signin_cancelled");
});

function installBrowserGlobals(window) {
  const globals = {
    window,
    document: window.document,
    self: window,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
    Element: window.Element,
    Node: window.Node,
    DocumentFragment: window.DocumentFragment,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    ErrorEvent: window.ErrorEvent,
  };
  for (const [key, value] of Object.entries(globals)) {
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    } catch {
      try {
        globalThis[key] = value;
      } catch {
        /* Node locks a few web globals such as navigator. */
      }
    }
  }
  if (!window.crypto) window.crypto = globalThis.crypto;
  window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.matchMedia = window.matchMedia;
  if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  window.IntersectionObserver = globalThis.IntersectionObserver;
  window.ResizeObserver = globalThis.ResizeObserver;
}

function waitFor(read, timeout = 4000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value = null;
      try {
        value = read();
      } catch (err) {
        reject(err);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error(`timed out waiting for sign-in UI: ${windowText()}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function windowText() {
  try {
    return String(globalThis.document?.body?.textContent || "").slice(0, 400);
  } catch {
    return "";
  }
}
