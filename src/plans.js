import { canonicalChecksum } from "./state-store.js";
import { cleanText, hashText, httpError } from "./util.js";
import { isVisibleToUser } from "./visibility.js";

export const plansStateVersion = 6;
export const planStatuses = Object.freeze(["Draft", "Active", "Completed", "Archived"]);
export const planAudiences = Object.freeze(["Shared", "Alex", "Jamie"]);
export const planLimits = Object.freeze({
  title: 180,
  summary: 2000,
  items: 200,
  steps: 30,
  stepText: 180,
  note: 280,
  scheduleLabel: 80
});

const planKeys = Object.freeze([
  "id",
  "title",
  "summary",
  "audience",
  "status",
  "startDate",
  "endDate",
  "items",
  "steps",
  "notes",
  "sourceArchivedCollectionId",
  "createdAt",
  "updatedAt"
]);
const planItemKeys = Object.freeze(["itemId", "dayLabel", "plannedDate", "timeLabel"]);
const planStepKeys = Object.freeze(["id", "text", "done"]);
const persistedPlanStepWithOriginKeys = Object.freeze(["id", "text", "done", "togetherOrigin"]);
const togetherOriginKeys = Object.freeze(["checkInId", "outcomeId"]);
const noteKeys = Object.freeze(["Alex", "Jamie"]);
const version5StateKeys = Object.freeze([
  "version",
  "meta",
  "trip",
  "preferences",
  "careerProfiles",
  "collections",
  "users",
  "activities",
  "deletedSeedIds"
]);
const purgedJobKeyPattern = /^[a-f0-9]{64}$/;
const purgedJobKeyLimit = 2000;
// No personal destination preferences are retained in this sample.
const destinationRanks = new Map();
const weekdayRanks = new Map([
  ["monday", 0],
  ["tuesday", 1],
  ["wednesday", 2],
  ["thursday", 3],
  ["friday", 4],
  ["saturday", 5],
  ["sunday", 6],
  ["backup", 98],
  ["unscheduled", 99]
]);
const timeRanks = new Map([
  ["early morning", 0],
  ["morning", 1],
  ["late morning", 2],
  ["midday", 3],
  ["afternoon", 4],
  ["late afternoon", 5],
  ["evening", 6],
  ["night", 7],
  ["flexible", 8],
  ["", 9]
]);
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const createBodyKeys = Object.freeze(["requestId", "plan"]);
const patchBodyKeys = Object.freeze(["requestId", "planVersion", "plan"]);
const createPlanKeys = Object.freeze(["title", "summary", "audience", "status", "startDate", "endDate", "items", "steps"]);
const patchPlanKeys = Object.freeze(["title", "summary", "status", "startDate", "endDate", "items", "steps"]);
const draftStepKeys = Object.freeze(["clientKey", "text", "done"]);

export function normalizePlanRequestId(value) {
  if (typeof value !== "string" || !uuidV4Pattern.test(value.trim())) {
    throw planError(400, "PLAN_INVALID", "Request ID must be a valid version-4 UUID.");
  }
  return value.trim().toLowerCase();
}

export function normalizePlanCreateInput(input, user) {
  const source = strictInputObject(input, "Plan creation");
  strictInputKeys(source, createBodyKeys, "Plan creation");
  const requestId = normalizePlanRequestId(source.requestId);
  const plan = normalizePlanCoreInput(source.plan, { creating: true, user });
  if (plan.status === "Archived") {
    throw planError(400, "PLAN_INVALID", "Create the Plan before archiving it.");
  }
  return { requestId, plan };
}

export function normalizePlanPatchInput(input) {
  const source = strictInputObject(input, "Plan update");
  if (Object.hasOwn(source, "audience") || Object.hasOwn(source?.plan || {}, "audience")) {
    throw planError(409, "PLAN_AUDIENCE_IMMUTABLE", "A Plan's audience cannot be changed.");
  }
  strictInputKeys(source, patchBodyKeys, "Plan update");
  const planVersionValue = requiredOpaqueVersion(source.planVersion, "Plan version");
  const plan = normalizePlanCoreInput(source.plan, { creating: false });
  if (plan.status === "Archived") {
    throw planError(400, "PLAN_INVALID", "Use Archive to archive this Plan.");
  }
  return { requestId: normalizePlanRequestId(source.requestId), planVersion: planVersionValue, plan };
}

export function normalizePlanNoteInput(input) {
  const source = strictInputObject(input, "Plan note update");
  strictInputKeys(source, ["note", "noteVersion"], "Plan note update");
  return {
    note: strictOptionalText(source.note, "Plan note", planLimits.note),
    noteVersion: requiredOpaqueVersion(source.noteVersion, "Plan note version")
  };
}

export function normalizePlanLifecycleInput(input) {
  const source = strictInputObject(input, "Plan lifecycle action");
  strictInputKeys(source, ["requestId", "planVersion"], "Plan lifecycle action");
  return {
    requestId: normalizePlanRequestId(source.requestId),
    planVersion: requiredOpaqueVersion(source.planVersion, "Plan version")
  };
}

