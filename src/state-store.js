import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { NO_STATE_CHANGE, runStateMutation } from "./transaction-context.js";

export class FileStateStore {
  constructor({
    dataFile,
    normalize,
    loadSeed,
    mergeSeed,
    now = () => new Date(),
    stateVersion = 0,
    requireExactStoredVersion = false,
  }) {
    this.dataFile = dataFile;
    this.normalize = normalize;
    this.loadSeed = loadSeed;
    this.mergeSeed = mergeSeed;
    this.now = now;
    this.stateVersion = Number(stateVersion) || 0;
    this.requireExactStoredVersion = requireExactStoredVersion === true;
    this.currentState = null;
    this.revision = 0;
    this.queue = Promise.resolve();
    this.operationFile = `${dataFile}.operations.json`;
    this.operations = null;
  }

  async initialize() {
    await this.#locked(() => this.#ensureLoaded());
  }

  async read() {
    return this.#locked(async () => ({
      state: structuredClone(await this.#ensureLoaded()),
      revision: this.revision,
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
        throw new TypeError(
          "StateStore.update mutators must be synchronous and must not return a Promise.",
        );
      }
      if (result === NO_STATE_CHANGE) {
        return { state: structuredClone(base), revision: this.revision };
      }

      const candidate = result === undefined ? draft : result;
      assertSupportedStoredStateVersion(
        candidate,
        this.stateVersion,
        this.requireExactStoredVersion,
      );
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
      const matches = [...this.operations.values()].filter(
        (operation) => operation.slotKey === request.slotKey,
      );
      if (matches.length > 1) {
        throw idempotentRequestConflict(request.operationType);
      }

      const existing = matches[0] || null;
      if (existing) {
        if (
          existing.operationType !== request.operationType ||
          existing.payloadHash !== request.payloadHash
        ) {
          throw idempotentRequestConflict(request.operationType);
        }
        if (existing.status === "completed") {
          return {
            result: structuredClone(existing.result),
            replayed: true,
            revision: this.revision,
          };
        }
        if (existing.status !== "reserved") {
          throw idempotentRequestConflict(request.operationType);
        }
      }

      const draft = structuredClone(base);
      const mutationTime = this.now();
      const mutationTimestamp = mutationTime.toISOString();
      const rawOutcome = runStateMutation(() =>
        mutator(draft, mutationTimestamp),
      );
      if (rawOutcome && typeof rawOutcome.then === "function") {
        throw new TypeError(
          "StateStore.mutateIdempotently mutators must be synchronous and must not return a Promise.",
        );
      }
      const outcome = normalizeIdempotentMutationOutcome(rawOutcome, draft);

      if (outcome.state !== NO_STATE_CHANGE) {
        assertSupportedStoredStateVersion(
          outcome.state,
          this.stateVersion,
          this.requireExactStoredVersion,
        );
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
        leaseExpiresAt: new Date(
          mutationTime.getTime() + 120_000,
        ).toISOString(),
        result: null,
        createdAt: mutationTimestamp,
        updatedAt: mutationTimestamp,
      };
      Object.assign(operation, {
        status: "completed",
        result: outcome.result,
        updatedAt: mutationTimestamp,
      });
      this.operations.set(operation.operationKey, operation);
      await this.#writeOperations();
      return {
        result: structuredClone(outcome.result),
        replayed: false,
        revision: this.revision,
      };
    });
  }

  async close() {
    await this.queue;
  }

  #locked(task) {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
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
      assertSupportedStoredStateVersion(
        persisted,
        this.stateVersion,
        this.requireExactStoredVersion,
      );
      state = this.normalize(persisted);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      state = this.normalize(structuredClone(seed));
      shouldWrite = true;
    }

    const merged = this.mergeSeed(state, seed);
    if (shouldWrite || merged.changed) {
      assertSupportedStoredStateVersion(
        merged.state,
        this.stateVersion,
        this.requireExactStoredVersion,
      );
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
        (Array.isArray(values) ? values : []).map((operation) => [
          operation.operationKey,
          operation,
        ]),
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      this.operations = new Map();
    }
  }

  async #writeOperations() {
    const values = [...this.operations.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-200);
    this.operations = new Map(
      values.map((operation) => [operation.operationKey, operation]),
    );
    await writeJsonAtomically(this.operationFile, values);
  }
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function canonicalChecksum(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function assertSupportedStoredStateVersion(
  document,
  expectedVersion,
  requireExact = false,
) {
  const supported = Number(expectedVersion) || 0;
  if (!supported) return document;
  const actual = Number(document?.version || 0);
  if (actual > supported) {
    const error = new Error(
      `State version ${actual} is newer than this application supports (${supported}). Refusing to normalize it.`,
    );
    error.code = "UNSUPPORTED_STATE_VERSION";
    throw error;
  }
  if (requireExact && actual !== supported) {
    const error = new Error(
      `State version ${actual || "unknown"} does not match this sample format (${supported}).`,
    );
    error.code = "STATE_MIGRATION_REQUIRED";
    throw error;
  }
  return document;
}

function normalizeIdempotentMutationRequest(options = {}) {
  const slotKey = requiredOperationText(options.slotKey, "slotKey", 512);
  const payloadHash = requiredOperationText(
    options.payloadHash,
    "payloadHash",
    256,
  );
  const owner = requiredOperationText(options.owner, "owner", 120);
  const operationType =
    options.operationType === undefined
      ? "plan_mutation"
      : String(options.operationType);
  if (operationType !== "plan_mutation") {
    throw new TypeError(
      "Idempotent state mutations must use a supported operation type.",
    );
  }
  return { slotKey, payloadHash, owner, operationType };
}

function normalizeIdempotentMutationOutcome(outcome, draft) {
  if (
    !outcome ||
    typeof outcome !== "object" ||
    Array.isArray(outcome) ||
    !Object.hasOwn(outcome, "result")
  ) {
    throw new TypeError(
      "Idempotent state mutators must return an object containing result.",
    );
  }
  const result = normalizeSmallOperationResult(outcome.result);
  const state = Object.hasOwn(outcome, "state") ? outcome.state : draft;
  if (
    state !== NO_STATE_CHANGE &&
    (!state || typeof state !== "object" || Array.isArray(state))
  ) {
    throw new TypeError(
      "Idempotent state mutator state must be an object or NO_STATE_CHANGE.",
    );
  }
  return { state, result };
}

function idempotentRequestConflict() {
  const error = new Error(
    "This Plan request ID was already used with different information.",
  );
  error.statusCode = 409;
  error.code = "PLAN_REQUEST_CONFLICT";
  return error;
}

async function writeJsonAtomically(fileName, value) {
  await fs.mkdir(path.dirname(fileName), { recursive: true });
  const temporary = `${fileName}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporary, fileName);
}

function requiredOperationText(value, label, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new TypeError(
      `Idempotent mutation ${label} must be nonempty text of at most ${limit} characters.`,
    );
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
    throw new TypeError(
      "Idempotent mutation result must be JSON serializable.",
    );
  }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 16 * 1024) {
    throw new TypeError(
      "Idempotent mutation result must be 16 KiB or smaller.",
    );
  }
  return JSON.parse(serialized);
}
