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

const POSTER_CACHE_VERSION = "244";

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
  version: "2.4.4",
  name: "Top 10 Trending (Apple TV Style)",
  description:
    "Top 10 from Trakt/MDBList with Pictorium portraits, adaptive ranks, SF Pro genre · IMDb.",
  resources: ["catalog"],
  types: ["series", "movie"],
  catalogs: [
    {
      id: "top10_trending_shows",
      type: "series",
      name: "Top 10 Trending Shows",
      extraSupported: [],
      posterShape: "poster",
    },
    {
      id: "top10_trending_movies",
      type: "movie",
      name: "Top 10 Trending Movies",
      extraSupported: [],
      posterShape: "poster",
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


// TMDB Animation = 16. Paired with Japanese language so Pixar/Disney stay.
const TMDB_ANIMATION_ID = 16;

// MDBList JSON has almost no genre/lang — catch common anime titles by name.
const ANIME_TITLE_RE =
  /\b(anime|one piece|naruto|boruto|demon slayer|kimetsu|jujutsu kaisen|attack on titan|shingeki|clevatess|solo leveling|frieren|bleach|dragon ball|chainsaw man|spy x family|my hero academia|boku no hero|hunter x hunter|tokyo ghoul|death note|evangelion|studio ghibli|ghibli|pokemon|pokémon|digimon|sailor moon|inuyasha|fullmetal|haikyuu|black clover|one punch|mob psycho|vinland saga|dandadan|kaiju no\.?\s*8|blue lock|oshi no ko)\b/i;

function isAnimeItem(item) {
  if (!item || typeof item !== "object") return false;

  const mediaType = String(item.mediatype || item.media_type || item.type || "").toLowerCase();
  if (mediaType === "anime") return true;

  const title = String(item.title || item.name || "");
  const overview = String(item.description || item.overview || item.plot || "");
  if (ANIME_TITLE_RE.test(title) || ANIME_TITLE_RE.test(overview)) return true;
  if (/\banime\b/i.test(title) || /\banime\b/i.test(overview)) return true;

  const genreNames = [];
  if (Array.isArray(item.genres)) {
    for (const g of item.genres) {
      genreNames.push(String(typeof g === "string" ? g : (g && g.name) || "").toLowerCase());
    }
  } else if (typeof item.genres === "string") {
    genreNames.push(item.genres.toLowerCase());
  }
  if (genreNames.some((n) => n.includes("anime"))) return true;

  const lang = String(
    item.original_language || item.language || item.origlang || ""
  ).toLowerCase();
  const isJapanese = lang === "ja" || lang === "jp" || lang.startsWith("ja-");
  const hasAnimId =
    Array.isArray(item.genre_ids) && item.genre_ids.some((g) => Number(g) === TMDB_ANIMATION_ID);
  const hasAnimName = genreNames.some((n) => n.includes("animation") || n.includes("animaatio"));
  if (isJapanese && (hasAnimId || hasAnimName)) return true;

  return false;
}

/** TMDB lookup — MDBList items lack genre/language fields */
async function isAnimeViaTmdb(item, type) {
  if (isAnimeItem(item)) return true;
  const apiKey = process.env.TMDB_API_KEY;
  const imdbId = item.imdb_id || item.imdbid || (item.external_ids && item.external_ids.imdb_id);
  if (!apiKey || !imdbId || !String(imdbId).startsWith("tt")) return false;
  try {
    const findRes = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
      params: { api_key: apiKey, external_source: "imdb_id" },
      timeout: 4000,
    });
    const isSeries = type === "series";
    const match =
      (isSeries ? findRes.data.tv_results : findRes.data.movie_results) &&
      (isSeries ? findRes.data.tv_results : findRes.data.movie_results)[0];
    if (!match) return false;
    const lang = String(match.original_language || "").toLowerCase();
    const isJapanese = lang === "ja" || lang === "jp";
    const hasAnim =
      Array.isArray(match.genre_ids) && match.genre_ids.some((g) => Number(g) === TMDB_ANIMATION_ID);
    if (isJapanese && hasAnim) return true;
    if (ANIME_TITLE_RE.test(String(match.name || match.title || ""))) return true;
    return false;
  } catch (_) {
    return false;
  }
}

