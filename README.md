# Nuvio Top 10 — v5.12 (Posters+ / Mainstream Streaming)

This is a drop-in update of the recovered v5.11 app. The two Stremio/Nuvio catalog IDs and the Netflix/Apple-TV-style ranked card renderer are unchanged:

- `series/top10_trending_shows`
- `movie/top10_trending_movies`

## Changes

- **Posters+:** Replaces EasyRatingsDB with the exact option set from the supplied `postersplus.slokker.cc/poster` instance. Uses server-side TMDB/MDBList API keys and inserts `tmdb_id`, `imdb_id`, `stremio_id`, `type`, and `shape`. The unchanged v5.11 numbered card composition is rendered on top of Posters+ output.
- **Ranking:** Main inputs are JustWatch's **daily (56%)** and **weekly (25%)** streaming charts, accessed through MDBList, plus an MDBList **mainstream popularity list (19%)**. These are weights on normalized rank *signals*, **not** claims about viewing hours. The region is `US` by default; optionally select `FI`, `GB`, etc.
- **No TMDB Trending Today:** Only TMDB *Popular* is used as a last-resort candidate fallback if the audience feeds are insufficient or down.
- **Quality:** Require TMDB rating >= 6.0 and at least 350 votes for movies / 250 for series when a title appears on more than one chart. Single-signal titles require twice as many votes. All numbers are adjustable by environment variables.
- **TV filtering:** Reject TMDB `Miniseries` and completed one-season runs of 10 episodes or fewer (preserving the prior explicit Cyberpunk: Edgerunners exception), plus reality/soap/news/talk genres. No upcoming premieres.
- **Movie filtering:** Require confirmed release type 4 (digital) on or before today, as in v5.11.
- **Anime filtering:** Same general anime exclusion as v5.11, with Cyberpunk: Edgerunners exception.
- **Caching:** Catalog caches, CDN headers, poster in-flight deduplication, render concurrency limit and TMDB poster fallback retained.

## Deployment

1. Unzip into your existing add-on repo, replacing `api/index.js`, `package.json`, `vercel.json`, `tests/` and README. **Keep any existing `fonts/` directory** from your working deployment; the original recovered ZIP did not contain those font assets.
2. Keep `TMDB_API_KEY` and `MDBLIST_API_KEY` configured as private environment variables. The same keys are used server-side for Posters+. Do not commit or expose them in public Git.
3. `npm install` then deploy to your existing Vercel/Render instance. If the same deployment and manifest URL are retained, the catalog IDs will remain stable.
4. Check `/api/status`; it should report `version: 5.12.0`, `posterSource: Posters+`, and a JustWatch ranking source.
5. Check `/catalog/movie/top10_trending_movies.json` and `/catalog/series/top10_trending_shows.json`. Verify the returned IDs and images on your actual device. Fresh chart retrieval and poster responsiveness depend on upstream services and your host; **not live-verified** in this environment.

## Optional environment variables

```dotenv
JUSTWATCH_COUNTRY=US
MIN_TMDB_MOVIE_VOTES=350
MIN_TMDB_SERIES_VOTES=250
MIN_TMDB_RATING=6.0
POSTERSPLUS_SHAPE=poster
POSTERSPLUS_TIMEOUT_MS=4200
POSTER_WIDTH=720
MAX_POSTER_RENDERS=2
```

To provide a full Posters+ URL instead, set `POSTERSPLUS_POSTER_TEMPLATE` to the supplied URL with placeholders `{tmdb_id?}`, `{imdb_id?}`, `{id}`, `{type}`, and `{shape}`. The default config already matches its visual options and fills the keys from `TMDB_API_KEY` / `MDBLIST_API_KEY`, so setting this is unnecessary unless those keys or options differ.

**Never commit your actual API keys.** If the shared URL has been posted publicly, rotate both keys.

## Technical caveats

- Rankings are a **curated mainstream streaming Top 10**, not an official top-ten ranking from any one provider.
- No specific live titles or chart placements have been independently verified. To audit a particular day's candidates, query the deployment after provisioning working API keys.
- MDBList may enforce quotas or provider-chart access restrictions. When charts fail, the app falls back to TMDB Popular with strict quality gates rather than showing unvetted titles from TMDB Trending.
- Serverless cold starts or upstream poster delays can still affect initial load. Posters+ has a 4.2-second timeout and falls back to TMDB artwork.
- Strict filtering may yield fewer than 10 items on a particularly sparse day; the system favors quality over padding the list with weak candidates.

## Tests

`npm test` runs offline mocked tests for ranking, filters, poster options, credential containment, upstream fallback, and status. It does **not** test live JustWatch/MDBList/Posters+ availability or real poster layout pixels.
