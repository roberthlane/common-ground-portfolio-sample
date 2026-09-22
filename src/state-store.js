import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { NO_STATE_CHANGE, runStateMutation } from "./transaction-context.js";

export class FileStateStore {
  constructor({
    dataFile,
    legacyDataFile = "",
    normalize,
    loadSeed,
    mergeSeed,
    now = () => new Date(),
    stateVersion = 0,
    requireExactStoredVersion = false
  }) {
    this.dataFile = dataFile;
    this.legacyDataFile = legacyDataFile;
    this.normalize = normalize;
    this.loadSeed = loadSeed;
    this.mergeSeed = mergeSeed;
    this.now = now;
    this.stateVersion = Number(stateVersion) || 0;
    this.requireExactStoredVersion = requireExactStoredVersion === true;
    this.currentState = null;
    this.revision = 0;
    this.queue = Promise.resolve();
    this.loginAttempts = new Map();
    this.operationFile = `${dataFile}.operations.json`;
    this.operations = null;
  }

  async initialize() {
    await this.#locked(() => this.#ensureLoaded());
  }

  async read() {
    return this.#locked(async () => ({
      state: structuredClone(await this.#ensureLoaded()),
      revision: this.revision
    }));
  }

  async update(mutator) {
    return this.#locked(async () => {
      const base = await this.#ensureLoaded();
      const draft = structuredClone(base);
      const mutationTime = this.now();
      const mutationTimestamp = mutationTime.toISOString();

      // Rejecting a returned Promise prevents accidental async mutators. It
      // cannot sandbox deliberate fire-and-forget work, so outbound adapters
      // also consult the AsyncLocalStorage mutation guard.
      const result = runStateMutation(() => mutator(draft, mutationTimestamp));
      if (result && typeof result.then === "function") {
        throw new TypeError("StateStore.update mutators must be synchronous and must not return a Promise.");
      }
      if (result === NO_STATE_CHANGE) {
        return { state: structuredClone(base), revision: this.revision };
      }

      const candidate = result === undefined ? draft : result;
      assertSupportedStoredStateVersion(candidate, this.stateVersion, this.requireExactStoredVersion);
      const next = this.normalize(candidate);
      next.meta.updatedAt = mutationTimestamp;
      await writeJsonAtomically(this.dataFile, next);
      this.currentState = next;
      this.revision += 1;
      return { state: structuredClone(next), revision: this.revision };
    });
  }

  async mutateIdempotently(options, mutator) {
    const request = normalizeIdempotentMutationRequest(options);
    return this.#locked(async () => {
      const base = await this.#ensureLoaded();
      await this.#ensureOperationsLoaded();
      const matches = [...this.operations.values()]
        .filter((operation) => operation.slotKey === request.slotKey);
      if (matches.length > 1) {
        throw idempotentRequestConflict(request.operationType);
      }

      const existing = matches[0] || null;
      if (existing) {
        if (existing.operationType !== request.operationType || existing.payloadHash !== request.payloadHash) {
          throw idempotentRequestConflict(request.operationType);
        }
        if (existing.status === "completed") {
          return { result: structuredClone(existing.result), replayed: true, revision: this.revision };
        }
        if (existing.status !== "reserved") {
          throw idempotentRequestConflict(request.operationType);
        }
      }

      const draft = structuredClone(base);
      const mutationTime = this.now();
      const mutationTimestamp = mutationTime.toISOString();
      const rawOutcome = runStateMutation(() => mutator(draft, mutationTimestamp));
      if (rawOutcome && typeof rawOutcome.then === "function") {
        throw new TypeError("StateStore.mutateIdempotently mutators must be synchronous and must not return a Promise.");
      }
      const outcome = normalizeIdempotentMutationOutcome(rawOutcome, draft);

      if (outcome.state !== NO_STATE_CHANGE) {
        assertSupportedStoredStateVersion(outcome.state, this.stateVersion, this.requireExactStoredVersion);
        const next = this.normalize(outcome.state);
        next.meta.updatedAt = mutationTimestamp;
        // The file backend is deliberately single-process. Persist the state
        // first, then its completed receipt. A process or disk failure between
        // the two files cannot be made transactional; Plan mutators must still
        // recognize their already-applied desired state when recovering from
        // that narrow local-only crash window.
        await writeJsonAtomically(this.dataFile, next);
        this.currentState = next;
        this.revision += 1;
      }

      const operation = existing || {
        operationKey: randomUUID(),
        temporaryId: randomUUID(),
        slotKey: request.slotKey,
        operationType: request.operationType,
        owner: request.owner,
        status: "reserved",
        payloadHash: request.payloadHash,
        leaseExpiresAt: new Date(mutationTime.getTime() + 120_000).toISOString(),
        result: null,
        createdAt: mutationTimestamp,
        updatedAt: mutationTimestamp
      };
      Object.assign(operation, {
        status: "completed",
        result: outcome.result,
        updatedAt: mutationTimestamp
      });
      this.operations.set(operation.operationKey, operation);
      await this.#writeOperations();
      return { result: structuredClone(outcome.result), replayed: false, revision: this.revision };
    });
  }

  async health() {
    try {
      await this.#locked(() => this.#ensureLoaded());
      return { ok: true, backend: "file" };
    } catch (error) {
      return { ok: false, backend: "file", error: error.message };
    }
  }

  async close() {
    await this.queue;
  }

  async reserveOperation({ slotKey, operationType, owner, payloadHash, leaseMs = 120_000, reuseCompleted = false }) {
    return this.#locked(async () => {
      await this.#ensureOperationsLoaded();
      const existing = [...this.operations.values()].find((operation) => {
        return operation.slotKey === slotKey &&
          new Set(["reserved", "pending_confirmation", ...(reuseCompleted ? ["completed"] : [])]).has(operation.status);
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw pendingOperationError(operationType);
        }
        return { ...structuredClone(existing), reused: true };
      }
      const now = this.now();
      const operation = {
        operationKey: randomUUID(),
        temporaryId: randomUUID(),
        slotKey,
        operationType,
        owner,
        status: "reserved",
        payloadHash,
        leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        result: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      this.operations.set(operation.operationKey, operation);
      await this.#writeOperations();
      return { ...structuredClone(operation), reused: false };
    });
  }

  async markOperationPending(operationKey, details = {}) {
    return this.#updateOperation(operationKey, "pending_confirmation", details);
  }

  async completeOperation(operationKey, details = {}) {
    return this.#updateOperation(operationKey, "completed", details);
  }

  async isLoginBlocked(keys, now = new Date()) {
    return keys.some(({ key, maxAttempts }) => {
      const entry = this.#loginEntry(key, now);
      return Boolean(entry && entry.count >= maxAttempts);
    });
  }

  async recordLoginFailure(keys, now = new Date()) {
    for (const { key } of keys) {
      const entry = this.#loginEntry(key, now);
      if (entry) {
        entry.count += 1;
      } else {
        this.loginAttempts.set(key, { count: 1, windowStartedAt: now.getTime() });
      }
    }
  }

  async resetLoginFailures(keys) {
    for (const { key } of keys) {
      this.loginAttempts.delete(key);
    }
  }

  #loginEntry(key, now) {
    const entry = this.loginAttempts.get(key);
    if (!entry) {
      return null;
    }
    if (now.getTime() - entry.windowStartedAt >= 15 * 60 * 1000) {
      this.loginAttempts.delete(key);
      return null;
    }
    return entry;
  }

  #locked(task) {
    const run = this.queue.then(task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #ensureLoaded() {
    if (this.currentState) {
      return this.currentState;
    }

    const seed = this.normalize(await this.loadSeed());
    let state;
    let shouldWrite = false;
    try {
      const persisted = JSON.parse(await fs.readFile(this.dataFile, "utf8"));
      assertSupportedStoredStateVersion(persisted, this.stateVersion, this.requireExactStoredVersion);
      state = this.normalize(persisted);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      state = await this.#readLegacyState() || this.normalize(structuredClone(seed));
      shouldWrite = true;
    }

    const merged = this.mergeSeed(state, seed);
    if (shouldWrite || merged.changed) {
      assertSupportedStoredStateVersion(merged.state, this.stateVersion, this.requireExactStoredVersion);
      await writeJsonAtomically(this.dataFile, merged.state);
    }
    this.currentState = merged.state;
    return this.currentState;
  }

  async #ensureOperationsLoaded() {
    if (this.operations) {
      return;
    }
    try {
      const values = JSON.parse(await fs.readFile(this.operationFile, "utf8"));
      this.operations = new Map(
        (Array.isArray(values) ? values : []).map((operation) => [operation.operationKey, operation])
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      this.operations = new Map();
    }
  }

  async #updateOperation(operationKey, status, details) {
    return this.#locked(async () => {
      await this.#ensureOperationsLoaded();
      const operation = this.operations.get(operationKey);
      if (!operation) {
        throw new Error(`Unknown operation lease: ${operationKey}`);
      }
      Object.assign(operation, details, { status, updatedAt: this.now().toISOString() });
      await this.#writeOperations();
      return structuredClone(operation);
    });
  }

  async #writeOperations() {
    const values = [...this.operations.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-200);
    this.operations = new Map(values.map((operation) => [operation.operationKey, operation]));
    await writeJsonAtomically(this.operationFile, values);
  }

  async #readLegacyState() {
    if (!this.legacyDataFile) {
      return null;
    }
    try {
      const persisted = JSON.parse(await fs.readFile(this.legacyDataFile, "utf8"));
      assertSupportedStoredStateVersion(persisted, this.stateVersion, this.requireExactStoredVersion);
      return this.normalize(persisted);
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}

