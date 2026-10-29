# Nuvio Top 10 · Platinum v5.8 — TMDB Trending Today

Drop-in update for the **existing** Top 10 Vercel add-on. The manifest ID (`com.sensationa1.top10.cloud`) and catalog IDs (`top10_trending_movies`, `top10_trending_shows`) are unchanged, so existing Nuvio / Xperience rows can stay in place.

## What changed in v5.8

- **Movies:** official TMDB **Trending Today** `GET /trending/movie/day` page 1, results 1–10, in TMDB's original order.
- **Series:** official TMDB **Trending Today** `GET /trending/tv/day` page 1, results 1–10, in TMDB's original order.
- **No more US/Europe regional popularity aggregation or `Discover` ranking.** This uses TMDB's global daily chart, not any regional chart.
- **No movie digital-release gate, genre, language, TV-category, anime, or release-date filters.** Such filters would change the official Top 10 ranks. Consequently, theatrical-only or future-release movies can appear, and non-Western content can appear if TMDB ranks it highly.
- **IMDb ID compatibility:** to preserve the user's existing Nuvio playback and stream resolvers, titles with no usable IMDb ID cannot be emitted. They are skipped **without pulling in rank 11 or renumbering later entries**. On rare days a row might have fewer than ten entries.
- **Daily refresh:** in-process catalog TTL reduced to one hour; CDN `s-maxage` reduced to 30 minutes. This is not an instantaneous live ranking feed.

## Preserved from v5.7

- Silver / platinum side-mounted ranks (same layout, size, shadow and positioning) with a cache-version refresh.
- The exact Posters+ Slokker preset including `hr=1`, `rdm=3`, `mam=1`, `mmfsr=0.056`, `msoo10=1`, `rtc=FFFFFF`, `lls=fi`, `bg1=0.9,0.075,r:4:network` and `bls=1.05`.
- IMDb-first rating lookup through MDBList when configured, with existing fallback behavior.
- TMDB movie/series metadata: summaries, original-resolution backdrops, English-first clearlogo images, official genres, cast, directors/creators, dates, runtime, trailers where available.
- TMDB artwork fallback when Posters+ is unavailable.
- Catalog-first behavior, independent caching, and all existing home row identifiers.

## Deploy over the current project

1. Back up your current Top 10 Vercel / GitHub repo.
2. Replace `api/index.js`, `package.json`, `vercel.json`, `.env.example`, `tests/` and `README.md` with files from this ZIP.
3. **Retain your original `fonts/` directory.** Font files are deliberately not redistributed in this ZIP.
4. Keep `TMDB_API_KEY` in your Vercel environment. `MDBLIST_API_KEY` is optional for IMDb ratings. Keep your existing production URL in `PUBLIC_BASE_URL` if already configured.
5. Redeploy the **existing** Vercel project (do not create a new project).
6. Verify `/api/status`, `/catalog/movie/top10_trending_movies.json`, and `/catalog/series/top10_trending_shows.json` at your domain. Refresh Nuvio after deployment.

The environment variable `DIGITAL_RELEASE_STRICT` from older versions no longer affects v5.8, because an exact TMDB Top 10 cannot be filtered for digital-release availability without changing rank positions.

## Technical settings

- `POSTER_WIDTH=1080` (default 1080 × 1620). Increase only if you accept slower rendering.
- `TMDB_META_ENRICHMENT=true` (default). Disable to reduce initial metadata calls; this also removes full logos and rich detail enrichment.
- `TMDB_META_TIMEOUT_MS=4000` (optional).
- `POSTERSPLUS_TIMEOUT_MS=9000` (optional).
- `CRON_SECRET` (only when using the `vercel.json` daily refresh cron).

## Verification and limitations

Run `npm test`. Twelve local mocked tests verify TMDB trending endpoints, official ordering, no custom filtering, missing IMDb-ID handling, caching/concurrency, metadata, logos, artwork fallbacks and errors. This is **not** a live TMDB query or deployed Nuvio test.

TMDB attribution: This product uses the TMDB API but is not endorsed or certified by TMDB.
