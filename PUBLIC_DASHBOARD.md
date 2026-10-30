# Public dashboard

Active URL: https://nubganggsta.github.io/DataViz_YaMaHam/

The earlier Sites URL was replaced after visitors reported that numbers and charts did not appear. Use the GitHub Pages URL above.

## GitHub Pages publication

- Repository: `nubganggsta/DataViz_YaMaHam`
- Publishing branch: `gh-pages`, root directory, with `.nojekyll`.
- Static checkout: `sites/github-pages/` (separate Git checkout, ignored by the main repository).
- Builder: `python data/build_github_pages.py`.

The public build uses ordinary JSON: a small manifest and 18 record chunks loaded with three concurrent requests and a progress message. It requires no `DecompressionStream`. Leaflet 1.9.4 and MarkerCluster 1.5.3 are stored in `vendor/` with the site. Library bytes are preserved with `vendor/** -text` so integrity checks remain correct. Missing map libraries or unavailable localStorage no longer prevent KPI/chart data from loading.

To update, build from the latest main workspace, then commit/push the generated `sites/github-pages/` checkout to `gh-pages`. On a fresh machine, clone that branch into `sites/github-pages/` first. Keep the pinned vendor files from the publishing branch. GitHub Pages rebuilds after a push. This process leaves the main dashboard source and original datasets unchanged.

Verified anonymously over HTTPS: page, application script, JSON manifest, first/last record chunks, annual summary, both Leaflet assets and MarkerCluster all returned 200. Published Leaflet integrity hashes match the HTML. A Node test of the full bootstrap rendered the 8,558 death counter, three annual rows, trend and heatmap drawing calls from all 69,302 records even with map/storage failures simulated. Browser screen verification was blocked by Computer Use's URL policy check; no screen result is claimed.

## Previous Sites publication (historical)

Previous URL: https://yamaham-road-safety.cometlime2048.chatgpt.site

Audience: public; visitors do not need to sign in. First publication: 30 October 2026.

This is a published snapshot of the dashboard, including its cleaned TRAMS data and DOH/DRR road overlays. It does not require the owner's computer to remain running. Changes pushed to GitHub do not automatically update this separate Sites publication.

## Hosting identity

- Sites project: `appgprj_6ae4296ae1d48191bbb78f0be89bde35`
- Version: 1
- Deployment: `appgdep_6ae42afc0b948191ac60ab73c0a4f05e`
- Local Site checkout: `sites/road-dashboard/`
- Hosting manifest: `sites/road-dashboard/.openai/hosting.json`

Reuse this project when publishing updates. The Site checkout has its own source repository managed by the Sites workflow. Keep its current public audience unless explicitly requested otherwise. Recover a new source write credential through Sites when needed; no credentials are stored in this document.

The static `dist/` contains the existing HTML/CSS/JavaScript and six gzip-compressed data files. A loader in the published copy of `app.js` reads these with `DecompressionStream`. The original local dashboard and its Node server are unchanged. Source CSV files, cleaning audit exports, dependency folders and Git metadata are excluded from the publication.

Verification: production deployment succeeded; anonymous requests to the page, application script and summary asset returned HTTP 200. The gzip loader preserved 69,302 events and 8,558 fatalities. Browser screenshot verification remains unavailable because Local browser use is disabled.
