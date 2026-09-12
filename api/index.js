const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sharp = require("sharp");
require("dotenv").config();

const app = express();
app.use(cors());

// Snoak MDBList & Trakt Sources
const SNOAK_MOVIES_URL = "https://mdblist.com/lists/snoak/trending-movies/json";
const SNOAK_SHOWS_URL = "https://mdblist.com/lists/snoak/trakt-s-trending-shows/json";
const SNOAK_SHOWS_ALT_URL = "https://mdblist.com/lists/snoak/most-popular-shows-on-rotten-tomatoes/json";

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "1.0.0",
  name: "Top 10 Trending (Apple TV Style)",
  description: "Top 10 Trending Movies & TV Shows with embedded Apple TV numbers on landscape posters.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      id: "top10_trending_movies",
      type: "movie",
      name: "Top 10 Trending Movies",
      extraSupported: [],
      posterShape: "landscape"
    },
    {
      id: "top10_trending_shows",
      type: "series",
      name: "Top 10 Trending Shows",
      extraSupported: [],
      posterShape: "landscape"
    }
  ],
  idPrefixes: ["tt"]
};

// High-Precision SVG Paths for Apple TV Style Digits (Grid Box: 100 x 150)
const DIGIT_PATHS = {
  "1": {
    width: 75,
    path: '<path d="M 20 30 L 55 0 L 75 0 L 75 150 L 35 150 L 35 125 L 50 125 L 50 25 L 30 40 Z" />'
  },
  "2": {
    width: 95,
    path: '<path d="M 10 40 C 10 10, 90 10, 90 45 C 90 70, 60 95, 10 125 L 10 150 L 95 150 L 95 125 L 40 125 L 70 98 C 92 75, 100 55, 100 40 C 100 12, 72 0, 48 0 C 24 0, 8 15, 8 40 Z" />'
  },
  "3": {
    width: 95,
    path: '<path d="M 12 18 L 88 18 L 88 45 L 48 70 C 76 70, 92 84, 92 110 C 92 138, 68 150, 48 150 C 22 150, 8 132, 5 110 L 28 106 C 30 118, 38 128, 48 128 C 58 128, 68 120, 68 108 C 68 94, 58 85, 42 85 L 30 85 L 30 62 L 55 42 L 12 42 Z" />'
  },
  "4": {
    width: 90,
    path: '<path d="M 60 0 L 5 95 L 60 95 L 60 0 Z M 60 95 L 90 95 L 90 118 L 60 118 L 60 150 L 36 150 L 36 118 L 0 118 L 0 90 L 60 0 Z" />'
  },
  "5": {
    width: 95,
    path: '<path d="M 12 15 L 85 15 L 85 40 L 38 40 L 34 65 C 42 60, 54 58, 65 60 C 84 65, 95 82, 95 106 C 95 135, 75 150, 48 150 C 20 150, 8 132, 5 108 L 26 104 C 28 118, 36 128, 48 128 C 58 128, 68 118, 68 104 C 68 90, 58 80, 42 80 C 34 80, 26 84, 20 88 L 12 15 Z" />'
  },
  "6": {
    width: 95,
    path: '<path d="M 52 0 C 20 0, 5 30, 5 80 C 5 120, 20 150, 50 150 C 76 150, 92 128, 92 98 C 92 68, 74 50, 48 50 C 36 50, 26 55, 19 65 C 22 35, 34 22, 54 22 L 85 22 L 85 0 Z M 48 72 C 60 72, 68 82, 68 98 C 68 114, 60 126, 48 126 C 36 126, 28 114, 28 98 C 28 82, 36 72, 48 72 Z" />'
  },
  "7": {
    width: 90,
    path: '<path d="M 8 15 L 92 15 L 92 38 L 48 150 L 20 150 L 60 40 L 8 40 Z" />'
  },
  "8": {
    width: 95,
    path: '<path d="M 48 0 C 24 0, 10 14, 10 36 C 10 52, 20 64, 34 70 C 18 78, 4 90, 4 112 C 4 135, 22 150, 48 150 C 74 150, 92 135, 92 112 C 92 90, 78 78, 62 70 C 76 64, 86 52, 86 36 C 86 14, 72 0, 48 0 Z M 48 22 C 58 22, 64 28, 64 36 C 64 44, 58 52, 48 52 C 38 52, 32 44, 32 36 C 32 28, 38 22, 48 22 Z M 48 90 C 60 90, 68 98, 68 112 C 68 126, 60 130, 48 130 C 36 130, 28 126, 28 112 C 28 98, 36 90, 48 90 Z" />'
  },
  "9": {
    width: 95,
    path: '<path d="M 44 150 C 75 150, 90 120, 90 68 C 90 30, 75 0, 45 0 C 20 0, 4 22, 4 52 C 4 82, 22 100, 48 100 C 60 100, 70 95, 76 86 C 73 116, 62 128, 42 128 L 12 128 L 12 150 Z M 48 22 C 60 22, 68 34, 68 52 C 68 70, 60 80, 48 80 C 36 80, 28 70, 28 52 C 28 34, 36 22, 48 22 Z" />'
  },
  "0": {
    width: 95,
    path: '<path d="M 48 0 C 18 0, 4 26, 4 75 C 4 124, 18 150, 48 150 C 78 150, 92 124, 92 75 C 92 26, 78 0, 48 0 Z M 48 24 C 62 24, 66 44, 66 75 C 66 106, 62 126, 48 126 C 34 126, 30 106, 30 75 C 30 44, 34 24, 48 24 Z" />'
  }
};