// TV genres to exclude: News, Kids, Talk. Animation+JA = anime.
const EXCLUDE_TV_GENRES = new Set([10763, 10762, 10767]); // news, kids, talk
const FAMILY_GENRE = 10751;

// Always drop Chinese / regional Chinese variants
const BLOCKED_LANGS = new Set([
  "zh", "cn", "zh-cn", "zh-tw", "zh-hk", "yue", "cmn", "zh-hans", "zh-hant",
]);

// Languages treated as mainstream / widely known for this catalog
const KNOWN_LANGS = new Set([
  "en", "fi", "sv", "no", "da", "de", "fr", "es", "it", "pt",
  "ko", "ja", "nl", "pl", "tr", "hi", "ru", "uk",
]);

function normalizeLang(code) {
  return String(code || "").toLowerCase().trim().split(/[-_]/)[0];
}

function isObscureInternational(item) {
  const raw = String(item.original_language || "").toLowerCase().trim();
  const lang = normalizeLang(raw);
  if (!lang) return false;

  // Chinese always out
  if (BLOCKED_LANGS.has(raw) || BLOCKED_LANGS.has(lang) || lang === "zh") return true;

  // English and other known languages stay
  if (KNOWN_LANGS.has(lang)) return false;

  // Unknown language: only keep if clearly popular / well-rated on TMDB
  const votes = Number(item.vote_count || 0);
  const popularity = Number(item.popularity || 0);
  if (votes >= 800 || popularity >= 80) return false;
  return true;
}

function shouldExcludeTrendingItem(item, type) {
  if (!item) return true;
  if (isAnimeItem(item)) return true;
  if (isObscureInternational(item)) return true;

  const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids.map(Number) : [];
  const isSeries = type === "series";

  if (isSeries) {
    if (genreIds.some((g) => EXCLUDE_TV_GENRES.has(g))) return true;
    // Kids animation / pure kids cartoons
    if (genreIds.includes(TMDB_ANIMATION_ID) && (genreIds.includes(10762) || genreIds.includes(FAMILY_GENRE))) {
      return true;
    }
  }

  // Anime: Japanese + Animation
  const lang = normalizeLang(item.original_language);
  const isJapanese = lang === "ja" || lang === "jp";
  if (isJapanese && genreIds.includes(TMDB_ANIMATION_ID)) return true;
  if (ANIME_TITLE_RE.test(String(item.title || item.name || ""))) return true;

  return false;
}

async function enrichItemFromTmdb(item, type) {
  // MDBList often has no language/genres — pull from TMDB so filters work
  if (item.original_language && Array.isArray(item.genre_ids) && item.genre_ids.length) {
    return item;
  }
  const apiKey = process.env.TMDB_API_KEY;
  const imdbId = item.imdb_id || item.imdbid || (item.external_ids && item.external_ids.imdb_id);
  if (!apiKey || !imdbId || !String(imdbId).startsWith("tt")) return item;
  try {
    const findRes = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
      params: { api_key: apiKey, external_source: "imdb_id" },
      timeout: 4000,
    });
    const isSeries = type === "series";
    const match =
      (isSeries ? findRes.data.tv_results : findRes.data.movie_results) &&
      (isSeries ? findRes.data.tv_results : findRes.data.movie_results)[0];
    if (!match) return item;
    return {
      ...item,
      original_language: item.original_language || match.original_language,
      genre_ids: (item.genre_ids && item.genre_ids.length) ? item.genre_ids : (match.genre_ids || []),
      vote_count: item.vote_count || match.vote_count,
      popularity: item.popularity || match.popularity,
      title: item.title || match.title || match.name,
      name: item.name || match.name || match.title,
      id: item.tmdb_id || item.tmdbid || match.id || item.id,
      tmdb_id: item.tmdb_id || item.tmdbid || match.id,
    };
  } catch (_) {
    return item;
  }
}

