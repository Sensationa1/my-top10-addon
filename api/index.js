const TMDB_KEY    = process.env.TMDB_API_KEY;
const MDBLIST_KEY = process.env.MDBLIST_API_KEY;

// Trakt trending lists mirrored on MDBList, auto-updated daily
const SOURCES = {
  "movie/top10-movies":  { listId: "87667", stremioType: "movie"  },
  "series/top10-series": { listId: "88434", stremioType: "series" },
};

const MANIFEST = {
  id: "community.nuvio.top10.ranked",
  version: "2.0.0",
  name: "Top 10 Trending",
  description: "Top 10 trending movies & series from Trakt with ranked landscape posters.",
  logo: "https://i.imgur.com/lphiQ9I.png",
  resources: ["catalog"],
  types: ["movie", "series"],
  // Use tt IMDB IDs — Cinemeta resolves these so items are clickable
  idPrefixes: ["tt"],
  catalogs: [
    { id: "top10-movies",  type: "movie",  name: "🔥 Top 10 Movies"  },
    { id: "top10-series",  type: "series", name: "🔥 Top 10 Series"  },
  ],
  behaviorHints: { adult: false, p2pNotSupported: true },
};

// ── SVG ranked poster ─────────────────────────────────────────────────────────
function buildPosterSVG(backdropUrl, rank) {
  const n        = Number(rank) || 1;
  const isDouble = n >= 10;
  const fontSize = isDouble ? 108 : 130;
  const xPos     = isDouble ? 3 : 7;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 320 180" width="320" height="180">
  <defs>
    <linearGradient id="gh" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#000" stop-opacity="0.75"/>
      <stop offset="42%"  stop-color="#000" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%"  stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
    </linearGradient>
  </defs>
  ${backdropUrl
    ? `<image href="${backdropUrl}" width="320" height="180" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="320" height="180" fill="#111118"/>`
  }
  <rect width="320" height="180" fill="url(#gh)"/>
  <rect width="320" height="180" fill="url(#gv)"/>
  <text
    x="${xPos}" y="170"
    font-family="'Arial Black','Arial',sans-serif"
    font-weight="900"
    font-size="${fontSize}"
    letter-spacing="${isDouble ? -7 : -5}"
    fill="#0a0a12"
    stroke="rgba(255,255,255,0.95)"
    stroke-width="2.8"
    paint-order="stroke fill"
  >${n}</text>
</svg>`;
}

// ── Fetch MDBList items ───────────────────────────────────────────────────────
async function fetchList(listId) {
  const url = `https://api.mdblist.com/lists/${listId}/items?apikey=${MDBLIST_KEY}&limit=10`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`MDBList ${r.status}: ${await r.text()}`);
  const data = await r.json();
  // MDBList returns { items: [...] } or { movies: [...] } or { shows: [...] }
  return (data.items || data.movies || data.shows || []).slice(0, 10);
}

// ── Fetch TMDB backdrop by IMDB ID ────────────────────────────────────────────
async function fetchBackdrop(imdbId, stremioType) {
  if (!TMDB_KEY || !imdbId) return null;
  try {
    // find_by_external_id lets us look up by imdb_id → works for both movies & shows
    const r = await fetch(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
    );
    if (!r.ok) return null;
    const d = await r.json();
    const results = stremioType === "movie"
      ? (d.movie_results || [])
      : (d.tv_results   || []);
    const item = results[0];
    return item?.backdrop_path
      ? {
          w780:  `https://image.tmdb.org/t/p/w780${item.backdrop_path}`,
          w1280: `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`,
        }
      : null;
  } catch { return null; }
}

// ── Build meta ────────────────────────────────────────────────────────────────
async function buildMeta(item, rank, stremioType, host) {
  // MDBList items have imdbid (string like "tt1234567") or imdb_id
  const imdbId = item.imdbid || item.imdb_id || null;
  const title  = item.title || item.name || "";

  const imgs = await fetchBackdrop(imdbId, stremioType);

  const params = new URLSearchParams({ rank: String(rank) });
  if (imgs?.w780) params.set("back", imgs.w780);
  const poster = `https://${host}/poster?${params}`;

  return {
    id:          imdbId || `mdb:${item.id}`,
    type:        stremioType,
    name:        title,
    poster,
    posterShape: "landscape",
    background:  imgs?.w1280 || undefined,
    description: item.description || item.overview || "",
    releaseInfo: item.year ? String(item.year) : undefined,
    imdbRating:  item.imdbrating
      ? String(Number(item.imdbrating).toFixed(1))
      : undefined,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const host = req.headers.host;
  const path = req.url.split("?")[0].replace(/^\/api/, "");

  // /manifest.json
  if (path === "/manifest.json" || path === "/" || path === "") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(MANIFEST);
  }

  // /poster?rank=1&back=https://...
  if (path === "/poster") {
    const { rank = "1", back = "" } = req.query;
    const svg = buildPosterSVG(back || null, rank);
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).send(svg);
  }

  // /catalog/:type/:id.json
  const match = path.match(/^\/catalog\/([^/]+)\/([^/]+?)(?:\.json)?$/);
  if (match) {
    const key = `${match[1]}/${match[2]}`;
    const src = SOURCES[key];

    if (!src) {
      res.setHeader("Content-Type", "application/json");
      return res.status(404).json({ metas: [] });
    }
    if (!MDBLIST_KEY) {
      res.setHeader("Content-Type", "application/json");
      return res.status(500).json({ error: "MDBLIST_API_KEY not set", metas: [] });
    }

    try {
      const items = await fetchList(src.listId);
      const metas = await Promise.all(
        items.map((item, i) => buildMeta(item, i + 1, src.stremioType, host))
      );
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({ metas });
    } catch (err) {
      console.error(err);
      res.setHeader("Content-Type", "application/json");
      return res.status(502).json({ error: err.message, metas: [] });
    }
  }

  res.setHeader("Content-Type", "application/json");
  return res.status(404).json({ error: "not found" });
}
