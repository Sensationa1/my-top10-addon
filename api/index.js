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

const POSTER_CACHE_VERSION = "288";

const TARGET_W = 720;
const TARGET_H = 1080;

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
const genrePngCache = new Map();     // "GENRE|7.5" -> png buffer
let CACHED_VIGNETTE_PNG = null;

function setPosterCache(key, buf) {
  if (posterMemoryCache.size >= 60) {
    const oldestKey = posterMemoryCache.keys().next().value;
    posterMemoryCache.delete(oldestKey);
  }
  posterMemoryCache.set(key, buf);
}

/** Background catalog refresh — never blocks the response */
const catalogRefreshing = new Set();

/** Catalog day key: flips at 12:00 Europe/Helsinki so the list updates once per day at noon. */
function getCatalogDayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let y = Number(get("year"));
  let m = Number(get("month"));
  let d = Number(get("day"));
  const hour = Number(get("hour"));
  // Before noon → still yesterday's catalog day
  if (hour < 12) {
    const utcGuess = Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000;
    const prev = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(utcGuess));
    const gp = (t) => prev.find((p) => p.type === t)?.value;
    y = Number(gp("year"));
    m = Number(gp("month"));
    d = Number(gp("day"));
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}


async function warmPosterUrls(urls) {
  // Higher concurrency — posters already rate-limit at PostersPlus; empty row is worse
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(
      urls.slice(i, i + 4).map((u) =>
        api.get(u, { responseType: "arraybuffer", timeout: 30000, httpAgent, httpsAgent }).catch(() => null)
      )
    );
  }
}

async function refreshCatalog(type, hostUrl) {
  if (catalogRefreshing.has(type)) return;
  catalogRefreshing.add(type);
  try {
    const metas = await buildCatalogMetas(type, hostUrl);
    if (!metas.length) return;
    // Warm ranked posters FIRST, then publish list — avoids blank posters on refresh
    await warmPosterUrls(metas.map((m) => m.poster).filter(Boolean));
    catalogCache.set(type, { ts: Date.now(), metas, dayKey: getCatalogDayKey() });
  } catch (e) {
    console.error("refreshCatalog", type, e.message);
  } finally {
    catalogRefreshing.delete(type);
  }
}

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "2.8.4",
  name: "Top 10 Trending (Apple TV Style)",
  description:
    "Top 10 TMDB trending. Refreshes daily at 12:00 Europe/Helsinki. PostersPlus + frosted ranks.",
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
  if (isObscureInternational(item)) return true;

  const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids.map(Number) : [];
  // Anime / animation ALLOWED again. Still drop news / kids / talk shows.
  const isSeries = type === "series";
  if (isSeries) {
    if (genreIds.some((g) => EXCLUDE_TV_GENRES.has(g))) return true;
  }

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


