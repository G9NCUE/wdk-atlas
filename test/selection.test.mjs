import { test } from "node:test";
import assert from "node:assert/strict";
import { nameSelection } from "../lib/selection.mjs";

const all = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const presets = [["Wallets", ["a", "b", "c", "d"]], ["Protocols", ["e", "f"]]];
const sections = [["The engine", ["a", "b", "c", "d", "e", "f"]], ["Your app", ["g", "h"]], ["Foundation", ["i", "j"]]];
const name = (chosen) => nameSelection(chosen, all, presets, sections, (n) => n.toUpperCase());

test("the button names the repos on show", () => {
  assert.equal(name(all), "All repos");
  assert.equal(name([]), "No repos");
  assert.equal(name(["a", "b", "c", "d"]), "Wallets");
  assert.equal(name(["g", "h"]), "Your app");
  assert.equal(name(["a", "b", "c", "d", "e", "f", "g", "h"]), "The engine + Your app");
  assert.equal(name(["a", "g", "j"]), "A + G + J");
  assert.equal(name(["a", "b", "c", "d", "e", "f", "g", "i"]), "All but H + J");
  assert.equal(name(["a", "b", "c", "d", "g"]), "Wallets + G");
  // Two whole sections and one more: not the two sections alone, and three more is still named.
  assert.equal(name(["a", "g", "h", "i", "j"]), "Your app + 3 more");
  // The largest set inside the choice, not the first.
  assert.equal(name(["a", "b", "c", "d", "e", "f", "g"]), "The engine + G");
  // Three left out is not "all but", and five more than a set is not named after it.
  assert.equal(name(["a", "c", "e", "f", "g", "i", "j"]), "Custom selection");
  assert.equal(name(["a", "e", "g", "i"]), "Custom selection");
});

test("a preset wins over a section holding the same repos", () => {
  assert.equal(nameSelection(["g", "h"], all, [["Starters", ["g", "h"]]], sections, (n) => n), "Starters");
});