function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  let paths = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    paths += `<g transform="translate(${xOffset}, 0)">${digitData.path}</g>`;
    xOffset += digitData.width + 10;
  });

  return paths;
}

// Helper to get base host URL in Vercel Cloud environment
function getHostUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

// Landing Page
app.get("/", (req, res) => {
  const hostUrl = getHostUrl(req);
  res.send(`
    <html>
      <head><title>Top 10 Trending Addon</title></head>
      <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0f0f12; color: #fff;">
        <h1>Top 10 Trending Addon</h1>
        <p>Landscape posters with embedded Apple TV numbers & genre tags.</p>
        <a href="stremio://${req.headers.host}/manifest.json" style="background: #e50914; color: white; padding: 14px 28px; text-decoration: none; font-size: 18px; font-weight: bold; border-radius: 6px; display: inline-block; margin-top: 20px;">Install in Stremio</a>
        <p style="margin-top: 20px; font-size: 13px; color: #888;">Manifest URL: ${hostUrl}/manifest.json</p>
      </body>
    </html>
  `);
});

// Stremio Addon Manifest
app.get("/manifest.json", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "max-age=86400, public");
  res.json(MANIFEST);
});

// TMDB Backdrop Lookup Helper
async function getTmdbData(imdbId, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return { backdropUrl: null };

  try {
    const findRes = await axios.get(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id`,
      { timeout: 4000 }
    );
    
    const isSeries = type === "series";
    const results = isSeries ? findRes.data.tv_results : findRes.data.movie_results;
    const match = results && results[0];

    if (match) {
      const backdropUrl = match.backdrop_path ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}` : null;
      return { backdropUrl };
    }
  } catch (err) {
    console.error(`TMDB lookup error for ${imdbId}:`, err.message);
  }
  return { backdropUrl: null };
}

// Fetch Trending Items (MDBList with Trakt/TMDB Fallbacks)
async function fetchTrendingList(type) {
  let rawItems = [];
  const apiKey = process.env.TMDB_API_KEY;

  if (type === "movie") {
    try {
      const res = await axios.get(SNOAK_MOVIES_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) rawItems = res.data;
    } catch (e) {
      console.warn("MDBList movies failed, fetching TMDB trending fallback...");
    }

    if (rawItems.length === 0 && apiKey) {
      const tmdbRes = await axios.get(`https://api.themoviedb.org/3/trending/movie/day?api_key=${apiKey}`, { timeout: 5000 });
      rawItems = tmdbRes.data.results || [];
    }
  } else if (type === "series") {
    try {
      const res = await axios.get(SNOAK_SHOWS_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) rawItems = res.data;
    } catch (e) {
      try {
        const resAlt = await axios.get(SNOAK_SHOWS_ALT_URL, { timeout: 6000 });
        if (Array.isArray(resAlt.data)) rawItems = resAlt.data;
      } catch (err) {
        console.warn("MDBList TV shows failed, fetching TMDB trending fallback...");
      }
    }

    if (rawItems.length === 0 && apiKey) {
      const tmdbRes = await axios.get(`https://api.themoviedb.org/3/trending/tv/day?api_key=${apiKey}`, { timeout: 5000 });
      rawItems = tmdbRes.data.results || [];
    }
  }

  return rawItems;
}