export function normalizePlanDeleteInput(input, ifMatch = "") {
  const source = strictInputObject(input, "Plan deletion");
  strictInputKeys(source, ["requestId"], "Plan deletion");
  const token = cleanText(ifMatch).replace(/^W\//, "").replace(/^"|"$/g, "");
  return {
    requestId: normalizePlanRequestId(source.requestId),
    planVersion: requiredOpaqueVersion(token, "Plan version", "Reload this Plan before deleting it.")
  };
}

export function derivePlanId(user, requestId) {
  const owner = requiredText(cleanText(user), 80, "Plan creator");
  const request = normalizePlanRequestId(requestId);
  return `plan-${hashText(`create|${owner}|${request}`).slice(0, 36)}`;
}

export function derivePlanStepId(planId, requestId, clientKey) {
  const plan = requiredText(planId, 100, "Plan ID");
  const request = normalizePlanRequestId(requestId);
  const key = normalizePlanRequestId(clientKey);
  return `step-${hashText(`plan-step|${plan}|${request}|${key}`).slice(0, 36)}`;
}

export function planIsVisibleToUser(plan, user) {
  const audience = cleanText(plan?.audience);
  return audience === "Shared" || audience.toLowerCase() === cleanText(user).toLowerCase();
}

export function findVisiblePlan(state, id, user) {
  const planId = cleanText(id);
  const matches = (Array.isArray(state?.plans) ? state.plans : [])
    .filter((plan) => cleanText(plan?.id) === planId)
    .filter((plan) => planIsVisibleToUser(plan, user));
  if (matches.length > 1) throw planError(409, "PLAN_ID_AMBIGUOUS", "This Plan has conflicting saved records.");
  if (!matches[0]) throw planError(404, "PLAN_NOT_FOUND", "Plan not found.");
  return matches[0];
}

export function buildWebPlans(state, user, users = ["Alex", "Jamie"]) {
  const plans = (Array.isArray(state?.plans) ? state.plans : [])
    .filter((plan) => planIsVisibleToUser(plan, user))
    .map((plan) => projectPlan(plan, user, { detail: false }))
    .sort((left, right) => planStatuses.indexOf(left.status) - planStatuses.indexOf(right.status)
      || left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
      || left.id.localeCompare(right.id));
  return {
    plans
  };
}

export function buildWebPlan(state, plan, user, users = ["Alex", "Jamie"]) {
  return {
    plan: projectPlan(plan, user, { detail: true }),
    memberCandidates: visiblePlanMemberCandidates(state, plan, users)
  };
}

export function createPlanInState(state, input, user, mutationTimestamp) {
  const id = derivePlanId(user, input.requestId);
  const existing = (Array.isArray(state?.plans) ? state.plans : []).filter((plan) => cleanText(plan?.id) === id);
  if (existing.length > 1) {
    throw planError(409, "PLAN_ID_AMBIGUOUS", "This Plan has conflicting saved records.");
  }
  if (existing[0] && planCreateMatches(existing[0], input)) {
    return { changed: false, plan: existing[0] };
  }
  if (existing[0]) {
    throw planError(409, "PLAN_REQUEST_CONFLICT", "This Plan request conflicts with an existing record.");
  }
  const plan = materializePlanCore({ id, input: input.plan, requestId: input.requestId, existing: null });
  plan.notes = { Alex: "", Jamie: "" };
  plan.sourceArchivedCollectionId = "";
  plan.createdAt = mutationTimestamp;
  plan.updatedAt = mutationTimestamp;
  assertPlanMemberReferences(state, plan.items, plan.audience, ["Alex", "Jamie"]);
  assertPlanShape(plan);
  state.plans = [...(Array.isArray(state.plans) ? state.plans : []), plan];
  return { changed: true, plan };
}

export function applyPlanCoreUpdate(state, plan, input, mutationTimestamp, users = ["Alex", "Jamie"]) {
  assertPlanWritable(plan);
  const audience = plan.audience;
  const next = materializePlanCore({ id: plan.id, input: input.plan, requestId: input.requestId, existing: plan });
  assertPlanMemberReferences(state, next.items, plan.audience, users);
  const desired = {
    ...plan,
    title: next.title,
    summary: next.summary,
    status: next.status,
    startDate: next.startDate,
    endDate: next.endDate,
    items: next.items,
    steps: next.steps
  };
  assertAudienceUnchanged(plan, desired);
  if (canonicalChecksum(corePlanProjection(plan)) === canonicalChecksum(corePlanProjection(desired))) {
    return { changed: false, plan };
  }
  if (planVersion(plan) !== input.planVersion) throw planChanged();
  Object.assign(plan, desired, { audience, updatedAt: mutationTimestamp });
  assertPlanShape(plan, users);
  return { changed: true, plan };
}

export function applyPlanNoteUpdate(plan, input, user, mutationTimestamp) {
  assertPlanWritable(plan);
  const canonicalUser = cleanText(user);
  if (!noteKeys.includes(canonicalUser) || !planIsVisibleToUser(plan, canonicalUser)) {
    throw planError(404, "PLAN_NOT_FOUND", "Plan not found.");
  }
  if (plan.notes[canonicalUser] === input.note) return { changed: false, plan };
  if (planNoteVersion(plan, canonicalUser) !== input.noteVersion) {
    throw planError(412, "PLAN_NOTE_CHANGED", "This Plan note changed elsewhere. Reload it before saving.");
  }
  const audience = plan.audience;
  plan.notes = { ...plan.notes, [canonicalUser]: input.note };
  plan.updatedAt = mutationTimestamp;
  assertAudienceUnchanged({ audience }, plan);
  assertPlanShape(plan);
  return { changed: true, plan };
}

export function applyPlanLifecycle(plan, input, action, mutationTimestamp) {
  const target = action === "archive" ? "Archived" : action === "restore" ? "Active" : "";
  if (!target) throw planError(400, "PLAN_INVALID", "Plan lifecycle action is invalid.");
  if (plan.status === target) return { changed: false, plan };
  if (planVersion(plan) !== input.planVersion) throw planChanged();
  if (action === "restore" && plan.status !== "Archived") {
    throw planError(409, "PLAN_ARCHIVED_READ_ONLY", "Only an archived Plan can be restored.");
  }
  if (action === "archive" && plan.status === "Archived") {
    throw planError(409, "PLAN_ARCHIVED_READ_ONLY", "This Plan is already archived.");
  }
  const audience = plan.audience;
  plan.status = target;
  plan.updatedAt = mutationTimestamp;
  assertAudienceUnchanged({ audience }, plan);
  assertPlanShape(plan);
  return { changed: true, plan };
}

export function deletePlanFromState(state, plan, planVersionValue) {
  if (planVersion(plan) !== planVersionValue) throw planChanged();
  if (plan.status !== "Archived") {
    throw planError(409, "PLAN_ARCHIVED_READ_ONLY", "Archive this Plan before deleting it permanently.");
  }
  state.plans = state.plans.filter((candidate) => candidate !== plan);
  return { changed: true, planId: plan.id };
}

export function removeActivityFromPlans(state, activityId, mutationTimestamp) {
  const id = cleanText(activityId);
  let changed = false;
  for (const plan of Array.isArray(state?.plans) ? state.plans : []) {
    const items = plan.items.filter((item) => item.itemId !== id);
    if (items.length === plan.items.length) continue;
    const audience = plan.audience;
    plan.items = items;
    plan.updatedAt = mutationTimestamp;
    assertAudienceUnchanged({ audience }, plan);
    changed = true;
  }
  return changed;
}

export function removeNonCommonVisibleItemsFromPlans(state, users = ["Alex", "Jamie"], mutationTimestamp = "") {
  let changed = false;
  for (const plan of Array.isArray(state?.plans) ? state.plans : []) {
    const visibleIds = new Set(planVisibleActivities(state, plan.audience, users)
      .map((activity) => cleanText(activity.id)));
    const items = plan.items.filter((item) => visibleIds.has(item.itemId));
    if (items.length === plan.items.length) continue;
    const audience = plan.audience;
    plan.items = items;
    plan.updatedAt = mutationTimestamp || plan.updatedAt;
    assertAudienceUnchanged({ audience }, plan);
    changed = true;
  }
  return changed;
}

export function assertAudienceUnchanged(before, after) {
  if (cleanText(before?.audience) !== cleanText(after?.audience)) {
    throw planError(409, "PLAN_AUDIENCE_IMMUTABLE", "A Plan's audience cannot be changed.");
  }
}

export function migrateStateDocumentV5ToV6(input, users = ["Alex", "Jamie"]) {
  return prepareStateDocumentV6Migration(input, users).state;
}

export function prepareStateDocumentV6Migration(input, users = ["Alex", "Jamie"]) {
  const source = requireObject(input, "State document");
  const version = Number(source.version);
  if (version === plansStateVersion) {
    return {
      changed: false,
      state: assertVersion6StateShape(structuredClone(source), users),
      fromVersion: plansStateVersion,
      toVersion: plansStateVersion
    };
  }
  if (version !== 5) {
    throw new TypeError(`Expected state version 5 or ${plansStateVersion}.`);
  }
  assertVersion5BaseStructure(source, users);

  const activities = Array.isArray(source.activities) ? source.activities : [];
  const collections = Array.isArray(source.collections) ? source.collections : [];
  const archivedIds = new Set(
    Array.isArray(source.preferences?.archivedCollectionIds)
      ? source.preferences.archivedCollectionIds.map(cleanText).filter(Boolean)
      : []
  );
  const tripCollections = collections
    .filter((collection) => cleanText(collection?.kind).toLowerCase() === "trip")
    .filter((collection) => archivedIds.has(cleanText(collection?.id)))
    .sort((left, right) => labelComparator(left?.title, right?.title) || labelComparator(left?.id, right?.id));

  const planIds = new Set();
  const plans = tripCollections.map((collection) => {
    const collectionId = requiredText(collection.id, 100, "Archived collection ID");
    const id = archivedPlanId(collectionId);
    if (planIds.has(id)) {
      throw new TypeError(`Archived collection ${collectionId} collides with another migrated Plan.`);
    }
    planIds.add(id);
    const members = activities
      .filter((activity) => cleanText(activity?.collection) === collectionId)
      .sort(compareArchivedTripActivities);
    assertMigratedMembersVisible(members, users, collectionId);
    const { createdAt, updatedAt } = migratedPlanTimestamps(source);
    return {
      id,
      title: requiredText(collection.title, planLimits.title, `Archived collection ${collectionId} title`),
      summary: limitedText(collection.description, planLimits.summary, `Archived collection ${collectionId} description`),
      audience: "Shared",
      status: "Archived",
      startDate: "",
      endDate: "",
      items: members.map((activity) => ({
        itemId: requiredText(activity.id, 100, `Archived collection ${collectionId} member ID`),
        dayLabel: limitedText(activity.targetDay, planLimits.scheduleLabel, "Plan day label"),
        plannedDate: optionalDate(activity.plannedDate, "Plan member date"),
        timeLabel: limitedText(activity.timeOfDay, planLimits.scheduleLabel, "Plan time label")
      })),
      steps: [],
      notes: { Alex: "", Jamie: "" },
      sourceArchivedCollectionId: collectionId,
      createdAt,
      updatedAt
    };
  });

  const candidate = structuredClone(source);
  candidate.version = plansStateVersion;
  candidate.plans = plans;
  return {
    changed: true,
    state: assertVersion6StateShape(candidate, users),
    fromVersion: 5,
    toVersion: plansStateVersion
  };
}

export function assertVersion6StateShape(state, users = ["Alex", "Jamie"], { allowTogetherOrigin = false } = {}) {
  const source = requireObject(state, "State document");
  if (Number(source.version) !== plansStateVersion) {
    throw new TypeError(`Expected state version ${plansStateVersion}.`);
  }
  if (!Array.isArray(source.plans)) {
    throw new TypeError("Version 6 state plans must be an array.");
  }
  assertExactKeys(source, [...version5KeysFor(source), "plans"], "Version 6 state");
  assertPurgedJobKeys(source);
  const ids = new Set();
  const sources = new Set();
  for (const plan of source.plans) {
    assertPlanShape(plan, users, { allowTogetherOrigin });
    if (ids.has(plan.id)) throw new TypeError(`Plan ID ${plan.id} is duplicated.`);
    ids.add(plan.id);
    if (plan.sourceArchivedCollectionId) {
      if (sources.has(plan.sourceArchivedCollectionId)) {
        throw new TypeError(`Archived collection ${plan.sourceArchivedCollectionId} is linked to more than one Plan.`);
      }
      sources.add(plan.sourceArchivedCollectionId);
    }
    assertPlanReferences(source, plan, users);
  }
  return state;
}

function assertVersion5BaseStructure(state, users = ["Alex", "Jamie"]) {
  const source = requireObject(state, "State document");
  if (Number(source.version) !== 5) throw new TypeError("Expected state version 5.");
  if (Object.hasOwn(source, "plans")) throw new TypeError("Version 5 state must not contain a plans field.");
  assertExactKeys(source, version5KeysFor(source), "Version 5 state");
  assertPurgedJobKeys(source);
  if (!Array.isArray(source.users) || canonicalChecksum(source.users) !== canonicalChecksum(users)) {
    throw new TypeError("State users do not match the configured planners.");
  }
  return state;
}

export function assertPlanShape(plan, users = ["Alex", "Jamie"], { allowTogetherOrigin = true } = {}) {
  const source = requireObject(plan, "Plan");
  assertExactKeys(source, planKeys, "Plan");
  requiredText(source.id, 100, "Plan ID");
  requiredText(source.title, planLimits.title, "Plan title");
  limitedText(source.summary, planLimits.summary, "Plan summary");
  if (!planAudiences.includes(source.audience)) throw new TypeError("Plan audience is invalid.");
  if (!planStatuses.includes(source.status)) throw new TypeError("Plan status is invalid.");
  const startDate = optionalDate(source.startDate, "Plan start date");
  const endDate = optionalDate(source.endDate, "Plan end date");
  if (startDate && endDate && startDate > endDate) throw new TypeError("Plan start date must not be after its end date.");
  if (!Array.isArray(source.items) || source.items.length > planLimits.items) {
    throw new TypeError(`Plan items must contain at most ${planLimits.items} records.`);
  }
  if (!Array.isArray(source.steps) || source.steps.length > planLimits.steps) {
    throw new TypeError(`Plan steps must contain at most ${planLimits.steps} records.`);
  }
  const itemIds = new Set();
  for (const item of source.items) {
    assertExactKeys(requireObject(item, "Plan item"), planItemKeys, "Plan item");
    const itemId = requiredText(item.itemId, 100, "Plan item ID");
    if (itemIds.has(itemId)) throw new TypeError(`Plan item ${itemId} is duplicated.`);
    itemIds.add(itemId);
    limitedText(item.dayLabel, planLimits.scheduleLabel, "Plan day label");
    optionalDate(item.plannedDate, "Plan member date");
    limitedText(item.timeLabel, planLimits.scheduleLabel, "Plan time label");
  }
  const stepIds = new Set();
  for (const step of source.steps) {
    const persistedStepKeys = allowTogetherOrigin && Object.hasOwn(step || {}, "togetherOrigin")
      ? persistedPlanStepWithOriginKeys
      : planStepKeys;
    assertExactKeys(requireObject(step, "Plan step"), persistedStepKeys, "Plan step");
    const stepId = requiredText(step.id, 100, "Plan step ID");
    if (stepIds.has(stepId)) throw new TypeError(`Plan step ${stepId} is duplicated.`);
    stepIds.add(stepId);
    requiredText(step.text, planLimits.stepText, "Plan step text");
    if (typeof step.done !== "boolean") throw new TypeError("Plan step done must be a boolean.");
    if (Object.hasOwn(step, "togetherOrigin")) {
      const origin = requireObject(step.togetherOrigin, "Plan step Together origin");
      assertExactKeys(origin, togetherOriginKeys, "Plan step Together origin");
      requiredText(origin.checkInId, 100, "Together check-in ID");
      requiredText(origin.outcomeId, 100, "Together outcome ID");
    }
  }
  assertExactKeys(requireObject(source.notes, "Plan notes"), noteKeys, "Plan notes");
  for (const user of noteKeys) limitedText(source.notes[user], planLimits.note, `${user} Plan note`);
  limitedText(source.sourceArchivedCollectionId, 100, "Plan source archived collection ID");
  requiredTimestamp(source.createdAt, "Plan createdAt");
  requiredTimestamp(source.updatedAt, "Plan updatedAt");
  if (source.updatedAt < source.createdAt) throw new TypeError("Plan updatedAt must not precede createdAt.");

  const configuredUsers = new Set((Array.isArray(users) ? users : []).map(cleanText).filter(Boolean));
  if (source.audience !== "Shared" && !configuredUsers.has(source.audience)) {
    throw new TypeError("Plan audience is not a configured account.");
  }
  if (source.audience !== "Shared" && noteKeys.some((user) => user !== source.audience && source.notes[user])) {
    throw new TypeError("A private Plan cannot contain another account's note.");
  }
  return plan;
}

export function planVersion(plan) {
  assertPlanShape(plan);
  return canonicalChecksum({
    id: plan.id,
    audience: plan.audience,
    status: plan.status,
    title: plan.title,
    summary: plan.summary,
    startDate: plan.startDate,
    endDate: plan.endDate,
    items: plan.items,
    steps: plan.steps,
    sourceArchivedCollectionId: plan.sourceArchivedCollectionId
  });
}

export function planNoteVersion(plan, user) {
  assertPlanShape(plan);
  const canonicalUser = cleanText(user);
  if (!noteKeys.includes(canonicalUser)) throw new TypeError("Plan note owner is invalid.");
  return canonicalChecksum({
    id: plan.id,
    audience: plan.audience,
    status: plan.status,
    note: plan.notes[canonicalUser]
  });
}

export function archivedPlanId(collectionId) {
  const canonical = requiredText(collectionId, 100, "Archived collection ID");
  return `plan-${hashText(`archived-trip|${canonical}`).slice(0, 36)}`;
}

export function compareArchivedTripActivities(left, right) {
  const leftDestination = cleanText(left?.destination) || "Destination not recorded";
  const rightDestination = cleanText(right?.destination) || "Destination not recorded";
  const leftDay = cleanText(left?.targetDay) || "Unscheduled";
  const rightDay = cleanText(right?.targetDay) || "Unscheduled";
  return destinationRank(leftDestination) - destinationRank(rightDestination)
    || labelComparator(leftDestination, rightDestination)
    || dayRank(leftDay) - dayRank(rightDay)
    || labelComparator(leftDay, rightDay)
    || timeRank(left?.timeOfDay) - timeRank(right?.timeOfDay)
    || labelComparator(left?.title, right?.title)
    || cleanText(left?.id).localeCompare(cleanText(right?.id));
}

function assertPlanReferences(state, plan, users) {
  const activities = Array.isArray(state.activities) ? state.activities : [];
  for (const member of plan.items) {
    const matches = activities.filter((activity) => cleanText(activity?.id) === member.itemId);
    if (matches.length !== 1) throw new TypeError(`Plan member ${member.itemId} must resolve exactly once.`);
    const visible = plan.audience === "Shared"
      ? users.every((user) => isVisibleToUser(matches[0], user))
      : isVisibleToUser(matches[0], plan.audience);
    if (!visible) {
      throw new TypeError(`Plan member ${member.itemId} is not visible to the Plan audience.`);
    }
  }
}

function assertMigratedMembersVisible(members, users, collectionId) {
  for (const activity of members) {
    if (!users.every((user) => isVisibleToUser(activity, user))) {
      throw new TypeError(`Archived collection ${collectionId} contains an item that is not visible to every planner.`);
    }
  }
}

function migratedPlanTimestamps(state) {
  const createdAt = validTimestamp(state.meta?.createdAt);
  const updatedAt = validTimestamp(state.meta?.updatedAt);
  if (!createdAt || !updatedAt || updatedAt < createdAt) {
    throw new TypeError("State metadata timestamps are invalid for Plans migration.");
  }
  return { createdAt, updatedAt };
}

function normalizePlanCoreInput(input, { creating, user = "" }) {
  const source = strictInputObject(input, "Plan");
  if (!creating && Object.hasOwn(source, "audience")) {
    throw planError(409, "PLAN_AUDIENCE_IMMUTABLE", "A Plan's audience cannot be changed.");
  }
  strictInputKeys(source, creating ? createPlanKeys : patchPlanKeys, "Plan");
  const title = strictRequiredText(source.title, "Plan title", planLimits.title, { singleLine: true });
  const summary = strictOptionalText(source.summary, "Plan summary", planLimits.summary);
  const audience = creating ? canonicalPlanCreateAudience(source.audience, user) : undefined;
  if (creating && !audience) throw planError(400, "PLAN_INVALID", "Choose a supported Plan audience.");
  const status = canonicalPlanStatus(source.status);
  if (!status) throw planError(400, "PLAN_INVALID", "Choose Draft, Active, Completed, or Archived.");
  const startDate = strictOptionalDate(source.startDate, "Plan start date");
  const endDate = strictOptionalDate(source.endDate, "Plan end date");
  if (startDate && endDate && startDate > endDate) {
    throw planError(400, "PLAN_INVALID", "Plan start date must not be after its end date.");
  }
  const items = normalizePlanItemInputs(source.items);
  const steps = normalizePlanStepInputs(source.steps, { creating });
  return { title, summary, ...(creating ? { audience } : {}), status, startDate, endDate, items, steps };
}

function normalizePlanItemInputs(input) {
  if (!Array.isArray(input) || input.length > planLimits.items) {
    throw planError(400, "PLAN_INVALID", `Plan items must contain at most ${planLimits.items} records.`);
  }
  const ids = new Set();
  return input.map((entry) => {
    const source = strictInputObject(entry, "Plan item");
    strictInputKeys(source, planItemKeys, "Plan item");
    const itemId = strictRequiredText(source.itemId, "Plan item ID", 100, { singleLine: true });
    if (ids.has(itemId)) throw planError(400, "PLAN_INVALID", "A Plan cannot contain the same item more than once.");
    ids.add(itemId);
    return {
      itemId,
      dayLabel: strictSingleLine(source.dayLabel, "Plan day label", planLimits.scheduleLabel),
      plannedDate: strictOptionalDate(source.plannedDate, "Plan member date"),
      timeLabel: strictSingleLine(source.timeLabel, "Plan time label", planLimits.scheduleLabel)
    };
  });
}

function normalizePlanStepInputs(input, { creating }) {
  if (!Array.isArray(input) || input.length > planLimits.steps) {
    throw planError(400, "PLAN_INVALID", `Plan steps must contain at most ${planLimits.steps} records.`);
  }
  const identities = new Set();
  return input.map((entry) => {
    const source = strictInputObject(entry, "Plan step");
    if (creating) {
      if (Object.hasOwn(source, "id")) throw planError(400, "PLAN_INVALID", "New Plan steps cannot provide persisted IDs.");
      strictInputKeys(source, draftStepKeys, "Plan step");
    } else {
      const hasId = Object.hasOwn(source, "id");
      const hasClientKey = Object.hasOwn(source, "clientKey");
      if (hasId === hasClientKey) throw planError(400, "PLAN_INVALID", "Each Plan step needs exactly one server ID or client key.");
      strictInputKeys(source, hasId ? planStepKeys : draftStepKeys, "Plan step");
    }
    if (typeof source.done !== "boolean") throw planError(400, "PLAN_INVALID", "Plan step done must be true or false.");
    const identity = Object.hasOwn(source, "id")
      ? strictRequiredText(source.id, "Plan step ID", 100, { singleLine: true })
      : normalizePlanRequestId(source.clientKey);
    if (identities.has(identity)) throw planError(400, "PLAN_INVALID", "Plan step identities must be unique.");
    identities.add(identity);
    return {
      ...(Object.hasOwn(source, "id") ? { id: identity } : { clientKey: identity }),
      text: strictRequiredText(source.text, "Plan step text", planLimits.stepText, { singleLine: true }),
      done: source.done
    };
  });
}

function materializePlanCore({ id, input, requestId, existing }) {
  const existingSteps = new Map((Array.isArray(existing?.steps) ? existing.steps : []).map((step) => [step.id, step]));
  const ids = new Set();
  const steps = input.steps.map((step) => {
    let stepId;
    if (step.id) {
      if (!existingSteps.has(step.id)) throw planError(400, "PLAN_INVALID", "A saved Plan step ID is not part of this Plan.");
      stepId = step.id;
    } else {
      stepId = derivePlanStepId(id, requestId, step.clientKey);
    }
    if (ids.has(stepId)) throw planError(409, "PLAN_REQUEST_CONFLICT", "Plan step identities conflict.");
    ids.add(stepId);
    const existingStep = existingSteps.get(stepId);
    return {
      id: stepId,
      text: step.text,
      done: step.done,
      ...(existingStep?.togetherOrigin ? { togetherOrigin: structuredClone(existingStep.togetherOrigin) } : {})
    };
  });
  return {
    id,
    title: input.title,
    summary: input.summary,
    audience: existing?.audience || input.audience,
    status: input.status,
    startDate: input.startDate,
    endDate: input.endDate,
    items: structuredClone(input.items),
    steps
  };
}

function projectPlan(plan, user, { detail }) {
  const completedSteps = plan.steps.filter((step) => step.done).length;
  const base = {
    id: plan.id,
    title: plan.title,
    summary: plan.summary,
    audience: plan.audience === "Shared" ? "Shared" : "Only me",
    status: plan.status,
    startDate: plan.startDate,
    endDate: plan.endDate,
    memberCount: plan.items.length,
    stepCount: plan.steps.length,
    completedStepCount: completedSteps,
    updatedAt: plan.updatedAt,
    planVersion: planVersion(plan)
  };
  if (!detail) return base;
  return {
    ...base,
    items: structuredClone(plan.items),
    steps: plan.steps.map((step) => ({ id: step.id, text: step.text, done: step.done })),
    notes: plan.audience === "Shared"
      ? structuredClone(plan.notes)
      : { [cleanText(user)]: cleanText(plan.notes?.[cleanText(user)]) },
    noteVersion: planNoteVersion(plan, user),
    sourceArchivedCollectionId: plan.sourceArchivedCollectionId,
    createdAt: plan.createdAt
  };
}

function visiblePlanMemberCandidates(state, plan, users) {
  return planVisibleActivities(state, plan.audience, users)
    .map((activity) => ({
      id: cleanText(activity.id),
      title: cleanText(activity.title)
    }))
    .sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
      || left.id.localeCompare(right.id));
}

