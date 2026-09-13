# WDK Atlas

A map of the Wallet Development Kit by Tether: the packages as a stack, the roadmap by north star,
the key results behind each star, and a dashboard of public metrics. Static site, no build step.

Pages: **Overview** (front page: what WDK is, where each north star stands, this quarter, headline
numbers, risks), **Roadmap**, **Key results**, **Dashboard**, **WDK Visual Map**, **Developer Resources**.

One rule runs through the site: everything shown can be recomputed by a stranger from public sources,
npm, GitHub and `atlas.yaml`. No number is typed by hand; a result that cannot be measured that way is
not a key result here.

- `atlas.yaml` is the source of truth: modules, sections, relations, mission, north stars with their
  key results, and roadmap items. Its header comment documents every field.
- `data/metrics.json` holds the dashboard data, written by the Metrics workflow.
- `index.html`, `app.js`, `styles.css` render everything. `vendor/` holds the two libraries used.

Run it locally from the repo, then open http://localhost:4173:

```
python3 -m http.server 4173
```

`data/metrics.json` is always revalidated on load, since the Metrics workflow rewrites it without touching the version. Other assets are versioned with `?v=N` in `index.html`; bump both suffixes after changing `app.js`,
`styles.css` or `atlas.yaml`, or GitHub Pages serves cached copies for a while. Working notes
(`NOTES.md`, `ATLAS_DEVELOPMENT.md`) stay local: both are git-ignored and never deployed.

## Keeping the map honest

`bin/check-atlas.mjs` compares the map with GitHub and npm and reports drift:

- repo links that no longer resolve, or archived repos;
- a module's status against its npm release;
- `requires` against each package's `dependencies`, in both directions;
- WDK repos in the org that the atlas does not mention;
- roadmap items that name a module id missing from the atlas.

It needs Node 22 and nothing else. A GitHub token lets it see private repos:

```
GITHUB_TOKEN=$(gh auth token) node bin/check-atlas.mjs
```

The `Atlas drift` workflow runs it every Monday and on demand, and keeps a single issue labelled
`atlas-drift` up to date with the findings. Fix the YAML, or add a repo to `audit.ignoreRepos`, and
the next run drops the line. The `ATLAS_TOKEN` repository secret (a classic token with `read:org`, plus
`repo` if the drift check should see private repos) is shared with the metrics workflow below.

## Metrics

`bin/collect-metrics.mjs` gathers public figures for every public WDK repo and the npm package it
publishes: daily downloads, pull requests and issues per day (external ones by author association),
time to first response on issues, and a daily snapshot of stars, forks, contributors and open counts.
Downloads are fetched for the whole retention window each run, so npm history is backfilled (about 13 months); everything else accumulates from the day collection started, and GitHub serves no dated star history for this org, so stars only move as daily snapshots pile up. It merges them into `data/metrics.json`. Scope is every public repo matching `audit.repoPattern` — WDK's public open-source footprint, the documentation site included. That is deliberately wider than `audit.ignoreRepos`, which only says what is not a module on the map. The `Metrics` workflow runs it every day at 06:30 UTC and on
demand and commits the result to `main`. Only public data is collected. `ATLAS_TOKEN` matters for one thing:
GitHub only says who is an org member to a member's token, so without it every teammate would count as an
external contributor. The collector reads the member list when it can, remembers teammate labels across runs,
and treats the logins in `audit.team` as the team whatever GitHub says.

```
GITHUB_TOKEN=$(gh auth token) node bin/collect-metrics.mjs --dry
```

Every key result reads from this data or from `atlas.yaml`: stable releases (npm latest tag),
audits (an audit folder at the repo root), CI (last run on the default branch), the signer interface
(code search for ISigner), private repos (the `private` flag the drift check verifies), examples
(folders in the examples repo), third-party modules (the map), external pull requests per quarter,
issues answered within a week, and GitHub's community health score. The "Release readiness" section
of the Dashboard shows the per-package facts behind them; CODEOWNERS files supply owners.
