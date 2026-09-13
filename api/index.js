const TMDB_KEY    = process.env.TMDB_API_KEY;
const MDBLIST_KEY = process.env.MDBLIST_API_KEY;

const SOURCES = {
  "movie/top10-movies":  { listId: "87667", stremioType: "movie"  },
  "series/top10-series": { listId: "88434", stremioType: "series" },
};

const MANIFEST = {
  id: "community.nuvio.top10.ranked",
  version: "5.0.0",
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

// ── Netflix-style ranked poster SVG ──────────────────────────────────────────
// 600x338 (16:9), number sits bottom-left, slightly cropped at bottom,
// dark fill + thick white stroke = the exact Netflix outlined number look
function buildPosterSVG(backdropUrl, rank) {
  const n        = Number(rank) || 1;
  const double   = n >= 10;

  // Scale up canvas so number looks crisp when Nuvio resizes down
  const W = 600, H = 338;

  // Number sizing & position
  const fontSize    = double ? 280 : 320;
  const strokeWidth = double ? 18  : 20;
  const xPos        = double ? 0   : 10;
  // Sits 90% of the way down — crops ~10% off bottom for drama
  const yPos        = H * 0.97;
  const letterSpacing = double ? -18 : -12;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <!-- Left-side gradient so number is always readable -->
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#000" stop-opacity="0.85"/>
      <stop offset="40%"  stop-color="#000" stop-opacity="0.3"/>
      <stop offset="70%"  stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <!-- Bottom vignette -->
    <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="50%"  stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.7"/>
    </linearGradient>
  </defs>

  <!-- Backdrop -->
  ${backdropUrl
    ? `<image href="${backdropUrl}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="#111118"/>`
  }

  <!-- Overlays -->
  <rect width="${W}" height="${H}" fill="url(#gl)"/>
  <rect width="${W}" height="${H}" fill="url(#gb)"/>

  <!-- Rank number: dark fill + white stroke = Netflix outlined style -->
  <text
    x="${xPos}"
    y="${yPos}"
    font-family="'Arial Black','Impact','Franklin Gothic Heavy','Arial',sans-serif"
    font-weight="900"
    font-size="${fontSize}"
    letter-spacing="${letterSpacing}"
    fill="#0a0a0f"
    stroke="white"
    stroke-width="${strokeWidth}"
    stroke-linejoin="round"
    paint-order="stroke fill"
  >${n}</text>
</svg>`;
}

// ── Fetch MDBList items ───────────────────────────────────────────────────────
async function fetchList(listId) {
  const r = await fetch(
    `https://api.mdblist.com/lists/${listId}/items?apikey=${MDBLIST_KEY}&limit=10`
  );
  if (!r.ok) throw new Error(`MDBList ${r.status}`);
  const data = await r.json();
  return data.movies || data.shows || data.items || [];
}

// ── Fetch TMDB images by IMDB ID ─────────────────────────────────────────────
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

// ── Build meta ────────────────────────────────────────────────────────────────
async function buildMeta(item, rank, stremioType, host) {
  const imdbId = item.imdb_id || item.imdbid || null;
  const title  = item.title || item.name || "";
  const year   = item.release_year || item.year || null;

  const imgs = await fetchImages(imdbId, stremioType);

  // Self-hosted SVG poster with Netflix-style rank number
  const params = new URLSearchParams({ rank: String(rank) });
  if (imgs?.backdrop) params.set("back", imgs.backdrop);
  const poster = `https://${host}/poster?${params}`;

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
        items.slice(0, 10).map((item, i) => buildMeta(item, i + 1, src.stremioType, host))
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
