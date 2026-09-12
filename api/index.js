const TMDB_KEY    = process.env.TMDB_API_KEY;
const MDBLIST_KEY = process.env.MDBLIST_API_KEY;

const SOURCES = {
  "movie/top10-movies":  { listId: "87667", stremioType: "movie"  },
  "series/top10-series": { listId: "88434", stremioType: "series" },
};

const MANIFEST = {
  id: "community.nuvio.top10.ranked",
  version: "3.0.0",
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
async function fetchList(listId) {
  const url = `https://api.mdblist.com/lists/${listId}/items?apikey=${MDBLIST_KEY}&limit=10`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`MDBList ${r.status}: ${await r.text()}`);
  const data = await r.json();
  // Log raw keys to help debug TV shows
  console.log("MDBList keys:", Object.keys(data));
  const items = data.items || data.movies || data.shows || [];
  console.log(`MDBList returned ${items.length} items for list ${listId}`);
  if (items[0]) console.log("Sample item keys:", Object.keys(items[0]));
  return items.slice(0, 10);
}

// ── Fetch TMDB backdrop via imdb_id ──────────────────────────────────────────
async function fetchImages(imdbId, stremioType) {
  if (!TMDB_KEY || !imdbId) return null;
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
    );
    if (!r.ok) return null;
    const d = await r.json();
    const results = stremioType === "movie"
      ? (d.movie_results || [])
      : (d.tv_results || []);
    const item = results[0];
    if (!item) return null;
    return {
      backdrop: item.backdrop_path
        ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}`
        : null,
      background: item.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
        : null,
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
        : null,
    };
  } catch (e) {
    console.error("TMDB fetch error:", e.message);
    return null;
  }
}

// ── Build meta ────────────────────────────────────────────────────────────────
async function buildMeta(item, rank, stremioType) {
  const imdbId = item.imdbid || item.imdb_id || null;
  const title  = item.title || item.name || "";

  console.log(`rank ${rank}: imdbId=${imdbId} title=${title}`);

  const imgs = await fetchImages(imdbId, stremioType);

  // Poster: use TMDB backdrop directly — Nuvio renders these fine in landscape mode
  // We use wsrv.nl to overlay the rank number onto the image as text
  let poster = null;
  if (imgs?.backdrop) {
    // wsrv.nl image processing: resize to 780x439 (16:9), overlay rank number
    const encoded = encodeURIComponent(imgs.backdrop);
    poster = imgs.backdrop; // Direct TMDB backdrop — most compatible
  } else if (imgs?.poster) {
    poster = imgs.poster;
  }

  return {
    id:          imdbId || `mdb:${item.id}`,
    type:        stremioType,
    name:        title,
    poster:      poster || undefined,
    posterShape: "landscape",
    background:  imgs?.background || undefined,
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

  const path = req.url.split("?")[0].replace(/^\/api/, "");

  // /manifest.json
  if (path === "/manifest.json" || path === "/" || path === "") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(MANIFEST);
  }

  // /catalog/:type/:id.json
  const match = path.match(/^\/catalog\/([^/]+)\/([^/]+?)(?:\.json)?$/);
  if (match) {
    const key = `${match[1]}/${match[2]}`;
    const src = SOURCES[key];

    console.log(`Catalog request: key=${key} found=${!!src}`);

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
        items.map((item, i) => buildMeta(item, i + 1, src.stremioType))
      );
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({ metas });
    } catch (err) {
      console.error("Catalog error:", err);
      res.setHeader("Content-Type", "application/json");
      return res.status(502).json({ error: err.message, metas: [] });
    }
  }

  res.setHeader("Content-Type", "application/json");
  return res.status(404).json({ error: "not found" });
}
