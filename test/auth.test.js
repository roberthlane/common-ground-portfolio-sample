import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionToken,
  readSessionToken,
  parseCookies,
} from "../src/auth.js";

test("signed sessions carry the selected account and expire", () => {
  const token = createSessionToken("secret", { user: "Alex" });
  assert.equal(readSessionToken(token, "secret").user, "Alex");
  const expired = createSessionToken("secret", { user: "Alex", maxAgeMs: -1 });
  assert.equal(readSessionToken(expired, "secret"), null);
});

test("sessions reject tampering, other signing keys and malformed tokens", () => {
  const token = createSessionToken("secret", { user: "Jamie" });
  assert.equal(readSessionToken(token, "other"), null);
  for (const value of [undefined, "", "bad", token + ".extra", token + "x"]) {
    assert.equal(readSessionToken(value, "secret"), null);
  }
});

test("cookies decode the session without requiring other cookie fields", () => {
  assert.deepEqual(parseCookies("bare; sample_session=hello%20world; a=1"), {
    sample_session: "hello world",
    a: "1",
  });
  assert.deepEqual(parseCookies(""), {});
});