function commonVisibleActivities(state, users) {
  return (Array.isArray(state?.activities) ? state.activities : []).filter((activity) => {
    const id = cleanText(activity?.id);
    return id
      && state.activities.filter((candidate) => cleanText(candidate?.id) === id).length === 1
      && users.every((user) => isVisibleToUser(activity, user));
  });
}

function planVisibleActivities(state, audience, users) {
  if (audience === "Shared") return commonVisibleActivities(state, users);
  return (Array.isArray(state?.activities) ? state.activities : []).filter((activity) => {
    const id = cleanText(activity?.id);
    return id
      && state.activities.filter((candidate) => cleanText(candidate?.id) === id).length === 1
      && isVisibleToUser(activity, audience);
  });
}

function assertPlanMemberReferences(state, items, audience, users) {
  const visible = new Set(planVisibleActivities(state, audience, users).map((activity) => cleanText(activity.id)));
  if (items.some((item) => !visible.has(item.itemId))) {
    throw planError(404, "PLAN_ITEM_NOT_FOUND", "A selected item is not available to this Plan's audience.");
  }
}

function corePlanProjection(plan) {
  return {
    id: plan.id,
    title: plan.title,
    summary: plan.summary,
    audience: plan.audience,
    status: plan.status,
    startDate: plan.startDate,
    endDate: plan.endDate,
    items: plan.items,
    steps: plan.steps,
    sourceArchivedCollectionId: plan.sourceArchivedCollectionId
  };
}

