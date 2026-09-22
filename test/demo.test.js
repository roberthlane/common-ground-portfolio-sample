import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { startDemo } from "../demo/server.js";
import { openStore, normalizeSample } from "../demo/store.js";
import { makeSeed } from "../demo/seed.js";
import { searchSaved } from "../src/discovery.js";
import { canonicalChecksum } from "../src/state-store.js";
import { normalizePlanCreateInput, createPlanInState } from "../src/plans.js";
import {
  NO_STATE_CHANGE,
  assertOutboundAllowed,
} from "../src/transaction-context.js";
const planInput = (
  title = "An invented plan",
  audience = "Shared",
  items = [],
) => ({
  requestId: randomUUID(),
  plan: {
    title,
    summary: "Original synthetic test content.",
    audience,
    status: "Draft",
    startDate: "",
    endDate: "",
    items: items.map((itemId) => ({
      itemId,
      dayLabel: "",
      plannedDate: "",
      timeLabel: "",
    })),
    steps: [],
  },
});
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocg-fictional-test-"));
  const app = await startDemo({ port: 0, dataDirectory: dir, ...options });
  t.after(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { ...app, dir };
}
async function request(
  app,
  url,
  method = "GET",
  data,
  cookie = "",
  extra = {},
) {
  const r = await fetch(app.url + url, {
    method,
    headers: {
      Origin: app.url,
      "Content-Type": "application/json",
      "X-Demo-Request": "1",
      cookie,
      ...extra,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(app, user = "Alex") {
  const r = await request(app, "/api/login", "POST", {
    user,
  });
  assert.equal(r.status, 200);
  return r.cookie;
}
const draftOf = (p) =>
  Object.fromEntries(
    [
      "title",
      "summary",
      "status",
      "startDate",
      "endDate",
      "items",
      "steps",
    ].map((k) => [k, p[k]]),
  );
test("search discovers fictional restaurants from archived context and ranks location", () => {
  const s = makeSeed();
  const r = searchSaved(s, "Alex", {
    q: "Mossport",
    type: "place",
    subtype: "restaurant",
  });
  assert.deepEqual(
    r.items.map((i) => i.id),
    ["lantern-table"],
  );
  assert.equal(r.items[0].sourceArchived, true);
  assert.equal(
    searchSaved(s, "Alex", {
      q: "Mossport",
      type: "place",
      subtype: "restaurant",
      archived: "exclude",
    }).total,
    0,
  );
});
test("unknown or production-shaped documents are rejected rather than loaded", () => {
  assert.throws(
    () => normalizeSample({ version: 8, activities: [] }),
    /fictional sample/,
  );
});
test("authentication, same-origin writes, host boundary, and static allowlist", async (t) => {
  const app = await fixture(t);
  assert.equal((await request(app, "/api/search")).status, 401);
  assert.equal(
    (
      await request(app, "/api/login", "POST", {
        user: "Unknown",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app, "/api/login", "POST", { user: "Alex" }, "", {
        Origin: "https://outsider.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app, "/api/login", "POST", { user: "Alex" }, "", {
        "X-Demo-Request": "0",
      })
    ).status,
    403,
  );
  assert.equal(
    await new Promise((resolve, reject) => {
      const req = http.get(
        app.url + "/api/search",
        { headers: { Host: "outsider.invalid" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
    }),
    403,
  );
  assert.equal((await fetch(app.url + "/.demo-data/board.json")).status, 404);
  const cookie = await login(app);
  assert.equal(
    (await request(app, "/api/session", "GET", undefined, cookie)).data.user,
    "Alex",
  );
});
test("private items, search counts, and private plans are filtered for each role", async (t) => {
  const app = await fixture(t);
  for (const [user, own, other] of [
    ["Alex", "alex-preparation", "jamie-preparation"],
    ["Jamie", "jamie-preparation", "alex-preparation"],
  ]) {
    const cookie = await login(app, user),
      r = await request(app, "/api/search?scope=all", "GET", undefined, cookie);
    assert.equal(r.data.total, 7);
    assert.ok(r.data.items.some((i) => i.id === own));
    assert.ok(!r.data.items.some((i) => i.id === other));
    assert.equal(
      (await request(app, "/api/items/" + other, "GET", undefined, cookie))
        .status,
      404,
    );
    const plans = (await request(app, "/api/plans", "GET", undefined, cookie))
      .data.plans;
    assert.equal(plans.length, 2);
    assert.ok(
      plans.every((p) => p.audience === "Shared" || p.audience === "Only me"),
    );
    const opposite = (await app.store.read()).state.plans.find(
      (p) => p.audience !== "Shared" && p.audience !== user,
    );
    assert.equal(
      (
        await request(
          app,
          "/api/plans/" + opposite.id,
          "GET",
          undefined,
          cookie,
        )
      ).status,
      404,
    );
  }
});
test("shared plans cannot smuggle a private item; private audience cannot be reassigned", async (t) => {
  const app = await fixture(t),
    cookie = await login(app);
  assert.equal(
    (
      await request(
        app,
        "/api/plans",
        "POST",
        planInput("No leak", "Shared", ["alex-preparation"]),
        cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        app,
        "/api/plans",
        "POST",
        planInput("Wrong owner", "Jamie"),
        cookie,
      )
    ).status,
    400,
  );
  const p = (await app.store.read()).state.plans[0];
  const d = (await request(app, "/api/plans/" + p.id, "GET", undefined, cookie))
    .data.plan;
  assert.equal(
    (
      await request(
        app,
        "/api/plans/" + p.id,
        "PATCH",
        {
          requestId: randomUUID(),
          planVersion: d.planVersion,
          plan: { ...draftOf(d), audience: "Only me" },
        },
        cookie,
      )
    ).status,
    409,
  );
});
test("create retries replay one receipt and reject changed payload under the same ID", async (t) => {
  const app = await fixture(t),
    cookie = await login(app),
    input = planInput();
  const a = await request(app, "/api/plans", "POST", input, cookie),
    b = await request(app, "/api/plans", "POST", input, cookie);
  assert.equal(a.status, 200);
  assert.equal(b.data.replayed, true);
  assert.equal(a.data.result.planId, b.data.result.planId);
  assert.equal((await app.store.read()).state.plans.length, 4);
  input.plan.title = "Different payload";
  assert.equal(
    (await request(app, "/api/plans", "POST", input, cookie)).status,
    409,
  );
});
test("concurrent edits produce one winner; stale version cannot overwrite it", async (t) => {
  const app = await fixture(t),
    cookie = await login(app),
    id = (await app.store.read()).state.plans[0].id;
  const p = (await request(app, "/api/plans/" + id, "GET", undefined, cookie))
    .data.plan;
  const writes = ["First proposed title", "Second proposed title"].map(
    (title) =>
      request(
        app,
        "/api/plans/" + id,
        "PATCH",
        {
          requestId: randomUUID(),
          planVersion: p.planVersion,
          plan: { ...draftOf(p), title },
        },
        cookie,
      ),
  );
  const result = await Promise.all(writes);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 412]);
  assert.equal((await app.store.read()).state.plans[0].items.length, 2);
});
test("notes use independent versions and the authenticated author", async (t) => {
  const app = await fixture(t),
    alex = await login(app),
    jamie = await login(app, "Jamie"),
    id = (await app.store.read()).state.plans[0].id;
  const a = (await request(app, "/api/plans/" + id, "GET", undefined, alex))
    .data.plan;
  const j = (await request(app, "/api/plans/" + id, "GET", undefined, jamie))
    .data.plan;
  assert.equal(
    (
      await request(
        app,
        "/api/plans/" + id + "/note",
        "PATCH",
        {
          requestId: randomUUID(),
          noteVersion: a.noteVersion,
          note: "Invented Alex thought",
        },
        alex,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        app,
        "/api/plans/" + id + "/note",
        "PATCH",
        {
          requestId: randomUUID(),
          noteVersion: j.noteVersion,
          note: "Invented Jamie thought",
        },
        jamie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        app,
        "/api/plans/" + id + "/note",
        "PATCH",
        {
          requestId: randomUUID(),
          noteVersion: a.noteVersion,
          note: "Stale replacement",
        },
        alex,
      )
    ).status,
    412,
  );
  const p = (await app.store.read()).state.plans[0];
  assert.equal(p.notes.Alex, "Invented Alex thought");
  assert.equal(p.notes.Jamie, "Invented Jamie thought");
});
test("read requests do not change state or revision", async (t) => {
  const app = await fixture(t),
    cookie = await login(app),
    before = await app.store.read();
  for (let i = 0; i < 3; i++) {
    await request(app, "/api/search", "GET", undefined, cookie);
    await request(app, "/api/plans", "GET", undefined, cookie);
  }
  assert.deepEqual(await app.store.read(), before);
});
test("preview failure still permits saving and rejects real external source links", async (t) => {
  const app = await fixture(t),
    cookie = await login(app);
  assert.equal(
    (await request(app, "/api/preview", "POST", {}, cookie)).data.available,
    false,
  );
  const input = {
    title: "An original imaginary article",
    summary: "Written for this test.",
    kind: "article",
    sourceUrl: "https://stories.invalid/one",
  };
  assert.equal(
    (await request(app, "/api/items", "POST", input, cookie)).status,
    201,
  );
  input.sourceUrl = "https://example.com/";
  assert.equal(
    (await request(app, "/api/items", "POST", input, cookie)).status,
    400,
  );
});
test("failed mutators and forbidden outbound work leave persisted state intact", async (t) => {
  const app = await fixture(t),
    before = await app.store.read();
  await assert.rejects(
    app.store.update((s) => {
      s.activities = [];
      throw Error("Simulated mutation failure");
    }),
    /Simulated/,
  );
  await assert.rejects(
    app.store.update(() => assertOutboundAllowed("test stub")),
    /network I\/O/,
  );
  assert.deepEqual(await app.store.read(), before);
  const reopened = openStore(path.join(app.dir, "board.json"));
  assert.deepEqual((await reopened.read()).state, before.state);
});
test("restart preserves plans and retries, including the documented missing-receipt crash window", async (t) => {
  const app = await fixture(t),
    input = normalizePlanCreateInput(planInput("Recovery example"), "Alex");
  const options = {
    slotKey: "recovery:" + input.requestId,
    owner: "Alex",
    payloadHash: canonicalChecksum(input),
  };
  const mutator = (s, at) => {
    const o = createPlanInState(s, input, "Alex", at);
    return {
      state: o.changed ? s : NO_STATE_CHANGE,
      result: { planId: o.plan.id },
    };
  };
  await app.store.mutateIdempotently(options, mutator);
  const reopened = openStore(path.join(app.dir, "board.json"));
  const retry = await reopened.mutateIdempotently(options, mutator);
  assert.equal(retry.replayed, true);
  await fs.unlink(path.join(app.dir, "board.json.operations.json"));
  const recovered = openStore(path.join(app.dir, "board.json"));
  await recovered.mutateIdempotently(options, mutator);
  assert.equal(
    (await recovered.read()).state.plans.filter(
      (p) => p.title === "Recovery example",
    ).length,
    1,
  );
});
test("unreadable local state fails closed and is not overwritten with seed", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "ocg-fictional-corrupt-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "board.json");
  await fs.writeFile(file, "{broken");
  await assert.rejects(openStore(file).initialize());
  assert.equal(await fs.readFile(file, "utf8"), "{broken");
});

test("loopback aliases work while cross-origin writes remain forbidden", async (t) => {
  const app = await fixture(t);
  const host = `localhost:${app.server.address().port}`;
  const send = (origin) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        app.url + "/api/login",
        {
          method: "POST",
          headers: {
            Host: host,
            Origin: origin,
            "Content-Type": "application/json",
            "X-Demo-Request": "1",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ user: "Alex" }));
    });
  assert.equal(await send(`http://${host}`), 200);
  assert.equal(await send(app.url), 403);
  assert.equal(await send("http://localhost.attacker.invalid"), 403);
});

test("all JSON mutation routes reject non-object bodies without changing state", async (t) => {
  const app = await fixture(t),
    cookie = await login(app);
  const before = await app.store.read(),
    id = before.state.plans[0].id;
  for (const [route, method] of [
    ["/api/login", "POST"],
    ["/api/items", "POST"],
    ["/api/plans", "POST"],
    [`/api/plans/${id}`, "PATCH"],
    [`/api/plans/${id}/note`, "PATCH"],
  ]) {
    for (const value of [null, [], "text", 42]) {
      assert.equal(
        (await request(app, route, method, value, cookie)).status,
        400,
        route,
      );
    }
  }
  assert.deepEqual(await app.store.read(), before);
});

test("demo account selection cannot lock out another evaluator and uses the shipped cookie policy", async (t) => {
  const app = await fixture(t);
  for (let i = 0; i < 20; i++) {
    assert.equal(
      (await request(app, "/api/login", "POST", { user: "Unknown" })).status,
      400,
    );
  }
  for (const user of ["Alex", "Jamie"]) {
    const res = await fetch(app.url + "/api/login", {
      method: "POST",
      headers: {
        Origin: app.url,
        "X-Demo-Request": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user }),
    });
    assert.equal(res.status, 200);
    const header = res.headers.get("set-cookie");
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/);
    assert.match(header, /Max-Age=3600/);
    const cookie = header.split(";")[0];
    assert.equal(
      (await request(app, "/api/session", "GET", undefined, cookie)).data.user,
      user,
    );
    const logout = await fetch(app.url + "/api/logout", {
      method: "POST",
      headers: {
        cookie,
        Origin: app.url,
        "X-Demo-Request": "1",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  }
});

test("a missing static asset returns an error without taking down the server", async (t) => {
  const assets = await fs.mkdtemp(
    path.join(os.tmpdir(), "ocg-missing-assets-"),
  );
  t.after(() => fs.rm(assets, { recursive: true, force: true }));
  const app = await fixture(t, { assetDirectory: assets });
  assert.equal((await fetch(app.url + "/app.js")).status, 500);
  const cookie = await login(app);
  assert.equal(
    (await request(app, "/api/search", "GET", undefined, cookie)).status,
    200,
  );
});

test("identical desired-state retries accept stale valid versions, but changes and malformed versions do not", async (t) => {
  const app = await fixture(t),
    cookie = await login(app);
  const id = (await app.store.read()).state.plans[0].id;
  const p = (await request(app, `/api/plans/${id}`, "GET", undefined, cookie))
    .data.plan;
  const before = await app.store.read();
  const patch = (version, plan) =>
    request(
      app,
      `/api/plans/${id}`,
      "PATCH",
      {
        requestId: randomUUID(),
        planVersion: version,
        plan,
      },
      cookie,
    );
  assert.equal((await patch("0".repeat(64), draftOf(p))).status, 200);
  assert.deepEqual(await app.store.read(), before);
  assert.equal((await patch("garbage", draftOf(p))).status, 400);
  assert.equal(
    (await patch("0".repeat(64), { ...draftOf(p), title: "Different title" }))
      .status,
    412,
  );
  assert.deepEqual(await app.store.read(), before);
});
