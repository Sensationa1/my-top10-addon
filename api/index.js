const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { Resvg } = require("@resvg/resvg-js");
require("dotenv").config();

// Reuse TCP/TLS connections across requests for much faster API & image downloads
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const api = axios.create({ httpAgent, httpsAgent });

const app = express();
app.use(cors());

const SNOAK_MOVIES_URL = "https://mdblist.com/lists/snoak/trending-movies/json";
const SNOAK_SHOWS_URL = "https://mdblist.com/lists/snoak/trakt-s-trending-shows/json";
const SNOAK_SHOWS_ALT_URL = "https://mdblist.com/lists/snoak/most-popular-shows-on-rotten-tomatoes/json";

const POSTER_CACHE_VERSION = "277";

const TARGET_W = 1000;
const TARGET_H = 1500;

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

// Resolve fonts once at startup instead of checking disk on every SVG render
let CACHED_FONT_FILES = null;
function getFontFiles() {
  if (CACHED_FONT_FILES) return CACHED_FONT_FILES;
  const black = fs.existsSync(FONT_BLACK) ? FONT_BLACK : FONT_BLACK_ALT;
  const semi = fs.existsSync(FONT_SEMI) ? FONT_SEMI : FONT_SEMI_ALT;
  const sfMed = fs.existsSync(FONT_SF_MED) ? FONT_SF_MED : FONT_SF_MED_ALT;
  const sfBold = fs.existsSync(FONT_SF_BOLD) ? FONT_SF_BOLD : FONT_SF_BOLD_ALT;
  const sfThin = fs.existsSync(FONT_SF_THIN) ? FONT_SF_THIN : FONT_SF_THIN_ALT;
  CACHED_FONT_FILES = [sfBold, sfMed, sfThin, black, semi].filter((p) => p && fs.existsSync(p));
  return CACHED_FONT_FILES;
}

// In-memory caches to avoid redundant API hits and re-renders
const tmdbCache = new Map();
const catalogCache = new Map();
const posterMemoryCache = new Map(); // key -> Buffer (max 25 posters in RAM)
const rankAssetCache = new Map();    // rank (1..10) -> { maskPng, rankLayer }
let CACHED_VIGNETTE_PNG = null;

function setPosterCache(key, buf) {
  if (posterMemoryCache.size >= 25) {
    const oldestKey = posterMemoryCache.keys().next().value;
    posterMemoryCache.delete(oldestKey);
  }
  posterMemoryCache.set(key, buf);
}

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "2.7.3",
  name: "Top 10 Trending (Apple TV Style)",
  description:
    "Top 10 from Trakt/MDBList with PostersPlus portraits, adaptive ranks, SF Pro genre · IMDb.",
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

const TMDB_ANIMATION_ID = 16;

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

const EXCLUDE_TV_GENRES = new Set([10763, 10762, 10767]);
const FAMILY_GENRE = 10751;

const BLOCKED_LANGS = new Set([
  "zh", "cn", "zh-cn", "zh-tw", "zh-hk", "yue", "cmn", "zh-hans", "zh-hant",
]);

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

  if (BLOCKED_LANGS.has(raw) || BLOCKED_LANGS.has(lang) || lang === "zh") return true;
  if (KNOWN_LANGS.has(lang)) return false;

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
    if (genreIds.includes(TMDB_ANIMATION_ID) && (genreIds.includes(10762) || genreIds.includes(FAMILY_GENRE))) {
      return true;
    }
  }

  const lang = normalizeLang(item.original_language);
  const isJapanese = lang === "ja" || lang === "jp";
  if (isJapanese && genreIds.includes(TMDB_ANIMATION_ID)) return true;
  if (ANIME_TITLE_RE.test(String(item.title || item.name || ""))) return true;

  return false;
}