export async function createStateStore(options) {
  if (options.backend === "postgres") {
    throw new Error("This sample supports local file storage only.");
  }
  if (options.backend !== "file") {
    throw new Error(`Unsupported STORAGE_BACKEND: ${options.backend}`);
  }
  return new FileStateStore(options);
}

const postgresStartupRetryDelaysMs = Object.freeze([250, 500, 1000, 2000]);
const retryablePostgresStartupCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "57P03"
]);

export async function initializeStateStoreWithRetry(stateStore, {
  backend,
  retryDelaysMs = postgresStartupRetryDelaysMs,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  onRetry = () => {}
} = {}) {
  let attempt = 1;
  while (true) {
    try {
      await stateStore.initialize();
      return { attempts: attempt };
    } catch (error) {
      const delayMs = retryDelaysMs[attempt - 1];
      if (backend !== "postgres" || delayMs === undefined || !isRetryablePostgresStartupError(error)) {
        throw error;
      }
      await onRetry({
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        errorCode: String(error.code || "UNKNOWN")
      });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

export function isRetryablePostgresStartupError(error) {
  const code = String(error?.code || "");
  return code.startsWith("08") || retryablePostgresStartupCodes.has(code);
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function canonicalChecksum(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])])
  );
}

export function assertSupportedStoredStateVersion(document, expectedVersion, requireExact = false) {
  const supported = Number(expectedVersion) || 0;
  if (!supported) return document;
  const actual = Number(document?.version || 0);
  if (actual > supported) {
    const error = new Error(`State version ${actual} is newer than this application supports (${supported}). Refusing to normalize it.`);
    error.code = "UNSUPPORTED_STATE_VERSION";
    throw error;
  }
  if (requireExact && actual !== supported) {
    const error = new Error(`State version ${actual || "unknown"} requires the explicit migration to version ${supported} before application startup.`);
    error.code = "STATE_MIGRATION_REQUIRED";
    throw error;
  }
  return document;
}

