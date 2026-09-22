export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function loginView() {
  return /* HTML */ ` <section class="login">
    <div class="eyebrow">Explore together</div>
    <h1>Take a look around.</h1>
    <p class="intro">
      Choose an account to explore shared plans and personal preparation. Both
      demo accounts are available to you.
    </p>
    <div class="actions">
      <button data-account="Alex">Continue as Alex</button>
      <button data-account="Jamie" class="secondary">Continue as Jamie</button>
    </div>
  </section>`;
}

export function savedView(results, params) {
  return /* HTML */ `<div class="eyebrow">Keep what catches your attention</div>
    <h1>Our shared shelf <span class="count">${results.total} finds</span></h1>
    <p class="intro">
      A place to save an idea, find it again, and turn it into something to do
      together.
    </p>
    <form id="search" class="toolbar">
      <label
        >Find something<input
          name="q"
          placeholder="Try Mossport or courtyard"
          value="${esc(params.get("q"))}" /></label
      ><label
        >Kind<select name="type">
          ${[
            ["", "Shared content"],
            ["place", "Places"],
            ["book", "Books"],
            ["link", "Articles"],
            ["idea", "Ideas"],
            ["guide", "Personal preparation"],
          ]
            .map(
              ([v, t]) =>
                /* HTML */ `<option
                  value="${v}"
                  ${params.get("type") === v ? "selected" : ""}
                >
                  ${t}
                </option>`,
            )
            .join("")}
        </select></label
      ><label
        >Place type<select name="subtype">
          ${[
            ["", "Any"],
            ["restaurant", "Restaurants"],
            ["cafe", "Cafés"],
            ["park", "Parks"],
          ]
            .map(
              ([v, t]) =>
                /* HTML */ `<option
                  value="${v}"
                  ${params.get("subtype") === v ? "selected" : ""}
                >
                  ${t}
                </option>`,
            )
            .join("")}
        </select></label
      ><button type="submit">Find</button>
    </form>
    <div class="grid">
      ${results.items
        .map(
          (item) =>
            /* HTML */ `<article class="card">
              <div class="eyebrow">
                ${esc(item.place?.subtype || item.kind)}
              </div>
              <h3>${esc(item.title)}</h3>
              <p>${esc(item.summary)}</p>
              <div class="meta">
                ${esc(item.place?.city || "Saved by " + item.createdBy)}
              </div>
              ${item.sourceArchived
                ? /* HTML */ `<div>
                    <span class="chip archived"
                      >From ${esc(item.sourceContext)}</span
                    >
                  </div>`
                : ""}<a href="#item/${item.id}">Open this find →</a>
            </article>`,
        )
        .join("") ||
      '<div class="empty">No matches with these filters. <a href="#saved">Clear the filters</a>.</div>'}
    </div>`;
}

export function itemView(item) {
  return /* HTML */ `<p><a href="#saved">← Saved</a></p>
    <div class="split">
      <article class="detail">
        <div class="eyebrow">${esc(item.kind)}</div>
        <h1>${esc(item.title)}</h1>
        <p>${esc(item.summary)}</p>
        ${item.place?.city
          ? /* HTML */ `<p>
              ${esc(item.place.address)} · ${esc(item.place.city)}
            </p>`
          : ""}${item.sourceUrl
          ? /* HTML */ `<p class="quiet">
              Source: <code>${esc(item.sourceUrl)}</code><br />No external page
              is fetched.
            </p>`
          : ""}
        <h2>Earlier notes</h2>
        ${Object.entries(item.notes || {})
          .filter(([, v]) => v)
          .map(
            ([name, text]) =>
              /* HTML */ `<div class="notes">
                <b>${esc(name)}</b>
                <p>${esc(text)}</p>
              </div>`,
          )
          .join("") || "<p>No notes yet.</p>"}
        <p class="quiet">Ratings are optional opinions.</p>
        <p>
          ${Object.entries(item.ratings || {})
            .filter(([, v]) => v)
            .map(([name, rating]) => `${esc(name)}: ${rating}/5`)
            .join(" · ")}
        </p>
      </article>
      <aside class="panel">
        <h2>Make room for it.</h2>
        <p>Reference this saved item in a plan. The item stays on the shelf.</p>
        <a class="button" href="#new-plan?item=${item.id}">Start a plan</a>
      </aside>
    </div>`;
}

export function saveView() {
  return /* HTML */ `<div class="eyebrow">A thought worth keeping</div>
    <h1>Save something.</h1>
    <p class="intro">Shared with Alex and Jamie.</p>
    <form id="save" class="form">
      <label>Title<input name="title" maxlength="180" required /></label
      ><label
        >Kind<select name="kind">
          <option value="idea">Idea</option>
          <option value="place">Place</option>
          <option value="article">Article</option>
          <option value="book">Book</option>
        </select></label
      ><label
        >Why save this?<textarea
          name="summary"
          maxlength="2000"
        ></textarea></label
      ><label
        >Source URL (optional, .invalid only)<input
          name="sourceUrl"
          placeholder="https://stories.invalid/example" /></label
      ><label
        >City (for places)<input name="city" placeholder="Mossport" /></label
      ><label
        >Place type<select name="subtype">
          <option value="">Unknown</option>
          <option value="restaurant">Restaurant</option>
          <option value="cafe">Café</option>
          <option value="park">Park</option>
        </select></label
      >
      <p class="quiet">
        Link previews are stubbed; an unavailable preview will not prevent
        saving.
      </p>
      <div class="actions">
        <button type="button" id="preview" class="secondary">
          Try preview stub</button
        ><button type="submit">Save to our shelf</button>
      </div>
    </form>`;
}