function parseYmd(s) {
  if (!s) return null;
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function isFutureDate(s) {
  const d = parseYmd(s);
  if (!d) return false;
  const today = new Date();
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return d.getTime() > t0;
}

function isUnreleasedItem(item, type) {
  if (type === "movie") {
    const rd = item.release_date || item.released || null;
    // Future theatrical/digital date → out. Missing date → keep (trending usually has dates)
    if (rd && isFutureDate(rd)) return true;
    return false;
  }
  const fd = item.first_air_date || item.release_date || null;
  if (fd && isFutureDate(fd)) return true;
  return false;
}

/** TMDB release type 4 = Digital. Cache per movie id. */
const digitalReleaseCache = new Map();
async function hasDigitalRelease(tmdbId) {
  if (!tmdbId) return true;
  const key = String(tmdbId);
  if (digitalReleaseCache.has(key)) return digitalReleaseCache.get(key);
  const apiKey = process.env.TMDB_API_KEY || "dc1ae8c943c805800112762a3afbc1b6";
  try {
    const r = await api.get(`https://api.themoviedb.org/3/movie/${tmdbId}/release_dates`, {
      params: { api_key: apiKey },
      timeout: 5000,
      httpAgent,
      httpsAgent,
    });
    const results = (r.data && r.data.results) || [];
    const today = new Date();
    const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    let ok = false;
    let sawDigitalOrPhysical = false;
    for (const country of results) {
      for (const rel of country.release_dates || []) {
        // 4 = Digital, 5 = Physical
        if (rel.type !== 4 && rel.type !== 5) continue;
        sawDigitalOrPhysical = true;
        const d = parseYmd(rel.release_date);
        if (d && d.getTime() <= t0) {
          ok = true;
          break;
        }
      }
      if (ok) break;
    }
    // No digital/physical rows in TMDB at all → treat as not digitally out yet
    if (!sawDigitalOrPhysical) ok = false;
    digitalReleaseCache.set(key, ok);
    return ok;
  } catch (_) {
    // API blip: do not empty the whole movie row
    digitalReleaseCache.set(key, true);
    return true;
  }
}

async function filterTrendingList(raw, type, limit = 10) {
  const out = [];
  const chunkSize = 15;
  for (let i = 0; i < raw.length && out.length < limit; i += chunkSize) {
    const chunk = raw.slice(i, i + chunkSize);
    const processed = await Promise.all(
      chunk.map(async (item) => {
        const enriched = await enrichItemFromTmdb(item, type);
        if (shouldExcludeTrendingItem(enriched, type)) return null;
        if (isUnreleasedItem(enriched, type)) return null;
        // Movies: only if digital/physical home release already out
        if (type === "movie") {
          const tid = enriched.tmdb_id || enriched.tmdbid || enriched.id;
          if (tid && !(await hasDigitalRelease(tid))) return null;
        }
        return enriched;
      })
    );
    for (const res of processed) {
      if (res && out.length < limit) out.push(res);
    }
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

    <!-- Professional glass rim: bright top edge, soft fade to transparent (no heavy outline) -->
    <linearGradient id="metallicRim" x1="0%" y1="0%" x2="0%" y2="100%" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="22%" stop-color="#F1F5F9" stop-opacity="0.32"/>
      <stop offset="55%" stop-color="#94A3B8" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#64748B" stop-opacity="0.00"/>
    </linearGradient>
    <linearGradient id="rimHighlight" x1="0%" y1="0%" x2="30%" y2="100%" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.70"/>
      <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.00"/>
    </linearGradient>

    <filter id="ambientShadow" x="-45%" y="-45%" width="190%" height="190%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.55"/>
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.40"/>
    </filter>
  </defs>

  <!-- 1. Deep floating shadow -->
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

  <!-- 2. Smoky frosted glass face (kept) -->
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="url(#smokyGlass)"
    letter-spacing="${tracking}em"
  >${num}</text>

  <!-- 3. Diagonal specular sheen (kept) -->
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="url(#glossShine)"
    letter-spacing="${tracking}em"
  >${num}</text>

  <!-- 4. Single refined fading rim (hairline, not chunky) -->
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="none"
    stroke="url(#metallicRim)"
    stroke-width="${Math.max(2.2, rankFont * 0.0065)}"
    stroke-linejoin="round"
    stroke-linecap="round"
    paint-order="stroke fill"
    letter-spacing="${tracking}em"
  >${num}</text>

  <!-- 5. Ultra-fine top-left light catch (barely there) -->
  <text
    x="${rankX - 0.4}"
    y="${rankBaseline - 0.5}"
    font-family="SF Pro Display"
    font-weight="700"
    font-size="${rankFont}"
    fill="none"
    stroke="url(#rimHighlight)"
    stroke-width="${Math.max(1.1, rankFont * 0.003)}"
    stroke-linejoin="round"
    stroke-linecap="round"
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
  params.set("sbi", "0.010");
  params.set("tmdb_key", process.env.TMDB_API_KEY || "dc1ae8c943c805800112762a3afbc1b6");
  params.set("mdblist_key", process.env.MDBLIST_API_KEY || "1cym9fkqsk4hvwtesjthxsrr9");
  params.set("tg", "off");
  params.set("bgr", "custom");
  params.set("bgo", "0.3");
  params.set("bgh", "0.55");
  params.set("tvso", "1");
  params.set("vpct", "1");
  params.set("vpcb", "1");
  params.set("vcsa", "1.55");
  params.set("vcb", "0.60");
  params.set("vcli", "1.60");
  params.set("vcs", "muted");
  params.set("hg", "1");
  params.set("sm", "hidden");
  params.set("_vcsa", "2.00");
  params.set("_vcb", "1.00");
  params.set("_vcli", "1.30");
  params.set("_vcs", "shade");
  params.set("_hg", "0");
  params.set("_sm", "sash");
  params.set("bp", "top_left");
  params.set("_cl", "off");
  params.set("fti", "1");
  params.set("trs", "direct");
  params.set("mw", "lb:.25,pc:.1,im:.4,mal:.25");
  params.set("tw", "pc:.1,im:.5,mc:.15,mal:.25");
  params.set("rdm", "0");
  params.set("ll", "fi");
  params.set("lp", "native,custom,english,neutral,native_if_original,original,text");
  params.set("lls", "fi");
  params.set("fbs", "photoreal");
  params.set("lmwr", "0.80");
  params.set("lmhr", "0.40");
  params.set("lbr", "0.15");
  params.set("cg", "0");
  params.set("rsd", "0");
  params.set("hur", "1");
  params.set(
    "_sp",
    "default2,-pic_noms,-gg_noms,-trending_broad,-new_release,-new_season,-season_finale,-studio,-blockbuster,-returning,-airing,-premiere,-physical,-streaming,trending@0,cinema@1,just_added@3,production@4,renewed@5,cast@9,director@10,cult@11,foreign@12,true_story@13,short_film@14,mini_series@15,binge_ready@16"
  );
  params.set("bdm", "0");
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
  const media = type === "series" ? "tv" : "movie";

  // Primary: TMDB trending today (movies / TV)
  const tmdbKey = apiKey || "dc1ae8c943c805800112762a3afbc1b6";
  try {
    const [r1, r2] = await Promise.all([
      api.get(`https://api.themoviedb.org/3/trending/${media}/day`, {
        params: { api_key: tmdbKey, page: 1 },
        timeout: 8000,
      }),
      api.get(`https://api.themoviedb.org/3/trending/${media}/day`, {
        params: { api_key: tmdbKey, page: 2 },
        timeout: 8000,
      }).catch(() => null),
    ]);
    raw = [...(r1.data.results || []), ...((r2 && r2.data && r2.data.results) || [])];
  } catch (err) {
    console.error(`TMDB trending ${media}/day:`, err.message);
  }

  // Fallback: MDBList if TMDB empty
  if (!raw.length) {
    try {
      if (type === "movie") {
        const res = await api.get(SNOAK_MOVIES_URL, { timeout: 6000 });
        if (Array.isArray(res.data)) raw = res.data;
      } else {
        try {
          const res = await api.get(SNOAK_SHOWS_URL, { timeout: 6000 });
          if (Array.isArray(res.data)) raw = res.data;
        } catch (_) {
          const res = await api.get(SNOAK_SHOWS_ALT_URL, { timeout: 6000 });
          if (Array.isArray(res.data)) raw = res.data;
        }
      }
    } catch (err) {
      console.error("MDBList fallback:", err.message);
    }
  }

  return raw;
}

async function resolveImdbId(tmdbId, type) {
  const apiKey = process.env.TMDB_API_KEY || "dc1ae8c943c805800112762a3afbc1b6";
  if (!tmdbId) return null;
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

/**
 * Fast catalog build: TMDB trending fields only + parallel IMDb resolve.
 * No per-item getTmdbData (that was the main catalog delay).
 */
async function buildCatalogMetas(type, hostUrl) {
  const raw = await fetchTrendingList(type);
  // Prefer items that already look like TMDB results (have genre_ids / original_language)
  const filtered = await filterTrendingList(raw, type, 40);
  const slice = filtered.slice(0, 25);

  const rows = await Promise.all(
    slice.map(async (item, i) => {
      let tmdbId = item.tmdb_id || item.tmdbid || item.id || null;
      if (tmdbId && String(tmdbId).startsWith("tt")) tmdbId = null;
      let imdbId =
        item.imdb_id ||
        item.imdbid ||
        (item.external_ids && item.external_ids.imdb_id) ||
        null;
      if (!imdbId && tmdbId) {
        imdbId = await resolveImdbId(tmdbId, type);
      }
      if (!imdbId || !String(imdbId).startsWith("tt")) return null;
      const idToUse = imdbId;

      // Genre + rating from trending payload (instant)
      let genre = null;
      const gids = Array.isArray(item.genre_ids) ? item.genre_ids : [];
      if (gids.length && GENRE_MAP[gids[0]]) genre = GENRE_MAP[gids[0]];
      else if (item.genres && item.genres[0]) {
        genre = String(item.genres[0].name || item.genres[0]).toUpperCase();
      }
      let imdbRating = null;
      if (item.vote_average != null && Number(item.vote_average) > 0) {
        imdbRating = Number(item.vote_average).toFixed(1);
      }

      const posterPath = item.poster_path || null;
      const posterUrl = posterPath
        ? `https://image.tmdb.org/t/p/w780${posterPath}`
        : null;
      const backdropPath = item.backdrop_path || null;
      const background = backdropPath
        ? `https://image.tmdb.org/t/p/w1280${backdropPath}`
        : null;

      const title = item.title || item.name || "Unknown";
      const rank = i + 1;
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
        name: title,
        poster: `${hostUrl}/api/poster?${posterParams.toString()}`,
        posterShape: "poster",
        description: item.overview || item.description || "",
      };
      if (background) meta.background = background;
      const rd = item.release_date || item.first_air_date || item.released || null;
      if (rd) meta.releaseInfo = String(rd).slice(0, 10);
      return { meta, rank };
    })
  );

  return rows
    .filter((r) => r && r.meta)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)
    .map((r) => r.meta);
}

app.get("/catalog/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const { type } = req.params;
  const hostUrl = getHostUrl(req);
  if (type !== "movie" && type !== "series") return res.json({ metas: [] });

  const cachedCat = catalogCache.get(type);
  const dayKey = getCatalogDayKey();
  const hasGoodCache =
    cachedCat &&
    Array.isArray(cachedCat.metas) &&
    cachedCat.metas.length > 0 &&
    cachedCat.dayKey === dayKey;

  // Same catalog day (noon→noon Helsinki): serve cache, no rebuild
  if (hasGoodCache) {
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400");
    return res.json({ metas: cachedCat.metas });
  }

  // New day (or empty): rebuild. Keep old list visible until warm finishes if we have one.
  if (cachedCat && cachedCat.metas && cachedCat.metas.length) {
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    res.json({ metas: cachedCat.metas });
    refreshCatalog(type, hostUrl); // swaps after posters warm, new dayKey
    return;
  }

  try {
    const metas = await buildCatalogMetas(type, hostUrl);
    if (metas.length) {
      const urls = metas.map((m) => m.poster).filter(Boolean);
      await Promise.all(
        urls.slice(0, 4).map((u) =>
          api.get(u, { responseType: "arraybuffer", timeout: 20000, httpAgent, httpsAgent }).catch(() => null)
        )
      );
      catalogCache.set(type, { ts: Date.now(), metas, dayKey });
      setImmediate(() => warmPosterUrls(urls.slice(4)));
    }
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400");
    res.json({ metas });
  } catch (err) {
    console.error(`Catalog (${type}):`, err.message);
    if (cachedCat && cachedCat.metas && cachedCat.metas.length) {
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json({ metas: cachedCat.metas });
    }
    res.json({ metas: [] });
  }
});


