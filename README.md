# WDK Atlas

A visual map and roadmap of the Wallet Development Kit by Tether. Static site, no build step.

- `atlas.yaml` is the source of truth: modules, sections, relations, north stars and roadmap items.
- `index.html`, `app.js`, `styles.css` render it. `vendor/` holds the two libraries the page uses.
- `NOTES.md` holds the working notes; its questions section is the unlisted Questions page.

Run it locally from the repo, then open http://localhost:4173:

```
python3 -m http.server 4173
```

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
