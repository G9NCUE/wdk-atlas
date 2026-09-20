// The metric registry: one entry per number Atlas publishes from collected data.
//
// A number that is wrong about what it means is worse than no number, because it is acted on.
// `wdk-failover-provider` shows 307 downloads a day and 99.7% of them are the single version
// every WDK package pins; the current release gets 21 a week. Nobody chose that package. Read
// as adoption, that figure would send us to build more of what nobody asked for.
//
// So a definition is written once, here, and the page, the export and the gates all read it
// from this file. The browser and Node both import it, like lib/quarters.mjs.
//
// Scope: figures derived from data/metrics.json. Counts of rows in atlas.yaml (initiatives
// shipped, modules on the map) are inventory that describes itself, and are covered by the
// single `atlas-counts` entry rather than one each.
//
// Every entry answers three questions before it may render:
//   decision  what someone would do differently if this moved by 20%
//   canFall   whether the number is able to go down. A number that only rises is a trophy
//   floor     the base below which a percentage change is noise and the raw count is shown

export const REQUIRED = ["id", "label", "question", "definition", "source", "window", "decision", "canFall", "verdict"];

/** Verdicts from the measurement review. `keep` needs no work; the rest are backlog. */
export const VERDICTS = ["keep", "redefine", "promote", "demote", "move", "add"];

