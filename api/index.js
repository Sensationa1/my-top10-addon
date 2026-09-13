const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sharp = require("sharp");
require("dotenv").config();

const app = express();
app.use(cors());

const SNOAK_MOVIES_URL = "https://mdblist.com/lists/snoak/trending-movies/json";
const SNOAK_SHOWS_URL = "https://mdblist.com/lists/snoak/trakt-s-trending-shows/json";
const SNOAK_SHOWS_ALT_URL = "https://mdblist.com/lists/snoak/most-popular-shows-on-rotten-tomatoes/json";

const POSTER_CACHE_VERSION = "70";

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "1.3.0",
  name: "Top 10 Trending (Apple TV Style)",
  description:
    "Top 10 Trending Movies & TV Shows with cinematic Apple TV-style rank numbers and frosted genre badges on landscape posters.",
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

function getHostUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

// Bold digit paths (unit box ~ 80 × 120) — no fonts
const DW = 80;
const DH = 120;

const DIGITS = {
  "0": {
    outer: "M40 6C18 6 6 26 6 60C6 94 18 114 40 114C62 114 74 94 74 60C74 26 62 6 40 6Z",
    hole:  "M40 22C52 22 58 34 58 60C58 86 52 98 40 98C28 98 22 86 22 60C22 34 28 22 40 22Z",
  },
  "1": {
    outer: "M48 8L48 104H64V114H16V104H32V28L18 36V20L48 8Z",
  },
  "2": {
    outer: "M10 36C10 18 24 8 42 8C60 8 72 20 72 38C72 54 62 64 46 76L26 92V104H70V114H10V88L42 62C54 52 58 46 58 38C58 28 52 22 42 22C32 22 26 28 26 36H10Z",
  },
  "3": {
    outer: "M14 24C18 14 28 8 42 8C58 8 72 20 72 38C72 50 64 58 52 62C66 66 76 76 76 92C76 110 60 114 42 114C24 114 12 104 8 90L24 84C26 94 34 100 42 100C54 100 60 92 60 84C60 74 52 68 40 68H30V56H42C52 56 58 50 58 40C58 30 52 22 42 22C32 22 26 28 24 36L14 30Z",
  },
  "4": {
    outer: "M52 8L52 76H72V90H52V114H36V90H8V74L36 8H52ZM36 76V30L16 76H36Z",
  },
  "5": {
    outer: "M66 8H16L12 70H42C56 70 66 80 66 94C66 108 56 114 42 114C28 114 18 106 16 94L32 88C34 96 38 100 42 100C48 100 52 96 52 90C52 84 48 80 42 80H10L16 8H66Z",
  },
  "6": {
    outer: "M42 6C22 6 8 26 8 60C8 94 22 114 44 114C64 114 76 100 76 82C76 64 64 54 48 54H34C32 46 30 38 30 32C30 22 36 16 44 16C52 16 58 22 60 30L76 24C72 10 60 6 42 6Z",
    hole:  "M44 68C54 68 60 76 60 86C60 96 54 102 44 102C34 102 28 96 28 86C28 76 34 68 44 68Z",
  },
  "7": {
    outer: "M10 8H70V26L36 114H18L50 26H10V8Z",
  },
  "8": {
    outer: "M40 6C22 6 10 18 10 34C10 46 18 56 30 60C16 64 6 76 6 92C6 110 20 114 40 114C60 114 74 110 74 92C74 76 64 64 50 60C62 56 70 46 70 34C70 18 58 6 40 6Z",
    hole1: "M40 18C50 18 56 24 56 34C56 44 50 50 40 50C30 50 24 44 24 34C24 24 30 18 40 18Z",
    hole2: "M40 72C52 72 58 80 58 90C58 100 52 106 40 106C28 106 22 100 22 90C22 80 28 72 40 72Z",
  },
  "9": {
    outer: "M40 6C20 6 8 22 8 42C8 60 20 72 38 72H50C52 80 54 88 54 96C54 106 48 110 40 110C32 110 28 104 26 96L10 102C14 114 26 118 40 118C60 118 74 102 74 60C74 22 60 6 40 6Z",
    hole:  "M40 18C50 18 56 26 56 40C56 54 50 60 40 60C30 60 24 54 24 40C24 26 30 18 40 18Z",
  },
};

function generateRankGroup(rank) {
  const r = String(rank);
  const isTen = r === "10";
  const gap = isTen ? DW * 0.38 : DW * 0.10;

  let x = 0;
  const parts = [];

  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    const d = DIGITS[ch] || DIGITS["1"];

    let combined = d.outer || "";
    if (d.hole) combined += " " + d.hole;
    if (d.hole1) combined += " " + d.hole1;
    if (d.hole2) combined += " " + d.hole2;

    // shadow
    parts.push(
      `<path transform="translate(${x + 8},${10})" d="${combined}" fill="#000000" fill-rule="evenodd" opacity="0.50"/>`
    );
    // white outline
    parts.push(
      `<path transform="translate(${x},0)" d="${combined}" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" fill-rule="evenodd"/>`
    );
    // metallic fill
    parts.push(
      `<path transform="translate(${x},0)" d="${combined}" fill="url(#metal)" fill-rule="evenodd"/>`
    );

    const adv = ch === "1" ? DW * 0.58 : DW;
    x += adv + gap;
  }

  return { width: x, height: DH, markup: parts.join("\n") };
}