async function filterTrendingList(raw, type, limit = 10) {
  const out = [];
  for (const item of raw) {
    if (out.length >= limit) break;
    const enriched = await enrichItemFromTmdb(item, type);
    if (shouldExcludeTrendingItem(enriched, type)) continue;
    if (await isAnimeViaTmdb(enriched, type)) continue;
    out.push(enriched);
  }
  return out;
}

function resolveDigitPath(rank) {
  const n = Math.min(10, Math.max(1, parseInt(rank, 10) || 1));
  const a = path.join(process.cwd(), "digits", `${n}.png`);
  const b = path.join(__dirname, "..", "digits", `${n}.png`);
  if (fs.existsSync(a)) return a;
  if (fs.existsSync(b)) return b;
  return null;
}

/**
 * Giant frosted rank: pure alpha mask over blurred poster glass.
 * Whole glyph is translucent glass — no solid half / colored digit bleed.
 */
async function loadRankOverlay(targetH, rank, posterBuffer, targetW) {
  const digitPath = resolveDigitPath(rank);
  // Larger + hard left corner
  const digitH = Math.round(targetH * 0.46);
  const left = Math.round(targetW * 0.004);
  const top = Math.round(targetH * 0.004);

  if (!digitPath) return null;

  // Build pure white+alpha mask from digit PNG (strip nebula RGB)
  const maskResized = await sharp(digitPath)
    .resize({ height: digitH, fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();

  const maskMeta = await sharp(maskResized).metadata();
  const dw = maskMeta.width || Math.round(digitH * 0.65);
  const dh = maskMeta.height || digitH;

  // Extract alpha only → solid white glyph with same alpha (uniform glass)
  const { data: raw, info } = await sharp(maskResized)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < raw.length; i += 4) {
    const a = raw[i + 3];
    raw[i] = 255;
    raw[i + 1] = 255;
    raw[i + 2] = 255;
    raw[i + 3] = a;
  }
  const pureMask = await sharp(raw, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  if (!posterBuffer) {
    // Fallback: soft white translucent digit
    const { data: d2, info: i2 } = await sharp(pureMask)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 3; i < d2.length; i += 4) d2[i] = Math.round(d2[i] * 0.55);
    const buf = await sharp(d2, {
      raw: { width: i2.width, height: i2.height, channels: 4 },
    })
      .png()
      .toBuffer();
    return { buf, left, top };
  }

  try {
    const pad = 32;
    const extractLeft = Math.max(0, left - pad);
    const extractTop = Math.max(0, top - pad);
    const extractW = Math.min(targetW - extractLeft, dw + pad * 2);
    const extractH = Math.min(targetH - extractTop, dh + pad * 2);

    // Blurred poster under rank — keep color for real glass
    const region = await sharp(posterBuffer)
      .extract({
        left: extractLeft,
        top: extractTop,
        width: extractW,
        height: extractH,
      })
      .blur(22)
      .modulate({ brightness: 1.4, saturation: 0.9 })
      .ensureAlpha()
      .png()
      .toBuffer();

    // Translucent white glass veil (whole surface before mask)
    const frost = await sharp({
      create: {
        width: extractW,
        height: extractH,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.32 },
      },
    })
      .png()
      .toBuffer();

    const glassPlate = await sharp(region)
      .composite([{ input: frost, blend: "over" }])
      .png()
      .toBuffer();

    // Place pure alpha mask on pad canvas
    const maskOnPad = await sharp({
      create: {
        width: extractW,
        height: extractH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: pureMask,
          left: Math.max(0, left - extractLeft),
          top: Math.max(0, top - extractTop),
        },
      ])
      .png()
      .toBuffer();

    // Clip glass through entire glyph
    let clipped = await sharp(glassPlate)
      .composite([{ input: maskOnPad, blend: "dest-in" }])
      .ensureAlpha()
      .png()
      .toBuffer();

    // Uniform transparency across whole number
    const { data, info: cInfo } = await sharp(clipped)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += 4) {
      data[i] = Math.round(data[i] * 0.72);
    }
    clipped = await sharp(data, {
      raw: { width: cInfo.width, height: cInfo.height, channels: 4 },
    })
      .png()
      .toBuffer();

    return { buf: clipped, left: extractLeft, top: extractTop };
  } catch (e) {
    console.error("Frost rank:", e.message);
    const { data: d2, info: i2 } = await sharp(pureMask)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 3; i < d2.length; i += 4) d2[i] = Math.round(d2[i] * 0.55);
    const buf = await sharp(d2, {
      raw: { width: i2.width, height: i2.height, channels: 4 },
    })
      .png()
      .toBuffer();
    return { buf, left, top };
  }
}

