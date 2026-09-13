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
// DEDICATED HIGH-PRECISION NETFLIX NUMBER VECTORS (RANKS 1 - 10)
// Guarantees pixel-perfect rendering with zero OS/font dependencies.
// --------------------------------------------------------------------------------
const RANK_VECTORS = {
  "1": `<path d="M 35 30 L 75 10 L 105 10 L 105 230 L 55 230 L 55 195 L 70 195 L 70 45 L 35 60 Z"/>`,
  "2": `<path d="M 20 60 C 20 20, 50 10, 85 10 C 120 10, 145 30, 145 65 C 145 95, 120 125, 80 160 L 45 195 L 145 195 L 145 230 L 20 230 L 20 190 L 80 130 C 110 100, 110 80, 110 65 C 110 45, 95 38, 82 38 C 65 38, 55 50, 55 65 Z"/>`,
  "3": `<path d="M 25 15 L 135 15 L 135 50 L 75 110 C 110 110, 140 128, 140 168 C 140 208, 112 235, 75 235 C 38 235, 20 210, 20 175 L 55 175 C 55 192, 65 202, 75 202 C 90 202, 102 190, 102 168 C 102 145, 88 135, 65 135 L 45 135 L 45 102 L 90 50 L 25 50 Z"/>`,
  "4": `<path d="M 85 10 L 122 10 L 122 145 L 145 145 L 145 180 L 122 180 L 122 230 L 85 230 L 85 180 L 20 180 L 20 142 Z M 85 55 L 42 145 L 85 145 Z"/>`,
  "5": `<path d="M 25 15 L 135 15 L 135 50 L 60 50 L 55 90 C 70 80, 88 78, 105 78 C 130 78, 145 95, 145 138 C 145 190, 120 235, 75 235 C 35 235, 20 205, 20 170 L 55 170 C 55 190, 65 202, 75 202 C 92 202, 105 182, 105 138 C 105 108, 92 98, 72 98 C 55 98, 42 108, 35 118 L 22 108 Z"/>`,
  "6": `<path d="M 75 10 C 35 10, 20 45, 20 120 C 20 195, 35 235, 75 235 C 115 235, 140 200, 140 148 C 140 100, 115 80, 78 80 C 58 80, 42 90, 32 105 C 32 52, 50 42, 75 42 L 115 42 L 115 10 Z M 75 112 C 98 112, 102 128, 102 148 C 102 175, 92 202, 75 202 C 58 202, 48 175, 48 148 C 48 128, 58 112, 75 112 Z"/>`,
  "7": `<path d="M 20 15 L 138 15 L 138 48 L 70 230 L 32 230 L 95 48 L 20 48 Z"/>`,
  "8": `<path d="M 75 10 C 42 10, 22 30, 22 62 C 22 88, 42 102, 60 110 C 35 118, 18 138, 18 172 C 18 208, 42 235, 75 235 C 108 235, 132 208, 132 172 C 132 138, 115 118, 90 110 C 108 102, 128 88, 128 62 C 128 30, 108 10, 75 10 Z M 75 42 C 90 42, 92 52, 92 64 C 92 78, 82 88, 75 88 C 68 88, 58 78, 58 64 C 58 52, 60 42, 75 42 Z M 75 118 C 92 118, 96 132, 96 172 C 96 198, 88 205, 75 205 C 62 205, 54 198, 54 172 C 54 132, 58 118, 75 118 Z"/>`,
  "9": `<path d="M 75 10 C 35 10, 18 45, 18 95 C 18 148, 42 165, 75 165 C 95 165, 110 155, 120 140 C 120 192, 102 202, 75 202 L 40 202 L 40 235 L 75 235 C 118 235, 140 195, 140 120 C 140 45, 115 10, 75 10 Z M 75 42 C 92 42, 102 55, 102 95 C 102 120, 95 135, 75 135 C 58 135, 48 120, 48 95 C 48 55, 58 42, 75 42 Z"/>`,
  "10": `
    <g transform="translate(0, 0)">
      <path d="M 15 30 L 45 10 L 70 10 L 70 230 L 30 230 L 30 195 L 42 195 L 42 45 L 15 60 Z"/>
    </g>
    <g transform="translate(50, 0)">
      <path d="M 70 10 C 28 10, 12 45, 12 120 C 12 195, 28 235, 70 235 C 112 235, 128 195, 128 120 C 128 45, 112 10, 70 10 Z M 70 42 C 88 42, 90 68, 90 120 C 90 172, 88 202, 70 202 C 52 202, 50 172, 50 120 C 50 68, 52 42, 70 42 Z"/>
    </g>
  `
};

function buildNetflixNumberOverlay(rank) {
  const pathData = RANK_VECTORS[String(rank)] || RANK_VECTORS["1"];
  
  return `
    <g transform="translate(20, 120)">
      <!-- Drop Shadow -->
      <g fill="#000000" opacity="0.85" transform="translate(8, 8)">
        ${pathData}
      </g>

      <!-- White Outer Border -->
      <g fill="#FFFFFF" stroke="#FFFFFF" stroke-width="14" stroke-linejoin="round">
        ${pathData}
      </g>

      <!-- Dark Inner Core -->
      <g fill="#141414">
        ${pathData}
      </g>
    </g>
  `;
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

      // v=20 flushes previous cached images completely
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=20`;

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
    const numberSvgOverlay = buildNetflixNumberOverlay(numRank);

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

        <!-- Rendered Vector Number -->
        ${numberSvgOverlay}

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