async function enrichItemFromTmdb(item, type) {
  if (item.original_language && Array.isArray(item.genre_ids) && item.genre_ids.length) {
    return item;
  }
  const apiKey = process.env.TMDB_API_KEY;
  const imdbId = item.imdb_id || item.imdbid || (item.external_ids && item.external_ids.imdb_id);
  if (!apiKey || !imdbId || !String(imdbId).startsWith("tt")) return item;

  const cacheKey = `enrich:${type}:${imdbId}`;
  if (tmdbCache.has(cacheKey)) {
    return { ...item, ...tmdbCache.get(cacheKey) };
  }

  try {
    const findRes = await api.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
      params: { api_key: apiKey, external_source: "imdb_id" },
      timeout: 3500,
    });
    const isSeries = type === "series";
    const match =
      (isSeries ? findRes.data.tv_results : findRes.data.movie_results) &&
      (isSeries ? findRes.data.tv_results : findRes.data.movie_results)[0];
    if (!match) return item;

    const extra = {
      original_language: item.original_language || match.original_language,
      genre_ids: (item.genre_ids && item.genre_ids.length) ? item.genre_ids : (match.genre_ids || []),
      vote_count: item.vote_count || match.vote_count,
      popularity: item.popularity || match.popularity,
      title: item.title || match.title || match.name,
      name: item.name || match.name || match.title,
      id: item.tmdb_id || item.tmdbid || match.id || item.id,
      tmdb_id: item.tmdb_id || item.tmdbid || match.id,
    };
    tmdbCache.set(cacheKey, extra);
    return { ...item, ...extra };
  } catch (_) {
    return item;
  }
}

async function filterTrendingList(raw, type, limit = 10) {
  const out = [];
  const chunkSize = 15;
  for (let i = 0; i < raw.length; i += chunkSize) {
    const chunk = raw.slice(i, i + chunkSize);
    const processed = await Promise.all(chunk.map(async (item) => {
      if (isAnimeItem(item)) return null;
      const enriched = await enrichItemFromTmdb(item, type);
      if (shouldExcludeTrendingItem(enriched, type)) return null;
      return enriched;
    }));
    for (const res of processed) {
      if (res && out.length < limit) out.push(res);
    }
    if (out.length >= limit) break;
  }
  return out;
}