function formatGenreLabel(genre) {
  if (!genre) return null;
  const s = String(genre).trim().toLowerCase();
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildGenreRatingSvg(width, height, genre, rating) {
  const g = formatGenreLabel(genre);
  const label = [g, rating].filter(Boolean).join("  ·  ");
  if (!label) return null;

  // Plain SF Pro Thin text only — no frost pill
  const fontSize = Math.round(height * 0.042);
  const y = Math.round(height * 0.965);
  const x = Math.round(width / 2);
  const safe = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="tshadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <text
    x="${x}"
    y="${y}"
    text-anchor="middle"
    font-family="SF Pro Display"
    font-weight="100"
    font-size="${fontSize}"
    fill="#FFFFFF"
    letter-spacing="0.10em"
    filter="url(#tshadow)"
  >${safe}</text>
</svg>`;
}

function getHostUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

/**
 * Overlay: rank numbers only (no genre label).
 * Metallic fade top→bottom of each digit, light left vignette.
 */
function buildOverlaySvg(width, height, rank) {
  const fontSize = Math.round(height * 0.175);
  const xPos = Math.round(width * 0.055);
  const yPos = Math.round(height * 0.035 + fontSize * 0.82);
  const tracking = String(rank).length > 1 ? "-0.05em" : "0";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0.95"/>
      <stop offset="70%" stop-color="#E2E8F0" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#94A3B8" stop-opacity="0.12"/>
    </linearGradient>
    <linearGradient id="vig" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.36"/>
      <stop offset="45%" stop-color="#000000" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="rankShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.50"/>
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <rect width="${Math.round(width * 0.55)}" height="${height}" fill="url(#vig)"/>

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
</svg>`;
}

function renderSvgToPng(svgString, width) {
  const { black, semi, sfThin } = resolveFonts();
  // Only Black (ranks) + Thin (genre) so weight 100 always hits SF Pro Thin
  const files = [black, sfThin, semi].filter((p) => fs.existsSync(p));
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: files,
      loadSystemFonts: false,
      defaultFontFamily: "SF Pro Display",
    },
  });
  return resvg.render().asPng();
}

function buildPictoriumUrl({ imdbId, tmdbId, type, shape }) {
  const media = type === "series" ? "series" : "movie";
  // Prefer IMDb id (stable); fall back to TMDB numeric id
  const idPart = (imdbId && String(imdbId).startsWith("tt"))
    ? imdbId
    : (tmdbId ? String(tmdbId) : "");
  if (!idPart) return null;

  const params = new URLSearchParams();
  params.set("badges", "0");
  params.set("ranking", "0");
  params.set("by", "0");
  params.set("bq", "0");
  params.set("cr", "0");
  params.set("sepstyle", "bottom-pills");
  params.set("rsrc", "imdb,simkl,anilist,mal,tomatoes,letterboxd");
  params.set("df", "dmy");
  params.set("netLogo", "0");
  params.set("side", "left");
  params.set("layout", "standard");
  params.set("freshScope", "ranked");
  params.set("lang", "en");
  params.set("gradHeight", "30");
  params.set("blur", "40");
  params.set("tint", "20");
  params.set("bf", "50");
  params.set("bd", "30");
  params.set("ts", "60");
  params.set("bs", "shadow");
  params.set("rs", "number");
  params.set("xbs", "default");
  params.set("bfont", "inter");
  params.set("qbs", "color");
  params.set("tscale", "100");
  params.set("tox", "0");
  params.set("toy", "0");
  params.set("exscale", "120");
  params.set("exox", "0");
  params.set("exoy", "0");
  params.set("gscale", "100");
  params.set("gox", "0");
  params.set("goy", "0");
  params.set("qscale", "100");
  params.set("sepscale", "130");
  params.set("sepox", "0");
  params.set("sepoy", "0");
  params.set("qox", "-10");
  params.set("qoy", "15");
  params.set("netscale", "100");
  params.set("nox", "0");
  params.set("noy", "0");
  params.set("rv", "cc6eae9f4a");
  params.set("shape", shape || "poster");
  return `https://pictorium-rctu.vercel.app/api/poster/${media}/${idPart}?${params.toString()}`;
}

