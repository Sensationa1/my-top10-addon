const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sharp = require("sharp");
require("dotenv").config();

const app = express();
app.use(cors());

const SNOAK_MOVIES_URL = "https://mdblist.com/lists/snoak/trending-movies/json";
const SNOAK_SHOWS_URL = "https://mdblist.com/lists/snoak/trakt-s-trending-shows/json";
const SNOAK_SHOWS_ALT_URL = "https://mdblist.com/lists/snoak/most-popular-shows-on-rotten-tomatoes/json";

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "1.0.0",
  name: "Top 10 Trending (Netflix Style)",
  description: "Top 10 Trending Movies & TV Shows with embedded Netflix-style numbers on landscape posters.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { id: "top10_trending_movies", type: "movie",  name: "Top 10 Trending Movies",  extraSupported: [], posterShape: "landscape" },
    { id: "top10_trending_shows",  type: "series", name: "Top 10 Trending Shows",   extraSupported: [], posterShape: "landscape" },
  ],
  idPrefixes: ["tt"],
};

// ─────────────────────────────────────────────────────────────────────────────
// NETFLIX-STYLE GLYPHS
// ViewBox height: 300. Each glyph is ultra-condensed, heavy weight.
// The key visual: dark fill + thick white stroke = outlined number on any bg.
// ─────────────────────────────────────────────────────────────────────────────
const GLYPHS = {
  "1": {
    width: 80,
    path: "M 18 72 L 52 10 L 75 10 L 75 290 L 28 290 L 28 238 L 52 238 L 52 58 L 18 72 Z",
  },
  "2": {
    width: 148,
    path: "M 12 68 C 12 22 48 8 90 8 C 138 8 165 35 165 78 C 165 118 132 158 82 208 L 28 260 L 168 260 L 168 290 L 12 290 L 12 252 L 76 186 C 118 138 122 112 122 78 C 122 46 108 38 90 38 C 66 38 52 52 52 68 Z",
  },
  "3": {
    width: 148,
    path: "M 18 10 L 162 10 L 162 52 L 82 128 C 122 130 165 152 165 202 C 165 252 128 292 82 292 C 32 292 12 256 12 208 L 56 208 C 56 234 66 258 82 258 C 102 258 120 240 120 202 C 120 166 102 148 72 148 L 48 148 L 48 112 L 108 52 L 18 52 Z",
  },
  "4": {
    width: 155,
    path: "M 98 10 L 140 10 L 140 192 L 170 192 L 170 232 L 140 232 L 140 290 L 95 290 L 95 232 L 10 232 L 10 188 Z M 95 62 L 38 192 L 95 192 Z",
  },
  "5": {
    width: 148,
    path: "M 22 10 L 162 10 L 162 52 L 62 52 L 56 108 C 76 94 102 88 125 88 C 155 88 172 112 172 162 C 172 234 140 292 82 292 C 30 292 12 252 12 200 L 56 200 C 56 232 68 252 82 252 C 104 252 126 222 126 162 C 126 126 110 118 84 118 C 62 118 46 130 38 144 L 18 132 Z",
  },
  "6": {
    width: 148,
    path: "M 88 10 C 38 10 12 58 12 152 C 12 248 38 292 88 292 C 140 292 165 252 165 186 C 165 124 134 98 88 98 C 62 98 42 112 32 130 C 32 68 52 52 88 52 L 142 52 L 142 10 Z M 88 136 C 112 136 122 156 122 186 C 122 222 110 252 88 252 C 66 252 58 222 58 186 C 58 156 64 136 88 136 Z",
  },
  "7": {
    width: 142,
    path: "M 12 10 L 162 10 L 162 50 L 78 290 L 30 290 L 112 52 L 12 52 Z",
  },
  "8": {
    width: 148,
    path: "M 84 10 C 42 10 18 36 18 78 C 18 112 38 134 64 144 C 36 154 12 180 12 222 C 12 268 38 292 84 292 C 130 292 156 268 156 222 C 156 180 132 154 104 144 C 130 134 150 112 150 78 C 150 36 126 10 84 10 Z M 84 48 C 100 48 108 60 108 78 C 108 98 98 112 84 112 C 70 112 60 98 60 78 C 60 60 68 48 84 48 Z M 84 146 C 102 146 114 162 114 222 C 114 252 102 256 84 256 C 66 256 56 252 56 222 C 56 162 66 146 84 146 Z",
  },
  "9": {
    width: 148,
    path: "M 84 10 C 32 10 12 52 12 118 C 12 184 38 208 84 208 C 110 208 132 194 142 176 C 142 238 122 254 84 254 L 38 254 L 38 292 L 84 292 C 136 292 168 246 168 148 C 168 52 142 10 84 10 Z M 84 48 C 106 48 122 68 122 118 C 122 150 112 170 84 170 C 62 170 56 150 56 118 C 56 68 64 48 84 48 Z",
  },
  "0": {
    width: 140,
    path: "M 80 10 C 34 10 12 52 12 150 C 12 248 34 290 80 290 C 126 290 148 248 148 150 C 148 52 126 10 80 10 Z M 80 50 C 100 50 104 82 104 150 C 104 218 100 250 80 250 C 60 250 56 218 56 150 C 56 82 60 50 80 50 Z",
  },
};

