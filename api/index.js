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

// Authentic Apple SF Pro Display Vector Glyphs (Height Box: 100)
const DIGIT_PATHS = {
  "1": { 
    width: 44, 
    path: '<path d="M 12.5 23.6 C 18.2 19.2, 24.3 13.8, 28.5 8.2 L 41.2 8.2 L 41.2 91.8 L 26.2 91.8 L 26.2 25.8 L 12.5 35.2 Z"/>' 
  },
  "2": { 
    width: 82, 
    path: '<path d="M 6.2 28.8 C 6.2 12.2, 21.2 2.2, 41.5 2.2 C 61.8 2.2, 76.2 12.5, 76.2 27.8 C 76.2 39.2, 68.8 48.8, 52.8 63.2 L 23.5 89.5 L 78.2 89.5 L 78.2 100 L 6.2 100 L 6.2 90.2 L 43.2 56.8 C 58.2 43.2, 61.8 36.5, 61.8 27.8 C 61.8 18.2, 52.5 12.2, 41.2 12.2 C 29.8 12.2, 20.8 18.5, 20.8 28.8 Z"/>' 
  },
  "3": { 
    width: 80, 
    path: '<path d="M 7.2 12.2 L 74.2 12.2 L 74.2 22.8 L 41.8 48.2 C 59.8 49.2, 75.2 60.2, 75.2 76.5 C 75.2 91.8, 61.2 102.2, 41.2 102.2 C 20.2 102.2, 6.8 90.2, 5.2 74.8 L 19.2 72.8 C 20.8 82.8, 29.5 90.8, 41.2 90.8 C 52.2 90.8, 60.2 83.8, 60.2 74.2 C 60.2 64.2, 51.8 57.2, 38.8 57.2 L 28.2 57.2 L 28.2 46.8 L 53.2 24.2 L 7.2 24.2 Z"/>' 
  },
  "4": { 
    width: 68, 
    path: '<path d="M 48.2 2.2 L 48.2 68.2 L 63.2 68.2 L 63.2 79.2 L 48.2 79.2 L 48.2 98.2 L 33.2 98.2 L 33.2 79.2 L 3.2 79.2 L 3.2 67.2 Z M 33.2 22.2 L 13.2 68.2 L 33.2 68.2 Z"/>' 
  },
  "5": { 
    width: 80, 
    path: '<path d="M 12.2 12.2 L 71.2 12.2 L 71.2 23.2 L 26.2 23.2 L 22.2 47.2 C 28.2 43.2, 36.2 41.2, 45.2 41.2 C 62.2 41.2, 75.2 52.2, 75.2 70.2 C 75.2 88.2, 61.2 100.2, 42.2 100.2 C 22.2 100.2, 8.2 88.2, 6.2 70.2 L 20.2 68.2 C 21.8 80.2, 30.2 88.2, 42.2 88.2 C 52.2 88.2, 60.2 80.2, 60.2 70.2 C 60.2 60.2, 52.2 52.2, 41.2 52.2 C 32.2 52.2, 24.2 56.2, 19.2 61.2 Z"/>' 
  },
  "6": { 
    width: 78, 
    path: '<path d="M 42.2 2.2 C 60.2 2.2, 72.2 16.2, 72.2 28.2 L 57.2 28.2 C 57.2 20.2, 49.2 13.2, 41.2 13.2 C 27.2 13.2, 18.2 25.2, 17.2 50.2 C 23.2 42.2, 32.2 38.2, 43.2 38.2 C 61.2 38.2, 74.2 50.2, 74.2 69.2 C 74.2 88.2, 60.2 100.2, 42.2 100.2 C 21.2 100.2, 4.2 82.2, 4.2 48.2 C 4.2 21.2, 21.2 2.2, 42.2 2.2 Z M 41.2 49.2 C 29.2 49.2, 20.2 57.2, 20.2 69.2 C 20.2 81.2, 29.2 89.2, 41.2 89.2 C 52.2 89.2, 59.2 81.2, 59.2 69.2 C 59.2 57.2, 51.2 49.2, 41.2 49.2 Z"/>' 
  },
  "7": { 
    width: 78, 
    path: '<path d="M 7.2 12.2 L 74.2 12.2 L 74.2 23.2 L 37.2 98.2 L 21.2 98.2 L 55.2 23.2 L 7.2 23.2 Z"/>' 
  },
  "8": { 
    width: 80, 
    path: '<path d="M 40.2 2.2 C 58.2 2.2, 71.2 12.2, 71.2 27.2 C 71.2 38.2, 62.2 46.2, 50.2 50.2 C 64.2 54.2, 75.2 63.2, 75.2 76.2 C 75.2 91.2, 61.2 102.2, 40.2 102.2 C 19.2 102.2, 5.2 91.2, 5.2 76.2 C 5.2 63.2, 16.2 54.2, 30.2 50.2 C 18.2 46.2, 9.2 38.2, 9.2 27.2 C 9.2 12.2, 22.2 2.2, 40.2 2.2 Z M 40.2 13.2 C 28.2 13.2, 23.2 20.2, 23.2 27.2 C 23.2 35.2, 29.2 41.2, 40.2 41.2 C 51.2 41.2, 57.2 35.2, 57.2 27.2 C 57.2 20.2, 52.2 13.2, 40.2 13.2 Z M 40.2 51.2 C 26.2 51.2, 19.2 59.2, 19.2 75.2 C 19.2 86.2, 27.2 91.2, 40.2 91.2 C 53.2 91.2, 61.2 86.2, 61.2 75.2 C 61.2 59.2, 54.2 51.2, 40.2 51.2 Z"/>' 
  },
  "9": { 
    width: 80, 
    path: '<path d="M 40.2 2.2 C 61.2 2.2, 76.2 19.2, 76.2 51.2 C 76.2 78.2, 59.2 98.2, 38.2 98.2 C 20.2 98.2, 8.2 83.2, 8.2 71.2 L 23.2 71.2 C 23.2 78.2, 30.2 86.2, 39.2 86.2 C 52.2 86.2, 60.2 74.2, 61.2 50.2 C 55.2 57.2, 46.2 61.2, 36.2 61.2 C 18.2 61.2, 5.2 49.2, 5.2 30.2 C 5.2 12.2, 19.2 2.2, 40.2 2.2 Z M 39.2 13.2 C 28.2 13.2, 20.2 21.2, 20.2 31.2 C 20.2 41.2, 28.2 49.2, 39.2 49.2 C 50.2 49.2, 59.2 41.2, 59.2 31.2 C 59.2 21.2, 50.2 13.2, 39.2 13.2 Z"/>' 
  },
  "0": { 
    width: 80, 
    path: '<path d="M 40.2 2.2 C 61.2 2.2, 75.2 18.2, 75.2 51.2 C 75.2 84.2, 61.2 100.2, 40.2 100.2 C 19.2 100.2, 5.2 84.2, 5.2 51.2 C 5.2 18.2, 19.2 2.2, 40.2 2.2 Z M 40.2 13.2 C 26.2 13.2, 20.2 27.2, 20.2 51.2 C 20.2 75.2, 26.2 89.2, 40.2 89.2 C 54.2 89.2, 60.2 75.2, 60.2 51.2 C 60.2 27.2, 54.2 13.2, 40.2 13.2 Z"/>' 
  }
};

