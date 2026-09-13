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
// PURE GEOMETRIC PATH GLYPHS (Base Height: 300px)
// Zero <text> tags = Zero font lookups = Zero white dot artifacts.
// --------------------------------------------------------------------------------
const DIGIT_PATHS = {
  "1": { width: 85, path: "M 15 75 L 55 15 L 90 15 L 90 285 L 35 285 L 35 240 L 55 240 L 55 60 L 15 75 Z" },
  "2": { width: 140, path: "M 15 70 C 15 25 50 10 95 10 C 140 10 170 35 170 80 C 170 120 135 160 85 210 L 35 255 L 170 255 L 170 290 L 15 290 L 15 250 L 80 185 C 120 140 125 115 125 80 C 125 45 110 38 92 38 C 70 38 58 50 58 70 Z" },
  "3": { width: 140, path: "M 20 15 L 165 15 L 165 55 L 85 130 C 125 130 165 150 165 200 C 165 250 130 290 85 290 C 35 290 15 255 15 210 L 60 210 C 60 235 70 248 85 248 C 105 248 120 232 120 200 C 120 168 105 152 75 152 L 50 152 L 50 115 L 110 55 L 20 55 Z" },
  "4": { width: 150, path: "M 95 15 L 135 15 L 135 190 L 165 190 L 165 230 L 135 230 L 135 285 L 90 285 L 90 230 L 15 230 L 15 185 Z M 90 65 L 40 190 L 90 190 Z" },
  "5": { width: 145, path: "M 25 15 L 160 15 L 160 55 L 65 55 L 60 105 C 80 92 105 88 125 88 C 155 88 170 110 170 160 C 170 230 140 290 85 290 C 35 290 15 250 15 200 L 60 200 C 60 230 70 248 85 248 C 105 248 125 220 125 160 C 125 125 110 118 85 118 C 65 118 50 128 42 140 L 22 130 Z" },
  "6": { width: 145, path: "M 90 15 C 40 15 15 60 15 155 C 15 245 40 290 90 290 C 140 290 165 250 165 185 C 165 125 135 100 90 100 C 65 100 45 112 35 130 C 35 70 55 55 90 55 L 140 55 L 140 15 Z M 90 138 C 112 138 120 155 120 185 C 120 220 110 248 90 248 C 70 248 60 220 60 185 C 60 155 68 138 90 138 Z" },
  "7": { width: 140, path: "M 15 15 L 165 15 L 165 50 L 80 285 L 35 285 L 115 55 L 15 55 Z" },
  "8": { width: 145, path: "M 85 15 C 45 15 20 40 20 80 C 20 112 40 132 65 142 C 38 152 15 178 15 220 C 15 265 40 290 85 290 C 130 290 155 265 155 220 C 155 178 132 152 105 142 C 130 132 150 112 150 80 C 150 40 125 15 85 15 Z M 85 50 C 100 50 105 62 105 80 C 105 98 95 110 85 110 C 75 110 65 98 65 80 C 65 62 70 50 85 50 Z M 85 142 C 100 142 110 160 110 220 C 110 248 100 255 85 255 C 70 255 60 248 60 220 C 60 160 70 142 85 142 Z" },
  "9": { width: 145, path: "M 85 15 C 35 15 15 55 15 120 C 15 185 40 205 85 205 C 110 205 130 192 140 175 C 140 235 120 250 85 250 L 40 250 L 40 290 L 85 290 C 135 290 165 245 165 150 C 165 55 140 15 85 15 Z M 85 52 C 105 52 120 70 120 120 C 120 150 112 168 85 168 C 65 168 58 150 58 120 C 58 70 65 52 85 52 Z" },
  "0": { width: 135, path: "M 80 15 C 35 15 15 55 15 150 C 15 245 35 285 80 285 C 125 285 145 245 145 150 C 145 55 125 15 80 15 Z M 80 55 C 98 55 100 85 100 150 C 100 215 98 245 80 245 C 62 245 60 215 60 150 C 60 85 62 55 80 55 Z" }
};

function renderVectorRank(rank) {
  const strRank = String(rank);
  let elements = [];

  if (strRank === "10") {
    elements.push({ d: DIGIT_PATHS["1"].path, x: 0 });
    elements.push({ d: DIGIT_PATHS["0"].path, x: 65 });
  } else {
    const digitData = DIGIT_PATHS[strRank] || DIGIT_PATHS["1"];
    elements.push({ d: digitData.path, x: 0 });
  }

  let shadowLayer = "";
  let borderLayer = "";
  let coreLayer = "";

  elements.forEach((item) => {
    shadowLayer += `<path d="${item.d}" transform="translate(${item.x + 12}, 12)" fill="#000000" opacity="0.88"/>`;
    borderLayer += `<path d="${item.d}" transform="translate(${item.x}, 0)" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="16" stroke-linejoin="miter"/>`;
    coreLayer += `<path d="${item.d}" transform="translate(${item.x}, 0)" fill="#141414"/>`;
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
        <p>Landscape posters with embedded Netflix-style numbers.</p>
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

      // v=40 flushes stale image caches completely
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&v=40`;

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
  const { id, rank, type } = req.query;

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

    const numRank = parseInt(rank, 10) || 1;
    const vectorGroup = renderVectorRank(numRank);

    // Number occupies 72% of landscape poster height
    const desiredHeight = Math.round(height * 0.72);
    const scale = (desiredHeight / 300).toFixed(3);
    const xPos = Math.round(width * 0.02);
    const yPos = height - desiredHeight + Math.round(height * 0.02);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="netflixGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.88" />
            <stop offset="35%" stop-color="#000000" stop-opacity="0.45" />
            <stop offset="70%" stop-color="#000000" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Pure Vignette Layer -->
        <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#netflixGradient)" />

        <!-- Pure Vector Number (NO TEXT TAGS) -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})">
          ${vectorGroup}
        </g>
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
