/**
 * Reader session tokens. The browser signer and the server HMAC must agree,
 * and a wallet signature is required before a token is issued.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildReaderSessionMessage as clientMessage,
  signReaderSessionToken as clientSign,
  verifyReaderSessionToken as clientVerify,
} from "../dist/core/reader-session.js";
import {
  READER_SESSION_TTL_SEC,
  buildReaderSessionMessage as serverMessage,
  gateWalletReader,
  issueReaderSession,
  readerSessionCookie,
  readerSessionTokenFromRequest,
  signReaderSessionToken as serverSign,
  verifyReaderSessionToken as serverVerify,
} from "./reader-session.mjs";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(KEY);
const ADDRESS = account.address.toLowerCase();
const NOW = 1_700_000_000;
const FIELDS = {
  domain: "openpaywall.app",
  address: ADDRESS,
  issuedAt: NOW,
  expiresAt: NOW + READER_SESSION_TTL_SEC,
};

test("client and server session messages and tokens match", async () => {
  assert.equal(clientMessage(FIELDS), serverMessage(FIELDS));
  const secret = "shared-secret";
  const nodeToken = serverSign(FIELDS, secret);
  const webToken = await clientSign(FIELDS, secret);
  assert.equal(nodeToken, webToken);
  const claims = await clientVerify(nodeToken, secret, {
    nowMs: NOW * 1000,
    expectedDomain: "openpaywall.app",
  });
  assert.equal(claims?.address, ADDRESS);
  assert.equal(serverVerify(webToken, secret, { nowMs: NOW * 1000 })?.domain, "openpaywall.app");
});

test("issueReaderSession requires the wallet that the message names", async () => {
  const message = serverMessage(FIELDS);
  const signature = await account.signMessage({ message });
  const issued = await issueReaderSession(
    { ...FIELDS, signature },
    { nowSec: NOW, secret: "shared-secret" }
  );
  assert.equal(issued.address, ADDRESS);
  assert.match(issued.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const cookie = readerSessionCookie(issued.token, issued.expiresAt, { secure: true, nowSec: NOW });
  assert.match(cookie, /op_reader=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);

  const other = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d4aad435cce0e4c9335790421507b8a191e28881");
  const wrongSig = await other.signMessage({ message });
  await assert.rejects(
    () => issueReaderSession({ ...FIELDS, signature: wrongSig }, { nowSec: NOW, secret: "shared-secret" }),
    (err) => err.status === 403 && err.message === "reader_mismatch"
  );
  await assert.rejects(
    () => issueReaderSession({ ...FIELDS, signature: "0xdead" }, { nowSec: NOW, secret: "shared-secret" }),
    (err) => err.status === 401
  );
});

test("gateWalletReader ignores a bare wallet and keeps a fiat session", () => {
  assert.throws(
    () => gateWalletReader({ queryReader: ADDRESS, session: null, fiatSession: "" }),
    (err) => err.status === 401 && err.message === "reader_session_required"
  );
  assert.equal(
    gateWalletReader({ queryReader: ADDRESS, session: null, fiatSession: "sess_card" }),
    ""
  );
  assert.equal(
    gateWalletReader({ queryReader: ADDRESS, session: { address: ADDRESS }, fiatSession: "" }),
    ADDRESS
  );
  assert.throws(
    () => gateWalletReader({ queryReader: "0x" + "22".repeat(20), session: { address: ADDRESS }, fiatSession: "" }),
    (err) => err.status === 403 && err.message === "reader_mismatch"
  );
});

test("readerSessionTokenFromRequest checks header, bearer, then cookie", () => {
  assert.equal(
    readerSessionTokenFromRequest({ headers: { "x-reader-session": "header.token" } }),
    "header.token"
  );
  assert.equal(
    readerSessionTokenFromRequest({
      headers: { authorization: "Bearer one.dot" },
    }),
    "one.dot"
  );
  assert.equal(
    readerSessionTokenFromRequest({
      headers: { authorization: "Bearer aaa.bbb.ccc" },
    }),
    ""
  );
  assert.equal(
    readerSessionTokenFromRequest({
      headers: { cookie: "other=1; op_reader=cookie.token" },
    }),
    "cookie.token"
  );
});
