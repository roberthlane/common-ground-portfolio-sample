export function activeSection(hash = "") {
  const route = (hash || "#saved").slice(1).split("?")[0];
  if (route === "saved" || route.startsWith("item/")) return "#saved";
  if (route === "plans" || route === "new-plan" || route.startsWith("plan/"))
    return "#plans";
  return ["save", "about"].includes(route) ? `#${route}` : "#saved";
}
