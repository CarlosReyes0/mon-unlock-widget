import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  READER_SESSION_PREFIX,
  READER_SESSION_TTL_SEC,
  buildReaderSessionMessage,
  establishReaderSession,
  readStoredReaderSession,
  signReaderSessionToken,
  verifyReaderSessionToken,
  writeStoredReaderSession,
} from "./reader-session.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const FIELDS = {
  domain: "openpaywall.app",
  address: ADDRESS,
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_000 + READER_SESSION_TTL_SEC,
};

describe("buildReaderSessionMessage", () => {
  it("binds domain, address, and the session window", () => {
    const message = buildReaderSessionMessage({
      domain: "OpenPaywall.app",
      address: "0x1111111111111111111111111111111111111111",
      issuedAt: 10,
      expiresAt: 20,
    });
    assert.equal(
      message,
      [
        READER_SESSION_PREFIX,
        "domain:openpaywall.app",
        `address:${ADDRESS}`,
        "issuedAt:10",
        "expiresAt:20",
      ].join("\n")
    );
  });
});

describe("reader session token", () => {
  it("round-trips and rejects a tampered token, the wrong domain, and expiry", async () => {
    const secret = "test-secret";
    const token = await signReaderSessionToken(FIELDS, secret);
    const ok = await verifyReaderSessionToken(token, secret, {
      nowMs: FIELDS.issuedAt * 1000,
      expectedDomain: "openpaywall.app",
    });
    assert.equal(ok?.address, ADDRESS);
    assert.equal(await verifyReaderSessionToken(token, "other-secret", { nowMs: FIELDS.issuedAt * 1000 }), null);
    assert.equal(
      await verifyReaderSessionToken(token, secret, {
        nowMs: FIELDS.issuedAt * 1000,
        expectedDomain: "evil.example",
      }),
      null
    );
    assert.equal(
      await verifyReaderSessionToken(token, secret, { nowMs: FIELDS.expiresAt * 1000 }),
      null
    );
    const [body, mac] = token.split(".");
    assert.equal(await verifyReaderSessionToken(`${body}.${mac}aa`, secret, { nowMs: FIELDS.issuedAt * 1000 }), null);
  });
});

describe("establishReaderSession", () => {
  it("reuses a stored token and otherwise posts one signature", async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    writeStoredReaderSession(storage, {
      token: "stored.token",
      address: ADDRESS,
      domain: "127.0.0.1:8080",
      issuedAt: 0,
      expiresAt: 1_700_003_600,
    });
    const reused = readStoredReaderSession(storage, "127.0.0.1:8080", ADDRESS, 1_700_000_000);
    assert.equal(reused?.token, "stored.token");

    let signs = 0;
    const created = await establishReaderSession({
      address: ADDRESS,
      domain: "openpaywall.app",
      nowSec: 1_700_000_000,
      storage,
      signMessage: async () => {
        signs += 1;
        return "0xsig";
      },
      sessionUrl: "https://openpaywall.app/api/reader/session",
      fetchImpl: async () =>
        new Response(JSON.stringify({ token: "fresh.token", expiresAt: 1_700_003_600 }), { status: 200 }),
    });
    assert.equal(signs, 1);
    assert.equal(created.token, "fresh.token");
    const again = await establishReaderSession({
      address: ADDRESS,
      domain: "openpaywall.app",
      nowSec: 1_700_000_100,
      storage,
      signMessage: async () => {
        signs += 1;
        return "0xsig";
      },
      sessionUrl: "https://openpaywall.app/api/reader/session",
      fetchImpl: async () => {
        throw new Error("should reuse storage");
      },
    });
    assert.equal(again.token, "fresh.token");
    assert.equal(signs, 1);
  });
});
