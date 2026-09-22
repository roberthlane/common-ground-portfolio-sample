import { cleanText } from "./util.js";

export function isVisibleToUser(activity, user) {
  const audience = activityAudience(activity);
  const requested = cleanText(user).toLowerCase();
  return audience === "shared" || audience === requested;
}

export function activityAudience(activity) {
  if (activity?.collection === "job-alerts" || activity?.kind === "job") {
    return "alex";
  }
  if (activity?.collection === "todoist" || activity?.kind === "todoist-task") {
    return personAudience(activity.todoistOwner || activity.category, "shared");
  }
  if (activity?.collection === "guides" || activity?.kind === "guide") {
    return personAudience(activity.guideAudience, "shared");
  }
  if (["goals", "questions"].includes(activity?.collection)) {
    return personAudience(activity.area, "shared");
  }
  return "shared";
}

export function personAudience(value, fallback = "shared") {
  const text = cleanText(value).toLowerCase();
  const hasJamie = /\bjamie\b/.test(text);
  const hasAlex = /\balex\b/.test(text);
  if (/\b(shared|both|all|together|us)\b/.test(text) || (hasJamie && hasAlex)) {
    return "shared";
  }
  if (hasJamie) return "jamie";
  if (hasAlex) return "alex";
  return fallback;
}
