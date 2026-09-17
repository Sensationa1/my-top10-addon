const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { Resvg } = require("@resvg/resvg-js");
require("dotenv").config();

const app = express();
app.use(cors());

const SNOAK_MOVIES_URL = "https://mdblist.com/lists/snoak/trending-movies/json";
const SNOAK_SHOWS_URL = "https://mdblist.com/lists/snoak/trakt-s-trending-shows/json";
const SNOAK_SHOWS_ALT_URL = "https://mdblist.com/lists/snoak/most-popular-shows-on-rotten-tomatoes/json";

const POSTER_CACHE_VERSION = "120";

const FONT_BLACK = path.join(process.cwd(), "fonts", "InterDisplay-Black.ttf");
const FONT_SEMI = path.join(process.cwd(), "fonts", "Inter-SemiBold.ttf");
const FONT_SF_MED = path.join(process.cwd(), "fonts", "SFPRODISPLAYMEDIUM.OTF");
const FONT_SF_BOLD = path.join(process.cwd(), "fonts", "SFPRODISPLAYBOLD.OTF");
const FONT_SF_THIN = path.join(process.cwd(), "fonts", "SFPRODISPLAYTHIN.TTF");
const FONT_BLACK_ALT = path.join(__dirname, "..", "fonts", "InterDisplay-Black.ttf");
const FONT_SEMI_ALT = path.join(__dirname, "..", "fonts", "Inter-SemiBold.ttf");
const FONT_SF_MED_ALT = path.join(__dirname, "..", "fonts", "SFPRODISPLAYMEDIUM.OTF");
const FONT_SF_BOLD_ALT = path.join(__dirname, "..", "fonts", "SFPRODISPLAYBOLD.OTF");
const FONT_SF_THIN_ALT = path.join(__dirname, "..", "fonts", "SFPRODISPLAYTHIN.TTF");

function resolveFonts() {
  const black = fs.existsSync(FONT_BLACK) ? FONT_BLACK : FONT_BLACK_ALT;
  const semi = fs.existsSync(FONT_SEMI) ? FONT_SEMI : FONT_SEMI_ALT;
  const sfMed = fs.existsSync(FONT_SF_MED) ? FONT_SF_MED : FONT_SF_MED_ALT;
  const sfBold = fs.existsSync(FONT_SF_BOLD) ? FONT_SF_BOLD : FONT_SF_BOLD_ALT;
  const sfThin = fs.existsSync(FONT_SF_THIN) ? FONT_SF_THIN : FONT_SF_THIN_ALT;
  return { black, semi, sfMed, sfBold, sfThin };
}

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "1.9.7",
  name: "Top 10 Trending (Apple TV Style)",
  description:
    "Top 10 Trending Movies & TV Shows with Apple TV-style ranks and genre labels.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      id: "top10_trending_movies",
      type: "movie",
      name: "Top 10 Trending Movies",
      extraSupported: [],
      posterShape: "landscape",
    },
    {
      id: "top10_trending_shows",
      type: "series",
      name: "Top 10 Trending Shows",
      extraSupported: [],
      posterShape: "landscape",
    },
  ],
  idPrefixes: ["tt"],
};

const GENRE_MAP = {
  28: "ACTION", 12: "ADVENTURE", 16: "ANIMATION", 35: "COMEDY",
  80: "CRIME", 99: "DOCUMENTARY", 18: "DRAMA", 10751: "FAMILY",
  14: "FANTASY", 36: "HISTORY", 27: "HORROR", 10402: "MUSIC",
  9648: "MYSTERY", 10749: "ROMANCE", 878: "SCI-FI", 10770: "TV MOVIE",
  53: "THRILLER", 10752: "WAR", 37: "WESTERN",
  10759: "ACTION", 10762: "KIDS", 10763: "NEWS", 10764: "REALITY",
  10765: "SCI-FI", 10766: "SOAP", 10767: "TALK", 10768: "WAR",
};


// Animation genre id on TMDB = 16. Also catch explicit "Anime" labels.
const ANIME_GENRE_IDS = new Set([16]);

function isAnimeItem(item) {
  // TMDB trending objects
  if (Array.isArray(item.genre_ids) && item.genre_ids.some((g) => ANIME_GENRE_IDS.has(g))) {
    return true;
  }
  // MDBList / other payloads
  const genres = item.genres;
  if (Array.isArray(genres)) {
    for (const g of genres) {
      const name = (typeof g === "string" ? g : g && g.name) || "";
      const n = name.toLowerCase();
      if (n.includes("anime") || n === "animation") return true;
    }
  } else if (typeof genres === "string") {
    const n = genres.toLowerCase();
    if (n.includes("anime") || n.includes("animation")) return true;
  }
  // Title heuristics (optional light filter)
  const title = (item.title || item.name || "").toLowerCase();
  if (/\banime\b/.test(title)) return true;
  return false;
}

function getHostUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

