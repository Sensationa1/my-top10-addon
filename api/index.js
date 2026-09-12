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

// High-Impact Netflix Condensed Typography Vectors (Height: 100)
const DIGIT_PATHS = {
  "1": { 
    width: 32, 
    path: '<path d="M 4 22 L 20 6 L 28 6 L 28 94 L 12 94 L 12 26 L 4 26 Z"/>' 
  },
  "2": { 
    width: 56, 
    path: '<path d="M 4 24 C 4 10, 16 4, 32 4 C 46 4, 52 12, 52 24 C 52 36, 42 46, 28 60 L 14 74 L 54 74 L 54 94 L 4 94 L 4 78 L 28 50 C 38 40, 38 34, 38 24 C 38 18, 34 16, 28 16 C 20 16, 18 20, 18 28 Z"/>' 
  },
  "3": { 
    width: 56, 
    path: '<path d="M 6 8 L 52 8 L 52 22 L 30 44 C 42 44, 52 52, 52 68 C 52 82, 40 96, 26 96 C 12 96, 4 86, 4 72 L 18 72 C 18 80, 22 84, 28 84 C 34 84, 38 78, 38 68 C 38 58, 32 52, 22 52 L 16 52 L 16 38 L 34 20 L 6 20 Z"/>' 
  },
  "4": { 
    width: 56, 
    path: '<path d="M 36 6 L 36 64 L 52 64 L 52 78 L 36 78 L 36 94 L 22 94 L 22 78 L 4 78 L 4 64 L 22 6 Z M 22 24 L 12 64 L 22 64 Z"/>' 
  },
  "5": { 
    width: 56, 
    path: '<path d="M 8 8 L 50 8 L 50 22 L 22 22 L 18 42 C 24 38, 30 36, 38 36 C 48 36, 54 44, 54 64 C 54 82, 44 94, 28 94 C 14 94, 6 84, 6 68 L 20 68 C 20 78, 24 82, 28 82 C 34 82, 38 76, 38 64 C 38 52, 32 48, 26 48 C 18 48, 14 52, 10 56 Z"/>' 
  },
  "6": { 
    width: 56, 
    path: '<path d="M 32 4 C 46 4, 52 16, 52 26 L 38 26 C 38 18, 34 16, 28 16 C 18 16, 18 30, 16 44 C 22 38, 28 36, 36 36 C 48 36, 54 46, 54 66 C 54 84, 44 96, 28 96 C 12 96, 4 80, 4 46 C 4 18, 16 4, 32 4 Z M 28 48 C 20 48, 18 56, 18 66 C 18 76, 22 84, 28 84 C 34 84, 38 76, 38 66 C 38 56, 34 48, 28 48 Z"/>' 
  },
  "7": { 
    width: 52, 
    path: '<path d="M 4 8 L 50 8 L 50 20 L 22 94 L 8 94 L 34 20 L 4 20 Z"/>' 
  },
  "8": { 
    width: 56, 
    path: '<path d="M 28 4 C 42 4, 52 12, 52 26 C 52 36, 44 44, 36 46 C 46 48, 54 58, 54 72 C 54 86, 44 96, 28 96 C 12 96, 2 86, 2 72 C 2 58, 10 48, 20 46 C 12 44, 4 36, 4 26 C 4 12, 14 4, 28 4 Z M 28 16 C 20 16, 18 20, 18 26 C 18 32, 22 36, 28 36 C 34 36, 38 32, 38 26 C 38 20, 36 16, 28 16 Z M 28 48 C 20 48, 16 54, 16 72 C 16 80, 20 84, 28 84 C 36 84, 40 80, 40 72 C 40 54, 36 48, 28 48 Z"/>' 
  },
  "9": { 
    width: 56, 
    path: '<path d="M 28 4 C 44 4, 54 18, 54 50 C 54 78, 42 96, 26 96 C 14 96, 6 84, 6 72 L 20 72 C 20 80, 22 84, 28 84 C 38 84, 38 70, 40 52 C 34 58, 28 60, 20 60 C 8 60, 2 48, 2 30 C 2 12, 14 4, 28 4 Z M 28 16 C 22 16, 16 22, 16 32 C 16 42, 20 48, 28 48 C 34 48, 38 42, 38 32 C 38 22, 34 16, 28 16 Z"/>' 
  },
  "0": { 
    width: 56, 
    path: '<path d="M 28 4 C 44 4, 54 18, 54 50 C 54 82, 44 96, 28 96 C 12 96, 2 82, 2 50 C 2 18, 12 4, 28 4 Z M 28 16 C 18 16, 16 28, 16 50 C 16 72, 18 84, 28 84 C 38 84, 40 72, 40 50 C 40 28, 38 16, 28 16 Z"/>' 
  }
};

function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  let paths = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    paths += `<g transform="translate(${xOffset}, 0)">${digitData.path}</g>`;
    xOffset += digitData.width - 4; // Tight kerning for Netflix bold numbers
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

      // v=8 forces Vercel CDN & Stremio to immediately refresh cached images
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=8`;

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

    // Netflix Size Proportions: ~72% total poster height, left-aligned
    const desiredHeight = Math.round(height * 0.72); 
    const scale = (desiredHeight / 100).toFixed(3);
    const xPos = Math.round(width * 0.025);
    const yPos = Math.round(height * 0.22);

    const pillWidth = Math.max(110, formattedGenres.length * 12 + 32);
    const pillXPos = width - pillWidth - Math.round(width * 0.04);
    const pillYPos = Math.round(height * 0.05);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- Left side shadow gradient for dramatic contrast -->
          <linearGradient id="netflixGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.85" />
            <stop offset="35%" stop-color="#000000" stop-opacity="0.50" />
            <stop offset="70%" stop-color="#000000" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Subtle Left-Side Vignette for Rank Contrast -->
        <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#netflixGradient)" />

        <!-- 1. Deep Netflix Outer Shadow (Drop Shadow Layer) -->
        <g transform="translate(${xPos + 8}, ${yPos + 8}) scale(${scale})" 
           fill="#000000" 
           stroke="#000000" 
           stroke-width="6" 
           stroke-linejoin="round">
          ${digitPathsSvg}
        </g>

        <!-- 2. Netflix Outer White Border Outline -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})" 
           fill="#141414" 
           stroke="#FFFFFF" 
           stroke-width="4.5" 
           stroke-linejoin="round">
          ${digitPathsSvg}
        </g>

        <!-- 3. Clean Inner Core Fill -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})" fill="#181818">
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
