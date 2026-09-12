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
// PURE VECTOR DIGIT GLYPHS (Base Height: 150px)
// Eliminates server font dependencies. Guarantees 100% deterministic rendering.
// --------------------------------------------------------------------------------
const DIGIT_PATHS = {
  "1": { width: 50, path: "M 12,30 L 32,10 L 48,10 L 48,150 L 12,150 L 12,126 L 26,126 L 26,30 Z" },
  "2": { width: 80, path: "M 8,40 C 8,14 26,4 50,4 C 74,4 88,18 88,40 C 88,60 68,82 44,106 L 20,126 L 88,126 L 88,150 L 8,150 L 8,124 L 46,82 C 64,64 64,52 64,40 C 64,26 56,22 50,22 C 42,22 34,28 34,40 Z" },
  "3": { width: 80, path: "M 10,10 L 82,10 L 82,32 L 44,70 C 66,70 84,82 84,106 C 84,132 68,150 44,150 C 20,150 10,134 10,110 L 32,110 C 32,122 38,128 44,128 C 54,128 60,120 60,106 C 60,92 52,84 38,84 L 26,84 L 26,62 L 52,32 L 10,32 Z" },
  "4": { width: 82, path: "M 48,8 L 76,8 L 76,92 L 86,92 L 86,114 L 76,114 L 76,150 L 52,150 L 52,114 L 8,114 L 8,90 Z M 52,36 L 24,90 L 52,90 Z" },
  "5": { width: 80, path: "M 10,10 L 80,10 L 80,32 L 32,32 L 28,62 C 38,54 48,52 58,52 C 74,52 84,64 84,98 C 84,130 68,150 44,150 C 20,150 10,132 10,108 L 32,108 C 32,120 38,128 44,128 C 54,128 60,120 60,98 C 60,82 52,74 40,74 C 30,74 22,80 18,88 L 8,80 Z" },
  "6": { width: 80, path: "M 44,8 C 20,8 8,28 8,76 C 8,124 20,150 44,150 C 68,150 82,128 82,96 C 82,66 68,54 46,54 C 34,54 22,60 16,70 C 16,36 28,30 44,30 L 66,30 L 66,8 Z M 44,74 C 58,74 60,84 60,98 C 60,114 54,128 44,128 C 34,128 28,114 28,98 C 28,84 34,74 44,74 Z" },
  "7": { width: 78, path: "M 8,8 L 80,8 L 80,28 L 40,150 L 16,150 L 54,28 L 8,28 Z" },
  "8": { width: 80, path: "M 44,8 C 24,8 12,20 12,40 C 12,56 24,66 36,70 C 20,74 8,86 8,108 C 8,130 22,150 44,150 C 66,150 80,130 80,108 C 80,86 68,74 52,70 C 64,66 76,56 76,40 C 76,20 64,8 44,8 Z M 44,28 C 54,28 56,34 56,42 C 56,50 50,56 44,56 C 38,56 32,50 32,42 C 32,34 34,28 44,28 Z M 44,74 C 54,74 56,82 56,108 C 56,126 52,130 44,130 C 36,130 32,126 32,108 C 32,82 34,74 44,74 Z" },
  "9": { width: 80, path: "M 44,8 C 20,8 8,28 8,60 C 8,92 22,102 44,102 C 56,102 68,94 74,84 C 74,118 64,128 44,128 L 24,128 L 24,150 L 44,150 C 70,150 82,128 82,80 C 82,32 70,8 44,8 Z M 44,28 C 54,28 58,38 58,58 C 58,72 52,82 44,82 C 36,82 30,72 30,58 C 30,38 34,28 44,28 Z" },
  "0": { width: 80, path: "M 44,8 C 18,8 8,28 8,78 C 8,128 18,148 44,148 C 70,148 80,128 80,78 C 80,28 70,8 44,8 Z M 44,28 C 58,28 58,44 58,78 C 58,112 58,128 44,128 C 30,128 30,112 30,78 C 30,44 30,28 44,28 Z" }
};

// Renders solid layered silhouettes to prevent stroke cap artifacts
function renderRankSvg(rankNum) {
  const digits = String(rankNum).split("");
  let xOffset = 0;
  
  let shadowLayer = "";
  let borderLayer = "";
  let coreLayer = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    
    // 1. Soft Ambient Shadow
    shadowLayer += `<path transform="translate(${xOffset + 6}, 6)" d="${digitData.path}" fill="#000000" opacity="0.8" fill-rule="evenodd"/>`;
    
    // 2. Solid White Outer Silhouette Layer
    borderLayer += `<path transform="translate(${xOffset}, 0)" d="${digitData.path}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="10" stroke-linejoin="miter" fill-rule="evenodd"/>`;
    
    // 3. Dark Core Layer
    coreLayer += `<path transform="translate(${xOffset}, 0)" d="${digitData.path}" fill="#141414" fill-rule="evenodd"/>`;
    
    xOffset += digitData.width - 2;
  });

  return `<g>${shadowLayer}${borderLayer}${coreLayer}</g>`;
}

function getHostUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

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

app.get("/manifest.json", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "max-age=86400, public");
  res.json(MANIFEST);
});

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

      // Cache buster v=18 flushes previous missing-glyph dots
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=18`;

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

app.get("/api/poster", async (req, res) => {
  const { id, rank, type, genres } = req.query;

  if (!id) {
    return res.status(400).send("Missing ID parameter");
  }

  try {
    let backdropBuffer = null;
    const cleanImdbId = id.startsWith("tt") ? id : null;

    if (cleanImdbId) {
      try {
        const extUrl = `https://extendedratings.com/backdrop/${cleanImdbId}?config=russel&key=Kolkko11&v=fd3ce853`;
        const response = await axios.get(extUrl, { responseType: "arraybuffer", timeout: 4500 });
        backdropBuffer = Buffer.from(response.data);
      } catch (e) {}
    }

    if (!backdropBuffer && cleanImdbId) {
      const tmdbInfo = await getTmdbData(cleanImdbId, type);
      if (tmdbInfo.backdropUrl) {
        try {
          const tmdbRes = await axios.get(tmdbInfo.backdropUrl, { responseType: "arraybuffer", timeout: 4500 });
          backdropBuffer = Buffer.from(tmdbRes.data);
        } catch (e) {}
      }
    }

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

    // Number scale: 65% of backdrop height
    const desiredHeight = Math.round(height * 0.65); 
    const scale = (desiredHeight / 150).toFixed(3);
    const xPos = Math.round(width * 0.025);
    const yPos = Math.round(height * 0.22);

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