function formatGenreLabel(genre) {
  if (!genre) return null;
  const s = String(genre).trim().toLowerCase();
  if (!s) return null;
  // Always keep Sci-fi short instead of "Science fiction" or "Sci-fi & fantasy"
  if (s === "science fiction" || s.includes("sci-fi") || s.includes("sci fi")) {
    return "Sci-fi";
  }
  if (s.includes("action & adventure")) {
    return "Action";
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildGenreRatingSvg(width, height, genre, rating) {
  const g = formatGenreLabel(genre);
  const label = [g, rating].filter(Boolean).join("  ·  ");
  if (!label) return null;

  // Expanded size & wider tracking for a bolder, more readable bottom badge
  const fontSize = Math.round(height * 0.055);
  const y = Math.round(height * 0.935);
  const x = Math.round(width / 2);
  const safe = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="tshadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.60"/>
    </filter>
  </defs>
  <text
    x="${x}"
    y="${y}"
    text-anchor="middle"
    font-family="SF Pro Display"
    font-weight="300"
    font-size="${fontSize}"
    fill="#FFFFFF"
    fill-opacity="0.92"
    letter-spacing="0.15em"
    filter="url(#tshadow)"
  >${safe}</text>
</svg>`;
}

function getHostUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

function renderSvgToPng(svgString, width) {
  const files = getFontFiles();
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

/**
 * Pre-renders and caches the static SVG layers for each rank (1..10) and left vignette
 * so we never re-rasterize fonts for the numbers on every poster load.
 */
function getRankAssets(num) {
  if (rankAssetCache.has(num)) return rankAssetCache.get(num);

  const isTen = num >= 10;
  const rankFont = Math.round(TARGET_H * (isTen ? 0.32 : 0.36));
  const rankX = Math.round(TARGET_W * 0.032);
  const rankBaseline = Math.round(TARGET_H * 0.29);
  const tracking = isTen ? -0.12 : 0;

  const maskSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TARGET_W}" height="${TARGET_H}" viewBox="0 0 ${TARGET_W} ${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="#FFFFFF"
    letter-spacing="${tracking}em"
  >${num}</text>
</svg>`;

  const rankSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TARGET_W}" height="${TARGET_H}" viewBox="0 0 ${TARGET_W} ${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Unchanged Smoky Frosted Face -->
    <linearGradient id="smokyGlass" x1="0%" y1="0%" x2="0%" y2="100%" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#E2E8F0" stop-opacity="0.64"/>
      <stop offset="30%" stop-color="#94A3B8" stop-opacity="0.44"/>
      <stop offset="65%" stop-color="#1E293B" stop-opacity="0.50"/>
      <stop offset="100%" stop-color="#090D16" stop-opacity="0.66"/>
    </linearGradient>

    <!-- Unchanged 4K Diagonal Specular Glass Sheen -->
    <linearGradient id="glossShine" x1="0%" y1="0%" x2="80%" y2="85%" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.70"/>
      <stop offset="20%" stop-color="#FFFFFF" stop-opacity="0.30"/>
      <stop offset="42%" stop-color="#FFFFFF" stop-opacity="0.04"/>
      <stop offset="43%" stop-color="#FFFFFF" stop-opacity="0.0"/>
      <stop offset="85%" stop-color="#FFFFFF" stop-opacity="0.0"/>
      <stop offset="100%" stop-color="#CBD5E1" stop-opacity="0.22"/>
    </linearGradient>

    <!-- More Prominent Fading Silver Outline (Crisp silver top fading smoothly down) -->
    <linearGradient id="metallicRim" x1="0%" y1="0%" x2="20%" y2="100%" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.75"/>
      <stop offset="32%" stop-color="#E2E8F0" stop-opacity="0.50"/>
      <stop offset="68%" stop-color="#94A3B8" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#64748B" stop-opacity="0.00"/>
    </linearGradient>

    <filter id="ambientShadow" x="-45%" y="-45%" width="190%" height="190%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000000" flood-opacity="0.62"/>
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>

  <!-- 1. Deep Floating Shadow -->
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="#000000"
    fill-opacity="0.01"
    letter-spacing="${tracking}em"
    filter="url(#ambientShadow)"
  >${num}</text>

  <!-- 2. Smoky Translucent Frosted Glass Body (Face unchanged) -->
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="url(#smokyGlass)"
    letter-spacing="${tracking}em"
  >${num}</text>

  <!-- 3. 4K Shiny Diagonal Specular Reflection (Face unchanged) -->
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="url(#glossShine)"
    letter-spacing="${tracking}em"
  >${num}</text>

  <!-- 4. Thicker Fading Silver Glass Rim (6.5px) -->
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="none"
    stroke="url(#metallicRim)"
    stroke-width="6.5"
    stroke-linejoin="round"
    letter-spacing="${tracking}em"
  >${num}</text>

  <!-- 5. Crisp Top-Left Specular Edge Glint (2.2px) -->
  <text
    x="${rankX - 0.7}"
    y="${rankBaseline - 0.9}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="none"
    stroke="url(#metallicRim)"
    stroke-width="2.2"
    stroke-opacity="0.75"
    stroke-linejoin="round"
    letter-spacing="${tracking}em"
  >${num}</text>
</svg>`;

  const assets = {
    maskPng: renderSvgToPng(maskSvg, TARGET_W),
    rankLayer: renderSvgToPng(rankSvg, TARGET_W),
  };
  rankAssetCache.set(num, assets);
  return assets;
}

async function getVignettePng() {
  if (CACHED_VIGNETTE_PNG) return CACHED_VIGNETTE_PNG;
  const vigSvg = Buffer.from(
    `<svg width="${TARGET_W}" height="${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="v" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#000" stop-opacity="0.32"/>
          <stop offset="42%" stop-color="#000" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${Math.round(TARGET_W * 0.50)}" height="${TARGET_H}" fill="url(#v)"/>
    </svg>`
  );
  CACHED_VIGNETTE_PNG = await sharp(vigSvg).png().toBuffer();
  return CACHED_VIGNETTE_PNG;
}

function buildPostersPlusUrl({ imdbId, tmdbId, stremioId, type, shape }) {
  const params = new URLSearchParams();
  if (tmdbId) params.set("tmdb_id", String(tmdbId));
  if (imdbId) params.set("imdb_id", String(imdbId));
  params.set("stremio_id", stremioId || imdbId || (tmdbId ? `tmdb:${tmdbId}` : ""));
  params.set("type", type === "series" ? "series" : "movie");
  params.set("shape", shape || "poster");
  params.set("pc", "stremio_tv_nuvio");
  params.set("tmdb_key", process.env.TMDB_API_KEY || "dc1ae8c943c805800112762a3afbc1b6");
  params.set("mdblist_key", process.env.MDBLIST_API_KEY || "1cym9fkqsk4hvwtesjthxsrr9");
  params.set("tg", "medium");
  params.set("bgr", "custom");
  params.set("bgo", "1");
  params.set("bgh", "0.55");
  params.set("tvso", "1");
  params.set("vpcb", "1");
  params.set("vcsa", "0.00");
  params.set("vcb", "0.20");
  params.set("vcli", "0.40");
  params.set("vcs", "reference");
  params.set("hy", "1");
  params.set("sm", "hidden");
  params.set("_bgr", "custom");
  params.set("_bgo", "0.2");
  params.set("_bgh", "0.75");
  params.set("_vcsa", "0.20");
  params.set("_vcb", "0.05");
  params.set("_vcl", "1");
  params.set("_vcs", "muted");
  params.set("_hg", "1");
  params.set("_hr", "1");
  params.set("_tx", "1");
  params.set("bp", "top_left");
  params.set("_bs", "1.70");
  params.set("_is", "1.35");
  params.set("_lp", "center");
  params.set("_ip", "bottom_center");
  params.set("_pc", "1");
  params.set("_soo10", "1");
  params.set("_bc", "mixed");
  params.set("_bf", "1.15");
  params.set("_bgop", "0.00");
  params.set("_bsa", "0.00");
  params.set("_bx", "-0.040");
  params.set("_by", "-0.060");
  params.set("_ls", "1.30");
  params.set("fti", "1");
  params.set("mw", "lb:.2,pc:.2,im:.6");
  params.set("tw", "rt:.1,pc:.25,im:.61,tm:.04");
  params.set("rdm", "0");
  params.set("oas", "top_rated");
  params.set("fbs", "photoreal");
  params.set("lmwr", "0.80");
  params.set("lmhr", "0.40");
  params.set("lbr", "0.19");
  params.set("cg", "0");
  params.set("hur", "1");
  params.set("bdm", "7");
  params.set("bg1", "tr:4:network");
  params.set("_bdm", "7");
  params.set("_bg1", "");
  params.set("bls", "1.10");
  return `https://postersplus.slokker.cc/poster?${params.toString()}`;
}

async function getTmdbData(imdbId, type, existingTmdbId) {
  const apiKey = process.env.TMDB_API_KEY;
  const empty = { posterUrl: null, backdropUrl: null, logoUrl: null, genre: null, tmdbId: existingTmdbId || null, imdbRating: null };
  if (!apiKey) return empty;

  const cacheKey = `tmdb:${type}:${imdbId || ""}:${existingTmdbId || ""}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 3600_000) {
    return cached.data;
  }

  const isSeries = type === "series";
  try {
    let match = null;
    let tmdbId = existingTmdbId ? Number(existingTmdbId) || existingTmdbId : null;

    if (!tmdbId && imdbId && String(imdbId).startsWith("tt")) {
      const findRes = await api.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
        params: { api_key: apiKey, external_source: "imdb_id" },
        timeout: 3500,
      });
      const results = isSeries ? findRes.data.tv_results : findRes.data.movie_results;
      match = results && results[0];
      if (match) tmdbId = match.id;
    }

    if (!tmdbId) return empty;

    const pathType = isSeries ? `tv/${tmdbId}` : `movie/${tmdbId}`;
    const tt = imdbId && String(imdbId).startsWith("tt") ? imdbId : null;

    const [detRes, omdbRes] = await Promise.allSettled([
      api.get(`https://api.themoviedb.org/3/${pathType}`, {
        params: {
          api_key: apiKey,
          append_to_response: "images",
          include_image_language: "fi,en,null",
        },
        timeout: 4000,
      }),
      tt && process.env.OMDB_API_KEY
        ? api.get("https://www.omdbapi.com/", {
            params: { i: tt, apikey: process.env.OMDB_API_KEY },
            timeout: 2800,
          })
        : Promise.resolve(null),
    ]);

    const det = detRes.status === "fulfilled" && detRes.value ? detRes.value.data : null;
    const omdbData = omdbRes.status === "fulfilled" && omdbRes.value ? omdbRes.value.data : null;

    const posterPath = (det && det.poster_path) || (match && match.poster_path);
    const backdropPath = (det && det.backdrop_path) || (match && match.backdrop_path);
    const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w780${posterPath}` : null;
    const backdropUrl = backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : null;

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
      const rawName = String(det.genres[0].name || "").trim();
      if (/science fiction|sci-fi/i.test(rawName)) {
        genre = "SCI-FI";
      } else if (/action & adventure/i.test(rawName)) {
        genre = "ACTION";
      } else {
        genre = rawName.toUpperCase();
      }
    } else if (match && Array.isArray(match.genre_ids) && match.genre_ids.length) {
      genre = GENRE_MAP[match.genre_ids[0]] || null;
    }

    let imdbRating = null;
    if (omdbData && omdbData.imdbRating && omdbData.imdbRating !== "N/A") {
      imdbRating = omdbData.imdbRating;
    } else if (det && det.vote_average != null && Number(det.vote_average) > 0) {
      imdbRating = Number(det.vote_average).toFixed(1);
    }

    const result = { posterUrl, backdropUrl, logoUrl, genre, tmdbId, imdbRating };
    tmdbCache.set(cacheKey, { ts: Date.now(), data: result });
    return result;
  } catch (err) {
    console.error(`TMDB ${imdbId || existingTmdbId}:`, err.message);
    return empty;
  }
}

async function fetchTrendingList(type) {
  let raw = [];
  const apiKey = process.env.TMDB_API_KEY;

  if (type === "movie") {
    try {
      const res = await api.get(SNOAK_MOVIES_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) raw = res.data;
    } catch (err) {
      console.error("MDBList movies:", err.message);
    }
  } else {
    try {
      const res = await api.get(SNOAK_SHOWS_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) raw = res.data;
    } catch (err) {
      console.error("MDBList shows:", err.message);
      try {
        const res = await api.get(SNOAK_SHOWS_ALT_URL, { timeout: 6000 });
        if (Array.isArray(res.data)) raw = res.data;
      } catch (err2) {
        console.error("MDBList shows alt:", err2.message);
      }
    }
  }

  if (!raw.length && apiKey) {
    const media = type === "series" ? "tv" : "movie";
    try {
      const r = await api.get(`https://api.themoviedb.org/3/trending/${media}/day`, {
        params: { api_key: apiKey },
        timeout: 5000,
      });
      raw = r.data.results || [];
    } catch (err) {
      console.error(`TMDB fallback ${media}:`, err.message);
    }
  }

  return raw;
}