// Catalog Handler
app.get("/catalog/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const { type, id } = req.params;
  const hostUrl = getHostUrl(req);

  if (type !== "movie" && type !== "series") {
    return res.json({ metas: [] });
  }

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
      if (Array.isArray(item.genres)) {
        genres = item.genres.slice(0, 2).join(",");
      } else if (typeof item.genres === "string") {
        genres = item.genres;
      }

      // v=4 parameter forces Vercel & Stremio to immediately purge old cached dots
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=4`;

      return {
        id: idToUse,
        type: type,
        name: `${rank}. ${title}`,
        poster: posterUrl,
        posterShape: "landscape",
        description: item.description || item.overview || ""
      };
    }).filter(Boolean);

    res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800");
    res.json({ metas });
  } catch (err) {
    console.error(`Catalog Error (${type}):`, err.message);
    res.json({ metas: [] });
  }
});

// Dynamic Image Composite Generator
app.get("/api/poster", async (req, res) => {
  const { id, rank, type, genres } = req.query;

  if (!id) {
    return res.status(400).send("Missing ID parameter");
  }

  try {
    let backdropBuffer = null;
    const cleanImdbId = id.startsWith("tt") ? id : null;

    // 1. Try Primary ExtendedRatings
    if (cleanImdbId) {
      try {
        const extUrl = `https://extendedratings.com/backdrop/${cleanImdbId}?config=russel&key=Kolkko11&v=fd3ce853`;
        const response = await axios.get(extUrl, { responseType: "arraybuffer", timeout: 4500 });
        backdropBuffer = Buffer.from(response.data);
      } catch (e) {}
    }

    // 2. Secondary Fallback: TMDB Backdrop
    if (!backdropBuffer && cleanImdbId) {
      const tmdbInfo = await getTmdbData(cleanImdbId, type);
      if (tmdbInfo.backdropUrl) {
        try {
          const tmdbRes = await axios.get(tmdbInfo.backdropUrl, { responseType: "arraybuffer", timeout: 4500 });
          backdropBuffer = Buffer.from(tmdbRes.data);
        } catch (e) {}
      }
    }

    // 3. Fallback: Dark Neutral Canvas
    if (!backdropBuffer) {
      backdropBuffer = await sharp({
        create: {
          width: 1280,
          height: 720,
          channels: 3,
          background: { r: 20, g: 20, b: 28 }
        }
      }).jpeg().toBuffer();
    }

    const metadata = await sharp(backdropBuffer).metadata();
    const width = metadata.width || 1280;
    const height = metadata.height || 720;

    const formattedGenres = genres
      ? genres.split(",").slice(0, 2).join(" • ").toUpperCase()
      : "";

    const numRank = parseInt(rank, 10) || 1;
    const digitPathsSvg = renderRankSvg(numRank);

    // Dynamic Scale for 1280x720 (Rank height ~ 450px)
    const scale = (height * 0.0031).toFixed(3);
    const xPos = Math.round(width * 0.03);
    const yPos = Math.round(height * 0.32);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bottomShadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000000" stop-opacity="0" />
            <stop offset="40%" stop-color="#000000" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.9" />
          </linearGradient>

          <linearGradient id="leftShadow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.85" />
            <stop offset="40%" stop-color="#000000" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0" />
          </linearGradient>

          <filter id="appleShadow" x="-20%" y="-20%" width="150%" height="150%">
            <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.95"/>
          </filter>

          <filter id="pillShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.75"/>
          </filter>
        </defs>

        <rect width="${width}" height="${height}" fill="url(#leftShadow)" />
        <rect width="${width}" height="${height}" fill="url(#bottomShadow)" />

        <!-- Apple TV Vector Rank Number -->
        <g filter="url(#appleShadow)" transform="translate(${xPos}, ${yPos}) scale(${scale})" fill="#FFFFFF" stroke="rgba(0,0,0,0.4)" stroke-width="2">
          ${digitPathsSvg}
        </g>

        <!-- Genre Pill -->
        ${
          formattedGenres
            ? `
        <g transform="translate(${Math.round(width * 0.03)}, ${Math.round(height * 0.05)})" filter="url(#pillShadow)">
          <rect 
            rx="${Math.round(height * 0.022)}" 
            ry="${Math.round(height * 0.022)}" 
            width="${Math.max(120, formattedGenres.length * 13 + 36)}" 
            height="${Math.round(height * 0.062)}" 
            fill="rgba(0, 0, 0, 0.78)" 
            stroke="rgba(255, 255, 255, 0.25)" 
            stroke-width="1.5"
          />
          <text 
            x="${Math.round((Math.max(120, formattedGenres.length * 13 + 36)) / 2)}" 
            y="${Math.round(height * 0.043)}" 
            font-family="DejaVu Sans, Arial, sans-serif" 
            font-size="${Math.round(height * 0.028)}" 
            font-weight="bold" 
            fill="#FFFFFF" 
            text-anchor="middle">
            ${formattedGenres}
          </text>
        </g>
        `
            : ""
        }
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
    console.error("Poster rendering error:", err.message);
    return res.status(500).send("Error rendering poster image");
  }
});

module.exports = app;
