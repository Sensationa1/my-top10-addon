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
  name: "Top 10 Trending (Netflix Style)",
  description: "Top 10 Trending Movies & TV Shows with embedded Netflix-style numbers on landscape posters.",
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

// Studio Netflix Geometry Glyphs (Base height: 150px)
const DIGIT_PATHS = {
  "1": { 
    width: 52, 
    path: "M 5,35 L 28,10 L 50,10 L 50,150 L 22,150 L 22,35 Z" 
  },
  "2": { 
    width: 86, 
    path: "M 6,38 C 6,12 22,5 48,5 C 72,5 88,15 88,38 C 88,62 68,82 42,108 L 18,128 L 88,128 L 88,150 L 6,150 L 6,126 L 46,84 C 62,68 62,54 62,38 C 62,25 54,20 48,20 C 40,20 32,25 32,38 Z" 
  },
  "3": { 
    width: 86, 
    path: "M 8,8 L 84,8 L 84,28 L 44,68 C 68,68 86,80 86,106 C 86,132 70,150 46,150 C 22,150 8,134 8,108 L 32,108 C 32,122 38,128 46,128 C 56,128 62,120 62,106 C 62,92 54,84 38,84 L 26,84 L 26,64 L 54,28 L 8,28 Z" 
  },
  "4": { 
    width: 86, 
    path: "M 52,8 L 80,8 L 80,92 L 90,92 L 90,114 L 80,114 L 80,150 L 56,150 L 56,114 L 6,114 L 6,92 Z M 56,34 L 24,92 L 56,92 Z" 
  },
  "5": { 
    width: 86, 
    path: "M 10,8 L 82,8 L 82,28 L 32,28 L 26,62 C 38,54 50,52 60,52 C 76,52 86,64 86,98 C 86,130 70,150 46,150 C 22,150 8,132 8,106 L 32,106 C 32,120 38,128 46,128 C 56,128 62,120 62,98 C 62,82 54,74 42,74 C 32,74 24,80 18,88 L 8,80 Z" 
  },
  "6": { 
    width: 86, 
    path: "M 46,8 C 20,8 8,30 8,78 C 8,126 20,150 46,150 C 72,150 86,128 86,94 C 86,64 72,52 48,52 C 34,52 22,60 16,70 C 16,34 28,30 46,30 L 68,30 L 68,8 Z M 46,72 C 60,72 62,82 62,96 C 62,114 56,128 46,128 C 36,128 30,114 30,96 C 30,82 36,72 46,72 Z" 
  },
  "7": { 
    width: 82, 
    path: "M 6,8 L 82,8 L 82,26 L 42,150 L 16,150 L 56,26 L 6,26 Z" 
  },
  "8": { 
    width: 86, 
    path: "M 46,8 C 24,8 12,20 12,40 C 12,56 24,66 36,70 C 20,74 8,86 8,108 C 8,130 22,150 46,150 C 70,150 84,130 84,108 C 84,86 72,74 56,70 C 68,66 80,56 80,40 C 80,20 68,8 46,8 Z M 46,26 C 56,26 58,32 58,40 C 58,48 52,54 46,54 C 40,54 34,48 34,40 C 34,32 36,26 46,26 Z M 46,74 C 58,74 60,82 60,108 C 60,126 54,130 46,130 C 38,130 32,126 32,108 C 32,82 34,74 46,74 Z" 
  },
  "9": { 
    width: 86, 
    path: "M 46,8 C 20,8 8,30 8,62 C 8,92 22,102 44,102 C 58,102 70,94 78,84 C 78,120 66,128 46,128 L 24,128 L 24,150 L 46,150 C 74,150 86,128 86,80 C 86,32 74,8 46,8 Z M 46,28 C 58,28 62,38 62,58 C 62,72 56,82 46,82 C 36,82 30,72 30,58 C 30,38 34,28 46,28 Z" 
  },
  "0": { 
    width: 86, 
    path: "M 46,8 C 18,8 8,28 8,78 C 8,128 18,148 46,148 C 74,148 84,128 84,78 C 84,28 74,8 46,8 Z M 46,28 C 60,28 60,44 60,78 C 60,112 60,128 46,128 C 32,128 32,112 32,78 C 32,44 32,28 46,28 Z" 
  }
};

function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  let shadowPaths = "";
  let mainPaths = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    
    // Drop Shadow
    shadowPaths += `<path transform="translate(${xOffset + 5}, 5)" d="${digitData.path}" fill="#000000" opacity="0.85"/>`;
    
    // Crisp White Border + Dark Inner Fill in a single SVG render pass
    mainPaths += `<path transform="translate(${xOffset}, 0)" d="${digitData.path}" fill="#141414" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="miter" paint-order="stroke fill"/>`;
    
    xOffset += digitData.width - 4;
  });

  return `<g>${shadowPaths}${mainPaths}</g>`;
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
        <p>Landscape posters with embedded Netflix-style numbers & genre tags.</p>
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

      // v=13 forces NuVio & Stremio iOS to purge old image caches completely
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=13`;

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

    // 1. Primary Backdrop Source
    if (cleanImdbId) {
      try {
        const extUrl = `https://extendedratings.com/backdrop/${cleanImdbId}?config=russel&key=Kolkko11&v=fd3ce853`;
        const response = await axios.get(extUrl, { responseType: "arraybuffer", timeout: 4500 });
        backdropBuffer = Buffer.from(response.data);
      } catch (e) {}
    }

    // 2. TMDB Fallback
    if (!backdropBuffer && cleanImdbId) {
      const tmdbInfo = await getTmdbData(cleanImdbId, type);
      if (tmdbInfo.backdropUrl) {
        try {
          const tmdbRes = await axios.get(tmdbInfo.backdropUrl, { responseType: "arraybuffer", timeout: 4500 });
          backdropBuffer = Buffer.from(tmdbRes.data);
        } catch (e) {}
      }
    }

    // 3. Neutral Fallback Canvas
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

    // Scaling calculations (Digit Height = 70% of poster height)
    const desiredHeight = Math.round(height * 0.70); 
    const scale = (desiredHeight / 150).toFixed(3);
    const xPos = Math.round(width * 0.025);
    const yPos = Math.round(height * 0.18);

    const pillWidth = Math.max(110, formattedGenres.length * 12 + 32);
    const pillXPos = width - pillWidth - Math.round(width * 0.04);
    const pillYPos = Math.round(height * 0.05);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="netflixGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.85" />
            <stop offset="40%" stop-color="#000000" stop-opacity="0.45" />
            <stop offset="75%" stop-color="#000000" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Left-Side Gradient Vignette -->
        <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#netflixGradient)" />

        <!-- Rendered Vector Digits -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})">
          ${digitPathsSvg}
        </g>

        <!-- Top-Right Genre Badge -->
        ${
          formattedGenres
            ? `
        <g transform="translate(${pillXPos}, ${pillYPos})">
          <rect 
            rx="${Math.round(height * 0.018)}" 
            ry="${Math.round(height * 0.018)}" 
            width="${pillWidth}" 
            height="${Math.round(height * 0.058)}" 
            fill="rgba(0, 0, 0, 0.75)" 
            stroke="rgba(255, 255, 255, 0.3)" 
            stroke-width="1.2"
          />
          <text 
            x="${Math.round(pillWidth / 2)}" 
            y="${Math.round(height * 0.040)}" 
            font-family="system-ui, -apple-system, sans-serif" 
            font-size="${Math.round(height * 0.026)}" 
            font-weight="700" 
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