function generateNetflixNumberSvg(rank) {
  const strRank = String(rank);
  let digits = [];

  if (strRank === "10") {
    // "1" and "0" overlap slightly — 0 tucks behind 1
    digits.push({ d: GLYPHS["1"].path, x: 0,  layer: 2 });
    digits.push({ d: GLYPHS["0"].path, x: 62, layer: 1 });
  } else {
    const g = GLYPHS[strRank] || GLYPHS["1"];
    digits.push({ d: g.path, x: 0, layer: 1 });
  }

  // Render back-to-front: shadow → white stroke fill → dark core
  let shadow = "", stroke = "", core = "";
  digits.sort((a, b) => a.layer - b.layer).forEach(({ d, x }) => {
    shadow += `<path d="${d}" transform="translate(${x + 10},10)" fill="#000" opacity="0.85"/>`;
    stroke += `<path d="${d}" transform="translate(${x},0)" fill="#fff" stroke="#fff" stroke-width="22" stroke-linejoin="round"/>`;
    core   += `<path d="${d}" transform="translate(${x},0)" fill="#111"/>`;
  });

  return `<g>${shadow}${stroke}${core}</g>`;
}

function getHostUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${req.headers.host}`;
}

app.get("/", (req, res) => {
  const hostUrl = getHostUrl(req);
  res.send(`
    <html>
      <head><title>Top 10 Trending Addon</title></head>
      <body style="font-family:system-ui,sans-serif;text-align:center;padding:50px;background:#0f0f12;color:#fff;">
        <h1>Top 10 Trending Addon</h1>
        <p>Landscape posters with Netflix-style numbers.</p>
        <a href="stremio://${req.headers.host}/manifest.json" style="background:#e50914;color:white;padding:14px 28px;text-decoration:none;font-size:18px;font-weight:bold;border-radius:6px;display:inline-block;margin-top:20px;">Install in Stremio</a>
        <p style="margin-top:20px;font-size:13px;color:#888;">Manifest: ${hostUrl}/manifest.json</p>
      </body>
    </html>
  `);
});

app.get("/manifest.json", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "max-age=86400, public");
  res.json(MANIFEST);
});

async function getTmdbData(imdbId, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return { backdropUrl: null };
  try {
    const r = await axios.get(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id`,
      { timeout: 4000 }
    );
    const isSeries = type === "series";
    const results = isSeries ? r.data.tv_results : r.data.movie_results;
    const match = results && results[0];
    if (match && match.backdrop_path) {
      return { backdropUrl: `https://image.tmdb.org/t/p/w1280${match.backdrop_path}` };
    }
  } catch (err) {
    console.error(`TMDB error for ${imdbId}:`, err.message);
  }
  return { backdropUrl: null };
}

async function fetchTrendingList(type) {
  let rawItems = [];
  const apiKey = process.env.TMDB_API_KEY;

  if (type === "movie") {
    try {
      const res = await axios.get(SNOAK_MOVIES_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) rawItems = res.data;
    } catch {}
    if (rawItems.length === 0 && apiKey) {
      const r = await axios.get(`https://api.themoviedb.org/3/trending/movie/day?api_key=${apiKey}`, { timeout: 5000 });
      rawItems = r.data.results || [];
    }
  } else {
    try {
      const res = await axios.get(SNOAK_SHOWS_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) rawItems = res.data;
    } catch {
      try {
        const res = await axios.get(SNOAK_SHOWS_ALT_URL, { timeout: 6000 });
        if (Array.isArray(res.data)) rawItems = res.data;
      } catch {}
    }
    if (rawItems.length === 0 && apiKey) {
      const r = await axios.get(`https://api.themoviedb.org/3/trending/tv/day?api_key=${apiKey}`, { timeout: 5000 });
      rawItems = r.data.results || [];
    }
  }

  return rawItems;
}

