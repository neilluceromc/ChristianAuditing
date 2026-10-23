import { randomInt } from "node:crypto";

/**
 * Users & access (spec §4.3, §7): the words of a temporary password. Neutral nature and household words of 4–7
 * letters, so `Word-NNNN-word` stays about 16 characters (14–20). Chosen so that nothing is easy to misread when an
 * admin reads it out or a person types it from a screen: no word starts with i, l or o (capitalised, I/l and O/0
 * look alike), none contains "rn" (reads as "m"), and no two are near-twins. Each has one spelling (no
 * harbor/harbour, desert/dessert). Nothing that could offend or embarrass read aloud (fix round 1, M2: no honey,
 * cherry or ginger). Task 5: "pepper" gave way to "button", since copper/pepper read as twins.
 */
export const TEMP_PASSWORD_WORDS: readonly string[] = [
  "amber", "anchor", "apple", "aspen", "badger", "bamboo", "basil", "beacon",
  "birch", "bison", "breeze", "brook", "cactus", "canyon", "cedar", "cobalt",
  "comet", "coral", "crane", "daisy", "delta", "teapot", "dune", "eagle",
  "ember", "falcon", "forest", "garden", "copper", "granite", "sparrow", "hazel",
  "pencil", "jasper", "juniper", "kettle", "maple", "marble", "meadow", "mango",
  "nutmeg", "pebble", "button", "planet", "poppy", "prairie", "quartz", "raven",
  "ridge", "river", "robin", "saffron", "sage", "spruce", "summit", "tulip",
  "tundra", "velvet", "violet", "walnut", "willow", "wren", "yarrow", "zinnia",
  "rocket", "plum", "fennel", "galaxy", "hammock", "kiwi", "puffin", "thistle",
];

/** 2–9 only: 0 and 1 read as O and l. */
const DIGITS = "23456789";

function pick<T>(list: readonly T[]): T {
  return list[randomInt(list.length)];
}

/**
 * A one-time password for a new account or an admin reset, e.g. `Maple-4827-cedar`. Generated with
 * `crypto.randomInt`. The caller shows it to the admin once, stores only its bcrypt hash, and never logs it or puts it
 * in an audit diff or a URL.
 */
export function generateTempPassword(): string {
  const first = pick(TEMP_PASSWORD_WORDS);
  let last = pick(TEMP_PASSWORD_WORDS);
  while (last === first) last = pick(TEMP_PASSWORD_WORDS);
  const digits = Array.from({ length: 4 }, () => DIGITS[randomInt(DIGITS.length)]).join("");
  return `${first[0].toUpperCase()}${first.slice(1)}-${digits}-${last}`;
}