async function getTmdbData(imdbId, type, existingTmdbId) {
  const apiKey = process.env.TMDB_API_KEY;
  const empty = { posterUrl: null, backdropUrl: null, logoUrl: null, genre: null, tmdbId: existingTmdbId || null, imdbRating: null };
  if (!apiKey) return empty;

  const isSeries = type === "series";
  try {
    let match = null;
    let tmdbId = existingTmdbId ? Number(existingTmdbId) || existingTmdbId : null;

    if (!tmdbId && imdbId && String(imdbId).startsWith("tt")) {
      const findRes = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
        params: { api_key: apiKey, external_source: "imdb_id" },
        timeout: 4500,
      });
      const results = isSeries ? findRes.data.tv_results : findRes.data.movie_results;
      match = results && results[0];
      if (match) tmdbId = match.id;
    }

    if (!tmdbId) return empty;

    const pathType = isSeries ? `tv/${tmdbId}` : `movie/${tmdbId}`;
    let det = null;
    try {
      const detRes = await axios.get(`https://api.themoviedb.org/3/${pathType}`, {
        params: {
          api_key: apiKey,
          append_to_response: "images",
          include_image_language: "fi,en,null",
        },
        timeout: 5000,
      });
      det = detRes.data;
    } catch (_) {}

    const posterPath = (det && det.poster_path) || (match && match.poster_path);
    const backdropPath = (det && det.backdrop_path) || (match && match.backdrop_path);
    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w780${posterPath}` : null;
    // Landscape / detail background
    const backdropUrl = backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : null;

    // Prefer FI logo, then EN, then any
    let logoUrl = null;
    const logos = det && det.images && Array.isArray(det.images.logos) ? det.images.logos : [];
    if (logos.length) {
      const preferred =
        logos.find((l) => l.iso_639_1 === "fi") ||
        logos.find((l) => l.iso_639_1 === "en") ||
        logos.find((l) => !l.iso_639_1) ||
        logos[0];
      if (preferred && preferred.file_path) {
        logoUrl = `https://image.tmdb.org/t/p/w500${preferred.file_path}`;
      }
    }

    let genre = null;
    if (det && Array.isArray(det.genres) && det.genres[0]) {
      genre = String(det.genres[0].name || "").toUpperCase();
    } else if (match && Array.isArray(match.genre_ids) && match.genre_ids.length) {
      genre = GENRE_MAP[match.genre_ids[0]] || null;
    }

    // Prefer real IMDb rating via OMDb when key present; else TMDB vote
    let imdbRating = null;
    const tt = imdbId && String(imdbId).startsWith("tt") ? imdbId : null;
    if (tt && process.env.OMDB_API_KEY) {
      try {
        const o = await axios.get("https://www.omdbapi.com/", {
          params: { i: tt, apikey: process.env.OMDB_API_KEY },
          timeout: 3500,
        });
        if (o.data && o.data.imdbRating && o.data.imdbRating !== "N/A") {
          imdbRating = o.data.imdbRating;
        }
      } catch (_) {}
    }
    if (!imdbRating && det && det.vote_average != null && Number(det.vote_average) > 0) {
      imdbRating = Number(det.vote_average).toFixed(1);
    }

    return { posterUrl, backdropUrl, logoUrl, genre, tmdbId, imdbRating };
  } catch (err) {
    console.error(`TMDB ${imdbId || existingTmdbId}:`, err.message);
    return empty;
  }
}