function planCreateMatches(plan, input) {
  if (plan.sourceArchivedCollectionId || plan.audience !== input.plan.audience) return false;
  let desired;
  try {
    desired = materializePlanCore({ id: plan.id, input: input.plan, requestId: input.requestId, existing: plan });
  } catch {
    return false;
  }
  return canonicalChecksum(corePlanProjection(plan)) === canonicalChecksum(corePlanProjection({
    ...plan,
    ...desired
  }));
}

function assertPlanWritable(plan) {
  if (plan.status === "Archived") {
    throw planError(409, "PLAN_ARCHIVED_READ_ONLY", "This Plan is archived and read only.");
  }
}

function planChanged() {
  return planError(412, "PLAN_CHANGED", "This Plan changed elsewhere. Reload it before saving.");
}

function preconditionRequired(message) {
  return planError(428, "PRECONDITION_REQUIRED", message);
}

function planError(status, code, message) {
  const error = httpError(status, message);
  error.code = code;
  return error;
}

function strictInputObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw planError(400, "PLAN_INVALID", `${label} must be an object.`);
  }
  return value;
}

function strictInputKeys(source, allowed, label) {
  const allowedSet = new Set(allowed);
  const unsupported = Object.keys(source).find((key) => !allowedSet.has(key));
  const missing = allowed.find((key) => !Object.hasOwn(source, key));
  if (unsupported || missing) throw planError(400, "PLAN_INVALID", `${label} fields are invalid.`);
}