async function resolveImdbId(tmdbId, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey || !tmdbId) return null;
  try {
    const pathType = type === "series" ? `tv/${tmdbId}` : `movie/${tmdbId}`;
    const r = await api.get(`https://api.themoviedb.org/3/${pathType}/external_ids`, {
      params: { api_key: apiKey },
      timeout: 3500,
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
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.json(MANIFEST);
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const { type } = req.params;
  const hostUrl = getHostUrl(req);
  if (type !== "movie" && type !== "series") return res.json({ metas: [] });

  const cachedCat = catalogCache.get(type);
  if (cachedCat && Date.now() - cachedCat.ts < 600_000) {
    res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");
    return res.json({ metas: cachedCat.metas });
  }

  try {
    const raw = await fetchTrendingList(type);
    const filtered = await filterTrendingList(raw, type, 10);

    const metaPromises = filtered.map(async (item, i) => {
      let tmdbId = item.tmdb_id || item.tmdbid || item.id || null;
      if (tmdbId && String(tmdbId).startsWith("tt")) tmdbId = null;
      let imdbId = item.imdb_id || item.imdbid || (item.external_ids && item.external_ids.imdb_id) || null;
      
      if (!imdbId && tmdbId) {
        imdbId = await resolveImdbId(tmdbId, type);
      }
      
      const idToUse = imdbId || (tmdbId ? `tmdb:${tmdbId}` : null);
      if (!idToUse) return null;

      const title = item.title || item.name || "Unknown";
      const rank = i + 1;

      let background = null;
      let logo = null;
      let genre = null;
      let imdbRating = null;
      let posterUrl = null;

      try {
        const tmdbData = await getTmdbData(imdbId, type, tmdbId);
        if (tmdbData.tmdbId) tmdbId = tmdbData.tmdbId;
        background = tmdbData.backdropUrl || null;
        logo = tmdbData.logoUrl || null;
        genre = tmdbData.genre || null;
        imdbRating = tmdbData.imdbRating || null;
        posterUrl = tmdbData.posterUrl || null;
      } catch (_) {}

      const posterParams = new URLSearchParams({
        id: imdbId || idToUse,
        rank: String(rank),
        type,
        tmdb: String(tmdbId || ""),
        g: genre || "",
        r: imdbRating || "",
        p: posterUrl || "",
        v: POSTER_CACHE_VERSION,
      });

      const meta = {
        id: idToUse,
        type,
        name: `${rank}. ${title}`,
        poster: `${hostUrl}/api/poster?${posterParams.toString()}`,
        posterShape: "poster",
        description: item.description || item.overview || "",
      };
      
      if (background) meta.background = background;
      if (logo) meta.logo = logo;
      
      const rd = item.release_date || item.first_air_date || item.released || null;
      if (rd) meta.releaseInfo = String(rd).slice(0, 10);

      return { meta, rank };
    });

    const resolved = await Promise.all(metaPromises);
    const metas = resolved
      .filter((r) => r && r.meta)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.meta);

    catalogCache.set(type, { ts: Date.now(), metas });

    res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");
    res.json({ metas });
  } catch (err) {
    console.error(`Catalog (${type}):`, err.message);
    res.json({ metas: [] });
  }
});

