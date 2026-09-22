import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createSessionToken,
  readSessionToken,
  parseCookies,
} from "../src/auth.js";
import { searchSaved, normalizePlace } from "../src/discovery.js";
import { isVisibleToUser } from "../src/visibility.js";
import { canonicalChecksum } from "../src/state-store.js";
import { NO_STATE_CHANGE } from "../src/transaction-context.js";
import {
  buildWebPlans,
  buildWebPlan,
  findVisiblePlan,
  normalizePlanCreateInput,
  createPlanInState,
  normalizePlanPatchInput,
  applyPlanCoreUpdate,
  normalizePlanNoteInput,
  normalizePlanRequestId,
  applyPlanNoteUpdate,
} from "../src/plans.js";
import { openStore } from "./store.js";
import { accounts } from "./seed.js";
import { integrationStatus, previewStub } from "./integrations.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/views.js", ["views.js", "text/javascript"]],
  ["/navigation.js", ["navigation.js", "text/javascript"]],
  ["/styles.css", ["styles.css", "text/css"]],
  [
    "/vendor/source-serif-4/SourceSerif4Variable-Roman.woff2",
    ["vendor/source-serif-4/SourceSerif4Variable-Roman.woff2", "font/woff2"],
  ],
]);
const fail = (status, message) =>
  Object.assign(new Error(message), { statusCode: status });