export function plansView(plans) {
  return /* HTML */ `<div class="eyebrow">Make space for what matters</div>
    <h1>A few things to look forward to.</h1>
    <p class="intro">
      Shared plans and your own preparation. A plan is not a reservation.
    </p>
    <p><a class="button" href="#new-plan">+ Start a plan</a></p>
    <div class="grid">
      ${plans
        .map(
          (p) =>
            /* HTML */ `<article class="card">
              <div class="eyebrow">
                ${p.audience === "Shared" ? "Shared" : "Only you"} ·
                ${esc(p.status)}
              </div>
              <h3>${esc(p.title)}</h3>
              <p>${esc(p.summary)}</p>
              <div class="meta">
                ${p.memberCount} saved items ·
                ${p.completedStepCount}/${p.stepCount} steps
              </div>
              <a href="#plan/${p.id}">Open plan →</a>
            </article>`,
        )
        .join("")}
    </div>`;
}

export function newPlanView(results, params) {
  return /* HTML */ `<h1>Start with a small plan.</h1>
    <p class="intro">
      Choose Shared or Only me now. The audience stays fixed after creation.
    </p>
    <form id="new-plan" class="form">
      <label>Title<input name="title" required maxlength="180" /></label
      ><label
        >Audience<select name="audience">
          <option>Shared</option>
          <option>Only me</option>
        </select></label
      ><label
        >Summary<textarea name="summary" maxlength="2000"></textarea>
      </label>
      <fieldset>
        <legend>Saved items</legend>
        ${results.items
          .map(
            (i) =>
              /* HTML */ `<label class="check"
                ><input
                  type="checkbox"
                  name="item"
                  value="${i.id}"
                  ${params.get("item") === i.id ? "checked" : ""}
                /><span>${esc(i.title)}</span></label
              >`,
          )
          .join("")}
      </fieldset>
      <p class="quiet">
        A shared plan can reference only items visible to both accounts.
      </p>
      <button type="submit">Create plan</button>
    </form>`;
}

export function planView(p, titles, user) {
  return /* HTML */ `<p><a href="#plans">← Plans</a></p>
    <div class="eyebrow">
      ${p.audience === "Shared" ? "Shared plan" : "Only you"} · version checked
      when saving
    </div>
    <h1>${esc(p.title)}</h1>
    <div class="split">
      <form id="edit-plan" class="form detail">
        <label
          >Title<input
            name="title"
            value="${esc(p.title)}"
            required
            maxlength="180" /></label
        ><label
          >Summary<textarea name="summary" maxlength="2000">
${esc(p.summary)}</textarea
          ></label
        ><label
          >Status<select name="status">
            ${["Draft", "Active", "Completed"]
              .map(
                (v) =>
                  /* HTML */ `<option ${p.status === v ? "selected" : ""}>
                    ${v}
                  </option>`,
              )
              .join("")}
          </select></label
        >
        <h2>Linked finds</h2>
        ${p.items
          .map(
            (i) =>
              /* HTML */ `<a href="#item/${i.itemId}"
                >${esc(titles.get(i.itemId) || i.itemId)}</a
              >`,
          )
          .join("") || "<p>No items selected.</p>"}
        <h2>Small next steps</h2>
        ${p.steps
          .map(
            (s) =>
              /* HTML */ `<label class="check"
                ><input
                  type="checkbox"
                  name="step"
                  value="${s.id}"
                  ${s.done ? "checked" : ""}
                /><span>${esc(s.text)}</span></label
              >`,
          )
          .join("") || "<p>No steps yet.</p>"}<label
          >Add a step (optional)<input name="newStep" maxlength="180"
        /></label>
        <div class="actions">
          <button type="submit">Save plan</button
          ><button type="button" id="reload" class="secondary">
            Reload saved version
          </button>
        </div>
        <p class="quiet">
          If another tab changes the plan, your stale edit is rejected and this
          form retains your text. Reloading discards unsaved form text.
        </p>
      </form>
      <aside class="panel">
        <h2>Notes for this plan</h2>
        ${Object.entries(p.notes)
          .filter(([, v]) => v)
          .map(
            ([name, v]) =>
              /* HTML */ `<div class="notes">
                <b>${esc(name)}</b>
                <p>${esc(v)}</p>
              </div>`,
          )
          .join("")}
        <form id="note" class="form">
          <label
            >${esc(user)}’s note<textarea name="note" maxlength="280">
${esc(p.notes[user] || "")}</textarea
            ></label
          ><button type="submit">Save my note</button>
        </form>
        <p class="quiet">
          Shared plan notes are visible to both accounts. Only you can edit your
          note. Notes have independent version checks.
        </p>
      </aside>
    </div>`;
}

export function aboutView() {
  return /* HTML */ `<div class="eyebrow">
      Engineering in a small, runnable form
    </div>
    <h1>What this sample demonstrates.</h1>
    <div class="split">
      <section class="detail">
        <ol>
          <li>
            Search structured place details, including an archived outing.
          </li>
          <li>
            Switch accounts to see server-enforced item and plan visibility.
          </li>
          <li>
            Create plans with item references, checklists, and per-person notes.
          </li>
          <li>Open a plan in two tabs to observe version conflict handling.</li>
          <li>
            Restart the server to verify local persistence. Retry the same plan
            request without duplicating it.
          </li>
        </ol>
      </section>
      <aside class="panel">
        <h2>A deliberate subset.</h2>
        <p>
          Domain and storage code was adapted from an existing private
          application. This local shell was written for the sample.
        </p>
        <p>
          This sample focuses on discovery, shared plans, access controls, and
          reliable local writes.
        </p>
        <p>
          Preview fetching is a local failure stub. No tasks or notifications
          are sent.
        </p>
      </aside>
    </div>`;
}
