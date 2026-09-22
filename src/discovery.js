import { cleanText } from "./util.js";
import { isVisibleToUser, activityAudience } from "./visibility.js";

const placeSubtypes = [
  "",
  "restaurant",
  "cafe",
  "bar",
  "museum",
  "park",
  "shop",
  "lodging",
  "attraction",
  "other",
];

export function normalizePlace(value = {}) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const coordinate = (v, limit) =>
    v !== null &&
    v !== "" &&
    Number.isFinite(Number(v)) &&
    Math.abs(Number(v)) <= limit
      ? Number(v)
      : null;
  return {
    city: cleanText(source.city).slice(0, 120),
    region: cleanText(source.region).slice(0, 120),
    country: cleanText(source.country).slice(0, 120),
    address: cleanText(source.address).slice(0, 300),
    subtype: placeSubtypes.includes(source.subtype) ? source.subtype : "",
    latitude: coordinate(source.latitude, 90),
    longitude: coordinate(source.longitude, 180),
  };
}

const fold = (value) =>
  cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function discoveryType(item) {
  const kind = fold(item.kind);
  return kind === "article" ? "link" : kind;
}

export function searchSaved(state, user, filters = {}) {
  const query = fold(filters.q || filters.query).slice(0, 300);
  const terms = query.split(/\s+/).filter(Boolean);
  const type = fold(filters.type);
  const archivedIds = new Set(state.preferences?.archivedCollectionIds || []);
  const visible = (state.activities || []).filter((item) =>
    isVisibleToUser(item, user),
  );
  const shared = visible.filter(
    (item) =>
      activityAudience(item) === "shared" &&
      ["link", "book", "place", "idea", "question"].includes(
        discoveryType(item),
      ),
  );
  const candidates = type || filters.scope === "all" ? visible : shared;
  const scored = candidates.flatMap((item) => {
    if (type && discoveryType(item) !== type) return [];
    if (filters.city && fold(item.place?.city) !== fold(filters.city))
      return [];
    if (filters.subtype && item.place?.subtype !== filters.subtype) return [];
    if (filters.collection && item.collection !== filters.collection) return [];
    if (filters.stage && fold(item.stage) !== fold(filters.stage)) return [];
    if (filters.category && fold(item.category) !== fold(filters.category))
      return [];
    if (
      filters.queue === "needs-details" &&
      !(item.stage === "inbox" || (item.kind === "place" && !item.place?.city))
    )
      return [];
    const archived =
      archivedIds.has(item.collection) || fold(item.status) === "archived";
    if (filters.archived === "only" && !archived) return [];
    if (filters.archived === "exclude" && archived) return [];
    const title = fold(item.title);
    const location = fold(
      [
        item.place?.city,
        item.place?.region,
        item.place?.country,
        item.place?.address,
        item.area,
        item.destination,
      ].join(" "),
    );
    const body = fold(
      [
        item.summary,
        item.category,
        item.nextStep,
        item.sourceUrl,
        item.guideContent,
        ...(item.tags || []),
        ...Object.values(item.notes || {}),
        ...(item.guideLinks || []).flatMap((link) => [link.label, link.url]),
      ].join(" "),
    );
    if (!terms.every((term) => `${title} ${location} ${body}`.includes(term)))
      return [];
    const score = terms.reduce(
      (sum, term) =>
        sum +
        (title.includes(term) ? 10 : 0) +
        (location.includes(term) ? 6 : 0),
      0,
    );
    const collection = state.collections?.find(
      (entry) => entry.id === item.collection,
    );
    return [
      {
        score,
        item: {
          ...structuredClone(item),
          sourceContext: collection?.title || item.collection,
          sourceArchived: archived,
        },
      },
    ];
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      cleanText(b.item.createdAt).localeCompare(cleanText(a.item.createdAt)) ||
      a.item.id.localeCompare(b.item.id),
  );
  return {
    items: scored.map(({ item }) => item),
    facets: {
      cities: [
        ...new Set(shared.map((item) => item.place?.city).filter(Boolean)),
      ].sort(),
      subtypes: placeSubtypes.filter(Boolean),
    },
    total: scored.length,
  };
}
