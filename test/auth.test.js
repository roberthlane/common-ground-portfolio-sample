import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionCookie,
  createLoginRateLimiter,
  createSessionToken,
  hashPlannerPassword,
  isPlannerPasswordScrypt,
  parseCookies,
  readSessionToken,
  safeEqual,
  sign,
  verifyPlannerPassword,
  verifySessionCookie
} from "../src/auth.js";

const secret = "test-secret";

function cookieValue(setCookie) {
  return setCookie.split(";")[0].split("=")[1];
}

test("session cookie round-trips through verify", () => {
  const setCookie = buildSessionCookie(secret);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/);
  assert.match(buildSessionCookie(secret, { secure: true }), /; Secure/);

  assert.equal(verifySessionCookie(cookieValue(setCookie), secret), true);
});

test("named session tokens carry an account and credential version", () => {
  const token = createSessionToken(secret, {
    user: "Jamie",
    credentialId: "jamie-password-v1"
  });
  const session = readSessionToken(token, secret);

  assert.equal(session.user, "Jamie");
  assert.equal(session.credentialId, "jamie-password-v1");
  assert.equal(session.sessionEpoch, 0);
  assert.ok(session.expiresAt > Date.now());
});

test("planner password scrypt hashes verify exact passwords and reject malformed values", async () => {
  const hash = await hashPlannerPassword("correct horse battery staple", { salt: Buffer.alloc(16, 7) });

  assert.equal(hash, "BwcHBwcHBwcHBwcHBwcHBw:Z65ESsHNOjUHGsgNtDm0Xr7vbTBZ7rd-kPBvsNw3uurSbfJmIc8c0po0QER3Dj1BsfoNbOuFuCt6C2ZkJGUmlQ");
  assert.equal(isPlannerPasswordScrypt(hash), true);
  assert.equal(await verifyPlannerPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPlannerPassword("wrong password", hash), false);
  assert.equal(isPlannerPasswordScrypt("missing-separator"), false);
  assert.equal(isPlannerPasswordScrypt("bad:hash"), false);
  assert.equal(await verifyPlannerPassword("anything", "bad:hash"), false);
  await assert.rejects(hashPlannerPassword(""), /nonempty text/);
});

test("session epochs revoke signed browser and native tokens without changing the secret", () => {
  const token = createSessionToken(secret, {
    user: "Alex",
    credentialId: "alex-password-v1",
    sessionEpoch: 4
  });

  assert.equal(readSessionToken(token, secret, { sessionEpoch: 4 }).user, "Alex");
  assert.equal(readSessionToken(token, secret, { sessionEpoch: 5 }), null);
  assert.equal(verifySessionCookie(token, secret, { sessionEpoch: 5 }), false);

  const legacyPayload = Buffer.from(JSON.stringify({
    expiresAt: Date.now() + 60_000,
    user: "Jamie",
    credentialId: "legacy"
  })).toString("base64url");
  const legacyToken = `${legacyPayload}.${sign(legacyPayload, secret)}`;
  assert.equal(readSessionToken(legacyToken, secret, { sessionEpoch: 0 }).user, "Jamie");
  assert.equal(readSessionToken(legacyToken, secret, { sessionEpoch: 1 }), null);
});

test("verifySessionCookie rejects tampered and malformed values", () => {
  const value = cookieValue(buildSessionCookie(secret));
  const [payload, signature] = value.split(".");

  assert.equal(verifySessionCookie(`${payload}x.${signature}`, secret), false);
  assert.equal(verifySessionCookie(`${payload}.${signature}x`, secret), false);
  assert.equal(verifySessionCookie(value, "other-secret"), false);
  assert.equal(verifySessionCookie("no-dot-here", secret), false);
  assert.equal(verifySessionCookie("", secret), false);
  assert.equal(verifySessionCookie(undefined, secret), false);
  assert.equal(readSessionToken(`${value}.extra`, secret), null);
});

test("verifySessionCookie rejects expired sessions even when signed", () => {
  const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() - 1000 })).toString("base64url");
  const value = `${payload}.${sign(payload, secret)}`;
  assert.equal(verifySessionCookie(value, secret), false);
});

test("safeEqual compares without throwing on unequal lengths", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual(undefined, "x"), false);
});

test("parseCookies handles multiple and malformed pairs", () => {
  assert.deepEqual(parseCookies("a=1; b=2"), { a: "1", b: "2" });
  assert.deepEqual(parseCookies("bare; c=3"), { c: "3" });
  assert.deepEqual(parseCookies(""), {});
});

test("login rate limiter blocks after max attempts and resets on success", () => {
  const limiter = createLoginRateLimiter({ maxAttempts: 3, windowMs: 1000 });
  const now = 1_000_000;

  assert.equal(limiter.isBlocked("ip", now), false);
  limiter.recordFailure("ip", now);
  limiter.recordFailure("ip", now);
  assert.equal(limiter.isBlocked("ip", now), false);
  limiter.recordFailure("ip", now);
  assert.equal(limiter.isBlocked("ip", now), true);
  assert.equal(limiter.isBlocked("other-ip", now), false);

  // Window expiry unblocks.
  assert.equal(limiter.isBlocked("ip", now + 1001), false);

  // Successful login clears the counter.
  limiter.recordFailure("ip2", now);
  limiter.recordFailure("ip2", now);
  limiter.recordFailure("ip2", now);
  assert.equal(limiter.isBlocked("ip2", now), true);
  limiter.reset("ip2");
  assert.equal(limiter.isBlocked("ip2", now), false);
});
