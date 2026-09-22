import { createPlanInState, normalizePlanCreateInput } from "../src/plans.js";
import { normalizePlace } from "../src/discovery.js";
export const accounts = ["Alex", "Jamie"];
export const sampleMarker = "fictional-local-portfolio-v1";
export const seedTime = "2024-04-01T12:00:00.000Z";
export function makeSeed() {
  const item = (id, title, kind, summary, extra = {}) => ({
    id,
    title,
    kind,
    summary,
    collection: "saved",
    createdBy: "Alex",
    createdAt: seedTime,
    status: "Considering",
    stage: "considering",
    area: "",
    category: "",
    tags: [],
    notes: { Alex: "", Jamie: "" },
    ratings: { Alex: 0, Jamie: 0 },
    sourceUrl: "",
    place: normalizePlace(),
    ...extra,
  });
  const venue = (id, title, subtype, summary, extra = {}) =>
    item(id, title, "place", summary, {
      place: normalizePlace({
        city: "Mossport",
        region: "Lumen Coast",
        country: "Cloudmere",
        address: "8 Lantern Lane",
        subtype,
      }),
      ...extra,
    });
  const state = {
    version: 1,
    sampleMarker,
    meta: { createdAt: seedTime, updatedAt: seedTime },
    users: accounts,
    preferences: { archivedCollectionIds: ["old-outing"] },
    collections: [
      { id: "saved", title: "Shared shelf" },
      { id: "old-outing", title: "Imaginary spring outing" },
      { id: "guides", title: "Personal preparation" },
    ],
    activities: [
      venue(
        "lantern-table",
        "The Lantern Table",
        "restaurant",
        "A neighborhood kitchen with a quiet courtyard.",
        {
          collection: "old-outing",
          tags: ["dinner", "courtyard"],
          notes: {
            Alex: "Could pair this with a short walk.",
            Jamie: "I would like an early table.",
          },
          ratings: { Alex: 4, Jamie: 5 },
        },
      ),
      venue(
        "paper-cup",
        "Paper Cup Studio",
        "cafe",
        "A café with drawing tables and a tiny lending shelf.",
        {
          createdBy: "Jamie",
          place: normalizePlace({
            city: "Mossport",
            region: "Lumen Coast",
            country: "Cloudmere",
            address: "22 Paper Arcade",
            subtype: "cafe",
          }),
        },
      ),
      venue(
        "reed-loop",
        "Reed Loop",
        "park",
        "A level walking circuit around a small pond.",
        { tags: ["walk", "outdoors"] },
      ),
      item(
        "small-pauses",
        "Small Pauses, Big Conversations",
        "article",
        "Leave room for a question before moving to the next plan.",
        {
          createdBy: "Jamie",
          sourceUrl: "https://stories.invalid/small-pauses",
          notes: {
            Alex: "What question should we start with?",
            Jamie: "Perhaps: what surprised you this week?",
          },
        },
      ),
      item(
        "atlas-of-evenings",
        "An Atlas of Evenings",
        "book",
        "A book by Rowan Quill, about noticing familiar places.",
        {
          tags: ["book", "reading"],
          notes: {
            Alex: "Let us talk about the chapter on windows.",
            Jamie: "",
          },
        },
      ),
      item(
        "swap-night",
        "Try a skill-swap evening",
        "idea",
        "Each person teaches one small thing in twenty minutes.",
        { tags: ["conversation", "at home"] },
      ),
      item(
        "alex-preparation",
        "Alex: quiet preparation",
        "guide",
        "Rehearse the paper-folding lesson.",
        {
          collection: "guides",
          guideAudience: "Alex",
          notes: {
            Alex: "Keep this preparation to myself for now.",
            Jamie: "",
          },
        },
      ),
      item(
        "jamie-preparation",
        "Jamie: personal sketch plan",
        "guide",
        "Sketch three imaginary doorways.",
        {
          collection: "guides",
          guideAudience: "Jamie",
          createdBy: "Jamie",
          notes: { Alex: "", Jamie: "Start with curved lines." },
        },
      ),
    ],
    plans: [],
  };
  const create = (requestId, title, audience, items) =>
    createPlanInState(
      state,
      normalizePlanCreateInput(
        {
          requestId,
          plan: {
            title,
            summary:
              "Make a little time for something worth looking forward to.",
            audience: audience === "Shared" ? "Shared" : "Only me",
            status: "Draft",
            startDate: "",
            endDate: "",
            items: items.map((itemId) => ({
              itemId,
              dayLabel: "An unhurried evening",
              plannedDate: "",
              timeLabel: "",
            })),
            steps: [
              {
                clientKey: "55555555-5555-4555-8555-555555555555",
                text: "Choose a comfortable time together",
                done: false,
              },
            ],
          },
        },
        audience === "Shared" ? "Alex" : audience,
      ),
      audience === "Shared" ? "Alex" : audience,
      seedTime,
    );
  create(
    "11111111-1111-4111-8111-111111111111",
    "Dinner and a gentle walk",
    "Shared",
    ["lantern-table", "reed-loop"],
  );
  create(
    "22222222-2222-4222-8222-222222222222",
    "Alex: paper-folding practice",
    "Alex",
    ["alex-preparation"],
  );
  create(
    "33333333-3333-4333-8333-333333333333",
    "Jamie: sketching session",
    "Jamie",
    ["jamie-preparation"],
  );
  return state;
}
