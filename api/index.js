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

// --------------------------------------------------------------------------------
// PROFESSIONAL CINEMATIC TYPEFACE PATHS
// Smooth bezier curves and arc geometry. Crisp, clean, high-end font appearance.
// Grid: 100x160.
// --------------------------------------------------------------------------------
const DIGIT_PATHS = {
  "1": { width: 70,  path: "M 20,35 L 45,15 L 45,160 L 75,160 L 75,0 L 45,0 L 20,20 Z" },
  "2": { width: 100, path: "M 10,40 A 40,40 0 0,1 90,40 C 90,75 50,105 10,140 L 10,160 L 100,160 L 100,130 L 55,130 C 70,115 90,95 90,65 C 90,30 65,10 45,10 C 25,10 10,22 10,40 Z" },
  "3": { width: 100, path: "M 10,25 C 25,10 50,5 75,20 C 95,32 98,60 80,78 C 98,90 95,130 70,148 C 45,165 15,150 10,130 L 40,115 C 45,125 58,130 68,122 C 78,115 78,95 65,90 C 55,85 45,85 35,85 L 35,65 L 45,65 C 55,65 65,60 70,50 C 75,40 70,28 55,25 C 40,22 25,32 20,45 L 0,35 C 3,20 10,12 25,15 Z" },
  "4": { width: 100, path: "M 65,0 L 35,110 L 0,110 L 0,135 L 35,135 L 35,160 L 65,160 L 65,135 L 100,135 L 100,110 L 65,110 Z M 65,30 L 65,90 L 20,90 Z" },
  "5": { width: 100, path: "M 5,0 L 100,0 L 100,30 L 35,30 L 35,65 C 45,60 55,60 65,65 C 90,75 100,100 95,130 C 90,155 65,165 40,165 C 20,165 5,155 0,140 L 25,115 C 32,125 42,135 55,135 C 70,135 75,125 72,115 C 70,102 55,95 40,95 C 25,95 10,85 5,70 Z" },
  "6": { width: 100, path: "M 50,5 C 20,5 0,30 0,90 C 0,145 25,165 55,165 C 80,165 100,145 95,110 L 65,100 C 68,115 62,135 48,135 C 32,135 30,115 30,90 C 35,95 45,100 55,100 C 80,100 95,80 95,50 C 95,20 75,5 50,5 Z M 55,30 C 68,30 70,45 70,55 C 70,68 68,75 55,75 C 42,75 35,65 35,55 C 35,45 42,30 55,30 Z" },
  "7": { width: 100, path: "M 0,0 L 100,0 L 100,25 L 45,160 L 15,160 L 65,45 L 0,45 Z" },
  "8": { width: 100, path: "M 50,5 C 25,5 10,22 10,48 C 10,70 30,82 50,90 C 30,98 10,110 10,135 C 10,158 28,165 50,165 C 72,165 90,158 90,135 C 90,110 70,98 50,90 C 70,82 90,70 90,48 C 90,22 75,5 50,5 Z M 50,30 C 60,30 65,38 65,48 C 65,58 60,65 50,65 C 40,65 35,58 35,48 C 35,38 40,30 50,30 Z M 50,105 C 60,105 65,112 65,122 C 65,132 60,140 50,140 C 40,140 35,132 35,122 C 35,112 40,105 50,105 Z" },
  "9": { width: 100, path: "M 50,0 C 25,0 5,15 5,50 C 5,80 25,95 45,95 C 55,95 65,90 70,85 L 70,160 L 100,160 L 100,0 Z M 50,25 C 62,25 68,38 68,50 C 68,62 62,75 50,75 C 38,75 32,62 32,50 C 32,38 38,25 50,25 Z" },
  "0": { width: 100, path: "M 50,0 C 20,0 0,25 0,85 C 0,140 20,165 50,165 C 80,165 100,140 100,85 C 100,25 80,0 50,0 Z M 50,30 C 65,30 70,48 70,85 C 70,120 65,135 50,135 C 35,135 30,120 30,85 C 30,48 35,30 50,30 Z" }
};

// TRIPLE LAYER SVG RENDER (Prevents rendering bugs & creates 3D Netflix depth)
function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  
  let shadowLayer = "";
  let outlineLayer = "";
  let coreLayer = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    
    // 1. Solid Base Drop Shadow
    shadowLayer += `<path transform="translate(${xOffset + 8}, 8)" d="${digitData.path}" fill="#000000" opacity="0.85" fill-rule="evenodd"/>`;
    
    // 2. Thick White Stroke Layer (Outer Contrast)
    outlineLayer += `<path transform="translate(${xOffset}, 0)" d="${digitData.path}" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linejoin="round" stroke-linecap="round" fill-rule="evenodd"/>`;
    
    // 3. Dark Cinematic Core Fill
    coreLayer += `<path transform="translate(${xOffset}, 0)" d="${digitData.path}" fill="#141414" fill-rule="evenodd"/>`;
    
    xOffset += digitData.width + 12; // Precise Kerning
  });

  return `<g>${shadowLayer}${outlineLayer}${coreLayer}</g>`;
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
        <p>Landscape posters with embedded cinematic Netflix-style numbers & genre tags.</p>
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

      // v=15 immediately busts cache across Stremio Web, iOS, and NuVio
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=15`;

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

    // Scaling calculations
    const desiredHeight = Math.round(height * 0.70); 
    const scale = (desiredHeight / 160).toFixed(3);
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

        <!-- Rendered Professional Cinematic Digits -->
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