function strictRequiredText(value, label, limit, options = {}) {
  const text = strictOptionalText(value, label, limit);
  if (!text) throw planError(400, "PLAN_INVALID", `${label} is required.`);
  if (options.singleLine && /[\r\n]/.test(value)) throw planError(400, "PLAN_INVALID", `${label} must fit on one line.`);
  return text;
}

function strictOptionalText(value, label, limit) {
  if (typeof value !== "string") throw planError(400, "PLAN_INVALID", `${label} must be text.`);
  const text = value.trim();
  if (text.length > limit) throw planError(400, "PLAN_INVALID", `${label} must be ${limit} characters or fewer.`);
  return text;
}

function strictSingleLine(value, label, limit) {
  const text = strictOptionalText(value, label, limit);
  if (/[\r\n]/.test(value)) throw planError(400, "PLAN_INVALID", `${label} must fit on one line.`);
  return text;
}

function strictOptionalDate(value, label) {
  if (typeof value !== "string") throw planError(400, "PLAN_INVALID", `${label} must be text.`);
  const text = value.trim();
  if (!text) return "";
  try {
    return optionalDate(text, label);
  } catch {
    throw planError(400, "PLAN_INVALID", `${label} must be a real calendar date.`);
  }
}

function requiredOpaqueVersion(value, label, missingMessage = "") {
  if (typeof value !== "string" || !cleanText(value)) {
    throw preconditionRequired(missingMessage || `Reload this Plan before saving ${label.toLowerCase()}.`);
  }
  const token = cleanText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw planError(400, "PLAN_INVALID", `${label} is invalid. Reload the Plan and try again.`);
  }
  return token;
}

