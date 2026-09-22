import crypto from "node:crypto";

const sessionMaxAgeMs = 1000 * 60 * 60 * 24 * 14;
const plannerPasswordSaltBytes = 16;
const plannerPasswordKeyBytes = 64;
const plannerPasswordScryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

export function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export async function hashPlannerPassword(password, { salt = crypto.randomBytes(plannerPasswordSaltBytes) } = {}) {
  if (typeof password !== "string" || !password) {
    throw new TypeError("Planner password must be nonempty text.");
  }
  const normalizedSalt = Buffer.from(salt);
  if (normalizedSalt.length !== plannerPasswordSaltBytes) {
    throw new TypeError(`Planner password salt must be ${plannerPasswordSaltBytes} bytes.`);
  }
  const hash = await scrypt(password, normalizedSalt);
  return `${normalizedSalt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function isPlannerPasswordScrypt(value) {
  if (typeof value !== "string") {
    return false;
  }
  const parts = value.split(":");
  return parts.length === 2
    && Boolean(decodeBase64url(parts[0], plannerPasswordSaltBytes))
    && Boolean(decodeBase64url(parts[1], plannerPasswordKeyBytes));
}

export async function verifyPlannerPassword(password, stored) {
  if (typeof password !== "string" || !isPlannerPasswordScrypt(stored)) {
    return false;
  }
  const [saltValue, hashValue] = stored.split(":");
  const expected = decodeBase64url(hashValue, plannerPasswordKeyBytes);
  const actual = await scrypt(password, decodeBase64url(saltValue, plannerPasswordSaltBytes));
  return crypto.timingSafeEqual(actual, expected);
}

export function createSessionToken(secret, {
  user = "",
  credentialId = "",
  sessionEpoch = 0,
  maxAgeMs = sessionMaxAgeMs
} = {}) {
  const expiresAt = Date.now() + maxAgeMs;
  const payload = Buffer.from(JSON.stringify({ expiresAt, user, credentialId, sessionEpoch })).toString("base64url");
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function buildSessionCookie(secret, {
  secure = false,
  user = "",
  credentialId = "",
  sessionEpoch = 0,
  maxAgeMs = sessionMaxAgeMs
} = {}) {
  const token = createSessionToken(secret, { user, credentialId, sessionEpoch, maxAgeMs });
  const maxAgeSeconds = Math.floor(maxAgeMs / 1000);
  const secureFlag = secure ? "; Secure" : "";
  return `sample_session=${token}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; HttpOnly${secureFlag}`;
}

export function readSessionToken(value, secret, { sessionEpoch = 0 } = {}) {
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
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Number(session.expiresAt) <= Date.now()) {
      return null;
    }
    const tokenEpoch = Number.isSafeInteger(session.sessionEpoch) && session.sessionEpoch >= 0
      ? session.sessionEpoch
      : 0;
    if (tokenEpoch !== sessionEpoch) {
      return null;
    }
    return {
      expiresAt: Number(session.expiresAt),
      user: typeof session.user === "string" ? session.user : "",
      credentialId: typeof session.credentialId === "string" ? session.credentialId : "",
      sessionEpoch: tokenEpoch
    };
  } catch {
    return null;
  }
}

export function verifySessionCookie(value, secret, options) {
  return Boolean(readSessionToken(value, secret, options));
}

export function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

export function safeEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function decodeBase64url(value, expectedLength) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === expectedLength && decoded.toString("base64url") === value ? decoded : null;
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, plannerPasswordKeyBytes, plannerPasswordScryptOptions, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

// Small in-memory throttle for the login endpoints. State is per-process,
// which matches the single-instance deployment model.
export function createLoginRateLimiter({ maxAttempts = 10, windowMs = 15 * 60 * 1000, maxKeys = 1000 } = {}) {
  const attempts = new Map();

  function entryFor(key, now) {
    const entry = attempts.get(key);
    if (!entry || now - entry.firstAt >= windowMs) {
      return null;
    }
    return entry;
  }

  function prune(now) {
    if (attempts.size <= maxKeys) {
      return;
    }
    for (const [key, entry] of attempts) {
      if (now - entry.firstAt >= windowMs) {
        attempts.delete(key);
      }
    }
  }

  return {
    isBlocked(key, now = Date.now()) {
      const entry = entryFor(key, now);
      return Boolean(entry && entry.count >= maxAttempts);
    },
    recordFailure(key, now = Date.now()) {
      prune(now);
      const entry = entryFor(key, now);
      if (entry) {
        entry.count += 1;
      } else {
        attempts.set(key, { count: 1, firstAt: now });
      }
    },
    reset(key) {
      attempts.delete(key);
    }
  };
}
