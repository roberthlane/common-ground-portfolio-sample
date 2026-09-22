import crypto from "node:crypto";

export function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function cleanUrl(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    return "";
  }

  return "";
}

export function cleanImageUrl(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function boundedNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(min, Math.min(max, Math.round(number)));
}

export function hashText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function normalizeStringList(value, limit, maxLength) {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean).map((item) => item.slice(0, maxLength)).slice(0, limit)
    : [];
}

export function normalizeUniqueStrings(values, limit, maxLength) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanText(value).slice(0, maxLength);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

export function normalizeChoice(value, allowed, fallback) {
  const text = cleanText(value);
  return allowed.has(text) ? text : fallback;
}

export function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

export function parseDateLike(value) {
  const raw = cleanText(value);
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(raw);
}

export function createId(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${slug || "idea"}-${crypto.randomBytes(3).toString("hex")}`;
}

export function createCollectionId(title) {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function envKeyForUser(user) {
  return cleanText(user)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function parseEnvList(value) {
  return cleanText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
