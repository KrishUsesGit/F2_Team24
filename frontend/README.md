# HOPTRACE frontend

React + TypeScript (strict) + Vite + Tailwind CSS + Motion. This directory holds
the new interface; the legacy `ui/` stays untouched until this one reaches
verified parity and its retirement is approved.

**Status: visual experience built (Stage C).** An asymmetric editorial page over
the four real bundles: a trial picker, the application's own RTT chart (the
symptom), a CSS-3D client-to-server path with selectable hops and a per-hop
inspector, the boundary statement ("appears to begin at or after Hop N"),
evidence grouped by kind (measured fact / inference / correlation / unknown),
the stored confidence with its limits, the two stored evaluations, and the
limitations. Animated packets are **illustrative only** (the data hold no
packet-level observations) and the scene says so; they are removed under
`prefers-reduced-motion`.

## Commands

Requires Node 22.12 or newer (developed on Node 24). Run everything from this
directory, **outside OneDrive** (a sync folder is a poor home for `node_modules`).

```bash
npm ci               # install exactly what package-lock.json records
npm run dev          # Vite dev server (serves the allowlisted data at /data/...)
npm run typecheck    # tsc -b --force, strict
npm run lint         # eslint, zero warnings allowed (includes jsx-a11y)
npm test             # vitest: schema, loader, allowlist, components, a11y, contrast
npm run build        # typecheck + production build into dist/
npm run verify:dist  # inspects dist/: only approved files, no raw traces/labels/CDNs
npm run verify       # all of the above, in order
npm run preview      # serve dist/ on http://127.0.0.1:4173 (run `npm run build` first)
npm run check:layout # real-browser overflow/overlap check of dist/ (needs Chrome or Edge)
npm run check:preview # starts `vite preview`, switches all four trials in a real browser
```

`npm run preview` must stay running while the page is open. The data files are
fetched when a trial is chosen, so if the preview server has been stopped the
page keeps showing but every trial fails with "The data files could not be
reached" (a refused connection, not a missing file). Restart the server and
reload. `vite/previewServer.test.ts` builds the site and fetches all four
bundles over HTTP from Vite's preview server as part of `npm test`.

The tests read the repository's real artifacts (`../experiments`, `../evaluate`)
and expect to be run with this directory as the working directory.

## Data: no backend, an explicit allowlist

The interface reads JSON the Python pipeline already produced. A small Vite
plugin (`vite/dataAllowlist.ts`, `vite/hoptraceData.ts`) serves it in dev and
emits the identical files into `dist/data/`. Nothing else is reachable:

| URL | Source | Notes |
|---|---|---|
| `data/index.json` | scan of `experiments/*/path_bundle.json` | ids only |
| `data/bundles/<id>.json` | `experiments/<id>/path_bundle.json` | verbatim, except local paths are removed (below); id must match the scan |
| `data/evaluation/phase4.json` | `evaluate/frozen_config.json` + `held_out_results.json` | aggregate projection |
| `data/evaluation/phase4b.json` | `evaluate/frozen_config_4b.json` + `held_out_results_4b.json` | aggregate projection |

The evaluation result files contain per-trial fault types and expected hops
(ground-truth-derived labels). The projections copy **only** aggregate fields,
verbatim, and the frozen configuration is read from its own file and
cross-checked against the copy in the results file; a mismatch fails the build.
`.jsonl` traces, other `experiments/` files, the ground-truth database and
arbitrary paths are never served. `npm run verify:dist` checks the built output.

**Local paths never reach the browser.** The historical demo bundle records an
absolute machine path in `evaluation.source_file`. The file on disk is left
exactly as it is (it is evidence). The served copy keeps only the base name, and
if any other local path (`/mnt/x/`, a Windows drive path, `/home/`, `/Users/`)
is found anywhere in a bundle, the request fails with HTTP 500 rather than
serving it. `verify:dist` fails on any local path in `dist/`, and tests assert
it for the served data and for the rendered interface.

**Dev-server exposure.** `vite.config.ts` binds to 127.0.0.1, sets
`server.fs.allow` to this directory only, and denies `.env*`, key files and
`.git`. `vite/devSourceGuard.ts` additionally answers 404 for this directory's
own non-source files (config, scripts, tests, `package.json`, the lockfile).
`vite/devServer.test.ts` starts the real dev server and probes about forty
traversal, ground-truth, trace and config URLs; none returns file content.

## What the interface may and may not say

- It formats and displays stored values; it never recomputes onsets, statuses
  or confidence.
- Phase 4 (`mad`): false attribution 3/12 = 25% against a target of at most 10%.
  Phase 4b (`mad_sustained`): numeric thresholds met on an **exposed** set, not
  independent validation. Algorithm names and parameters come from the frozen
  configuration files, never from copy.
- "No onset detected" is not "healthy"; confidence is a fixed heuristic, not a
  probability; loss and bandwidth localization are unproven. See
  `../docs/EVIDENCE_LEDGER.md`.
- Result states shown are those present in real bundles (localized, partially
  localized, no degradation). There is no real `not_localized` or
  "insufficient data" bundle, and none is invented.

## Known limitations of this work package

- Historical bundles are shown as stored. They lack `evaluation.evidence_status`
  (the exposed status is derived by an explicit, flagged frontend rule) and carry
  the older "held-out validation" scope text. The demo bundle's recorded
  absolute path is preserved on disk and removed only from what is served.
- Hop roles (routers 1-4, server 5) are the documented testbed topology, a
  frontend constant, not a field in the data. Per-hop RTT timelines and packet
  data do not exist in the bundles, so the chart shows only the application's
  own pings and the packets are illustrative.
- The page is one ~500 kB script (React, zod, Motion); it is not code-split.
- Dependencies: ESLint is on 9.x because `eslint-plugin-jsx-a11y` does not yet
  support 10 (npm marks 9.x as no longer supported); TypeScript is on 6.0
  because `typescript-eslint` supports `<6.1`.
- **OUTSTANDING: offline testing.** The built site has no runtime CDN
  dependency (checked by `verify:dist` and by a test of the requested URLs), but
  it has **not** been loaded with the network actually disabled. Do not treat it
  as verified offline until that is done.
- Browser checks were done on the production build served locally from
  127.0.0.1, and `check:layout` drives a headless local Chrome/Edge. Neither is
  a cross-browser or real-device test.