/**
 * Overlay matched to Apple TV Top 10 reference:
 * - Large clean white rank, top-left
 * - Soft shadow only (no heavy stroke)
 * - Genre as small frosted pill, bottom-center
 */
function buildOverlaySvg(width, height, rank, genre) {
  // ===== RANK — DO NOT CHANGE =====
  const fontSize = Math.round(height * 0.40);
  const xPos = Math.round(width * 0.022);
  const yPos = Math.round(height * 0.055 + fontSize * 0.82);
  const tracking = String(rank).length > 1 ? "-0.06em" : "0";

  // ===== GENRE =====
  const genreLabel = (genre || "")
    .toLowerCase()
    .split(/[\s\-]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");
  const badgeFont = Math.max(22, Math.round(height * 0.076));
  const badgeCx = Math.round(width / 2);
  // Raised slightly off the bottom edge (was 5.5% → ~9%)
  const badgeCy = height - Math.round(height * 0.09);

  // Faint bottom bar (~24% of poster; slightly stronger than before)
  const bottomBarH = Math.round(height * 0.24);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metal" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="35%" stop-color="#E8EEF4"/>
      <stop offset="70%" stop-color="#C5D0DC"/>
      <stop offset="100%" stop-color="#9AA8B8"/>
    </linearGradient>
    <linearGradient id="vig" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.50"/>
      <stop offset="40%" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <!-- Apple TV–style faint bottom fade (slightly stronger) -->
    <linearGradient id="bottomFade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="25%" stop-color="#000000" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.60"/>
    </linearGradient>
    <filter id="rankShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="3" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.50"/>
      <feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.25"/>
    </filter>
    <filter id="genreShadow" x="-40%" y="-60%" width="180%" height="220%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.70"/>
      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>

  <!-- Left vignette for rank contrast -->
  <rect width="${Math.round(width * 0.48)}" height="${height}" fill="url(#vig)"/>

  <!-- Rank (unchanged) -->
  <text
    x="${xPos}"
    y="${yPos}"
    font-family="Inter Display"
    font-weight="900"
    font-size="${fontSize}"
    fill="url(#metal)"
    letter-spacing="${tracking}"
    filter="url(#rankShadow)"
  >${rank}</text>

  <!-- Very faint black bar over bottom of poster -->
  <rect
    x="0"
    y="${height - bottomBarH}"
    width="${width}"
    height="${bottomBarH}"
    fill="url(#bottomFade)"
  />

  <!-- Genre: SF Pro Display Thin + soft shadow -->
  <text
    x="${badgeCx}"
    y="${badgeCy}"
    font-family="SF Pro Display"
    font-weight="100"
    font-size="${badgeFont}"
    fill="rgba(255,255,255,0.95)"
    text-anchor="middle"
    dominant-baseline="middle"
    filter="url(#genreShadow)"
  >${genreLabel}</text>
</svg>`;
}

function renderSvgToPng(svgString, width) {
  const { black, semi, sfMed, sfBold, sfThin } = resolveFonts();
  // Prefer Thin for genre labels; keep Medium/Bold as fallbacks
  const files = [black, semi, sfThin, sfMed, sfBold].filter((p) => fs.existsSync(p));
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: files,
      loadSystemFonts: false,
      // Prefer SF Pro Display when requested in SVG; Inter remains fallback for ranks
      defaultFontFamily: "SF Pro Display",
    },
  });
  return resvg.render().asPng();
}

async function getTmdbData(imdbId, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey || !imdbId || !imdbId.startsWith("tt")) {
    return { backdropUrl: null, genre: null };
  }
  try {
    const findRes = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
      params: { api_key: apiKey, external_source: "imdb_id" },
      timeout: 4500,
    });
    const isSeries = type === "series";
    const results = isSeries ? findRes.data.tv_results : findRes.data.movie_results;
    const match = results && results[0];
    if (!match) return { backdropUrl: null, genre: null };

    const backdropUrl = match.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
      : null;

    let genre = null;
    if (Array.isArray(match.genre_ids) && match.genre_ids.length) {
      genre = GENRE_MAP[match.genre_ids[0]] || null;
    }
    if (!genre && match.id) {
      try {
        const p = isSeries ? `tv/${match.id}` : `movie/${match.id}`;
        const det = await axios.get(`https://api.themoviedb.org/3/${p}`, {
          params: { api_key: apiKey },
          timeout: 4000,
        });
        if (det.data.genres && det.data.genres[0]) {
          genre = det.data.genres[0].name.toUpperCase();
        }
      } catch (_) {}
    }
    return { backdropUrl, genre };
  } catch (err) {
    console.error(`TMDB ${imdbId}:`, err.message);
    return { backdropUrl: null, genre: null };
  }
}

