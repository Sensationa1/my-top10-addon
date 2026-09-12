const TMDB_KEY    = process.env.TMDB_API_KEY;
const MDBLIST_KEY = process.env.MDBLIST_API_KEY;

const SOURCES = {
  "movie/top10-movies":  { listId: "87667", stremioType: "movie"  },
  "series/top10-series": { listId: "88434", stremioType: "series" },
};

const MANIFEST = {
  id: "community.nuvio.top10.ranked",
  version: "4.0.0",
  name: "Top 10 Trending",
  description: "Top 10 trending movies & series from Trakt with ranked landscape posters.",
  logo: "https://i.imgur.com/lphiQ9I.png",
  resources: ["catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [
    { id: "top10-movies",  type: "movie",  name: "🔥 Top 10 Movies"  },
    { id: "top10-series",  type: "series", name: "🔥 Top 10 Series"  },
  ],
  behaviorHints: { adult: false, p2pNotSupported: true },
};

// ── Fetch MDBList items ───────────────────────────────────────────────────────
// MDBList returns { movies: [...] } for movie lists and { shows: [...] } for show lists
// Each item has imdb_id (not imdbid), title, release_year
async function fetchList(listId) {
  const r = await fetch(
    `https://api.mdblist.com/lists/${listId}/items?apikey=${MDBLIST_KEY}&limit=10`
  );
  if (!r.ok) throw new Error(`MDBList ${r.status}`);
  const data = await r.json();
  return data.movies || data.shows || data.items || [];
}

// ── Fetch TMDB images by IMDB ID ──────────────────────────────────────────────
async function fetchImages(imdbId, stremioType) {
  if (!TMDB_KEY || !imdbId) return null;
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
    );
    if (!r.ok) return null;
    const d = await r.json();
    const item = stremioType === "movie"
      ? (d.movie_results || [])[0]
      : (d.tv_results   || [])[0];
    if (!item) return null;
    return {
      backdrop:   item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}`  : null,
      background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
      poster:     item.poster_path   ? `https://image.tmdb.org/t/p/w342${item.poster_path}`    : null,
    };
  } catch { return null; }
}

// ── Ranked poster via imagekit free CDN overlay ───────────────────────────────
// We use wsrv.nl (a free image proxy/processor) to add the rank number
// directly onto the TMDB backdrop. This returns a real image URL Nuvio can load.
function rankedPosterUrl(backdropUrl, rank) {
  if (!backdropUrl) return null;
  // wsrv.nl supports text overlay via &wtl= parameter
  // Font size 120, white text, bottom-left position, bold
  const n = String(rank);
  const encoded = encodeURIComponent(backdropUrl);
  return `https://wsrv.nl/?url=${encoded}&w=780&h=439&fit=cover&wtl=${n}&wts=120&wtc=ffffff&wtb=1&wtp=0&wta=0&wtx=10&wty=-10&output=jpg`;
}

// ── Build meta ────────────────────────────────────────────────────────────────
async function buildMeta(item, rank, stremioType) {
  // MDBList field is imdb_id for shows, imdbid for movies — handle both
  const imdbId = item.imdb_id || item.imdbid || null;
  const title  = item.title || item.name || "";
  const year   = item.release_year || item.year || null;

  const imgs = await fetchImages(imdbId, stremioType);

  // Try wsrv.nl ranked poster first, fall back to plain backdrop, then portrait
  const poster = rankedPosterUrl(imgs?.backdrop, rank)
    || imgs?.backdrop
    || imgs?.poster
    || undefined;

  return {
    id:          imdbId || `mdb:${item.id}`,
    type:        stremioType,
    name:        title,
    poster,
    posterShape: "landscape",
    background:  imgs?.background || undefined,
    description: item.description || item.overview || "",
    releaseInfo: year ? String(year) : undefined,
    imdbRating:  item.imdbrating ? String(Number(item.imdbrating).toFixed(1)) : undefined,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const path = req.url.split("?")[0].replace(/^\/api/, "");

  if (path === "/manifest.json" || path === "/" || path === "") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(MANIFEST);
  }

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
        items.slice(0, 10).map((item, i) => buildMeta(item, i + 1, src.stremioType))
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
