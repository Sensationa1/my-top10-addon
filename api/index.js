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

// High-Precision Apple SF Pro Display Bold Glyphs (Standard Box Height: 100)
const DIGIT_PATHS = {
  "1": { 
    width: 38, 
    path: '<path d="M 8.5 25.4 C 15.2 20.8, 22.1 14.2, 26.8 7.5 L 37.5 7.5 L 37.5 92.5 L 23.8 92.5 L 23.8 26.8 L 8.5 36.2 Z"/>' 
  },
  "2": { 
    width: 76, 
    path: '<path d="M 5.8 28.2 C 5.8 11.5, 20.8 1.5, 40.5 1.5 C 60.2 1.5, 74.2 11.8, 74.2 26.8 C 74.2 38.5, 66.8 48.2, 50.8 62.8 L 22.8 88.5 L 75.8 88.5 L 75.8 98.5 L 5.8 98.5 L 5.8 88.8 L 41.8 55.8 C 56.8 42.2, 60.2 35.5, 60.2 26.8 C 60.2 17.5, 51.2 11.8, 40.2 11.8 C 29.2 11.8, 20.2 17.8, 20.2 28.2 Z"/>' 
  },
  "3": { 
    width: 76, 
    path: '<path d="M 6.8 11.5 L 72.8 11.5 L 72.8 21.8 L 40.8 47.5 C 58.8 48.5, 73.8 59.2, 73.8 75.8 C 73.8 90.8, 60.2 100.8, 40.2 100.8 C 19.8 100.8, 6.2 88.8, 4.8 73.8 L 18.8 71.8 C 20.2 81.8, 28.8 89.8, 40.2 89.8 C 50.8 89.8, 58.8 82.8, 58.8 73.5 C 58.8 63.8, 50.8 56.8, 37.8 56.8 L 27.5 56.8 L 27.5 46.2 L 51.8 23.5 L 6.8 23.5 Z"/>' 
  },
  "4": { 
    width: 68, 
    path: '<path d="M 46.8 1.5 L 46.8 66.8 L 61.8 66.8 L 61.8 77.8 L 46.8 77.8 L 46.8 98.5 L 32.2 98.5 L 32.2 77.8 L 2.5 77.8 L 2.5 66.2 Z M 32.2 20.8 L 13.5 66.8 L 32.2 66.8 Z"/>' 
  },
  "5": { 
    width: 76, 
    path: '<path d="M 11.5 11.5 L 69.8 11.5 L 69.8 22.5 L 25.5 22.5 L 21.8 46.2 C 27.8 42.2, 35.8 40.2, 44.8 40.2 C 61.8 40.2, 73.8 51.2, 73.8 69.2 C 73.8 87.2, 59.8 99.5, 41.2 99.5 C 21.5 99.5, 7.8 87.5, 5.8 69.5 L 19.8 67.5 C 21.2 79.5, 29.5 87.5, 41.2 87.5 C 50.8 87.5, 58.8 79.5, 58.8 69.2 C 58.8 59.2, 50.8 51.2, 39.8 51.2 C 31.2 51.2, 23.5 55.2, 18.8 60.2 Z"/>' 
  },
  "6": { 
    width: 76, 
    path: '<path d="M 41.2 1.5 C 59.2 1.5, 70.8 15.2, 70.8 27.2 L 56.2 27.2 C 56.2 19.2, 48.5 12.5, 40.5 12.5 C 26.8 12.5, 17.8 24.2, 16.8 49.2 C 22.8 41.2, 31.8 37.2, 42.5 37.2 C 60.2 37.2, 72.8 49.2, 72.8 68.2 C 72.8 87.2, 58.8 99.5, 41.2 99.5 C 20.5 99.5, 3.8 81.5, 3.8 47.5 C 3.8 20.5, 20.5 1.5, 41.2 1.5 Z M 40.2 48.2 C 28.5 48.2, 19.8 56.2, 19.8 68.2 C 19.8 80.2, 28.5 88.2, 40.2 88.2 C 50.8 88.2, 57.8 80.2, 57.8 68.2 C 57.8 56.2, 50.2 48.2, 40.2 48.2 Z"/>' 
  },
  "7": { 
    width: 74, 
    path: '<path d="M 6.5 11.5 L 72.5 11.5 L 72.5 22.2 L 36.2 98.5 L 20.8 98.5 L 53.8 22.2 L 6.5 22.2 Z"/>' 
  },
  "8": { 
    width: 76, 
    path: '<path d="M 39.2 1.5 C 57.2 1.5, 69.8 11.2, 69.8 26.2 C 69.8 37.2, 60.8 45.2, 49.2 49.2 C 63.2 53.2, 73.8 62.2, 73.8 75.2 C 73.8 90.2, 59.8 100.8, 39.2 100.8 C 18.8 100.8, 4.8 90.2, 4.8 75.2 C 4.8 62.2, 15.5 53.2, 29.5 49.2 C 17.8 45.2, 8.8 37.2, 8.8 26.2 C 8.8 11.2, 21.5 1.5, 39.2 1.5 Z M 39.2 12.2 C 27.8 12.2, 22.8 19.2, 22.8 26.2 C 22.8 34.2, 28.8 40.2, 39.2 40.2 C 49.8 40.2, 55.8 34.2, 55.8 26.2 C 55.8 19.2, 50.8 12.2, 39.2 12.2 Z M 39.2 50.2 C 25.8 50.2, 18.8 58.2, 18.8 74.2 C 18.8 85.2, 26.8 90.2, 39.2 90.2 C 51.8 90.2, 59.8 85.2, 59.8 74.2 C 59.8 58.2, 52.8 50.2, 39.2 50.2 Z"/>' 
  },
  "9": { 
    width: 76, 
    path: '<path d="M 39.2 1.5 C 59.8 1.5, 74.8 18.2, 74.8 49.8 C 74.8 76.8, 58.2 97.5, 37.2 97.5 C 19.5 97.5, 7.8 82.5, 7.8 70.5 L 22.5 70.5 C 22.5 77.5, 29.5 85.5, 38.2 85.5 C 50.8 85.5, 58.8 73.5, 59.8 49.5 C 53.8 56.5, 45.2 60.2, 35.2 60.2 C 17.8 60.2, 4.8 48.2, 4.8 29.5 C 4.8 11.8, 18.5 1.5, 39.2 1.5 Z M 38.2 12.2 C 27.5 12.2, 19.8 20.2, 19.8 30.2 C 19.8 40.2, 27.5 48.2, 38.2 48.2 C 49.2 48.2, 57.8 40.2, 57.8 30.2 C 57.8 20.2, 49.2 12.2, 38.2 12.2 Z"/>' 
  },
  "0": { 
    width: 76, 
    path: '<path d="M 39.2 1.5 C 59.8 1.5, 73.8 17.5, 73.8 49.8 C 73.8 82.5, 59.8 99.5, 39.2 99.5 C 18.8 99.5, 4.8 82.5, 4.8 49.8 C 4.8 17.5, 18.8 1.5, 39.2 1.5 Z M 39.2 12.5 C 25.8 12.5, 19.8 26.2, 19.8 49.8 C 19.8 73.5, 25.8 87.5, 39.2 87.5 C 52.8 87.5, 58.8 73.5, 58.8 49.8 C 58.8 26.2, 52.8 12.5, 39.2 12.5 Z"/>' 
  }
};

