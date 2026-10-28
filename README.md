# TOP 10 | Nuvio Edition v3.0

A resilient Top 10 catalog service for **Nuvio / Stremio-compatible clients**, with ranked, Apple TV-inspired glass overlays. This is an upgrade to your existing add-on, not a new catalog: the **manifest ID and both catalog IDs are unchanged**, and the existing movies/series rows should remain compatible.

## What was fixed

- **Movie and series catalog requests no longer wait for Posters+ or ranked poster rendering.** The catalog returns the ten metadata cards first; the images load on demand.
- **No fire-and-forget startup storm.** The old module-start `setTimeout` prewarming has been removed.
- **Vercel CDN caches successful catalog responses for 6 hours**, with stale-while-revalidate for a full day. Invalid/empty error responses are *not* cached as successful catalogs.
- **Independent movie and series in-flight requests** reduce duplicate calls during cold starts.
- **TMDB daily and weekly trending + MDBList backup.** A single unavailable page won't automatically zero the row.
- **Digital-release status is a preference, not an empty-list trap.** Movies without explicit TMDB digital metadata can still fill a row; films with confirmed non-released digital dates are placed lower.
- **IMDb lookup failures only drop affected titles.** More candidates are tried if the first ten lack playable IMDb IDs.
- **Posters+ fails over to original TMDB poster art**, with a tasteful dark poster placeholder as a last resort. Original frosted glass number treatment and Finnish logo preferences retained.
- **Sharper poster exports**: 1080×1620 by default, high-quality JPEG with 4:4:4 chroma. Optional `POSTER_WIDTH=1440` produces 1440×2160 but costs more CPU, RAM and bandwidth.
- **Status endpoint** `/api/status`, updated premium homepage and optional protected `/api/refresh` cron for CDN warming.

## Deployment — minimum changes

1. In your **existing Vercel GitHub repository**, replace `api/index.js`, `vercel.json` and `package.json` with the files from this patch. Add `.env.example` and `README.md`. **Keep your original `fonts/` directory unchanged**; the patch intentionally does not redistribute font files. `digits/` can stay, though the current renderer does not need it.
2. In Vercel → Project → Settings → Environment Variables, set `TMDB_API_KEY` (TMDB v3 API key), in **Production** (and Preview if you test previews). The old code contained a hard-coded key; this version intentionally does not ship anyone's API credentials.
3. Optional: set `MDBLIST_API_KEY` for Posters+. To self-host Posters+, change `POSTERSPLUS_BASE_URL`. Do not share URLs containing these keys.
4. Optionally set `PUBLIC_BASE_URL=https://my-top10-addon.vercel.app` (your permanent production URL); this keeps poster URLs stable. Otherwise requests use the incoming domain.
5. For the included daily warm-up cron, set a random `CRON_SECRET` in Vercel; the scheduled endpoint uses Vercel's `Authorization: Bearer ...` handling. Without this variable the cron will return 401. If you do not want to configure the cron, remove the `crons` section from `vercel.json`; CDN caching still works without it.
6. Redeploy. Verify `/manifest.json`, `/api/status`, `/catalog/movie/top10_trending_movies.json` and `/catalog/series/top10_trending_shows.json`. Each catalog should return up to ten `metas` without waiting for images.
7. Open a returned `poster` URL. On an uncached render it may take several seconds; repeat it to verify Vercel CDN caching.

### Recommended settings for your Android TV

- **POSTER_WIDTH=1080** for best quality/speed balance; 1440 if you deliberately choose heavier artwork and your TV handles it.
- **POSTERSPLUS_TIMEOUT_MS=9000** initially. Reduce to 6000 if Slokker often stalls and you prefer fast TMDB fallback. Increase if preserving Posters+ title logos on cold loads matters more than speed.
- Leave your native Nuvio TorBox integration, Comet and Torrentio configurations unchanged.
- Xperience can continue using the same catalog IDs; you may need to refresh/reinstall the manifest once to recognize version 3.0.0.

### Behavior and tradeoffs

- A catalog response is fast **after CDN caching**, but the first uncached request still needs TMDB/MDBList and IMDb ID lookups. The project has no persistent cross-instance database; CDN caching provides the durable fast path between Vercel function invocations.
- When TMDB and MDBList are both unreachable on a truly cold request, the API returns `503` and **does not cache an empty `{metas:[]}`**. Existing CDN content may still be served stale.
- Poster generation remains on-demand. `GET /api/refresh` warms *catalog JSON at the edge*, not all poster images.
- The movie filter prefers digitally available films, but does not guarantee TorBox availability. TMDB release-date metadata is incomplete and sometimes misleading.
- Default visuals are cinematic **portrait** 2:3 cards with custom ranking, intentionally preserving your working Nuvio layout rather than changing it to landscape without consent.

## Tests

Run `npm install`, then `npm test` or `npm run check`. The tests are dependency-free mocks using Node's built-in test runner, covering both catalogs, concurrent deduplication, publisher timeouts, and safe fallback behavior. They do not make live external requests.
