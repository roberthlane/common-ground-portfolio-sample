import crypto from "node:crypto";

const sessionMaxAgeMs = 1000 * 60 * 60;
function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken(
  secret,
  { user = "", maxAgeMs = sessionMaxAgeMs } = {},
) {
  const expiresAt = Date.now() + maxAgeMs;
  const payload = Buffer.from(JSON.stringify({ expiresAt, user })).toString(
    "base64url",
  );
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function readSessionToken(value, secret) {
  if (!value || !value.includes(".")) {
    return null;
  }

  const parts = value.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payload, signature] = parts;
  if (!safeEqual(signature, sign(payload, secret))) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= Date.now()
    ) {
      return null;
    }
    return {
      expiresAt: Number(session.expiresAt),
      user: typeof session.user === "string" ? session.user : "",
    };
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function safeEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
