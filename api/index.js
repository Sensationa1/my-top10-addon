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
  description: "Top 10 Trending Movies & TV Shows with cinematic numbers and Apple TV style genre badges.",
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

// Aggressive sanitization to prevent Vercel "missing font glyph" white dots
function getSafeGenre(genres) {
  if (!genres) return "";
  // Isolate the primary genre, uppercase it, and strip everything except A-Z, 0-9, and Hyphens
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
        <p>Landscape posters with embedded cinematic numbers and Apple TV style UI badges.</p>
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

      // Ensure genres are extracted safely
      let genres = "";
      if (Array.isArray(item.genres)) {
        genres = item.genres.join(",");
      } else if (typeof item.genres === "string") {
        genres = item.genres;
      }

      // v=50 forces instant cache refresh on Stremio
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=50`;

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
    const rankStr = String(numRank);
    const safeGenre = getSafeGenre(genres);

    // Number Typography Setup (Occupies massive 70% of poster height)
    const fontSize = Math.round(height * 0.70);
    const yPos = height - Math.round(height * 0.05);
    const xPos = Math.round(width * 0.02);

    let textMarkup = "";
    if (rankStr === "10") {
      const digitOneX = xPos;
      const digitZeroX = xPos + Math.round(fontSize * 0.42); // Tight cinematic overlap
      
      textMarkup = `
        <!-- '0' Background Elements -->
        <text x="${digitZeroX + 12}" y="${yPos + 12}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-style="italic" font-size="${fontSize}" fill="rgba(0,0,0,0.85)">0</text>
        <text x="${digitZeroX}" y="${yPos}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-style="italic" font-size="${fontSize}" fill="#141414" stroke="#ffffff" stroke-width="16" stroke-linejoin="round">0</text>
        
        <!-- '1' Foreground Elements -->
        <text x="${digitOneX + 12}" y="${yPos + 12}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-style="italic" font-size="${fontSize}" fill="rgba(0,0,0,0.85)">1</text>
        <text x="${digitOneX}" y="${yPos}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-style="italic" font-size="${fontSize}" fill="#141414" stroke="#ffffff" stroke-width="16" stroke-linejoin="round">1</text>
      `;
    } else {
      textMarkup = `
        <text x="${xPos + 12}" y="${yPos + 12}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-style="italic" font-size="${fontSize}" fill="rgba(0,0,0,0.85)">${rankStr}</text>
        <text x="${xPos}" y="${yPos}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-style="italic" font-size="${fontSize}" fill="#141414" stroke="#ffffff" stroke-width="16" stroke-linejoin="round">${rankStr}</text>
      `;
    }

    // Apple TV Style Genre Badge (Top Right)
    let badgeMarkup = "";
    if (safeGenre) {
      const badgeHeight = Math.round(height * 0.07);
      const fontSizeBadge = Math.round(badgeHeight * 0.55);
      const charWidthEst = fontSizeBadge * 0.7; 
      const badgeWidth = Math.max(120, safeGenre.length * charWidthEst + 40);
      
      const badgeX = width - badgeWidth - Math.round(width * 0.03);
      const badgeY = Math.round(height * 0.04);
      
      const textX = badgeX + (badgeWidth / 2);
      const textY = badgeY + (badgeHeight / 2) + (fontSizeBadge * 0.35); // Visually centered

      badgeMarkup = `
        <g>
          <!-- tvOS Frosted Glass Pill Replica -->
          <rect x="${badgeX}" y="${badgeY}" width="${badgeWidth}" height="${badgeHeight}" rx="${Math.round(badgeHeight/2)}" ry="${Math.round(badgeHeight/2)}" fill="rgba(20, 20, 25, 0.7)" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" />
          <text x="${textX}" y="${textY}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fontSizeBadge}" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">${safeGenre}</text>
        </g>
      `;
    }

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="overlayGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.88" />
            <stop offset="35%" stop-color="#000000" stop-opacity="0.45" />
            <stop offset="70%" stop-color="#000000" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Shadow Vignette -->
        <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#overlayGradient)" />

        <!-- Cinematic Numbers -->
        ${textMarkup}

        <!-- Apple TV Genre Pill -->
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
