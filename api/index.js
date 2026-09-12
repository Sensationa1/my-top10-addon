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

// Mathematically Precise Netflix Block Glyphs (Straight edges & smooth arcs)
const DIGIT_PATHS = {
  "1": { 
    width: 36, 
    path: '<path d="M 0 25 L 18 5 L 34 5 L 34 95 L 12 95 L 12 28 L 0 28 Z"/>' 
  },
  "2": { 
    width: 62, 
    path: '<path d="M 4 28 C 4 10, 16 2, 32 2 C 48 2, 60 10, 60 28 C 60 42, 48 54, 32 70 L 12 90 L 62 90 L 62 100 L 0 100 L 0 88 L 32 56 C 44 44, 46 36, 46 28 C 46 18, 40 14, 32 14 C 24 14, 18 18, 18 28 Z"/>' 
  },
  "3": { 
    width: 60, 
    path: '<path d="M 4 2 L 58 2 L 58 16 L 28 46 C 44 46, 60 54, 60 74 C 60 90, 46 100, 28 100 C 12 100, 2 90, 2 74 L 16 74 C 16 82, 20 86, 28 86 C 36 86, 44 80, 44 74 C 44 66, 36 60, 24 60 L 16 60 L 16 48 L 38 22 L 4 22 Z"/>' 
  },
  "4": { 
    width: 58, 
    path: '<path d="M 38 2 L 38 65 L 56 65 L 56 80 L 38 80 L 38 100 L 22 100 L 22 80 L 0 80 L 0 65 L 22 2 Z M 22 22 L 9 65 L 22 65 Z"/>' 
  },
  "5": { 
    width: 60, 
    path: '<path d="M 6 2 L 58 2 L 58 16 L 20 16 L 16 42 C 24 38, 32 36, 40 36 C 54 36, 60 46, 60 68 C 60 88, 48 100, 28 100 C 12 100, 4 88, 4 72 L 18 72 C 18 80, 22 86, 28 86 C 36 86, 44 80, 44 68 C 44 56, 36 50, 26 50 C 18 50, 14 54, 10 58 L 2 52 Z"/>' 
  },
  "6": { 
    width: 60, 
    path: '<path d="M 34 2 C 50 2, 58 14, 58 28 L 44 28 C 44 18, 40 16, 34 16 C 22 16, 18 28, 16 46 C 22 40, 30 38, 38 38 C 52 38, 60 48, 60 68 C 60 88, 48 100, 30 100 C 12 100, 2 84, 2 48 C 2 18, 16 2, 34 2 Z M 30 52 C 22 52, 16 60, 16 70 C 16 80, 22 86, 30 86 C 38 86, 44 80, 44 70 C 44 60, 38 52, 30 52 Z"/>' 
  },
  "7": { 
    width: 56, 
    path: '<path d="M 2 2 L 56 2 L 56 16 L 24 100 L 8 100 L 38 16 L 2 16 Z"/>' 
  },
  "8": { 
    width: 60, 
    path: '<path d="M 30 2 C 46 2, 56 12, 56 26 C 56 36, 46 44, 38 46 C 48 48, 58 58, 58 74 C 58 90, 46 100, 30 100 C 14 100, 2 90, 2 74 C 2 58, 12 48, 22 46 C 14 44, 4 36, 4 26 C 4 12, 14 2, 30 2 Z M 30 14 C 22 14, 18 18, 18 26 C 18 34, 22 36, 30 36 C 38 36, 42 34, 42 26 C 42 18, 38 14, 30 14 Z M 30 48 C 20 48, 16 56, 16 74 C 16 82, 22 88, 30 88 C 38 88, 44 82, 44 74 C 44 56, 40 48, 30 48 Z"/>' 
  },
  "9": { 
    width: 60, 
    path: '<path d="M 30 2 C 48 2, 58 14, 58 52 C 58 82, 44 100, 26 100 C 12 100, 4 88, 4 74 L 18 74 C 18 82, 22 86, 28 86 C 38 86, 42 72, 44 54 C 38 60, 30 62, 22 62 C 8 62, 2 50, 2 32 C 2 14, 14 2, 30 2 Z M 30 14 C 20 14, 16 22, 16 32 C 16 42, 20 50, 30 50 C 38 50, 44 42, 44 32 C 44 22, 38 14, 30 14 Z"/>' 
  },
  "0": { 
    width: 60, 
    path: '<path d="M 30 2 C 48 2, 58 16, 58 50 C 58 84, 48 98, 30 98 C 12 98, 2 84, 2 50 C 2 16, 12 2, 30 2 Z M 30 14 C 18 14, 16 28, 16 50 C 16 72, 18 86, 30 86 C 42 86, 44 72, 44 50 C 44 28, 42 14, 30 14 Z"/>' 
  }
};

function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  let paths = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    paths += `<g transform="translate(${xOffset}, 0)">${digitData.path}</g>`;
    xOffset += digitData.width - 2; // Precise kerning offset
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

      // v=9 forces Vercel CDN & Stremio to immediately purge old image caches
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=9`;

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

    // Scaling: ~70% total canvas height
    const desiredHeight = Math.round(height * 0.70); 
    const scale = (desiredHeight / 100).toFixed(3);
    const xPos = Math.round(width * 0.03);
    const yPos = Math.round(height * 0.22);

    const pillWidth = Math.max(110, formattedGenres.length * 12 + 32);
    const pillXPos = width - pillWidth - Math.round(width * 0.04);
    const pillYPos = Math.round(height * 0.05);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- Left-Side Contrast Gradient -->
          <linearGradient id="netflixGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.80" />
            <stop offset="40%" stop-color="#000000" stop-opacity="0.40" />
            <stop offset="75%" stop-color="#000000" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Subtle Left-Side Vignette for Rank Contrast -->
        <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#netflixGradient)" />

        <!-- 1. Deep Solid Drop Shadow -->
        <g transform="translate(${xPos + 6}, ${yPos + 6}) scale(${scale})" 
           fill="#000000">
          ${digitPathsSvg}
        </g>

        <!-- 2. Crisp Razor-Sharp White Outline & Dark Core Fill -->
        <!-- paint-order="stroke fill" forces stroke UNDER fill so edge is sharp -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})" 
           fill="#141414" 
           stroke="#FFFFFF" 
           stroke-width="3" 
           stroke-linejoin="miter" 
           stroke-miterlimit="4"
           paint-order="stroke fill">
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
