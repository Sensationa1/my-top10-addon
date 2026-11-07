# Nuvio Top 10 — Netlify deployment package

**Important: this ZIP contains an offline recovery copy of `api/index.js` (v5.11) as a fallback.** It cannot be described as a full offline snapshot of GitHub v5.12, because direct GitHub downloads were unavailable in the packaging environment. **On each Netlify build**, `scripts/sync-upstream.mjs` clones the original public GitHub repository and replaces `api/index.js` with the original **v5.12.0** source. It FAILS CLOSED when the upstream download or version check fails rather than deploying the older bundled code.

The Netlify adapter does not modify the upstream Top 10 algorithm, filters, poster layouts, or IDs. It adds a serverless wrapper, a Netlify rewrite and required dependencies. The original GitHub repo is `https://github.com/Sensationa1/my-top10-addon`.

## Deployment

1. **Create a NEW GitHub repository** (for example `my-top10-netlify`), extract the ZIP, and commit its contents there. Do not replace the files in `Sensationa1/my-top10-addon`: that is the upstream repository the build fetches, and replacing it with the older offline recovery snapshot would break the version check. Do NOT use Netlify's manual drag-and-drop static upload: it will not build the Functions.
2. Connect that repository to your existing Netlify site `top10-silo-nyz` under continuous deployment. Keep the repository base directory empty (root). The included `netlify.toml` sets the build and publish directories.
3. At Netlify → Project configuration → Environment variables, set `TMDB_API_KEY`, `MDBLIST_API_KEY`, and `PUBLIC_BASE_URL=https://top10-silo-nyz.netlify.app` with function access. Never publish your keys.
4. Trigger a production deploy; confirm the build log includes `Synchronized upstream v5.12.0 source successfully` and that Netlify deployed a function named `api`.
5. Verify `/manifest.json`, `/api/status`, `/catalog/movie/top10_trending_movies.json`, and `/catalog/series/top10_trending_shows.json`.
6. Verify actual poster URLs from the catalogue responses on your Nuvio device.

**Warning:** The included local `api/index.js` is not the latest version; to deploy current v5.12, a successful network-enabled Netlify build is required. This package cannot be tested against live TMDB/MDBList/Posters+ APIs without keys, and cloud deployment has not been verified.

**Fonts:** No font files are redistributed with this ZIP. The Netlify build retrieves the existing `fonts/` folder from the user's original public GitHub repository if present, and `included_files` bundles it with the function. This keeps any pre-existing artwork typography as configured in the source.

**Performance:** These changes fix deployment compatibility, not inherent ranking-generation or image-processing latency. Caching should be measured after endpoints function. Netlify Free usage is metered.


## Fixed build guard
This revision repairs `Unexpected upstream version` caused by syncing the HEAD of a repo that also holds this Netlify package. The build now searches upstream Git history for the latest v5.12 source matching its JustWatch/MDBList ranking, Posters+ artwork, and catalogue IDs; it restores the original fonts from the matching revision where available. It fails safely if no matching version exists. Build-time GitHub access is required. This package includes an older *offline fallback* that must not be deployed unless the reviewed source is restored.