const defs = [
  // ---- Try: did someone start? ------------------------------------------------------------
  {
    id: "downloads",
    label: "npm downloads",
    question: "Did anyone choose to install WDK?",
    definition:
      "Downloads of the selected packages summed over the last complete period. Counts every tarball fetch, so an install pulled in by another WDK package counts the same as one a person asked for.",
    source: "npm registry, api.npmjs.org",
    window: "last complete day, week or month; npm reports a few days late so the current period is left out",
    floor: 50,
    canFall: true,
    decision:
      "Which packages to invest in next. Unusable for that until direct and induced installs are separated, because 53% of the volume is the dependency graph echoing.",
    verdict: "redefine",
    pages: ["dashboard", "overview"],
  },
  {
    id: "downloads-direct",
    label: "Installs of entry points",
    question: "How many people started something with WDK?",
    definition:
      "Downloads of packages nothing else in WDK depends on, plus the assembler. A lower bound on direct installs: internal dependencies pin exact versions, so an install of a pinned version is attributable to the package that pinned it and is subtracted.",
    source: "npm registry per-version downloads, plus the internal dependency graph from each package manifest",
    window: "last complete period",
    floor: 20,
    canFall: true,
    decision:
      "Whether a launch, a piece of documentation or an example reached anyone. This is the number a launch should move.",
    verdict: "add",
    pages: ["dashboard"],
  },
  {
    id: "downloads-induced",
    label: "Pulled in as a dependency",
    question: "How much of the volume is plumbing?",
    definition:
      "Downloads attributable to another WDK package pinning that exact version. An upper bound: caching means a dependent install does not always fetch the dependency again.",
    source: "npm registry per-version downloads, plus the internal dependency graph",
    window: "last complete period",
    floor: 20,
    canFall: true,
    decision:
      "Nothing on its own. It is published so the headline cannot be misread, and so a rise in it is never mistaken for growth.",
    verdict: "add",
    pages: ["dashboard"],
  },

  // ---- Integrate and Ship: did it reach a real project? -----------------------------------
  {
    id: "dependents",
    label: "Projects depending on WDK",
    question: "Did WDK reach somebody else's repository?",
    definition: "Public repositories outside the organisation whose package.json names a WDK package.",
    source: "GitHub code search",
    window: "daily snapshot",
    floor: 10,
    canFall: true,
    decision:
      "Whether the kit is being adopted at all, and by whom. The best number on the page and currently the least prominent one.",
    verdict: "promote",
    pages: ["dashboard", "overview"],
  },
  {
    id: "dependents-active",
    label: "Projects still building on WDK",
    question: "Is WDK in anything alive?",
    definition:
      "Dependent repositories that are not forks and have been committed to within 90 days. A proxy for production use, which public data cannot show directly.",
    source: "GitHub code search, then the repository metadata for each result",
    window: "daily snapshot, 90-day activity horizon",
    floor: 5,
    canFall: true,
    decision:
      "Whether integrations survive contact with a real project, or are abandoned after a weekend. Distinguishes 201 users from 201 experiments.",
    verdict: "add",
    pages: ["dashboard"],
  },

  // ---- Stay: are they still with us? ------------------------------------------------------
  {
    id: "version-currency",
    label: "Version currency",
    question: "Are the people who installed WDK still keeping up with it?",
    definition:
      "Share of a package's installs landing on a release published within the last 30 days, weighted across published packages.",
    source: "npm registry per-version downloads",
    window: "last week of downloads, against release dates",
    floor: 100,
    canFall: true,
    decision:
      "Whether to fix upgrade friction before shipping more features. Today 2.5% of wdk-wallet installs are current and 38% are twelve releases behind, which points at the exact pins rather than at demand.",
    verdict: "add",
    pages: ["dashboard"],
  },

  // ---- Extend: did others build on it? ----------------------------------------------------
  {
    id: "third-party-modules",
    label: "Modules built by others",
    question: "Is anyone extending WDK rather than only consuming it?",
    definition: "Modules on the map whose publisher is not the organisation and whose status is shipped.",
    source: "atlas.yaml, cross-checked against npm",
    window: "current",
    floor: 3,
    canFall: true,
    decision: "Whether the module interface is good enough to build against, or whether we are the only ones who can.",
    verdict: "keep",
    pages: ["dashboard", "results"],
  },
  {
    id: "external-prs-merged",
    label: "External pull requests merged",
    question: "Are people outside the team improving WDK?",
    definition:
      "Pull requests merged in the period whose author is not a member or collaborator of the organisation.",
    source: "GitHub API",
    window: "last complete period",
    floor: 10,
    canFall: true,
    decision:
      "Whether contributing is possible for an outsider. Counts run between zero and three, so a growth target on this base is noise and the raw count is shown instead.",
    verdict: "redefine",
    pages: ["dashboard", "overview", "results"],
  },
  {
    id: "external-authors",
    label: "External contributors",
    question: "How many different people outside the team took part?",
    definition: "Distinct authors of external pull requests over the periods charted, bots excluded.",
    source: "GitHub API",
    window: "the complete periods shown on the pull request charts",
    floor: 5,
    canFall: true,
    decision: "Whether contribution is concentrated in one enthusiast or spread across a community.",
    verdict: "keep",
    pages: ["dashboard"],
  },

  // ---- Support: do we answer? -------------------------------------------------------------
  {
    id: "issue-response",
    label: "Time to first response",
    question: "Do we answer the people who turn up?",
    definition: "Share of issues opened in the window that received a reply within seven days.",
    source: "GitHub API",
    window: "rolling 30 days",
    floor: 10,
    canFall: true,
    decision:
      "Whether to staff support before promoting the kit further. The first thing a developer learns about a project is whether anyone is home.",
    verdict: "promote",
    pages: ["dashboard", "results"],
  },
  {
    id: "open-issues",
    label: "Open issues",
    question: "How large is the backlog right now?",
    definition: "Issues open across the selected repositories on the day of collection.",
    source: "GitHub API",
    window: "daily snapshot",
    floor: 20,
    canFall: true,
    decision:
      "None on its own: a level, not a rate, and it falls both when we fix things and when we close things unfixed. Kept as context beside time to first response.",
    verdict: "demote",
    pages: ["dashboard"],
  },
  {
    id: "issues-flow",
    label: "Issues opened and closed",
    question: "Are we closing issues faster than they arrive?",
    definition: "Issues opened and issues closed in each complete period.",
    source: "GitHub API",
    window: "last complete periods",
    floor: 10,
    canFall: true,
    decision: "Whether the backlog is growing structurally or absorbing a one-off.",
    verdict: "keep",
    pages: ["dashboard"],
  },

  // ---- Inventory: what we own. True, but not outcomes. -------------------------------------
  {
    id: "packages-published",
    label: "Packages published",
    question: "How many first-party packages exist on npm?",
    definition: "Repositories in the selection with a package published to npm, split by stable and beta.",
    source: "npm registry",
    window: "daily snapshot",
    floor: null,
    canFall: true,
    decision:
      "None. It describes what we own, not what anyone uses, and it rises whenever we split a package. Belongs in the release readiness table.",
    verdict: "move",
    pages: ["dashboard", "overview"],
  },
  {
    id: "contributors",
    label: "Contributors",
    question: "How many people have committed to WDK?",
    definition: "Distinct commit authors across the selection, bots excluded.",
    source: "GitHub API",
    window: "daily snapshot, all time",
    floor: null,
    canFall: false,
    decision:
      "None while it mixes the team with everyone else, when it largely measures hiring. Split into team and outside, the outside half answers whether the project is open in practice.",
    verdict: "redefine",
    pages: ["dashboard", "overview"],
  },
  {
    id: "stars",
    label: "GitHub stars",
    question: "How many people bookmarked the repositories?",
    definition: "The sum of GitHub star counts across the selection.",
    source: "GitHub API",
    window: "daily snapshot",
    floor: null,
    canFall: false,
    decision:
      "None. Nobody has ever changed a plan because of it, it cannot move within a quarter through anything we control, and in practice it never falls. The definition of a vanity metric.",
    verdict: "demote",
    pages: ["dashboard", "overview"],
  },
  {
    id: "atlas-counts",
    label: "Counts taken from the atlas",
    question: "How much is on the map and the roadmap?",
    definition:
      "Rows counted in atlas.yaml: initiatives by status, modules by state, north stars, key results measured. Inventory that describes itself.",
    source: "atlas.yaml",
    window: "current, as of the last edit",
    floor: null,
    canFall: true,
    decision:
      "Planning only. These say what we have written down, never what is true of the world, and must never be read beside the collected numbers as if they were the same kind of thing.",
    verdict: "keep",
    pages: ["overview", "roadmap", "results", "map"],
  },

  // ---- Release readiness: gates, not results ----------------------------------------------
  {
    id: "readiness",
    label: "Release readiness",
    question: "Is each published package fit to depend on?",
    definition:
      "Per package: the npm latest tag carries no beta suffix; the newest completed workflow run on the default branch passed; an audit file or folder sits at the repository root; GitHub's community profile score; wallet packages reference the shared signer interface; a CODEOWNERS file names an owner.",
    source: "npm registry and GitHub API",
    window: "daily snapshot",
    floor: null,
    canFall: true,
    decision:
      "What blocks the 1.0.0 release. These are gates on a checklist, not results: each is binary, three of them read 0% and will keep reading 0% until a release lands.",
    verdict: "keep",
    pages: ["dashboard"],
  },
];

/** Every entry, in the order they were reviewed. */
export const METRICS = Object.freeze(defs.map(Object.freeze));

const byId = new Map(METRICS.map((m) => [m.id, m]));

/** One entry, or undefined. Callers that publish a number must treat undefined as a fault. */
export const metricDef = (id) => byId.get(id);

/** Ids that failed the three-part test and must not appear in a tile row. */
export const DEMOTED = Object.freeze(METRICS.filter((m) => m.verdict === "demote").map((m) => m.id));

/**
 * Whether a percentage change may be shown for this metric at this base.
 * Below the floor the raw count is shown instead: a change of "+50%" on a base of two is
 * arithmetic, not information.
 */
export function mayShowChange(id, base) {
  const def = byId.get(id);
  if (!def || def.floor == null) return false;
  return typeof base === "number" && Number.isFinite(base) && base >= def.floor;
}