app.get("/catalog/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { type, id } = req.params;
  const hostUrl = getHostUrl(req);

  if (type !== "movie" && type !== "series") return res.json({ metas: [] });

  try {
    const rawItems = await fetchTrendingList(type);
    const top10 = rawItems.slice(0, 10);

    const metas = top10.map((item, index) => {
      const imdbId = item.imdb_id || item.imdbid || (item.external_ids && item.external_ids.imdb_id);
      const tmdbId = item.id || item.tmdb_id || item.tmdbid;
      const idToUse = imdbId || (tmdbId ? `tmdb:${tmdbId}` : null);
      if (!idToUse) return null;

      const title = item.title || item.name || "Unknown";
      const rank = index + 1;

      let genres = "";
      if (Array.isArray(item.genres)) genres = item.genres.slice(0, 2).join(",");
      else if (typeof item.genres === "string") genres = item.genres;

      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=31`;

      return {
        id: idToUse,
        type,
        name: `${rank}. ${title}`,
        poster: posterUrl,
        posterShape: "landscape",
        description: item.description || item.overview || "",
      };
    }).filter(Boolean);

    res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800");
    res.json({ metas });
  } catch (err) {
    console.error(`Catalog Error (${type}):`, err.message);
    res.json({ metas: [] });
  }
});

app.get("/api/poster", async (req, res) => {
  const { id, rank, type, genres } = req.query;
  if (!id) return res.status(400).send("Missing ID");

  try {
    let backdropBuffer = null;
    const cleanImdbId = id.startsWith("tt") ? id : null;

    // 1. Try xrdb backdrop
    if (cleanImdbId) {
      try {
        const r = await axios.get(
          `https://extendedratings.com/backdrop/${cleanImdbId}?config=russel&key=Kolkko11&v=fd3ce853`,
          { responseType: "arraybuffer", timeout: 4500 }
        );
        backdropBuffer = Buffer.from(r.data);
      } catch {}
    }

    // 2. Fallback to TMDB
    if (!backdropBuffer && cleanImdbId) {
      const { backdropUrl } = await getTmdbData(cleanImdbId, type);
      if (backdropUrl) {
        try {
          const r = await axios.get(backdropUrl, { responseType: "arraybuffer", timeout: 4500 });
          backdropBuffer = Buffer.from(r.data);
        } catch {}
      }
    }

    // 3. Solid dark fallback
    if (!backdropBuffer) {
      backdropBuffer = await sharp({
        create: { width: 1280, height: 720, channels: 3, background: { r: 20, g: 20, b: 28 } },
      }).jpeg().toBuffer();
    }

    const meta = await sharp(backdropBuffer).metadata();
    const W = meta.width  || 1280;
    const H = meta.height || 720;

    const formattedGenres = genres
      ? genres.split(",").slice(0, 2).join(" • ").toUpperCase()
      : "";

    const numRank = parseInt(rank, 10) || 1;
    const numberSvgGroup = generateNetflixNumberSvg(numRank);

    // Number height = 80% of card height, anchored to bottom
    const numH   = Math.round(H * 0.80);
    const scale  = (numH / 300).toFixed(4);
    const xPos   = Math.round(W * 0.018);
    const yPos   = H - numH - Math.round(H * 0.01);

    const pillW  = Math.max(110, formattedGenres.length * 12 + 32);
    const pillX  = W - pillW - Math.round(W * 0.04);
    const pillY  = Math.round(H * 0.05);

    const svgOverlay = Buffer.from(`
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stop-color="#000" stop-opacity="0.90"/>
            <stop offset="38%"  stop-color="#000" stop-opacity="0.45"/>
            <stop offset="72%"  stop-color="#000" stop-opacity="0"/>
          </linearGradient>
        </defs>

        <rect width="${Math.round(W * 0.60)}" height="${H}" fill="url(#lg)"/>

        <g transform="translate(${xPos},${yPos}) scale(${scale})">
          ${numberSvgGroup}
        </g>

        ${formattedGenres ? `
        <g transform="translate(${pillX},${pillY})">
          <rect rx="${Math.round(H * 0.018)}" ry="${Math.round(H * 0.018)}"
            width="${pillW}" height="${Math.round(H * 0.058)}"
            fill="rgba(0,0,0,0.72)" stroke="rgba(255,255,255,0.28)" stroke-width="1.2"/>
          <text x="${Math.round(pillW / 2)}" y="${Math.round(H * 0.040)}"
            font-family="system-ui,-apple-system,sans-serif"
            font-size="${Math.round(H * 0.026)}" font-weight="700"
            fill="#FFF" text-anchor="middle">${formattedGenres}</text>
        </g>` : ""}
      </svg>
    `);

    const result = await sharp(backdropBuffer)
      .composite([{ input: svgOverlay, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return res.send(result);
  } catch (err) {
    console.error("Poster error:", err.message);
    return res.status(500).send("Error rendering poster");
  }
});

module.exports = app;
