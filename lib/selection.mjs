// What the dashboard's repo button calls the repos on show, so nobody has to open it to know. Pure
// so Node can test it.

/**
 * `chosen` and `all` are repo names. `presets` and `sections` are [name, repos] pairs: the named
 * sets the panel offers and the map's sections; a preset wins over a section of the same repos.
 * `titleOf` gives a repo's plain title. A named set when the choice is one, then whole sections, a
 * few titles, all but one or two, a set plus up to three more, and "Custom selection" otherwise.
 */
export function nameSelection(chosen, all, presets, sections, titleOf) {
  const n = chosen.length, has = new Set(chosen);
  const within = (names) => names.every((x) => has.has(x));
  if (n === all.length) return "All repos";
  if (!n) return "No repos";
  const sets = [...presets, ...sections];
  const exact = sets.find(([, names]) => names.length === n && within(names));
  if (exact) return exact[0];
  const whole = sections.filter(([, names]) => within(names));
  if (whole.reduce((k, [, names]) => k + names.length, 0) === n) return whole.map(([name]) => name).join(" + ");
  if (n <= 3) return chosen.map(titleOf).join(" + ");
  const missing = all.filter((x) => !has.has(x));
  if (missing.length <= 2) return `All but ${missing.map(titleOf).join(" + ")}`;
  const base = sets.filter(([, names]) => within(names)).sort((a, b) => b[1].length - a[1].length)[0];
  const rest = base ? chosen.filter((x) => !base[1].includes(x)) : [];
  if (base && rest.length <= 3) return `${base[0]} + ${rest.length === 1 ? titleOf(rest[0]) : `${rest.length} more`}`;
  return "Custom selection";
}
