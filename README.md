# Nuvio Top 10 · Platinum v5.10 — TMDB Trending Today (Filtered)

Drop-in update for your **existing Nuvio / Xperience Top 10 add-on**. The manifest ID (`com.sensationa1.top10.cloud`) and both catalog IDs (`top10_trending_movies`, `top10_trending_shows`) stay unchanged.

## Selection rules

- **Movies:** Start with TMDB's global `GET /trending/movie/day` chart, in its actual published order. Only include films with a confirmed **digital release (TMDB release type 4) on or before today** in the TMDB `/movie/{id}/release_dates` data. A future, theatrical-only, missing, or unverified digital date does not count.
- **Series:** Start with TMDB's global `GET /trending/tv/day` chart, in its actual published order. No digital-release constraint for series.
- **Anime:** Excluded from BOTH charts, except **Cyberpunk: Edgerunners** (TMDB TV ID `105248`) which remains eligible if it appears on today's trending chart. The anime check uses Animation plus Japanese original language/origin, and TMDB's anime keyword where necessary. Non-anime Western animation is not blanket-excluded. Ambiguous animated entries fail closed if TMDB's keywords cannot be checked.
- **No US/Europe restriction**, no regional Discover-ranking queries, and no nationality/language filter for non-anime content.
- After filtering, the app scans further pages **of the same TMDB daily chart** (up to five pages) until it finds ten eligible entries. It **preserves the surviving titles' TMDB order** and numbers the displayed results 1–10. Thus the lists are personalized, *not* TMDB's unmodified official Top 10. If fewer than ten titles qualify, fewer may be displayed.
- Items without a usable IMDb ID are skipped to preserve the existing Nuvio stream resolvers.

## Preserved

- Platinum/silver side-rank poster layout, sizing, card shadow, and positioning.
- Your exact previous Posters+ Slokker configuration (`bg1=0.9,0.075,r:4:network`, `bls=1.05`, `mam=1`, `msoo10=1`, etc.).
- IMDb-first rating lookup via MDBList when configured, with the existing fallback behavior.
- TMDB title metadata: descriptions, genres, cast, director/creators, runtime, dates, trailers, English-first transparent logos and original-resolution backdrops where available.
- Catalog caching, Vercel endpoints and current Nuvio/Xperience catalog identifiers.

## Installation

1. Back up your live Top 10 Vercel/GitHub project.
2. Replace `api/index.js`, `package.json`, `vercel.json`, `.env.example`, `tests/`, and `README.md` using this ZIP.
3. **Keep your existing `fonts/` folder.** The ZIP deliberately does not include font binaries.
4. Retain your existing `TMDB_API_KEY` and optional `MDBLIST_API_KEY` Vercel environment variables. Retain `PUBLIC_BASE_URL` if previously set.
5. Redeploy your **existing** Top 10 project (not a new Vercel project). You do **not** need to recreate any Xperience rows.
6. Verify these endpoints on your live domain:
   - `/api/status` — should report `version: 5.10.0`, `digitalReleaseStrict: true`, `animeExcluded: true`, `regionalFilter: false`.
   - `/catalog/movie/top10_trending_movies.json`
   - `/catalog/series/top10_trending_shows.json`

A versioned poster URL/cache key has been bumped to prevent stale artwork. CDN responses for catalog JSON may otherwise remain cached for up to about 30 minutes before refresh.

## Notes

- Strict release checks depend on TMDB's release-date metadata and may exclude a digitally available film if its database record is incomplete.
- Anime detection is best effort based on TMDB language, country and keywords; no public metadata taxonomy is guaranteed exhaustive.
- `TMDB_META_ENRICHMENT=true` (default) enables the rich detail/logo lookup. `POSTER_WIDTH=1080` balances quality and TV responsiveness.
- The app has only been tested locally with mocked upstream API responses; this is **not** a successful live deployment or independently verified real-world TMDB ranking.
- This product uses the TMDB API but is not endorsed or certified by TMDB.
