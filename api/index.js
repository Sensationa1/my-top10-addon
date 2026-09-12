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

// Clean Apple TV Sans-Serif Vector Digits (Grid Height: 120)
const DIGIT_PATHS = {
  "1": { width: 32, path: '<path d="M 2 24 L 28 0 L 28 120 L 0 120 L 0 96 L 8 96 L 8 24 Z" />' },
  "2": { width: 68, path: '<path d="M 4 36 C 4 12, 64 12, 64 42 C 64 64, 40 84, 4 102 L 4 120 L 68 120 L 68 96 L 28 96 L 48 78 C 64 62, 68 50, 68 40 C 68 10, 50 0, 34 0 C 16 0, 4 12, 4 36 Z" />' },
  "3": { width: 68, path: '<path d="M 6 18 L 62 18 L 62 40 L 32 60 C 52 60, 66 72, 66 92 C 66 110, 50 120, 34 120 C 16 120, 4 106, 2 88 L 22 84 C 24 94, 30 100, 36 100 C 44 100, 48 94, 48 84 C 48 72, 40 66, 28 66 L 20 66 L 20 48 L 38 34 L 6 34 Z" />' },
  "4": { width: 68, path: '<path d="M 44 0 L 0 74 L 44 74 L 44 0 Z M 44 74 L 68 74 L 68 94 L 44 94 L 44 120 L 24 120 L 24 94 L 0 94 L 0 70 L 44 0 Z" />' },
  "5": { width: 68, path: '<path d="M 8 12 L 62 12 L 62 32 L 28 32 L 24 52 C 30 48, 40 46, 48 48 C 62 52, 68 66, 68 84 C 68 106, 54 120, 34 120 C 14 120, 4 106, 2 86 L 22 82 C 24 92, 28 100, 36 100 C 44 100, 48 92, 48 82 C 48 70, 42 62, 30 62 C 24 62, 18 66, 14 70 L 8 12 Z" />' },
  "6": { width: 68, path: '<path d="M 38 0 C 14 0, 4 24, 4 60 C 4 92, 14 120, 36 120 C 56 120, 68 102, 68 78 C 68 54, 54 40, 36 40 C 26 40, 18 44, 12 52 C 14 28, 24 18, 40 18 L 62 18 L 62 0 Z M 36 58 C 44 58, 48 66, 48 78 C 48 90, 44 100, 36 100 C 28 100, 22 90, 22 78 C 22 66, 28 58, 36 58 Z" />' },
  "7": { width: 64, path: '<path d="M 4 12 L 64 12 L 64 30 L 32 120 L 10 120 L 40 30 L 4 30 Z" />' },
  "8": { width: 68, path: '<path d="M 34 0 C 16 0, 6 12, 6 28 C 6 42, 14 52, 24 56 C 12 62, 2 72, 2 90 C 2 108, 16 120, 34 120 C 56 120, 66 108, 66 90 C 66 72, 56 62, 44 56 C 54 52, 62 42, 62 28 C 62 12, 52 0, 34 0 Z M 34 18 C 42 18, 46 22, 46 28 C 46 34, 42 40, 34 40 C 26 40, 22 34, 22 28 C 22 22, 26 18, 34 18 Z M 34 72 C 42 72, 48 78, 48 90 C 48 100, 42 104, 34 104 C 26 104, 20 100, 20 90 C 20 78, 26 72, 34 72 Z" />' },
  "9": { width: 68, path: '<path d="M 32 120 C 54 120, 64 96, 64 54 C 64 24, 52 0, 32 0 C 14 0, 2 18, 2 42 C 2 66, 16 80, 34 80 C 42 80, 50 76, 54 68 C 52 92, 44 102, 30 102 L 8 102 L 8 120 Z M 34 18 C 42 18, 46 26, 46 42 C 46 56, 42 64, 34 64 C 26 64, 20 56, 20 42 C 20 26, 26 18, 34 18 Z" />' },
  "0": { width: 68, path: '<path d="M 34 0 C 12 0, 2 20, 2 60 C 2 100, 12 120, 34 120 C 56 120, 66 100, 66 60 C 66 20, 56 0, 34 0 Z M 34 20 C 44 20, 46 36, 46 60 C 46 84, 44 100, 34 100 C 24 100, 22 84, 22 60 C 22 36, 24 20, 34 20 Z" />' }
};

function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  let paths = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    paths += `<g transform="translate(${xOffset}, 0)">${digitData.path}</g>`;
    xOffset += digitData.width + 12;
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

      // v=5 forces Vercel CDN and Stremio cache to instantly purge old styles
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=5`;

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

    // Apple TV Style: Clean Top-Left Position & Proportional Scale (~14% height)
    const desiredHeight = Math.round(height * 0.14); 
    const scale = (desiredHeight / 120).toFixed(3);
    const xPos = Math.round(width * 0.04);
    const yPos = Math.round(height * 0.05);

    const pillWidth = Math.max(120, formattedGenres.length * 13 + 36);
    const pillXPos = width - pillWidth - Math.round(width * 0.04);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="topShadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.8" />
            <stop offset="50%" stop-color="#000000" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0" />
          </linearGradient>

          <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.85"/>
          </filter>

          <filter id="pillShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.75"/>
          </filter>
        </defs>

        <!-- Top Vignette for Contrast -->
        <rect width="${width}" height="${Math.round(height * 0.35)}" fill="url(#topShadow)" />

        <!-- Apple TV Top-Left Rank Number -->
        <g filter="url(#textShadow)" transform="translate(${xPos}, ${yPos}) scale(${scale})" fill="#FFFFFF">
          ${digitPathsSvg}
        </g>

        <!-- Genre Pill (Top-Right) -->
        ${
          formattedGenres
            ? `
        <g transform="translate(${pillXPos}, ${yPos})" filter="url(#pillShadow)">
          <rect 
            rx="${Math.round(height * 0.022)}" 
            ry="${Math.round(height * 0.022)}" 
            width="${pillWidth}" 
            height="${Math.round(height * 0.062)}" 
            fill="rgba(0, 0, 0, 0.78)" 
            stroke="rgba(255, 255, 255, 0.25)" 
            stroke-width="1.5"
          />
          <text 
            x="${Math.round(pillWidth / 2)}" 
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