function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  let paths = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    paths += `<g transform="translate(${xOffset}, 0)">${digitData.path}</g>`;
    xOffset += digitData.width + 6;
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

      // v=7 parameter forces Vercel CDN & Stremio to immediately purge old image caches
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=7`;

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

    // Apple TV Proportional Scale (~13% height)
    const desiredHeight = Math.round(height * 0.13); 
    const scale = (desiredHeight / 100).toFixed(3);
    const xPos = Math.round(width * 0.04);
    const yPos = Math.round(height * 0.05);

    const pillWidth = Math.max(110, formattedGenres.length * 12 + 32);
    const pillXPos = width - pillWidth - Math.round(width * 0.04);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- Localized Soft Radial Dark Shadow behind Top-Left Rank Number -->
          <radialGradient id="numberHalo" cx="5%" cy="8%" r="18%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.75" />
            <stop offset="50%" stop-color="#000000" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0" />
          </radialGradient>
        </defs>

        <!-- Localized Halo (Zero top black bars across full image) -->
        <rect width="${width}" height="${height}" fill="url(#numberHalo)" />

        <!-- 5-Layer Stacked Soft Ambient Shadow for High-Fidelity Depth -->
        <g transform="translate(${xPos + 4}, ${yPos + 5}) scale(${scale})" fill="rgba(0,0,0,0.12)">${digitPathsSvg}</g>
        <g transform="translate(${xPos + 3}, ${yPos + 4}) scale(${scale})" fill="rgba(0,0,0,0.22)">${digitPathsSvg}</g>
        <g transform="translate(${xPos + 2}, ${yPos + 3}) scale(${scale})" fill="rgba(0,0,0,0.35)">${digitPathsSvg}</g>
        <g transform="translate(${xPos + 1}, ${yPos + 2}) scale(${scale})" fill="rgba(0,0,0,0.55)">${digitPathsSvg}</g>
        <g transform="translate(${xPos + 0.5}, ${yPos + 1}) scale(${scale})" fill="rgba(0,0,0,0.70)">${digitPathsSvg}</g>

        <!-- Crisp Pure White SF Pro Display Apple TV Rank Number -->
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
