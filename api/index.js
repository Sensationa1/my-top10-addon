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

// Pure Vector Paths for Apple TV Style Numbers (Grid Height: 200)
const DIGIT_PATHS = {
  "1": {
    width: 80,
    path: '<path d="M 15 35 L 55 0 L 68 0 L 68 200 L 22 200 L 22 165 L 36 165 L 36 30 Z" />'
  },
  "2": {
    width: 120,
    path: '<path d="M 10 55 C 10 15, 110 15, 110 60 C 110 95, 75 125, 10 165 L 10 200 L 115 200 L 115 165 L 55 165 L 85 135 C 112 108, 120 85, 120 60 C 120 20, 90 0, 60 0 C 30 0, 10 20, 10 55 Z" />'
  },
  "3": {
    width: 120,
    path: '<path d="M 15 20 L 110 20 L 110 55 L 60 85 C 95 85, 115 105, 115 140 C 115 180, 85 200, 55 200 C 25 200, 10 180, 5 150 L 38 145 C 40 162, 48 170, 58 170 C 70 170, 80 160, 80 140 C 80 120, 70 110, 52 110 L 38 110 L 38 80 L 68 52 L 15 52 Z" />'
  },
  "4": {
    width: 115,
    path: '<path d="M 75 0 L 10 120 L 75 120 L 75 0 Z M 75 120 L 110 120 L 110 150 L 75 150 L 75 200 L 42 200 L 42 150 L 0 150 L 0 115 L 75 0 Z" />'
  },
  "5": {
    width: 120,
    path: '<path d="M 15 20 L 105 20 L 105 52 L 48 52 L 42 85 C 52 78, 68 75, 80 78 C 105 85, 118 108, 118 140 C 118 180, 92 200, 58 200 C 25 200, 8 178, 5 145 L 38 140 C 40 158, 48 168, 58 168 C 72 168, 82 158, 82 140 C 82 122, 70 110, 52 110 C 42 110, 32 115, 25 120 L 15 20 Z" />'
  },
  "6": {
    width: 120,
    path: '<path d="M 65 0 C 25 0, 5 40, 5 110 C 5 160, 25 200, 62 200 C 95 200, 115 170, 115 130 C 115 90, 92 65, 60 65 C 45 65, 32 72, 24 85 C 28 45, 42 30, 68 30 L 105 30 L 105 0 Z M 60 95 C 75 95, 82 108, 82 130 C 82 152, 75 168, 60 168 C 45 168, 38 152, 38 130 C 38 108, 45 95, 60 95 Z" />'
  },
  "7": {
    width: 120,
    path: '<path d="M 10 20 L 115 20 L 115 50 L 60 200 L 22 200 L 75 52 L 10 52 Z" />'
  },
  "8": {
    width: 120,
    path: '<path d="M 60 0 C 30 0, 12 18, 12 48 C 12 70, 25 85, 42 95 C 22 105, 5 122, 5 152 C 5 182, 28 200, 60 200 C 92 200, 115 182, 115 152 C 115 122, 98 105, 78 95 C 95 85, 108 70, 108 48 C 108 18, 90 0, 60 0 Z M 60 30 C 72 30, 76 40, 76 50 C 76 60, 70 70, 60 70 C 50 70, 48 60, 48 50 C 48 40, 52 30, 60 30 Z M 60 120 C 72 120, 80 130, 80 152 C 80 170, 72 172, 60 172 C 48 172, 40 170, 40 152 C 40 130, 48 120, 60 120 Z" />'
  },
  "9": {
    width: 120,
    path: '<path d="M 55 200 C 95 200, 115 160, 115 90 C 115 40, 95 0, 58 0 C 25 0, 5 30, 5 70 C 5 110, 28 135, 60 135 C 75 135, 88 128, 96 115 C 92 155, 78 170, 52 170 L 15 170 L 15 200 Z M 60 32 C 75 32, 82 48, 82 70 C 82 92, 75 105, 60 105 C 45 105, 38 92, 38 70 C 38 48, 45 32, 60 32 Z" />'
  },
  "0": {
    width: 120,
    path: '<path d="M 60 0 C 22 0, 5 35, 5 100 C 5 165, 22 200, 60 200 C 98 200, 115 165, 115 100 C 115 35, 98 0, 60 0 Z M 60 32 C 78 32, 80 58, 80 100 C 80 142, 78 168, 60 168 C 42 168, 40 142, 40 100 C 40 58, 42 32, 60 32 Z" />'
  }
};

function renderRankVector(rankNum) {
  const digits = String(rankNum).split("");
  let totalWidth = 0;
  let pathsSvg = "";

  digits.forEach((d) => {
    const digitData = DIGIT_PATHS[d] || DIGIT_PATHS["1"];
    pathsSvg += `<g transform="translate(${totalWidth}, 0)">${digitData.path}</g>`;
    totalWidth += digitData.width + 8;
  });

  return { pathsSvg, totalWidth };
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

      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}`;

      return {
        id: idToUse,
        type: type,
        name: `${rank}. ${title}`,
        poster: posterUrl,
        posterShape: "landscape",
        description: item.description || item.overview || ""
      };
    }).filter(Boolean);

    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
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
    const { pathsSvg } = renderRankVector(numRank);

    // Dynamic Vector Scale based on Backdrop Height
    const desiredHeight = Math.round(height * 0.70); // 70% height
    const scale = (desiredHeight / 200).toFixed(3);
    const xPos = Math.round(width * 0.025);
    const yPos = Math.round(height * 0.96 - desiredHeight);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bottomShadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000000" stop-opacity="0" />
            <stop offset="40%" stop-color="#000000" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.88" />
          </linearGradient>

          <linearGradient id="leftShadow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.85" />
            <stop offset="35%" stop-color="#000000" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0" />
          </linearGradient>

          <linearGradient id="appleTvGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#FFFFFF" />
            <stop offset="60%" stop-color="#F2F2F2" />
            <stop offset="100%" stop-color="#CCCCCC" />
          </linearGradient>

          <filter id="appleShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.95"/>
            <feDropShadow dx="-4" dy="0" stdDeviation="6" flood-color="#000000" flood-opacity="0.6"/>
          </filter>

          <filter id="pillShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.75"/>
          </filter>
        </defs>

        <rect width="${width}" height="${height}" fill="url(#leftShadow)" />
        <rect width="${width}" height="${height}" fill="url(#bottomShadow)" />

        <!-- Vector Apple TV Rank Number -->
        <g filter="url(#appleShadow)" transform="translate(${xPos}, ${yPos}) scale(${scale})" fill="url(#appleTvGradient)" stroke="rgba(255,255,255,0.4)" stroke-width="2">
          ${pathsSvg}
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
