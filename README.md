# Nuvio Top 10 · v5.11 — EasyRatingsDB Fast Edition

A drop-in upgrade to the existing `my-top10-addon` project (Render or Vercel). The **manifest ID**, both **catalog IDs** and all Top 10 ranking/selection rules remain unchanged. No existing Xperience Top 10 rows need to be removed or recreated.

## What caused the regression

The prior v5.10 path waited for Posters+ (up to nine seconds) on **each** poster, then blurred and composited a 1080×1620 image. Ten concurrent images could overload a small Render service. Catalog refreshes also fetched release dates, IMDb IDs, and full details in separate calls, and screened too many candidates on the first page.

## Changes in v5.11

1. **New poster source**: uses your exact EasyRatingsDB URL template:
   `https://easyratingsdb.com/67b66dcb8878a238077b648eaf2f35c4/poster/{id}.jpg?type={type}&shape={shape}`.
   - `{id}` is the IMDb `tt` ID, `{type}` is `movie` or `series`, and `{shape}` defaults to `poster` (because existing ranked output is a 2:3 portrait card). Set `EASYRATINGS_SHAPE=landscape` if you intentionally want wide artwork cropped into the card.
   - **Posters+ is no longer called.** A failed/invalid EasyRatings response falls back to TMDB, so the row is not left blank merely because EasyRatings times out.
   - This project still renders your existing large **1–10 side-number layer**, frame, rounded image and genre/rating footer over the EasyRatings source. Using the external URL directly would be faster still but would lose your custom numbered layout; this upgrade avoids that trade-off.
2. **Lower CPU load**: default artwork rendering is 720×1080 (configurable); blur is computed on a tiny thumbnail, not a full 1080×1620 image; 4:2:0 JPEG at quality 81 instead of 4:4:4 quality 90; two CPU renders at a time (`MAX_POSTER_RENDERS=2`) while network downloads remain concurrent.
3. **Fewer upstream calls**: uses TMDB's `append_to_response` to fetch details, release dates and external IDs together for each candidate. Only processes as many candidates from the chart as needed. Parallel MDBList rating lookups with metadata enrichment.
4. **Less blocking on refresh**: when an already-cached catalog has expired, return its last-good result immediately and refresh asynchronously. Fresh catalog responses and poster JPEGs carry longer cache/stale headers, and a poster LRU avoids rerendering on repeated local requests.
5. **Failure isolation**: if an image cannot be rendered, redirect to its TMDB fallback when available instead of always returning a broken image. Original poster/metadata/catalog IDs are preserved, so Xperience integration remains stable.

## Deploy to your existing Render project

1. **Back up** the existing repository/deployment.
2. Replace `api/index.js`, `package.json` and any updated files from this ZIP in the **existing** GitHub repository (`Sensationa1/my-top10-addon`, if you still use that repo). Include `tests/`, `.env.example`, and this `README.md`. `vercel.json` only applies if using Vercel.
3. **KEEP your existing `fonts/` directory.** This ZIP does not distribute any font files. Rendering rank numerals relies on the existing fonts.
4. Preserve the current **`TMDB_API_KEY`** and optional **`MDBLIST_API_KEY`** secret environment variables. Do not overwrite your actual keys with `.env.example` placeholders.
5. For Render: Node 20+, build command `npm install`, start command `npm start` and appropriate `PORT`. Apply environment values below. Deploy the same service URL so Xperience automatically uses the update.
6. Open your existing deployment URL plus `/api/status`: it should show `version: 5.11.0` and `posterSource: EasyRatingsDB`. Open `/catalog/movie/top10_trending_movies.json` and `/catalog/series/top10_trending_shows.json`, then load the row in Nuvio.

### Suggested environment variables

```
POSTER_WIDTH=720
MAX_POSTER_RENDERS=2
EASYRATINGS_SHAPE=poster
EASYRATINGS_TIMEOUT_MS=3500
TMDB_META_ENRICHMENT=true
TMDB_META_TIMEOUT_MS=3000
```

`EASYRATINGS_POSTER_TEMPLATE` defaults to the URL above. You can override it in Render without changing code. If `shape=poster` fails for your particular EasyRatings preset, use the same template with a supported `shape` value and redeploy.

### Important limitations

- An initial **cold catalog load** still depends on TMDB and (if configured) MDBList. The lower call count helps, but free-tier Render services may spin down and have cold starts, which application code cannot eliminate.
- EasyRatingsDB image availability and its exact `shape`/`type` behavior could not be end-to-end verified here because outbound network requests to the image host were unavailable from the execution environment. The provider URL is applied exactly as supplied and there is a TMDB fallback.
- The local tests mock upstream APIs and the image renderer. All tests pass, but this does **not** constitute a measured live speed improvement or a successful production deployment. Check the actual service and posters after redeploying.
- If you change poster width or the template after deployment, bump `POSTER_CACHE_VERSION` in `api/index.js` (or wait for cache expiry) so clients don't retain an old image.

## Preserved compatibility

- Manifest ID: `com.sensationa1.top10.cloud`
- Catalogs: `top10_trending_movies` and `top10_trending_shows`
- Movies from TMDB Trending Today **only if confirmed digitally released**; anime excluded except *Cyberpunk: Edgerunners* if trending; no country filter; relative ordering preserved; ranks always 1–10 after filtering.
- IMDb IDs, IMDb-first rating preference, TMDB description/backdrops/transparent logos/cast/trailers when available, ranked poster design, metadata response schema.

## Testing

Run `npm test` or `node --test tests/top10.test.js`. 19 test cases cover catalog IDs, digital release constraints, anime restrictions, rank ordering, parallel catalog requests, TMDB fallback, EasyRatings URLs, metadata, combined TMDB lookups and repeat-image caching.