function canonicalPlanCreateAudience(value, user) {
  const requested = cleanText(value);
  if (requested === "Shared") return "Shared";
  if (requested !== "Only me") return "";
  const account = cleanText(user);
  return planAudiences.includes(account) && account !== "Shared" ? account : "";
}

function canonicalPlanStatus(value) {
  const requested = cleanText(value).toLowerCase();
  return planStatuses.find((candidate) => candidate.toLowerCase() === requested) || "";
}

function destinationRank(value) {
  return destinationRanks.get(cleanText(value).toLowerCase()) ?? 99;
}

function dayRank(value) {
  const normalized = cleanText(value).toLowerCase();
  if (weekdayRanks.has(normalized)) return weekdayRanks.get(normalized);
  const numbered = normalized.match(/^day\s+(\d+)$/);
  return numbered ? 10 + Number(numbered[1]) : 90;
}

function timeRank(value) {
  return timeRanks.get(cleanText(value).toLowerCase()) ?? 8;
}

function labelComparator(left, right) {
  return cleanText(left).localeCompare(cleanText(right), undefined, { sensitivity: "base" });
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (canonicalChecksum(actual) !== canonicalChecksum(expected)) {
    throw new TypeError(`${label} fields are invalid.`);
  }
}

function version5KeysFor(source) {
  return Object.hasOwn(source, "purgedJobKeys")
    ? [...version5StateKeys, "purgedJobKeys"]
    : version5StateKeys;
}

