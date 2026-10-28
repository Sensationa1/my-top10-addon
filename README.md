# Nuvio Top 10 · Platinum v5.1

Drop-in update for your **existing** personal Vercel add-on. The manifest ID and movie/series catalog IDs remain unchanged, so your Xperience home rows should not need re-adding.

## What's different

- **Strict digital-only movies, ON by default.** A movie must have a TMDB **type 4 (Digital)** release date on or before today (UTC), in at least one country. A theatrical release (type 2/3), physical release (type 5), missing date, API error, or future-only digital release no longer counts as proof. Series still use their original first-air-date filter.
- If TMDB trending doesn't produce 10 eligible movies, the add-on consults TMDB's digital-only Discover results in **US, FI and GB** and still verifies each movie's release_dates. It never fills the row with films known to be theatrical-only or with unconfirmed dates merely to show ten cards. Some refreshes may have fewer than ten movies.
- **New ranking numerals:** large Inter Display Black type, metallic platinum/silver face, controlled edge highlights and deep but soft separation shadow. Placement remains **top left**, with no heavy glassy haze or colored glow. Vector-rendered at your configured image resolution; ranks 1–10 handled individually.
- Poster cache version bumped so Nuvio fetches the new side-rank art, rather than reusing last version's cached images.
- TMDB fallback posters now use `original` artwork (rather than an often-unavailable arbitrary image size).
- Keeps v3's responsive catalog-first behavior, Posters+ artwork source, fallback path, independent caches and your catalog IDs.

## Deploy (do not create a new Vercel project)

1. **Back up your current repo.** In your current GitHub/Vercel project, replace `api/index.js`, `package.json`, `vercel.json` and add/update `tests/` and this README.
2. **Keep your original `fonts/` folder in the existing repo unchanged.** This download intentionally does not contain or redistribute any font files. The renderer expects your current `fonts/InterDisplay-Black.ttf`, `fonts/Inter-SemiBold.ttf` and SF Pro font files. If you remove the folder, the ranked text may render using a fallback font.
3. In Vercel project Environment Variables, set `TMDB_API_KEY` (required), `MDBLIST_API_KEY` (optional), `PUBLIC_BASE_URL=https://my-top10-addon.vercel.app` (recommended), and `CRON_SECRET` if using the included cron. Never commit real keys or share token-bearing manifest links.
4. Redeploy Production. Test `https://my-top10-addon.vercel.app/api/status`, then `/catalog/movie/top10_trending_movies.json` and `/catalog/series/top10_trending_shows.json`.
5. For a poster render, open one of the returned `metas[].poster` links. Cold renders can be slower than subsequent cached renders. Refresh Nuvio's home once the new deployment is live.

## Settings

- `DIGITAL_RELEASE_STRICT=true` — default. Leave on to exclude unconfirmed digital releases. `false` is a temporary troubleshooting override; it reverts to v3's permissive movie behavior.
- `POSTER_WIDTH=1080` — default high-quality 1080×1620 portrait, recommended for fast Android TV home scrolling. For more detail, use `POSTER_WIDTH=1440` (1440×2160). Maximum permitted is `2160` (2160×3240) but that uses ~4× the pixels of 1080 and can be much slower on Vercel and Android TV. Do not confuse image resolution with the TV's video playback resolution.
- `POSTERSPLUS_TIMEOUT_MS=9000` — optional. If the public poster processor is routinely slow, test 6000 to reach TMDB fallback sooner.
- `CRON_SECRET` — optional only if using the `crons` block in `vercel.json`; delete that block if you don't want scheduled refreshes.

## Checks and limitations

Run `npm install`, then `npm test`. Seven automated mocked tests cover independent catalogs, concurrency, API failures, poster fallback, future digital dates, unconfirmed digital metadata and digital Discover fallback.

**Digital availability:** TMDB's release data is community-maintained and can be incomplete or region-dependent. The filter is intentionally conservative; it is not a TorBox cache/availability test. A movie may be digitally available but absent from the Top 10 until a qualifying TMDB date is present.

**Performance:** Catalog JSON is not blocked on poster rendering. The first uncached catalog request still requires TMDB digital-release and IMDb lookups; on Vercel instances without previous memory, it may take longer. CDN caching is used for subsequent requests, and there is no persistent database. These are mocked functional tests, not a live API or Nuvio production benchmark.

**Visual preview (older preview image is no longer exact; it only illustrates the premium direction):** `Nuvio_Top10_v4_rank_preview.png` uses placeholder artwork and shows the design direction; actual poster art continues coming from your Posters+ instance.