// 7×9 bitmap font for genre (no system fonts needed)
const FONT = {
  A: ["01110","10001","10001","11111","10001","10001","10001","10001","00000"],
  B: ["11110","10001","10001","11110","10001","10001","10001","11110","00000"],
  C: ["01111","10000","10000","10000","10000","10000","10000","01111","00000"],
  D: ["11110","10001","10001","10001","10001","10001","10001","11110","00000"],
  E: ["11111","10000","10000","11110","10000","10000","10000","11111","00000"],
  F: ["11111","10000","10000","11110","10000","10000","10000","10000","00000"],
  G: ["01111","10000","10000","10000","10011","10001","10001","01111","00000"],
  H: ["10001","10001","10001","11111","10001","10001","10001","10001","00000"],
  I: ["11111","00100","00100","00100","00100","00100","00100","11111","00000"],
  J: ["00111","00010","00010","00010","00010","00010","10010","01100","00000"],
  K: ["10001","10010","10100","11000","10100","10010","10001","10001","00000"],
  L: ["10000","10000","10000","10000","10000","10000","10000","11111","00000"],
  M: ["10001","11011","10101","10001","10001","10001","10001","10001","00000"],
  N: ["10001","11001","10101","10011","10001","10001","10001","10001","00000"],
  O: ["01110","10001","10001","10001","10001","10001","10001","01110","00000"],
  P: ["11110","10001","10001","11110","10000","10000","10000","10000","00000"],
  Q: ["01110","10001","10001","10001","10001","10101","10010","01101","00000"],
  R: ["11110","10001","10001","11110","10100","10010","10001","10001","00000"],
  S: ["01111","10000","10000","01110","00001","00001","00001","11110","00000"],
  T: ["11111","00100","00100","00100","00100","00100","00100","00100","00000"],
  U: ["10001","10001","10001","10001","10001","10001","10001","01110","00000"],
  V: ["10001","10001","10001","10001","10001","10001","01010","00100","00000"],
  W: ["10001","10001","10001","10001","10001","10101","11011","10001","00000"],
  X: ["10001","10001","01010","00100","00100","01010","10001","10001","00000"],
  Y: ["10001","10001","01010","00100","00100","00100","00100","00100","00000"],
  Z: ["11111","00001","00010","00100","01000","10000","10000","11111","00000"],
  "-":["00000","00000","00000","11111","00000","00000","00000","00000","00000"],
  " ":["00000","00000","00000","00000","00000","00000","00000","00000","00000"],
  "&":["01100","10010","10100","01000","10101","10010","10010","01101","00000"],
};

function renderBitmapText(text, px) {
  let x = 0;
  const gap = Math.max(1, Math.round(px * 0.35));
  let rects = "";
  for (const raw of text.toUpperCase()) {
    const rows = FONT[raw] || FONT[" "];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < 5; c++) {
        if (rows[r][c] === "1") {
          rects += `<rect x="${x + c * px}" y="${r * px}" width="${px}" height="${px}" fill="#fff"/>`;
        }
      }
    }
    x += 5 * px + gap;
  }
  return { w: Math.max(0, x - gap), h: 9 * px, rects };
}

function generateGenreBadge(genre, W, H) {
  if (!genre) return "";
  const px = Math.max(3, Math.round(H * 0.0085));
  const { w: tw, h: th, rects } = renderBitmapText(genre, px);
  const padX = Math.round(px * 3.2);
  const padY = Math.round(px * 2.2);
  const bw = tw + padX * 2;
  const bh = th + padY * 2;
  const rx = Math.round(bh / 2);
  const cx = Math.round(W / 2);
  const cy = H - Math.round(H * 0.075);
  const bx = cx - Math.round(bw / 2);
  const by = cy - Math.round(bh / 2);

  return `
    <rect x="${bx + 3}" y="${by + 4}" width="${bw}" height="${bh}" rx="${rx}" ry="${rx}" fill="#000" opacity="0.4"/>
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${rx}" ry="${rx}"
          fill="rgba(22,22,28,0.82)" stroke="rgba(255,255,255,0.42)" stroke-width="1.5"/>
    <g transform="translate(${bx + padX},${by + padY})">${rects}</g>
  `;
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
        const path = isSeries ? `tv/${match.id}` : `movie/${match.id}`;
        const det = await axios.get(`https://api.themoviedb.org/3/${path}`, {
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
<p>Apple TV-style metallic ranks + frosted genre badges</p>
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
    const metas = raw.slice(0, 10).map((item, i) => {
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
    const rankGroup = generateRankGroup(num);

    const scale = (H * 0.34) / DH;
    const xPos = Math.round(W * 0.028);
    const yPos = Math.round(H * 0.045);
    const badge = generateGenreBadge(genre, W, H);

    const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metal" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="35%" stop-color="#F1F5F9"/>
      <stop offset="70%" stop-color="#CBD5E1"/>
      <stop offset="100%" stop-color="#94A3B8"/>
    </linearGradient>
    <linearGradient id="vig" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#000" stop-opacity="0.78"/>
      <stop offset="45%" stop-color="#000" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${Math.round(W * 0.55)}" height="${H}" fill="url(#vig)"/>

  <g transform="translate(${xPos},${yPos}) scale(${scale.toFixed(5)})">
    ${rankGroup.markup}
  </g>

  ${badge}
</svg>`);

    const out = await sharp(backdropBuffer)
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 91 })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return res.send(out);
  } catch (err) {
    console.error("Poster error:", err.message);
    return res.status(500).send("Error rendering poster");
  }
});

module.exports = app;
