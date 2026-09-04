# WDK Atlas

A map of the Wallet Development Kit by Tether: the packages as a stack, the roadmap by north star,
the key results behind each star, and a dashboard of public metrics. Static site, no build step.

Pages: **Roadmap** (front page), **Key results**, **Dashboard**, **WDK Visual Map**, **Developer
Resources**, and an unlisted **Questions** page (ten taps on the logo).

- `atlas.yaml` is the source of truth: modules, sections, relations, mission, north stars with their
  key results, and roadmap items. Its header comment documents every field.
- `data/metrics.json` holds the dashboard data, written by the Metrics workflow.
- `index.html`, `app.js`, `styles.css` render everything. `vendor/` holds the two libraries used.
- `NOTES.md` holds working notes; its questions section is the Questions page.

Run it locally from the repo, then open http://localhost:4173:

```
python3 -m http.server 4173
```

Assets are versioned with `?v=N` in `index.html`; bump both suffixes after changing `app.js`,
`styles.css`, `atlas.yaml` or `NOTES.md`, or GitHub Pages serves cached copies for a while.

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
the next run drops the line. Set an `ATLAS_TOKEN` repository secret, a read-only token with access to
the org's private repos, for the workflow to see them.

## Metrics

`bin/collect-metrics.mjs` gathers public figures for every public WDK repo and the npm package it
publishes: daily downloads, pull requests and issues per day (external ones by author association),
time to first response on issues, and a daily snapshot of stars, forks, contributors and open counts.
It merges them into `data/metrics.json`. The `Metrics` workflow runs it every day at 06:30 UTC and on
demand and commits the result to `main`. Only public data is collected; the workflow token is enough.

```
GITHUB_TOKEN=$(gh auth token) node bin/collect-metrics.mjs --dry
```

Three key results read from this data (third-party modules, external pull requests per quarter,
issues answered within a week); the others are set by hand in `atlas.yaml` or left "not measured".
