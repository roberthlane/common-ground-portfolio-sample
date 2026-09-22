import { cleanText } from "./util.js";

export function activityAudience(activity) {
  return activity?.kind === "guide"
    ? cleanText(activity.guideAudience).toLowerCase()
    : "shared";
}

export function isVisibleToUser(activity, user) {
  const audience = activityAudience(activity);
  return audience === "shared" || audience === cleanText(user).toLowerCase();
}
