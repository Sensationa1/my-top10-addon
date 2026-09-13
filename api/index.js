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
// HIGH-PRECISION CONDENSED TYPOGRAPHY VECTOR PATHS (Base ViewBox Height: 205)
// Zero font dependencies. Guarantees 100% sharp rendering across all environments.
// --------------------------------------------------------------------------------
const GLYPHS = {
  "1": { w: 75, path: "M 15 45 L 42 10 L 72 10 L 72 200 L 25 200 L 25 168 L 42 168 L 42 45 Z" },
  "2": { w: 105, path: "M 10 50 C 10 15 35 5 62 5 C 90 5 105 25 105 55 C 105 85 80 115 48 148 L 22 172 L 105 172 L 105 200 L 10 200 L 10 170 L 52 125 C 75 100 75 80 75 58 C 75 35 62 28 50 28 C 38 28 32 38 32 50 Z" },
  "3": { w: 105, path: "M 15 10 L 105 10 L 105 42 L 55 95 C 80 95 105 110 105 148 C 105 182 82 205 50 205 C 20 205 10 182 10 150 L 38 150 C 38 168 44 178 52 178 C 62 178 72 168 72 148 C 72 128 62 118 45 118 L 30 118 L 30 90 L 68 42 L 15 42 Z" },
  "4": { w: 115, path: "M 62 10 L 92 10 L 92 135 L 115 135 L 115 165 L 92 165 L 92 200 L 62 200 L 62 165 L 10 165 L 10 130 Z M 62 48 L 30 135 L 62 135 Z" },
  "5": { w: 115, path: "M 18 10 L 105 10 L 105 40 L 45 40 L 40 75 C 55 65 72 62 88 62 C 108 62 120 78 120 115 C 120 162 98 205 55 205 C 22 205 10 178 10 142 L 38 142 C 38 165 45 178 55 178 C 68 178 88 160 88 115 C 88 88 78 78 58 78 C 45 78 35 85 30 95 L 18 88 Z" },
  "6": { w: 110, path: "M 60 10 C 28 10 12 40 12 110 C 12 175 28 205 60 205 C 92 205 110 178 110 132 C 110 88 90 70 60 70 C 42 70 28 80 22 95 C 22 50 38 38 60 38 L 92 38 L 92 10 Z M 60 98 C 76 98 80 112 80 132 C 80 158 72 178 60 178 C 48 178 40 158 40 132 C 40 112 44 98 60 98 Z" },
  "7": { w: 105, path: "M 12 10 L 105 10 L 105 38 L 52 200 L 20 200 L 72 38 L 12 38 Z" },
  "8": { w: 110, path: "M 58 10 C 30 10 15 28 15 55 C 15 78 30 92 45 98 C 28 105 12 122 12 152 C 12 185 30 205 58 205 C 86 205 104 185 104 152 C 104 122 88 105 71 98 C 86 92 101 78 101 55 C 101 28 86 10 58 10 Z M 58 35 C 68 35 72 45 72 55 C 72 68 65 75 58 75 C 51 75 44 68 44 55 C 44 45 48 35 58 35 Z M 58 98 C 68 98 74 112 74 152 C 74 175 68 180 58 180 C 48 180 42 175 42 152 C 42 112 48 98 58 98 Z" },
  "9": { w: 115, path: "M 58 10 C 28 10 10 38 10 82 C 10 128 28 145 58 145 C 74 145 88 135 94 122 C 94 165 80 178 58 178 L 28 178 L 28 205 L 58 205 C 92 205 120 175 120 108 C 120 40 92 10 58 10 Z M 58 35 C 72 35 88 48 88 82 C 88 105 80 120 58 120 C 42 120 38 105 38 82 C 38 48 44 35 58 35 Z" },
  "0": { w: 100, path: "M 55 10 C 22 10 10 40 10 105 C 10 170 22 200 55 200 C 88 200 100 170 100 105 C 100 40 88 10 55 10 Z M 55 38 C 68 38 70 60 70 105 C 70 150 68 172 55 172 C 42 172 40 150 40 105 C 40 60 42 38 55 38 Z" }
};

function generateNetflixNumberSvg(rank) {
  const strRank = String(rank);
  let paths = [];

  if (strRank === "10") {
    // Tight overlap spacing for rank 10
    paths.push({ d: GLYPHS["1"].path, x: 0 });
    paths.push({ d: GLYPHS["0"].path, x: 55 });
  } else {
    const digitData = GLYPHS[strRank] || GLYPHS["1"];
    paths.push({ d: digitData.path, x: 0 });
  }

  let shadowMarkup = "";
  let borderMarkup = "";
  let coreMarkup = "";

  paths.forEach((p) => {
    shadowMarkup += `<path d="${p.d}" transform="translate(${p.x + 8}, 8)" fill="#000000" opacity="0.85"/>`;
    borderMarkup += `<path d="${p.d}" transform="translate(${p.x}, 0)" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="12" stroke-linejoin="round"/>`;
    coreMarkup += `<path d="${p.d}" transform="translate(${p.x}, 0)" fill="#111111"/>`;
  });

  return `<g>${shadowMarkup}${borderMarkup}${coreMarkup}</g>`;
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

      // v=21 forces complete cache invalidation
      const posterUrl = `${hostUrl}/api/poster?id=${imdbId || idToUse}&rank=${rank}&type=${type}&genres=${encodeURIComponent(genres)}&v=21`;

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
    const numberSvgGroup = generateNetflixNumberSvg(numRank);

    // Number takes up 58% of poster height, anchored to bottom-left
    const desiredNumHeight = Math.round(height * 0.58);
    const scale = (desiredNumHeight / 205).toFixed(3);
    const xPos = Math.round(width * 0.03);
    const yPos = height - desiredNumHeight - Math.round(height * 0.03);

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

        <!-- Left Vignette -->
        <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#netflixGradient)" />

        <!-- Netflix Vector Rank Number -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale})">
          ${numberSvgGroup}
        </g>

        <!-- Top-Right Genre Pill -->
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