async function fetchTrendingList(type) {
  let raw = [];
  const apiKey = process.env.TMDB_API_KEY;

  // Primary: Snoak Trakt / MDBList (fewer unreleased junk titles)
  if (type === "movie") {
    try {
      const res = await axios.get(SNOAK_MOVIES_URL, { timeout: 8000 });
      if (Array.isArray(res.data)) raw = res.data;
    } catch (err) {
      console.error("MDBList movies:", err.message);
    }
  } else {
    try {
      const res = await axios.get(SNOAK_SHOWS_URL, { timeout: 8000 });
      if (Array.isArray(res.data)) raw = res.data;
    } catch (err) {
      console.error("MDBList shows:", err.message);
      try {
        const res = await axios.get(SNOAK_SHOWS_ALT_URL, { timeout: 8000 });
        if (Array.isArray(res.data)) raw = res.data;
      } catch (err2) {
        console.error("MDBList shows alt:", err2.message);
      }
    }
  }

  // Fallback only if list is empty
  if (!raw.length && apiKey) {
    const media = type === "series" ? "tv" : "movie";
    try {
      const r = await axios.get(`https://api.themoviedb.org/3/trending/${media}/day`, {
        params: { api_key: apiKey },
        timeout: 6000,
      });
      raw = r.data.results || [];
    } catch (err) {
      console.error(`TMDB fallback ${media}:`, err.message);
    }
  }

  return raw;
}

/** Attach imdb_id from TMDB external_ids when missing (trending has none). */
async function resolveImdbId(tmdbId, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey || !tmdbId) return null;
  try {
    const pathType = type === "series" ? `tv/${tmdbId}` : `movie/${tmdbId}`;
    const r = await axios.get(`https://api.themoviedb.org/3/${pathType}/external_ids`, {
      params: { api_key: apiKey },
      timeout: 4000,
    });
    return r.data && r.data.imdb_id ? r.data.imdb_id : null;
  } catch (_) {
    return null;
  }
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
  // Short cache so catalog order / version updates apply quickly
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
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
    // Trakt/MDBList source; drop news / talk / kids / anime / Chinese / obscure international
    const filtered = await filterTrendingList(raw, type, 10);

    const metas = [];
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      let tmdbId = item.tmdb_id || item.tmdbid || item.id || null;
      if (tmdbId && String(tmdbId).startsWith("tt")) tmdbId = null;
      let imdbId = item.imdb_id || item.imdbid || (item.external_ids && item.external_ids.imdb_id) || null;
      if (!imdbId && tmdbId) {
        imdbId = await resolveImdbId(tmdbId, type);
      }
      // Include not-yet-released; prefer imdb id for stream matching
      const idToUse = imdbId || (tmdbId ? `tmdb:${tmdbId}` : null);
      if (!idToUse) continue;

      const title = item.title || item.name || "Unknown";
      const rank = i + 1;

      let background = null;
      let logo = null;
      try {
        const tmdbData = await getTmdbData(imdbId, type, tmdbId);
        if (tmdbData.tmdbId) tmdbId = tmdbData.tmdbId;
        background = tmdbData.backdropUrl || null;
        logo = tmdbData.logoUrl || null;
      } catch (_) {}

      const meta = {
        id: idToUse,
        type,
        name: `${rank}. ${title}`,
        poster: `${hostUrl}/api/poster?id=${encodeURIComponent(imdbId || idToUse)}&rank=${rank}&type=${type}&tmdb=${encodeURIComponent(tmdbId || "")}&v=${POSTER_CACHE_VERSION}`,
        posterShape: "poster",
        description: item.description || item.overview || "",
      };
      // TMDB landscape backdrop + logo
      if (background) meta.background = background;
      if (logo) meta.logo = logo;
      // Pass through release date when present (including future)
      const rd = item.release_date || item.first_air_date || item.released || null;
      if (rd) meta.releaseInfo = String(rd).slice(0, 10);

      metas.push(meta);
    }

    res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");
    res.json({ metas });
  } catch (err) {
    console.error(`Catalog (${type}):`, err.message);
    res.json({ metas: [] });
  }
});

