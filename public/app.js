import { activeSection } from "./navigation.js";
import {
  esc,
  loginView,
  savedView,
  itemView,
  saveView,
  plansView,
  newPlanView,
  planView,
  aboutView,
} from "./views.js";

const app = document.querySelector("#app"),
  notice = document.querySelector("#notice");
let user = "",
  epoch = 0;
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
  document.querySelectorAll("nav a").forEach((a) => {
    const active = activeSection(location.hash) === a.hash;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
function login() {
  user = "";
  document.querySelector("#account").textContent = "";
  app.innerHTML = loginView();
  app.focus();
  for (const button of app.querySelectorAll("[data-account]")) {
    button.onclick = async () => {
      const buttons = app.querySelectorAll("[data-account]");
      buttons.forEach((entry) => (entry.disabled = true));
      try {
        const data = await api("/api/login", "POST", {
          user: button.dataset.account,
        });
        user = data.user;
        await render();
      } catch (error) {
        message(error.message);
        buttons.forEach((entry) => (entry.disabled = false));
      }
    };
  }
}
async function render() {
  const ticket = ++epoch;
  message("");
  try {
    const session = await api("/api/session");
    if (ticket !== epoch) return;
    user = session.user;
  } catch {
    if (ticket !== epoch) return;
    bindNavigation();
    return login();
  }
  document.querySelector("#account").innerHTML =
    `<span class="account-label">${esc(user)}</span> <button class="link-button" id="logout">Switch account</button>`;
  document.querySelector("#logout").onclick = async () => {
    await api("/api/logout", "POST", {});
    login();
  };
  bindNavigation();
  const raw = (location.hash || "#saved").slice(1),
    [route, query = ""] = raw.split("?"),
    params = new URLSearchParams(query);
  try {
    const controller = route.startsWith("item/")
      ? showItem
      : route.startsWith("plan/")
        ? showPlan
        : {
            saved: showSaved,
            save: showSave,
            plans: showPlans,
            "new-plan": showNewPlan,
            about: showAbout,
          }[route];
    if (!controller) {
      location.hash = "saved";
      return;
    }
    await controller(params, route, ticket);
    if (ticket === epoch) app.focus();
  } catch (e) {
    message(e.message);
  }
}
async function showSaved(params, route, ticket) {
  const results = await api("/api/search?" + params);
  if (ticket !== epoch) return;
  app.innerHTML = savedView(results, params);
  document.querySelector("#search").onsubmit = (e) => {
    e.preventDefault();
    location.hash =
      "saved?" +
      new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v));
  };
}

async function showItem(params, route, ticket) {
  const { item } = await api("/api/items/" + route.slice(5));
  if (ticket !== epoch) return;
  app.innerHTML = itemView(item);
}

async function showSave(params, route, ticket) {
  app.innerHTML = saveView();
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
}

async function showPlans(params, route, ticket) {
  const { plans } = await api("/api/plans");
  if (ticket !== epoch) return;
  app.innerHTML = plansView(plans);
}

async function showNewPlan(params, route, ticket) {
  const results = await api("/api/search?scope=all");
  if (ticket !== epoch) return;
  app.innerHTML = newPlanView(results, params);
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
        items: f.getAll("item").map((itemId) => ({
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
}

async function showPlan(params, route, ticket) {
  const detail = await api("/api/plans/" + route.slice(5));
  if (ticket !== epoch) return;
  const { plan: p, memberCandidates } = detail;
  const titles = new Map(memberCandidates.map((i) => [i.id, i.title]));
  app.innerHTML = planView(p, titles, user);
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
}

async function showAbout(params, route, ticket) {
  app.innerHTML = aboutView();
}

window.addEventListener("hashchange", render);
render();
