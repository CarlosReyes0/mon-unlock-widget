import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayNameFromPrivyUser,
  nameFromEmail,
  publishAuthor,
} from "./publish-author.js";

describe("publish author", () => {
  it("trims a typed byline and does not invent one", () => {
    assert.equal(publishAuthor("  Carlos Reyes  "), "Carlos Reyes");
    assert.equal(publishAuthor("Author"), "Author");
    assert.equal(publishAuthor(""), "");
    assert.equal(publishAuthor("   "), "");
    assert.equal(publishAuthor(undefined), "");
    assert.equal(publishAuthor(null), "");
  });

  it("reads a Google profile name ahead of the email", () => {
    assert.equal(
      displayNameFromPrivyUser({
        google: { name: "Carlos Reyes", email: "carlos.reyes@gmail.com" },
        email: { address: "other@example.com" },
      }),
      "Carlos Reyes"
    );
  });

  it("turns a dotted email local-part into a name", () => {
    assert.equal(nameFromEmail("carlos.reyes+news@gmail.com"), "Carlos Reyes");
    assert.equal(
      displayNameFromPrivyUser({ email: { address: "ada_lovelace@example.com" } }),
      "Ada Lovelace"
    );
    assert.equal(
      displayNameFromPrivyUser({ email: { address: "carlosreyes0@gmail.com" } }),
      "carlosreyes0"
    );
  });

  it("prefers an email name, then a linked username", () => {
    assert.equal(
      displayNameFromPrivyUser({
        twitter: { name: null, username: "cr" },
        email: { address: "carlos.reyes@gmail.com" },
      }),
      "Carlos Reyes"
    );
    assert.equal(
      displayNameFromPrivyUser({
        twitter: { name: null, username: "@carlos" },
      }),
      "carlos"
    );
    assert.equal(
      displayNameFromPrivyUser({
        farcaster: { displayName: "Carlos Reyes", username: "carlos" },
      }),
      "Carlos Reyes"
    );
  });

  it("joins a Telegram first and last name", () => {
    assert.equal(
      displayNameFromPrivyUser({
        telegram: { firstName: "Carlos", lastName: "Reyes", username: "cr" },
      }),
      "Carlos Reyes"
    );
  });

  it("leaves wallet-only and Apple private-relay sessions blank", () => {
    assert.equal(displayNameFromPrivyUser({}), "");
    assert.equal(displayNameFromPrivyUser(null), "");
    assert.equal(
      displayNameFromPrivyUser({
        apple: { email: "xyz123@privaterelay.appleid.com" },
      }),
      ""
    );
  });
});