async function fetchTrendingList(type) {
  let raw = [];
  const apiKey = process.env.TMDB_API_KEY;

  if (type === "movie") {
    try {
      const res = await axios.get(SNOAK_MOVIES_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) raw = res.data;
    } catch (_) {}
    if (!raw.length && apiKey) {
      const r = await axios.get(`https://api.themoviedb.org/3/trending/movie/day`, {
        params: { api_key: apiKey }, timeout: 5000,
      });
      raw = r.data.results || [];
    }
  } else {
    try {
      const res = await axios.get(SNOAK_SHOWS_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) raw = res.data;
    } catch (_) {
      try {
        const res = await axios.get(SNOAK_SHOWS_ALT_URL, { timeout: 6000 });
        if (Array.isArray(res.data)) raw = res.data;
      } catch (_) {}
    }
    if (!raw.length && apiKey) {
      const r = await axios.get(`https://api.themoviedb.org/3/trending/tv/day`, {
        params: { api_key: apiKey }, timeout: 5000,
      });
      raw = r.data.results || [];
    }
  }
  return raw;
}

app.get("/", (req, res) => {
  const hostUrl = getHostUrl(req);
  res.send(`<!DOCTYPE html><html><head><title>Top 10 Trending</title></head>
<body style="font-family:system-ui;text-align:center;padding:50px;background:#0f0f12;color:#fff">
<h1>Top 10 Trending Addon</h1>
<p>Apple TV-style ranks + genre badges</p>
<a href="stremio://${req.headers.host}/manifest.json"
   style="background:#e50914;color:#fff;padding:14px 28px;text-decoration:none;font-size:18px;font-weight:700;border-radius:6px;display:inline-block;margin-top:20px">
Install in Stremio</a>
<p style="margin-top:20px;font-size:13px;color:#888">Manifest: ${hostUrl}/manifest.json</p>
</body></html>`);
});

app.get("/manifest.json", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "max-age=86400, public");
  res.json(MANIFEST);
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const { type } = req.params;
  const hostUrl = getHostUrl(req);
  if (type !== "movie" && type !== "series") return res.json({ metas: [] });

  try {
    const raw = await fetchTrendingList(type);
    const filtered = raw.filter((item) => !isAnimeItem(item));
    const metas = filtered.slice(0, 10).map((item, i) => {
      const imdbId = item.imdb_id || item.imdbid || (item.external_ids && item.external_ids.imdb_id);
      const tmdbId = item.id || item.tmdb_id || item.tmdbid;
      const idToUse = imdbId || (tmdbId ? `tmdb:${tmdbId}` : null);
      if (!idToUse) return null;
      const title = item.title || item.name || "Unknown";
      const rank = i + 1;
      return {
        id: idToUse,
        type,
        name: `${rank}. ${title}`,
        poster: `${hostUrl}/api/poster?id=${encodeURIComponent(imdbId || idToUse)}&rank=${rank}&type=${type}&v=${POSTER_CACHE_VERSION}`,
        posterShape: "landscape",
        description: item.description || item.overview || "",
      };
    }).filter(Boolean);

    res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800");
    res.json({ metas });
  } catch (err) {
    console.error(`Catalog (${type}):`, err.message);
    res.json({ metas: [] });
  }
});

app.get("/api/poster", async (req, res) => {
  const { id, rank, type } = req.query;
  if (!id) return res.status(400).send("Missing ID");

  try {
    let backdropBuffer = null;
    const cleanImdb = id.startsWith("tt") ? id : null;
    let genre = null;

    if (cleanImdb) {
      try {
        const r = await axios.get(
          `https://extendedratings.com/backdrop/${cleanImdb}?config=russel&key=Kolkko11&v=fd3ce853`,
          { responseType: "arraybuffer", timeout: 4500 }
        );
        backdropBuffer = Buffer.from(r.data);
      } catch (_) {}
    }

    const tmdb = await getTmdbData(cleanImdb, type || "movie");
    if (tmdb.genre) genre = tmdb.genre;

    if (!backdropBuffer && tmdb.backdropUrl) {
      try {
        const r = await axios.get(tmdb.backdropUrl, {
          responseType: "arraybuffer", timeout: 4500,
        });
        backdropBuffer = Buffer.from(r.data);
      } catch (_) {}
    }

    if (!backdropBuffer) {
      backdropBuffer = await sharp({
        create: { width: 1280, height: 720, channels: 3, background: { r: 18, g: 18, b: 24 } },
      }).jpeg().toBuffer();
    }

    const meta = await sharp(backdropBuffer).metadata();
    const W = meta.width || 1280;
    const H = meta.height || 720;
    if (!genre) genre = type === "series" ? "SERIES" : "MOVIE";

    const num = parseInt(rank, 10) || 1;
    const svg = buildOverlaySvg(W, H, num, genre);
    const overlayPng = renderSvgToPng(svg, W);

    const out = await sharp(backdropBuffer)
      .composite([{ input: overlayPng, top: 0, left: 0 }])
      .jpeg({ quality: 91 })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return res.send(out);
  } catch (err) {
    console.error("Poster error:", err.message, err.stack);
    return res.status(500).send("Error rendering poster");
  }
});

module.exports = app;