app.get("/api/poster", async (req, res) => {
  const { id, rank, type, tmdb } = req.query;
  if (!id) return res.status(400).send("Missing ID");

  try {
    let posterBuffer = null;
    const mediaType = type === "series" ? "series" : "movie";
    const cleanImdb = id.startsWith("tt") ? id : null;
    let tmdbId = tmdb || null;

    let genre = null;
    let imdbRating = null;

    // Resolve TMDB + genre + rating
    try {
      const tmdbData = await getTmdbData(cleanImdb, mediaType, tmdbId);
      if (tmdbData.tmdbId) tmdbId = tmdbData.tmdbId;
      genre = tmdbData.genre || null;
      imdbRating = tmdbData.imdbRating || null;
    } catch (_) {}

    // Primary: Pictorium portrait
    try {
      const picUrl = buildPictoriumUrl({
        imdbId: cleanImdb,
        tmdbId,
        type: mediaType,
        shape: "poster",
      });
      if (picUrl) {
        const r = await axios.get(picUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
          headers: { Accept: "image/*" },
          maxRedirects: 5,
        });
        if (r.data && r.data.byteLength > 1000) {
          posterBuffer = Buffer.from(r.data);
        }
      }
    } catch (e) {
      console.error("Pictorium:", e.message);
    }

    // Fallback: TMDB portrait poster
    if (!posterBuffer) {
      try {
        const tmdbData = await getTmdbData(cleanImdb, mediaType, tmdbId);
        if (tmdbData.posterUrl) {
          const r = await axios.get(tmdbData.posterUrl, {
            responseType: "arraybuffer", timeout: 4500,
          });
          posterBuffer = Buffer.from(r.data);
        }
        if (!genre) genre = tmdbData.genre;
        if (!imdbRating) imdbRating = tmdbData.imdbRating;
      } catch (_) {}
    }

    if (!posterBuffer) {
      posterBuffer = await sharp({
        create: { width: 500, height: 750, channels: 3, background: { r: 18, g: 18, b: 24 } },
      }).jpeg().toBuffer();
    }

    const TARGET_W = 500;
    const TARGET_H = 750;
    posterBuffer = await sharp(posterBuffer)
      .resize(TARGET_W, TARGET_H, { fit: "cover", position: "centre" })
      .jpeg({ quality: 92 })
      .toBuffer();

    const num = parseInt(rank, 10) || 1;
    const composites = [];
    // Soft left vignette for contrast behind rank
    const vigSvg = Buffer.from(
      `<svg width="${TARGET_W}" height="${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="v" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#000" stop-opacity="0.18"/>
            <stop offset="35%" stop-color="#000" stop-opacity="0.06"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect width="${Math.round(TARGET_W * 0.52)}" height="${TARGET_H}" fill="url(#v)"/>
      </svg>`
    );
    composites.push({ input: vigSvg, top: 0, left: 0 });

    const rankOverlay = await loadRankOverlay(TARGET_H, num, posterBuffer, TARGET_W);
    if (rankOverlay && rankOverlay.buf) {
      composites.push({
        input: rankOverlay.buf,
        top: rankOverlay.top,
        left: rankOverlay.left,
      });
    }

    // SF Pro Thin: GENRE · IMDb rating (bottom center)
    const genreSvg = buildGenreRatingSvg(TARGET_W, TARGET_H, genre, imdbRating);
    if (genreSvg) {
      try {
        const genrePng = renderSvgToPng(genreSvg, TARGET_W);
        composites.push({ input: genrePng, top: 0, left: 0 });
      } catch (e) {
        console.error("Genre overlay:", e.message);
      }
    }

    const out = await sharp(posterBuffer)
      .composite(composites)
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
