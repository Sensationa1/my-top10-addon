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

// Studio-Grade Netflix Condensed Geometry (Base ViewBox: 100x160 per digit)
const DIGIT_PATHS = {
  "1": { 
    width: 60, 
    path: '<path d="M 12 38 L 40 10 L 62 10 L 62 150 L 34 150 L 34 38 Z"/>' 
  },
  "2": { 
    width: 90, 
    path: '<path d="M 8 42 C 8 16, 22 8, 48 8 C 74 8, 88 16, 88 42 C 88 66, 68 88, 45 110 L 22 128 L 88 128 L 88 150 L 8 150 L 8 128 L 48 88 C 64 70, 64 58, 64 42 C 64 26, 56 24, 48 24 C 38 24, 32 28, 32 42 Z"/>' 
  },
  "3": { 
    width: 88, 
    path: '<path d="M 10 10 L 86 10 L 86 32 L 46 72 C 70 72, 86 84, 86 108 C 86 134, 70 150, 48 150 C 22 150, 8 134, 8 108 L 32 108 C 32 122, 38 128, 48 128 C 58 128, 62 120, 62 108 C 62 96, 54 90, 38 90 L 26 90 L 26 70 L 54 32 L 10 32 Z"/>' 
  },
  "4": { 
    width: 90, 
    path: '<path d="M 56 10 L 84 10 L 84 94 L 94 94 L 94 116 L 84 116 L 84 150 L 58 150 L 58 116 L 8 116 L 8 94 Z M 58 38 L 26 94 L 58 94 Z"/>' 
  },
  "5": { 
    width: 88, 
    path: '<path d="M 12 10 L 84 10 L 84 30 L 34 30 L 28 64 C 40 56, 52 54, 62 54 C 78 54, 88 66, 88 100 C 88 132, 72 150, 48 150 C 22 150, 8 132, 8 104 L 32 104 C 32 120, 38 128, 48 128 C 58 128, 64 120, 64 100 C 64 84, 56 76, 44 76 C 34 76, 26 82, 20 90 L 10 82 Z"/>' 
  },
  "6": { 
    width: 88, 
    path: '<path d="M 48 10 C 20 10, 8 32, 8 80 C 8 128, 20 150, 48 150 C 76 150, 88 128, 88 94 C 88 64, 74 54, 50 54 C 36 54, 24 62, 16 72 C 16 34, 28 32, 48 32 L 70 32 L 70 10 Z M 48 76 C 64 76, 64 84, 64 98 C 64 116, 58 128, 48 128 C 38 128, 32 116, 32 98 C 32 84, 38 76, 48 76 Z"/>' 
  },
  "7": { 
    width: 84, 
    path: '<path d="M 8 10 L 86 10 L 86 28 L 44 150 L 18 150 L 58 28 L 8 28 Z"/>' 
  },
  "8": { 
    width: 88, 
    path: '<path d="M 48 10 C 26 10, 12 22, 12 42 C 12 58, 24 68, 36 72 C 20 76, 8 88, 8 110 C 8 132, 22 150, 48 150 C 74 150, 88 132, 88 110 C 88 88, 76 76, 60 72 C 72 68, 84 58, 84 42 C 84 22, 70 10, 48 10 Z M 48 30 C 60 30, 62 36, 62 44 C 62 52, 56 58, 48 58 C 40 58, 34 52, 34 44 C 34 36, 36 30, 48 30 Z M 48 78 C 62 78, 64 86, 64 110 C 64 128, 58 130, 48 130 C 38 130, 32 128, 32 110 C 32 86, 34 78, 48 78 Z"/>' 
  },
  "9": { 
    width: 88, 
    path: '<path d="M 48 10 C 20 10, 8 32, 8 64 C 8 94, 22 104, 46 104 C 60 104, 72 96, 80 86 C 80 122, 68 128, 48 128 L 26 128 L 26 150 L 48 150 C 76 150, 88 128, 88 80 C 88 32, 76 10, 48 10 Z M 48 32 C 60 32, 64 42, 64 60 C 64 74, 58 84, 48 84 C 38 84, 32 74, 32 60 C 32 42, 36 32, 48 32 Z"/>' 
  },
  "0": { 
    width: 88, 
    path: '<path d="M 48 10 C 18 10, 8 30, 8 80 C 8 130, 18 150, 48 150 C 78 150, 88 130, 88 80 C 88 30, 78 10, 48 10 Z M 48 32 C 64 32, 64 48, 64 80 C 64 112, 64 128, 48 128 C 32 128, 32 112, 32 80 C 32 48, 32 32, 48 32 Z"/>' 
  }
};

function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  let paths = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    paths += `<g transform="translate(${xOffset}, 0)">${digitData.path}</g>`;
    xOffset += digitData.width - 6; // Tight Netflix kerning
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

      // v=12 forces NuVio & Stremio iOS to purge stale image caches completely
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=12`;

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

    // Scale calculation: 160px base height scaled to 70% of poster height
    const desiredHeight = Math.round(height * 0.70); 
    const scale = (desiredHeight / 160).toFixed(3);
    const xPos = Math.round(width * 0.025);
    const yPos = Math.round(height * 0.20);

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

        <!-- Left-Side Gradient Vignette for Rank Contrast -->
        <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#netflixGradient)" />

        <!-- Layer 1: Solid Drop Shadow -->
        <g transform="translate(${xPos + 8}, ${yPos + 8}) scale(${scale})" fill="#000000" opacity="0.85">
          ${digitPathsSvg}
        </g>

        <!-- Layer 2: Razor-Sharp White Border Stroke -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})" 
           fill="none" 
           stroke="#FFFFFF" 
           stroke-width="7" 
           stroke-linejoin="round" 
           stroke-linecap="round">
          ${digitPathsSvg}
        </g>

        <!-- Layer 3: Dark Inner Core Fill -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})" fill="#141414">
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
