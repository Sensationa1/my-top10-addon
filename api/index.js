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
  name: "Top 10 Trending (Apple TV / Netflix Style)",
  description: "Top 10 Trending Posters with ultra-smooth cinematic numbers and Apple TV UI badges.",
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
// SKELETON STROKE VECTORS (Base Grid: 150x280)
// Uses mathematically perfect bezier curves (C) layered with massive stroke weights.
// Guarantees ultra-smooth, premium typography without relying on Vercel's text engine.
// --------------------------------------------------------------------------------
const SKELETONS = {
  "1": "M 40 80 L 80 30 L 80 250",
  "2": "M 30 80 C 30 10, 130 10, 130 80 C 130 140, 30 190, 30 250 L 130 250",
  "3": "M 30 60 C 30 10, 120 10, 120 60 C 120 90, 80 120, 80 120 C 80 120, 130 140, 130 190 C 130 250, 30 250, 30 200",
  "4": "M 110 250 L 110 30 L 30 170 L 140 170",
  "5": "M 120 40 L 40 40 L 40 110 C 40 110, 130 80, 130 170 C 130 250, 30 250, 30 190",
  "6": "M 110 40 C 60 10, 40 60, 40 140 C 40 230, 120 240, 120 180 C 120 130, 40 130, 40 180",
  "7": "M 30 30 L 130 30 L 60 250",
  "8": "M 80 140 C 130 140, 130 30, 80 30 C 30 30, 30 140, 80 140 C 130 140, 130 250, 80 250 C 30 250, 30 140, 80 140 Z",
  "9": "M 50 240 C 100 270, 120 220, 120 140 C 120 50, 40 40, 40 100 C 40 150, 120 150, 120 100",
  "0": "M 80 30 C 20 30, 20 250, 80 250 C 140 250, 140 30, 80 30 Z"
};

function renderCinematicNumber(rank) {
  const strRank = String(rank);
  const elements = [];

  if (strRank === "10") {
    // 0 is placed first so 1 renders perfectly over top of it
    elements.push({ path: SKELETONS["0"], x: 75 });
    elements.push({ path: SKELETONS["1"], x: 0 });
  } else {
    const p = SKELETONS[strRank] || SKELETONS["1"];
    elements.push({ path: p, x: 0 });
  }

  let markup = "";
  elements.forEach((el) => {
    // Layer 1: Drop Shadow
    markup += `<path d="${el.path}" transform="translate(${el.x + 10}, 10)" fill="none" stroke="#000000" stroke-width="60" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" />`;
    // Layer 2: Thick White Border
    markup += `<path d="${el.path}" transform="translate(${el.x}, 0)" fill="none" stroke="#FFFFFF" stroke-width="50" stroke-linecap="round" stroke-linejoin="round" />`;
    // Layer 3: Dark Inner Core
    markup += `<path d="${el.path}" transform="translate(${el.x}, 0)" fill="none" stroke="#141414" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" />`;
  });

  return markup;
}

// Aggressive sanitization to prevent missing-font "white dots" on Vercel
function getSafeGenre(genres) {
  if (!genres) return "";
  return genres.split(",")[0].toUpperCase().replace(/[^A-Z0-9 -]/g, "").trim();
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
        <p>Landscape posters with ultra-smooth cinematic numbers and Apple TV UI badges.</p>
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
        genres = item.genres.join(",");
      } else if (typeof item.genres === "string") {
        genres = item.genres;
      }

      // v=60 forces instant cache refresh for the new Skeleton architecture
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=60`;

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

    const numRank = parseInt(rank, 10) || 1;
    const safeGenre = getSafeGenre(genres);
    const vectorGroup = renderCinematicNumber(numRank);

    // Number takes up roughly 70% of the poster height
    const desiredNumHeight = Math.round(height * 0.70);
    const scale = (desiredNumHeight / 280).toFixed(3);
    const xPos = Math.round(width * 0.02);
    const yPos = height - desiredNumHeight + Math.round(height * 0.02);

    let badgeMarkup = "";
    if (safeGenre) {
      const badgeHeight = Math.round(height * 0.07);
      const fontSizeBadge = Math.round(badgeHeight * 0.55);
      const charWidthEst = fontSizeBadge * 0.7; 
      const badgeWidth = Math.max(120, safeGenre.length * charWidthEst + 40);
      
      const badgeX = width - badgeWidth - Math.round(width * 0.03);
      const badgeY = Math.round(height * 0.04);
      
      const textX = badgeX + (badgeWidth / 2);
      const textY = badgeY + (badgeHeight / 2) + (fontSizeBadge * 0.35);

      // Uses highly-safe system fonts to bypass Vercel rendering bugs
      badgeMarkup = `
        <g>
          <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${Math.round(badgeHeight/2)}" ry="${Math.round(badgeHeight/2)}" fill="rgba(20, 20, 25, 0.7)" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" />
          <text x="${textX}" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-weight="bold" font-size="${fontSizeBadge}" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">${safeGenre}</text>
        </g>
      `;
    }

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="netflixGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.88" />
            <stop offset="35%" stop-color="#000000" stop-opacity="0.5" />
            <stop offset="70%" stop-color="#000000" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#netflixGradient)" />

        <g transform="translate(${xPos}, ${yPos}) scale(${scale})">
          ${vectorGroup}
        </g>

        ${badgeMarkup}
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
