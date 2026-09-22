import crypto from "node:crypto";

export function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function hashText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