function assertPurgedJobKeys(source) {
  if (!Object.hasOwn(source, "purgedJobKeys")) return;
  if (!Array.isArray(source.purgedJobKeys) || source.purgedJobKeys.length > purgedJobKeyLimit) {
    throw new TypeError("Purged Job keys are invalid.");
  }
  if (new Set(source.purgedJobKeys).size !== source.purgedJobKeys.length
    || source.purgedJobKeys.some((key) => typeof key !== "string" || !purgedJobKeyPattern.test(key))) {
    throw new TypeError("Purged Job keys are invalid.");
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function requiredText(value, maxLength, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const text = value.trim();
  if (!text || text.length > maxLength || text !== value) throw new TypeError(`${label} is invalid.`);
  return text;
}

function limitedText(value, maxLength, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  if (value.length > maxLength || value !== value.trim()) throw new TypeError(`${label} is invalid.`);
  return value;
}

function optionalDate(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new TypeError(`${label} is invalid.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])
  ) throw new TypeError(`${label} is invalid.`);
  return value;
}

function requiredTimestamp(value, label) {
  if (!validTimestamp(value) || value !== new Date(value).toISOString()) throw new TypeError(`${label} is invalid.`);
  return value;
}

function validTimestamp(value) {
  if (typeof value !== "string" || !value) return "";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}
