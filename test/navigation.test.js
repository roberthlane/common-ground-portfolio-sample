import test from "node:test";
import assert from "node:assert/strict";
import { activeSection } from "../public/navigation.js";

test("navigation distinguishes Save from Saved and selects a default and detail parent", () => {
  for (const [hash, section] of [
    ["", "#saved"],
    ["#saved", "#saved"],
    ["#saved?q=Mossport", "#saved"],
    ["#save", "#save"],
    ["#item/lantern-table", "#saved"],
    ["#new-plan", "#plans"],
    ["#plan/example", "#plans"],
    ["#about", "#about"],
  ]) {
    assert.equal(activeSection(hash), section);
  }
});
