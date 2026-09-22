import { FileStateStore } from "../src/state-store.js";
import { assertPlanShape } from "../src/plans.js";
import { makeSeed, sampleMarker, accounts } from "./seed.js";
export function normalizeSample(state) {
  if (
    state?.sampleMarker !== sampleMarker ||
    state.version !== 1 ||
    JSON.stringify(state.users) !== JSON.stringify(accounts)
  )
    throw new Error("Only this fictional sample format can be opened.");
  if (!Array.isArray(state.activities) || !Array.isArray(state.plans))
    throw new Error("Invalid sample document.");
  const ids = new Set(state.activities.map((x) => x.id));
  if (ids.size !== state.activities.length)
    throw new Error("Duplicate item IDs.");
  for (const p of state.plans) {
    assertPlanShape(p, accounts);
    for (const ref of p.items)
      if (!ids.has(ref.itemId)) throw new Error("Missing item reference.");
  }
  return structuredClone(state);
}
export function openStore(dataFile) {
  return new FileStateStore({
    dataFile,
    normalize: normalizeSample,
    loadSeed: makeSeed,
    mergeSeed: (state) => ({ state, changed: false }),
    stateVersion: 1,
    requireExactStoredVersion: true,
  });
}
