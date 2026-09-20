# Contributing to WDK Atlas

Atlas is a static site with no build step and no dependencies. Serve the folder, edit a file,
reload. That constraint is deliberate: it is what lets another site embed Atlas with one script
tag, and it is not traded away for convenience.

## Running it

```
python3 -m http.server 4173     # then open http://localhost:4173
```

Node 22 or later for the scripts in `bin/` (`.nvmrc` pins it). Nothing to install.

## Before you open a pull request

The Checks workflow runs these on every push. Run them first and save yourself a round trip:

```
node bin/validate-atlas.mjs      # atlas.yaml structure, ids, references, 50-word blurbs
node --test test/*.test.mjs      # the arithmetic behind the published numbers
node bin/check-quality.mjs       # contrast, type sizes, weight, embeddability, the asset version
node bin/check-metrics.mjs       # every published number has a definition and a decision
node bin/check-public.mjs        # nothing internal reached a shipped file
```

`node bin/check-atlas.mjs` compares the map with GitHub and npm; it needs the network and a
`GITHUB_TOKEN` for the rate limit, so it runs on its own schedule rather than on a pull request.

## The rules the checks cannot see

- **Every number is recomputed from a public source.** npm, GitHub, or `atlas.yaml`. Nothing is
  typed by hand, and anything that cannot be measured that way says "not measured" on the page.
- **Fifty plain words.** Module summaries and roadmap blurbs are 50 words or fewer, in plain
  language, naming a standard only when it is the product's own name.
- **British spelling, no marketing adjectives, no exclamation marks.** The site says what it
  does not know.
- **The colour tokens are not ours to change.** They are byte-identical to the ones
  wdk.tether.io ships. If a contrast check fails, fix where the token is used, never its value.
- **Bump `?v=N`** in `index.html` and `examples/embed.html` whenever `app.js`, `styles.css`,
  `page.css` or `atlas.yaml` changes. Gate P4.9 fails the build if you forget.
- **Nothing private.** Everything in this repo is published. `bin/check-public.mjs` scans for
  internal content; a new finding has to be decided before it will pass.

## Editing the map

`atlas.yaml` is the source of truth for modules, sections, relations, the mission, the north
stars, the key results and the roadmap. Its header comment documents every field. When a module
changes state, check the roadmap items that name it: their status or wording usually needs the
same edit.