function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  let paths = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    paths += `<g transform="translate(${xOffset}, 0)">${digitData.path}</g>`;
    xOffset += digitData.width + 8;
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

      // v=6 parameter forces Vercel CDN & Stremio to immediately purge old image caches
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=6`;

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

    // Apple TV Proportional Scaling (Sleek Top-Left Corner Rank Number)
    const desiredHeight = Math.round(height * 0.13); 
    const scale = (desiredHeight / 100).toFixed(3);
    const xPos = Math.round(width * 0.035);
    const yPos = Math.round(height * 0.045);

    const pillWidth = Math.max(110, formattedGenres.length * 12 + 32);
    const pillXPos = width - pillWidth - Math.round(width * 0.035);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        
        <!-- Subtle Top Dark Gradient Vignette for Legibility -->
        <rect width="${width}" height="${Math.round(height * 0.30)}" fill="black" opacity="0.45" />

        <!-- 1. Bulletproof Dual-Layer Drop Shadow (Offset Path) -->
        <g transform="translate(${xPos + 2}, ${yPos + 3}) scale(${scale})" fill="rgba(0,0,0,0.85)">
          ${digitPathsSvg}
        </g>

        <!-- 2. Pure White SF Pro Display Apple TV Rank Number -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})" fill="#FFFFFF">
          ${digitPathsSvg}
        </g>

        <!-- Top-Right Genre Pill -->
        ${
          formattedGenres
            ? `
        <g transform="translate(${pillXPos}, ${yPos})">
          <rect 
            rx="${Math.round(height * 0.018)}" 
            ry="${Math.round(height * 0.018)}" 
            width="${pillWidth}" 
            height="${Math.round(height * 0.058)}" 
            fill="rgba(0, 0, 0, 0.72)" 
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