app.get("/api/warm", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const hostUrl = getHostUrl(req);
  // Return immediately; work in background
  res.json({ ok: true, warming: true });
  setImmediate(() => {
    refreshCatalog("series", hostUrl);
    refreshCatalog("movie", hostUrl);
  });
});

app.get("/api/poster", async (req, res) => {
  const { id, rank, type, tmdb, g, r, p } = req.query;
  if (!id) return res.status(400).send("Missing ID");

  const num = Math.min(10, Math.max(1, parseInt(rank, 10) || 1));
  const mediaType = type === "series" ? "series" : "movie";
  const memKey = `${id}:${num}:${mediaType}:${POSTER_CACHE_VERSION}`;

  if (posterMemoryCache.has(memKey)) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=604800, immutable");
    return res.send(posterMemoryCache.get(memKey));
  }

  try {
    const cleanImdb = id.startsWith("tt") ? id : null;
    let tmdbId = tmdb || null;
    let genre = g || null;
    let imdbRating = r || null;
    let fallbackPosterUrl = p || null;

    // ONLY PostersPlus — never TMDB/other art as the base poster
    let posterBuffer = null;
    const ppUrl = buildPostersPlusUrl({
      imdbId: cleanImdb,
      tmdbId,
      stremioId: id,
      type: mediaType,
      shape: "poster",
    });
    try {
      const ppRes = await api.get(ppUrl, {
        responseType: "arraybuffer",
        timeout: 12000,
        headers: { Accept: "image/*" },
        maxRedirects: 5,
        httpAgent,
        httpsAgent,
      });
      if (ppRes.data && ppRes.data.byteLength > 1000) {
        posterBuffer = Buffer.from(ppRes.data);
      }
    } catch (e) {
      console.error("PostersPlus:", e.message);
    }

    if (!posterBuffer) {
      posterBuffer = await sharp({
        create: { width: 360, height: 540, channels: 3, background: { r: 18, g: 18, b: 24 } },
      }).jpeg().toBuffer();
    }

    // FAST path: no full-poster blur (that was the slowdown vs digit PNGs).
    // Rank glass is pure SVG (pre-cached). One resize + one composite.
    const { rankLayer } = getRankAssets(num);
    const vigPng = await getVignettePng();

    const composites = [
      { input: vigPng, top: 0, left: 0 },
      { input: rankLayer, top: 0, left: 0 },
    ];

    const genreSvg = buildGenreRatingSvg(TARGET_W, TARGET_H, genre, imdbRating);
    if (genreSvg) {
      try {
        const gKey = `${genre || ""}|${imdbRating || ""}`;
        let genrePng = genrePngCache.get(gKey);
        if (!genrePng) {
          genrePng = renderSvgToPng(genreSvg, TARGET_W);
          if (genrePngCache.size > 80) {
            genrePngCache.delete(genrePngCache.keys().next().value);
          }
          genrePngCache.set(gKey, genrePng);
        }
        composites.push({ input: genrePng, top: 0, left: 0 });
      } catch (e) {
        console.error("Genre overlay:", e.message);
      }
    }

    const out = await sharp(posterBuffer)
      .resize(TARGET_W, TARGET_H, { fit: "cover", position: "centre" })
      .composite(composites)
      .jpeg({ quality: 85, chromaSubsampling: "4:2:0" })
      .toBuffer();

    setPosterCache(memKey, out);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=604800, immutable");
    return res.send(out);
  } catch (err) {
    console.error("Poster error:", err.message, err.stack);
    return res.status(500).send("Error rendering poster");
  }
});

// Warm rank SVG + catalogs so first user hit is instant
try {
  for (let n = 1; n <= 10; n++) getRankAssets(n);
  getVignettePng().catch(() => {});
} catch (_) {}
setTimeout(() => {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://127.0.0.1:3000";
  refreshCatalog("series", base);
  refreshCatalog("movie", base);
}, 500);

module.exports = app;
