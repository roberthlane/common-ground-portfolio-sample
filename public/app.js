const app = document.querySelector("#app"),
  notice = document.querySelector("#notice");
let user = "",
  epoch = 0;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const message = (text) => {
  notice.textContent = text;
};
const uid = () => crypto.randomUUID();
async function api(url, method = "GET", value) {
  const options = {
    method,
    headers: { "Content-Type": "application/json", "X-Demo-Request": "1" },
  };
  if (value !== undefined) options.body = JSON.stringify(value);
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw Error(
      "Connection interrupted. Your text is still here. Reconnect and deliberately retry.",
    );
  }
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Request failed.");
  return data;
}
function formHandler(id, handler) {
  document.querySelector(id).addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.target.querySelector("button[type=submit]");
    if (button) button.disabled = true;
    try {
      await handler(event.target);
    } catch (e) {
      message(e.message);
    } finally {
      if (button) button.disabled = false;
    }
  });
}
function bindNavigation() {
  document
    .querySelectorAll("nav a")
    .forEach((a) =>
      a.classList.toggle("active", location.hash.startsWith(a.hash)),
    );
}
function login() {
  user = "";
  document.querySelector("#account").textContent = "";
  app.innerHTML = `<section class="login"><div class="eyebrow">A private, local work sample</div><h1>Take a look around.</h1><p class="intro">Explore an invented shared shelf as either fictional account. Everyone who has this sample can use these demo credentials.</p><form id="login" class="form"><label>Demo account<select name="user"><option>Alex</option><option>Jamie</option></select></label><label>Demo password<input name="password" type="password" value="fictional-demo-only" autocomplete="off"></label><p class="quiet">Local demo password: <code>fictional-demo-only</code></p><button type="submit">Open the sample</button></form></section>`;
  formHandler("#login", async (form) => {
    const data = await api(
      "/api/login",
      "POST",
      Object.fromEntries(new FormData(form)),
    );
    user = data.user;
    await render();
  });
}
async function render() {
  const ticket = ++epoch;
  message("");
  try {
    const session = await api("/api/session");
    if (ticket !== epoch) return;
    user = session.user;
  } catch {
    return login();
  }
  document.querySelector("#account").innerHTML =
    `<span class="account-label">${esc(user)} · fictional account</span> <button class="link-button" id="logout">Switch account</button>`;
  document.querySelector("#logout").onclick = async () => {
    await api("/api/logout", "POST", {});
    login();
  };
  bindNavigation();
  const raw = (location.hash || "#saved").slice(1),
    [route, query = ""] = raw.split("?"),
    params = new URLSearchParams(query);
  try {
    if (route === "saved") {
      const results = await api("/api/search?" + params);
      if (ticket !== epoch) return;
      app.innerHTML = `<div class="eyebrow">Keep what catches your attention</div><h1>Our shared shelf <span class="count">${results.total} finds</span></h1><p class="intro">A place to save an idea, find it again, and turn it into something to do together.</p><form id="search" class="toolbar"><label>Find something<input name="q" placeholder="Try Mossport or courtyard" value="${esc(params.get("q"))}"></label><label>Kind<select name="type">${[
        ["", "Shared content"],
        ["place", "Places"],
        ["book", "Books"],
        ["link", "Articles"],
        ["idea", "Ideas"],
        ["guide", "Personal preparation"],
      ]
        .map(
          ([v, t]) =>
            `<option value="${v}" ${params.get("type") === v ? "selected" : ""}>${t}</option>`,
        )
        .join("")}</select></label><label>Place type<select name="subtype">${[
        ["", "Any"],
        ["restaurant", "Restaurants"],
        ["cafe", "Cafés"],
        ["park", "Parks"],
      ]
        .map(
          ([v, t]) =>
            `<option value="${v}" ${params.get("subtype") === v ? "selected" : ""}>${t}</option>`,
        )
        .join(
          "",
        )}</select></label><button type="submit">Find</button></form><div class="grid">${results.items.map((item) => `<article class="card"><div class="eyebrow">${esc(item.place?.subtype || item.kind)}</div><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p><div class="meta">${esc(item.place?.city || "Saved by " + item.createdBy)}</div>${item.sourceArchived ? `<div><span class="chip archived">From ${esc(item.sourceContext)}</span></div>` : ""}<a href="#item/${item.id}">Open this find →</a></article>`).join("") || '<div class="empty">No matches with these filters. <a href="#saved">Clear the filters</a>.</div>'}</div>`;
      document.querySelector("#search").onsubmit = (e) => {
        e.preventDefault();
        location.hash =
          "saved?" +
          new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v));
      };
    } else if (route.startsWith("item/")) {
      const { item } = await api("/api/items/" + route.slice(5));
      if (ticket !== epoch) return;
      app.innerHTML = `<p><a href="#saved">← Saved</a></p><div class="split"><article class="detail"><div class="eyebrow">${esc(item.kind)} · fictional content</div><h1>${esc(item.title)}</h1><p>${esc(item.summary)}</p>${item.place?.city ? `<p>${esc(item.place.address)} · ${esc(item.place.city)}</p>` : ""}${item.sourceUrl ? `<p class="quiet">Invented source: <code>${esc(item.sourceUrl)}</code><br>No external page is fetched.</p>` : ""}<h2>Earlier notes</h2>${
        Object.entries(item.notes || {})
          .filter(([, v]) => v)
          .map(
            ([name, text]) =>
              `<div class="notes"><b>${esc(name)}</b><p>${esc(text)}</p></div>`,
          )
          .join("") || "<p>No notes yet.</p>"
      }<p class="quiet">These are example notes, not a messaging service. Numerical ratings are optional opinions.</p><p>${Object.entries(
        item.ratings || {},
      )
        .filter(([, v]) => v)
        .map(([name, rating]) => `${esc(name)}: ${rating}/5`)
        .join(
          " · ",
        )}</p></article><aside class="panel"><h2>Make room for it.</h2><p>Reference this saved item in a plan. The item stays on the shelf.</p><a class="button" href="#new-plan?item=${item.id}">Start a plan</a></aside></div>`;
    } else if (route === "save") {
      app.innerHTML = `<div class="eyebrow">A thought worth keeping</div><h1>Save something.</h1><p class="intro">Shared with both fictional accounts. Use invented content only.</p><form id="save" class="form"><label>Title<input name="title" maxlength="180" required></label><label>Kind<select name="kind"><option value="idea">Idea</option><option value="place">Place</option><option value="article">Article</option><option value="book">Book</option></select></label><label>Why save this?<textarea name="summary" maxlength="2000"></textarea></label><label>Invented source URL (optional)<input name="sourceUrl" placeholder="https://stories.invalid/example"></label><label>Fictional city (for places)<input name="city" placeholder="Mossport"></label><label>Place type<select name="subtype"><option value="">Unknown</option><option value="restaurant">Restaurant</option><option value="cafe">Café</option><option value="park">Park</option></select></label><p class="quiet">Link previews are stubbed; an unavailable preview will not prevent saving.</p><div class="actions"><button type="button" id="preview" class="secondary">Try preview stub</button><button type="submit">Save to our shelf</button></div></form>`;
      document.querySelector("#preview").onclick = async () =>
        message((await api("/api/preview", "POST", {})).message);
      formHandler("#save", async (form) => {
        const result = await api(
          "/api/items",
          "POST",
          Object.fromEntries(new FormData(form)),
        );
        location.hash = "item/" + result.id;
      });
    } else if (route === "plans") {
      const { plans } = await api("/api/plans");
      if (ticket !== epoch) return;
      app.innerHTML = `<div class="eyebrow">Make space for what matters</div><h1>A few things to look forward to.</h1><p class="intro">Shared plans and your own preparation. A plan is not a reservation.</p><p><a class="button" href="#new-plan">+ Start a plan</a></p><div class="grid">${plans.map((p) => `<article class="card"><div class="eyebrow">${p.audience === "Shared" ? "Shared" : "Only you"} · ${esc(p.status)}</div><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p><div class="meta">${p.memberCount} saved items · ${p.completedStepCount}/${p.stepCount} steps</div><a href="#plan/${p.id}">Open plan →</a></article>`).join("")}</div>`;
    } else if (route === "new-plan") {
      const results = await api("/api/search?scope=all");
      if (ticket !== epoch) return;
      app.innerHTML = `<h1>Start with a small plan.</h1><p class="intro">Choose Shared or Only me now. The audience stays fixed after creation.</p><form id="new-plan" class="form"><label>Title<input name="title" required maxlength="180"></label><label>Audience<select name="audience"><option>Shared</option><option>Only me</option></select></label><label>Summary<textarea name="summary" maxlength="2000"></textarea></label><fieldset><legend>Saved items</legend>${results.items.map((i) => `<label class="check"><input type="checkbox" name="item" value="${i.id}" ${params.get("item") === i.id ? "checked" : ""}><span>${esc(i.title)}</span></label>`).join("")}</fieldset><p class="quiet">A shared plan can reference only items visible to both accounts.</p><button type="submit">Create plan</button></form>`;
      let requestId = uid();
      formHandler("#new-plan", async (form) => {
        const f = new FormData(form);
        const result = await api("/api/plans", "POST", {
          requestId,
          plan: {
            title: f.get("title"),
            summary: f.get("summary"),
            audience: f.get("audience"),
            status: "Draft",
            startDate: "",
            endDate: "",
            items: f
              .getAll("item")
              .map((itemId) => ({
                itemId,
                dayLabel: "",
                plannedDate: "",
                timeLabel: "",
              })),
            steps: [],
          },
        });
        location.hash = "plan/" + result.result.planId;
      });
    } else if (route.startsWith("plan/")) {
      const detail = await api("/api/plans/" + route.slice(5));
      if (ticket !== epoch) return;
      const { plan: p, memberCandidates } = detail;
      const titles = new Map(memberCandidates.map((i) => [i.id, i.title]));
      app.innerHTML = `<p><a href="#plans">← Plans</a></p><div class="eyebrow">${p.audience === "Shared" ? "Shared plan" : "Only you"} · version checked when saving</div><h1>${esc(p.title)}</h1><div class="split"><form id="edit-plan" class="form detail"><label>Title<input name="title" value="${esc(p.title)}" required maxlength="180"></label><label>Summary<textarea name="summary" maxlength="2000">${esc(p.summary)}</textarea></label><label>Status<select name="status">${["Draft", "Active", "Completed"].map((v) => `<option ${p.status === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><h2>Linked finds</h2>${p.items.map((i) => `<a href="#item/${i.itemId}">${esc(titles.get(i.itemId) || i.itemId)}</a>`).join("") || "<p>No items selected.</p>"}<h2>Small next steps</h2>${p.steps.map((s) => `<label class="check"><input type="checkbox" name="step" value="${s.id}" ${s.done ? "checked" : ""}><span>${esc(s.text)}</span></label>`).join("") || "<p>No steps yet.</p>"}<label>Add a step (optional)<input name="newStep" maxlength="180"></label><div class="actions"><button type="submit">Save plan</button><button type="button" id="reload" class="secondary">Reload saved version</button></div><p class="quiet">If another tab changes the plan, your stale edit is rejected and this form retains your text. Reloading discards unsaved form text.</p></form><aside class="panel"><h2>Notes for this plan</h2>${Object.entries(
        p.notes,
      )
        .filter(([, v]) => v)
        .map(
          ([name, v]) =>
            `<div class="notes"><b>${esc(name)}</b><p>${esc(v)}</p></div>`,
        )
        .join(
          "",
        )}<form id="note" class="form"><label>${esc(user)}’s note<textarea name="note" maxlength="280">${esc(p.notes[user] || "")}</textarea></label><button type="submit">Save my note</button></form><p class="quiet">Shared plan notes are visible to both accounts. Only you can edit your note. Notes have independent version checks.</p></aside></div>`;
      let requestId = uid(),
        noteRequestId = uid(),
        stepKey = uid();
      document.querySelector("#reload").onclick = render;
      formHandler("#edit-plan", async (form) => {
        const f = new FormData(form),
          steps = p.steps.map((s) => ({
            ...s,
            done: f.getAll("step").includes(s.id),
          }));
        if (f.get("newStep").trim())
          steps.push({
            clientKey: stepKey,
            text: f.get("newStep"),
            done: false,
          });
        await api("/api/plans/" + p.id, "PATCH", {
          requestId,
          planVersion: p.planVersion,
          plan: {
            title: f.get("title"),
            summary: f.get("summary"),
            status: f.get("status"),
            startDate: p.startDate,
            endDate: p.endDate,
            items: p.items,
            steps,
          },
        });
        await render();
        message("Plan saved.");
      });
      formHandler("#note", async (form) => {
        await api("/api/plans/" + p.id + "/note", "PATCH", {
          requestId: noteRequestId,
          noteVersion: p.noteVersion,
          note: new FormData(form).get("note"),
        });
        await render();
        message("Your note was saved.");
      });
    } else if (route === "about") {
      app.innerHTML = `<div class="eyebrow">Engineering in a small, runnable form</div><h1>What this sample demonstrates.</h1><div class="split"><section class="detail"><ol><li>Search real structured fields in fictional saved content, including an archived outing.</li><li>Switch fictional accounts to see server-enforced item and plan visibility.</li><li>Create plans with item references, checklists, and per-person notes.</li><li>Open a plan in two tabs to observe version conflict handling.</li><li>Restart the server to verify local persistence. Retry the same plan request without duplicating it.</li></ol></section><aside class="panel"><h2>A deliberate subset.</h2><p>Domain and storage code was adapted from an existing private application. This local shell was written for the sample.</p><p>Conversations, relational planning agreements, catalog imports, cloud recovery, and provider integrations are not implemented here.</p><p>Preview fetching is a local failure stub. No tasks or notifications are sent.</p></aside></div>`;
    } else {
      location.hash = "saved";
    }
  } catch (e) {
    message(e.message);
  }
}
window.addEventListener("hashchange", render);
render();
