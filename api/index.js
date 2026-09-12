const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sharp = require("sharp");
require("dotenv").config();

const app = express();
app.use(cors());

const MANIFEST = {
  id: "com.sensationa1.top10.trakt",
  version: "1.0.0",
  name: "Top 10 Trakt Trending",
  description: "Top 10 Trakt Trending Movies & Shows with Apple TV style numbers on ExtendedRatings landscape posters.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      id: "trakt_top10_movies",
      type: "movie",
      name: "Top 10 Trakt Trending Movies",
      extraSupported: [],
      posterShape: "landscape"
    },
    {
      id: "trakt_top10_shows",
      type: "series",
      name: "Top 10 Trakt Trending Shows",
      extraSupported: [],
      posterShape: "landscape"
    }
  ],
  idPrefixes: ["tt"]
};

// Landing page / Redirect to Stremio
app.get("/", (req, res) => {
  const host = `${req.protocol}://${req.get("host")}`;
  res.send(`
    <html>
      <head><title>Top 10 Trakt Trending Addon</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #121212; color: #fff;">
        <h1>Top 10 Trakt Trending Addon</h1>
        <p>Landscape posters with embedded Apple TV style numbers & genre tags.</p>
        <a href="stremio://${req.get("host")}/manifest.json" style="background: #e50914; color: white; padding: 12px 24px; text-decoration: none; font-size: 18px; border-radius: 5px; display: inline-block; margin-top: 20px;">Install in Stremio</a>
        <p style="margin-top: 15px; font-size: 12px; color: #aaa;">Manifest URL: ${host}/manifest.json</p>
      </body>
    </html>
  `);
});

// Stremio Addon Manifest
app.get("/manifest.json", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.json(MANIFEST);
});

// Helper function to fetch Trakt trending list
async function fetchTraktTrending(mediaType) {
  const apiKey = process.env.TRAKT_CLIENT_ID || "3a2a4b8df4838db99cbce24db49b18361b7fbb978d3eb663ff9e3b432a5dfb0a";
  const url = `https://api.trakt.tv/${mediaType}/trending?limit=10&extended=full`;

  const response = await axios.get(url, {
    headers: {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": apiKey
    },
    timeout: 8000
  });

  return response.data || [];
}

// Catalog Endpoint
app.get("/catalog/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const { type, id } = req.params;
  const host = `${req.protocol}://${req.get("host")}`;

  try {
    let items = [];
    if (id === "trakt_top10_movies" && type === "movie") {
      items = await fetchTraktTrending("movies");
    } else if (id === "trakt_top10_shows" && type === "series") {
      items = await fetchTraktTrending("shows");
    }

    const metas = items.slice(0, 10).map((item, index) => {
      const media = item.movie || item.show;
      const imdbId = media?.ids?.imdb;
      const title = media?.title || "Unknown";
      const rank = index + 1;
      const genres = Array.isArray(media?.genres) ? media.genres.slice(0, 2).join(",") : "";

      const posterUrl = `${host}/api/poster?id=${imdbId}&rank=${rank}&genres=${encodeURIComponent(genres)}`;

      return {
        id: imdbId,
        type: type,
        name: `${rank}. ${title}`,
        poster: posterUrl,
        posterShape: "landscape",
        description: media?.overview || ""
      };
    });

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({ metas });
  } catch (err) {
    console.error("Error serving catalog:", err.message);
    res.json({ metas: [] });
  }
});

// Dynamic Landscape Poster Generator
app.get("/api/poster", async (req, res) => {
  const { id, rank, genres } = req.query;

  if (!id) {
    return res.status(400).send("Missing IMDb ID parameter");
  }

  try {
    const backdropUrl = `https://extendedratings.com/backdrop/${id}?config=russel&key=Kolkko11&v=fd3ce853`;

    let backdropBuffer;
    try {
      const response = await axios.get(backdropUrl, {
        responseType: "arraybuffer",
        timeout: 6000
      });
      backdropBuffer = Buffer.from(response.data);
    } catch (e) {
      // Dark fallback backdrop canvas if main backdrop fetch fails
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

    // Composite Apple TV style numbers and Genre tag pill onto backdrop
    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bottomShadow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000000" stop-opacity="0" />
            <stop offset="50%" stop-color="#000000" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.85" />
          </linearGradient>
          <linearGradient id="leftShadow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.8" />
            <stop offset="40%" stop-color="#000000" stop-opacity="0.2" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="numberGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#FFFFFF" />
            <stop offset="100%" stop-color="#CCCCCC" />
          </linearGradient>
          <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="4" dy="6" stdDeviation="6" flood-color="#000000" flood-opacity="0.9"/>
          </filter>
        </defs>

        <!-- Gradient Scrims for Legibility -->
        <rect width="${width}" height="${height}" fill="url(#leftShadow)" />
        <rect width="${width}" height="${height}" fill="url(#bottomShadow)" />

        <!-- Apple TV Style Embedded Rank Number -->
        <g filter="url(#dropShadow)">
          <text 
            x="${Math.round(width * 0.04)}" 
            y="${Math.round(height * 0.92)}" 
            font-family="system-ui, -apple-system, 'SF Pro Display', Arial, sans-serif" 
            font-size="${Math.round(height * 0.55)}" 
            font-weight="900" 
            fill="url(#numberGradient)" 
            stroke="rgba(255,255,255,0.3)" 
            stroke-width="2">
            ${rank || "1"}
          </text>
        </g>

        <!-- Genre Tag Pill -->
        ${
          formattedGenres
            ? `
        <g transform="translate(${Math.round(width * 0.04)}, ${Math.round(height * 0.06)})" filter="url(#dropShadow)">
          <rect 
            rx="${Math.round(height * 0.025)}" 
            ry="${Math.round(height * 0.025)}" 
            width="${Math.max(120, formattedGenres.length * 12 + 32)}" 
            height="${Math.round(height * 0.06)}" 
            fill="rgba(0, 0, 0, 0.72)" 
            stroke="rgba(255, 255, 255, 0.3)" 
            stroke-width="1.5"
          />
          <text 
            x="${Math.round((Math.max(120, formattedGenres.length * 12 + 32)) / 2)}" 
            y="${Math.round(height * 0.041)}" 
            font-family="system-ui, -apple-system, Arial, sans-serif" 
            font-size="${Math.round(height * 0.028)}" 
            font-weight="800" 
            fill="#FFFFFF" 
            text-anchor="middle" 
            letter-spacing="1">
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
    console.error("Poster Generation Error:", err);
    return res.status(500).send("Error generating poster");
  }
});

const PORT = process.env.PORT || 7000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

module.exports = app;