export function normalizeIdempotentMutationRequest(options = {}) {
  const slotKey = requiredOperationText(options.slotKey, "slotKey", 512);
  const payloadHash = requiredOperationText(options.payloadHash, "payloadHash", 256);
  const owner = requiredOperationText(options.owner, "owner", 120);
  const operationType = options.operationType === undefined ? "plan_mutation" : String(options.operationType);
  if (!new Set(["plan_mutation", "together_mutation", "capture_token_mutation"]).has(operationType)) {
    throw new TypeError("Idempotent state mutations must use a supported operation type.");
  }
  return { slotKey, payloadHash, owner, operationType };
}

export function normalizeIdempotentMutationOutcome(outcome, draft) {
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome) || !Object.hasOwn(outcome, "result")) {
    throw new TypeError("Idempotent state mutators must return an object containing result.");
  }
  const result = normalizeSmallOperationResult(outcome.result);
  const state = Object.hasOwn(outcome, "state") ? outcome.state : draft;
  if (state !== NO_STATE_CHANGE && (!state || typeof state !== "object" || Array.isArray(state))) {
    throw new TypeError("Idempotent state mutator state must be an object or NO_STATE_CHANGE.");
  }
  return { state, result };
}

export function planRequestConflict() {
  return idempotentRequestConflict("plan_mutation");
}

export function idempotentRequestConflict(operationType) {
  const together = operationType === "together_mutation";
  const capture = operationType === "capture_token_mutation";
  const error = new Error(capture
    ? "This capture request ID was already used with different information."
    : `This ${together ? "Together" : "Plan"} request ID was already used with different information.`);
  error.statusCode = 409;
  error.code = capture ? "CAPTURE_REQUEST_CONFLICT" : together ? "TOGETHER_REQUEST_CONFLICT" : "PLAN_REQUEST_CONFLICT";
  return error;
}

async function writeJsonAtomically(fileName, value) {
  await fs.mkdir(path.dirname(fileName), { recursive: true });
  const temporary = `${fileName}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, fileName);
}

function requiredOperationText(value, label, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new TypeError(`Idempotent mutation ${label} must be nonempty text of at most ${limit} characters.`);
  }
  return value.trim();
}

function normalizeSmallOperationResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Idempotent mutation result must be a JSON object.");
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("Idempotent mutation result must be JSON serializable.");
  }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 16 * 1024) {
    throw new TypeError("Idempotent mutation result must be 16 KiB or smaller.");
  }
  return JSON.parse(serialized);
}

function pendingOperationError(operationType = "") {
  const structuredCreate = operationType === "structured_item_create";
  const bulkCreate = operationType === "structured_bulk_create";
  const guideCreate = operationType === "guide_create";
  const error = new Error(structuredCreate
    ? "This creation request was already used with different information."
    : bulkCreate
      ? "This bulk request was already used with different information."
      : guideCreate
        ? "This Guide creation request was already used with different information."
      : "A previous Todoist operation for this item is still awaiting confirmation.");
  error.statusCode = 409;
  if (structuredCreate) error.code = "STRUCTURED_CREATE_CONFLICT";
  if (bulkCreate) error.code = "BULK_CAPTURE_CONFLICT";
  if (guideCreate) error.code = "GUIDE_CREATE_CONFLICT";
  return error;
}