app.get("/api/poster", async (req, res) => {
  const { id, rank, type, tmdb, g, r, p } = req.query;
  if (!id) return res.status(400).send("Missing ID");

  const num = Math.min(10, Math.max(1, parseInt(rank, 10) || 1));
  const mediaType = type === "series" ? "series" : "movie";
  const memKey = `${id}:${num}:${mediaType}:${POSTER_CACHE_VERSION}`;

  if (posterMemoryCache.has(memKey)) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400");
    return res.send(posterMemoryCache.get(memKey));
  }

  try {
    const cleanImdb = id.startsWith("tt") ? id : null;
    let tmdbId = tmdb || null;
    let genre = g || null;
    let imdbRating = r || null;
    let fallbackPosterUrl = p || null;

    const ppUrl = buildPostersPlusUrl({
      imdbId: cleanImdb,
      tmdbId,
      stremioId: id,
      type: mediaType,
      shape: "poster",
    });

    const needsMetaLookup = !genre && !imdbRating && !fallbackPosterUrl;

    const [ppRes, tmdbData] = await Promise.all([
      api.get(ppUrl, {
        responseType: "arraybuffer",
        timeout: 6500,
        headers: { Accept: "image/*" },
        maxRedirects: 3,
      }).catch(() => null),
      needsMetaLookup
        ? getTmdbData(cleanImdb, mediaType, tmdbId).catch(() => null)
        : Promise.resolve(null),
    ]);

    if (tmdbData) {
      if (!genre) genre = tmdbData.genre;
      if (!imdbRating) imdbRating = tmdbData.imdbRating;
      if (!fallbackPosterUrl) fallbackPosterUrl = tmdbData.posterUrl;
    }

    let posterBuffer = null;
    if (ppRes && ppRes.data && ppRes.data.byteLength > 1000) {
      posterBuffer = Buffer.from(ppRes.data);
    }

    if (!posterBuffer) {
      if (!fallbackPosterUrl && !needsMetaLookup) {
        const td = await getTmdbData(cleanImdb, mediaType, tmdbId).catch(() => null);
        if (td) {
          fallbackPosterUrl = td.posterUrl;
          if (!genre) genre = td.genre;
          if (!imdbRating) imdbRating = td.imdbRating;
        }
      }
      if (fallbackPosterUrl) {
        try {
          const tmdbImg = await api.get(fallbackPosterUrl, {
            responseType: "arraybuffer",
            timeout: 3500,
          });
          posterBuffer = Buffer.from(tmdbImg.data);
        } catch (_) {}
      }
    }

    if (!posterBuffer) {
      posterBuffer = await sharp({
        create: { width: 500, height: 750, channels: 3, background: { r: 18, g: 18, b: 24 } },
      }).png().toBuffer();
    }

    const { data: rawPoster, info: rawInfo } = await sharp(posterBuffer)
      .resize(TARGET_W, TARGET_H, { fit: "cover", position: "centre" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rawInput = {
      raw: { width: rawInfo.width, height: rawInfo.height, channels: rawInfo.channels },
    };

    const { maskPng, rankLayer } = getRankAssets(num);
    const [vigPng, frostedNumberBg] = await Promise.all([
      getVignettePng(),
      sharp(rawPoster, rawInput)
        .modulate({ brightness: 0.88, saturation: 1.45 })
        .blur(22)
        .ensureAlpha()
        .composite([{ input: maskPng, blend: "dest-in" }])
        .png({ compressionLevel: 1 })
        .toBuffer(),
    ]);

    const composites = [
      { input: vigPng, top: 0, left: 0 },
      { input: frostedNumberBg, top: 0, left: 0 },
      { input: rankLayer, top: 0, left: 0 },
    ];

    const genreSvg = buildGenreRatingSvg(TARGET_W, TARGET_H, genre, imdbRating);
    if (genreSvg) {
      try {
        const genrePng = renderSvgToPng(genreSvg, TARGET_W);
        composites.push({ input: genrePng, top: 0, left: 0 });
      } catch (e) {
        console.error("Genre overlay:", e.message);
      }
    }

    const out = await sharp(rawPoster, rawInput)
      .composite(composites)
      .jpeg({ quality: 90, mozjpeg: false, chromaSubsampling: "4:2:0" })
      .toBuffer();

    setPosterCache(memKey, out);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400");
    return res.send(out);
  } catch (err) {
    console.error("Poster error:", err.message, err.stack);
    return res.status(500).send("Error rendering poster");
  }
});

module.exports = app;
