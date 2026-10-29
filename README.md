# Nuvio Top 10 · Platinum v5.9 — Trending Today + US/Europe + Digital Only

**Drop-in replacement for your existing Top 10 Vercel project.** The stable manifest ID `com.sensationa1.top10.cloud` and catalog IDs `top10_trending_movies` and `top10_trending_shows` are unchanged, so your Nuvio / Xperience home rows do not need to be rebuilt.

## How the new Top 10 is selected

1. Pull **TMDB Trending Today** for movies and series from `/trending/movie/day` and `/trending/tv/day` (up to the first three pages).
2. Check each title against TMDB regional **Discover** listings for **US, UK, Germany, France, Italy, Spain, Finland, Sweden, and the Netherlands**:
   - Movies: region-filtered Discover with **digital release type 4** and a release date no later than today.
   - Series: `watch_region` plus `with_watch_monetization_types=flatrate|free|ads` to confirm streaming availability in those markets.
3. Prefer titles found in at least **two** listed markets, preserving their relative TMDB daily-trending order. If necessary to reach ten, allow titles listed in **one** of the selected markets, *never* a worldwide-only title.
4. **Movies only:** independently require a confirmed TMDB release-dates **Digital (type 4)** entry **in at least one of those US/European markets** with a date on or before today. Unknown, future, theatrical-only, or out-of-market-only releases are excluded. For series this digital movie gate does not apply.
5. Require a working IMDb ID to preserve compatibility with your Nuvio stream resolvers; select up to 10 and number them 1–10 sequentially.

**Important:** TMDB does *not* publish a localized `Trending Today` API chart. These are **custom filtered daily charts**, not the exact global top ten or true regional viewership rankings. Regional TMDB Discover listings represent release/streaming availability and popularity, not actual viewing figures. If fewer than ten eligible titles are present in the chart pool, the add-on returns fewer than ten, rather than filling with unqualified titles.

## Preserved visual design and metadata

- Platinum silver side-mounted rank numerals, same card placement, no visual restyling.
- The previous Posters+ Slokker instance, including `hr=1`, `rdm=3`, `mam=1`, `mmfsr=0.056`, `msoo10=1`, `rtc=FFFFFF`, `lls=fi`, `bg1=0.9,0.075,r:4:network`, and `bls=1.05`.
- IMDb-first rating lookup through MDBList when configured, with the existing fallback.
- TMDB title metadata: descriptions, genres, release dates, runtime, cast, directors/creators, trailer links where available.
- TMDB original-resolution backdrops and English-first transparent title logos where available.
- TMDB artwork fallback if Posters+ times out.
- Independent cached catalogs and stable Xperience home-row URLs.

## Deployment

1. Back up your current Top 10 GitHub/Vercel project.
2. Replace its `api/index.js`, `package.json`, `vercel.json`, `tests/` and `README.md` with the contents of this ZIP.
3. **Retain your own `fonts/` directory**. Font files are deliberately not included in the ZIP.
4. Keep the existing `TMDB_API_KEY` in Vercel. `MDBLIST_API_KEY` is optional for IMDb ratings. Leave your `PUBLIC_BASE_URL` as your current production URL if configured.
5. Redeploy the **existing** Vercel project, not a separate add-on.
6. Check `/api/status`, `/catalog/movie/top10_trending_movies.json` and `/catalog/series/top10_trending_shows.json` on your production domain, then refresh Nuvio.

Settings: `POSTER_WIDTH=1080` by default (1080 x 1620); `TMDB_META_ENRICHMENT=true` by default; `TMDB_META_TIMEOUT_MS=4000` optional; `POSTERSPLUS_TIMEOUT_MS=9000` optional. Hourly in-memory refresh and a ~30-minute CDN TTL reduce unnecessary calls. `DIGITAL_RELEASE_STRICT` is no longer a switch; **digital-only movie filtering is always enabled in v5.9**.

## Testing / limitations

Run `npm test`. All 13 local mocked tests cover region selection, the digital-only gate, daily ranking, IMDb compatibility, caching, posters, TMDB metadata/logos/backdrops and error handling. **No live TMDB or deployed Nuvio test has been performed**. Regional Discover and strict digital-release requirements can mean fewer titles or a slower first refresh than the unfiltered global chart. The app never disables filters silently when an upstream source fails.

TMDB attribution: This product uses the TMDB API but is not endorsed or certified by TMDB.
