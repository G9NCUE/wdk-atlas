## What changes, and why

<!-- One paragraph. What a reader of the site would notice, or what stops being possible. -->

## How it was checked

<!-- Tick what you ran. The Checks workflow runs all five anyway; this says what you saw. -->

- [ ] `node bin/validate-atlas.mjs`
- [ ] `node --test test/*.test.mjs`
- [ ] `node bin/check-quality.mjs`
- [ ] `node bin/check-metrics.mjs`
- [ ] `node bin/check-public.mjs`
- [ ] Looked at it in a browser, at phone width as well

## If this touches a served file

- [ ] `?v=N` bumped in `index.html` and `examples/embed.html`
- [ ] No number on a page is typed by hand
- [ ] Nothing here is internal