const bounded = (v, max, required = false) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw fail(400, "Invalid text field.");
  return v.trim();
};
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 32768)
      throw fail(413, "Request is too large.");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw fail(400, "Expected JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw fail(400, "Expected a JSON object.");
  return value;
}
export async function startDemo({
  port = 4177,
  dataDirectory = path.join(root, ".demo-data"),
  assetDirectory = path.join(root, "public"),
} = {}) {
  const store = openStore(path.join(dataDirectory, "board.json"));
  await store.initialize();
  const secret = randomBytes(32).toString("hex");
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const host = req.headers.host;
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const origin = `http://${host}`;
    const json = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      if (!allowedHosts.has(host))
        throw fail(403, "Use the printed loopback URL.");
      const url = new URL(req.url, origin);
      if (req.method === "GET" && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const data = await fs.readFile(path.join(assetDirectory, file));
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
        return;
      }
      if (!url.pathname.startsWith("/api/")) throw fail(404, "Not found.");
      if (!["GET", "POST", "PATCH"].includes(req.method))
        throw fail(405, "Method not allowed.");
      if (
        req.method !== "GET" &&
        (req.headers.origin !== origin ||
          req.headers["x-demo-request"] !== "1" ||
          !req.headers["content-type"]?.startsWith("application/json"))
      )
        throw fail(403, "Same-origin JSON request required.");
      if (url.pathname === "/api/login" && req.method === "POST") {
        const input = await body(req);
        // Both identities are available to every local evaluator. This selects
        // a demo role; it does not pretend to authenticate a private account.
        if (!accounts.includes(input.user))
          throw fail(400, "Choose Alex or Jamie.");
        const token = createSessionToken(secret, {
          user: input.user,
          maxAgeMs: 3600000,
        });
        res.setHeader(
          "Set-Cookie",
          `sample_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`,
        );
        json(200, { user: input.user });
        return;
      }
      let session;
      try {
        session = readSessionToken(
          parseCookies(req.headers.cookie || "").sample_session,
          secret,
        );
      } catch {}
      if (!session || !accounts.includes(session.user))
        throw fail(401, "Choose a demo account to continue.");
      const user = session.user;
      if (url.pathname === "/api/logout" && req.method === "POST") {
        res.setHeader(
          "Set-Cookie",
          "sample_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        );
        json(200, { ok: true });
        return;
      }
      if (url.pathname === "/api/session" && req.method === "GET") {
        json(200, { user, accounts, integrations: integrationStatus });
        return;
      }
      const { state, revision } = await store.read();
      if (url.pathname === "/api/search" && req.method === "GET") {
        json(200, {
          ...searchSaved(state, user, Object.fromEntries(url.searchParams)),
          revision,
        });
        return;
      }
      if (url.pathname === "/api/plans" && req.method === "GET") {
        json(200, buildWebPlans(state, user, accounts));
        return;
      }
      if (url.pathname === "/api/preview" && req.method === "POST") {
        await body(req);
        json(200, previewStub());
        return;
      }
      if (url.pathname === "/api/items" && req.method === "POST") {
        const input = await body(req);
        const title = bounded(input.title, 180, true),
          summary = bounded(input.summary || "", 2000),
          kind = input.kind;
        if (!["place", "article", "book", "idea"].includes(kind))
          throw fail(400, "Choose a supported kind.");
        const sourceUrl = bounded(input.sourceUrl || "", 500);
        if (sourceUrl) {
          let u;
          try {
            u = new URL(sourceUrl);
          } catch {
            throw fail(400, "Use a fictional https://...invalid URL.");
          }
          if (
            u.protocol !== "https:" ||
            !u.hostname.endsWith(".invalid") ||
            u.username ||
            u.password
          )
            throw fail(
              400,
              "This sample only accepts fictional .invalid links.",
            );
        }
        const id = "sample-" + randomUUID();
        await store.update((draft) => {
          draft.activities.push({
            id,
            title,
            summary,
            kind,
            collection: "saved",
            createdBy: user,
            createdAt: new Date().toISOString(),
            notes: { Alex: "", Jamie: "" },
            ratings: { Alex: 0, Jamie: 0 },
            sourceUrl,
            place: normalizePlace(
              kind === "place"
                ? {
                    city: bounded(input.city || "", 120),
                    subtype: input.subtype,
                  }
                : {},
            ),
            tags: [],
            stage: "considering",
            status: "Considering",
          });
        });
        json(201, { id });
        return;
      }
      const itemMatch = /^\/api\/items\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
      if (itemMatch && req.method === "GET") {
        const item = state.activities.find(
          (x) => x.id === itemMatch[1] && isVisibleToUser(x, user),
        );
        if (!item) throw fail(404, "Item not found.");
        json(200, { item, version: canonicalChecksum(item) });
        return;
      }
      const planMatch = /^\/api\/plans\/([a-zA-Z0-9-]+)(\/note)?$/.exec(
        url.pathname,
      );
      if (planMatch && req.method === "GET" && !planMatch[2]) {
        json(
          200,
          buildWebPlan(
            state,
            findVisiblePlan(state, planMatch[1], user),
            user,
            accounts,
          ),
        );
        return;
      }
      if (
        (url.pathname === "/api/plans" && req.method === "POST") ||
        (planMatch && req.method === "PATCH")
      ) {
        const input = await body(req);
        const normalized = !planMatch
          ? normalizePlanCreateInput(input, user)
          : planMatch[2]
            ? (() => {
                const { requestId, ...note } = input;
                return {
                  ...normalizePlanNoteInput(note),
                  requestId: normalizePlanRequestId(requestId),
                };
              })()
            : normalizePlanPatchInput(input);
        const route = planMatch
          ? `edit:${planMatch[1]}:${planMatch[2] || "core"}`
          : "create";
        const result = await store.mutateIdempotently(
          {
            slotKey: `${user}:${route}:${normalized.requestId}`,
            owner: user,
            payloadHash: canonicalChecksum(normalized),
          },
          (draft, at) => {
            const outcome = !planMatch
              ? createPlanInState(draft, normalized, user, at)
              : planMatch[2]
                ? applyPlanNoteUpdate(
                    findVisiblePlan(draft, planMatch[1], user),
                    normalized,
                    user,
                    at,
                  )
                : applyPlanCoreUpdate(
                    draft,
                    findVisiblePlan(draft, planMatch[1], user),
                    normalized,
                    at,
                    accounts,
                  );
            return {
              state: outcome.changed ? draft : NO_STATE_CHANGE,
              result: { planId: outcome.plan.id },
            };
          },
        );
        json(200, result);
        return;
      }
      throw fail(404, "Not found.");
    } catch (error) {
      json(error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : "Local operation failed; no automatic retry was queued.",
        code: error.code || "",
      });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    store,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // No .env loader, production config, caller-supplied storage path, or service adapter.
  const app = await startDemo();
  console.log(`Fictional local sample: ${app.url}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
