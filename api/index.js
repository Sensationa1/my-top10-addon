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

const POSTER_CACHE_VERSION = "300";

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
  version: "3.0.0",
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
  const chunkSize = 15;
  for (let i = 0; i < raw.length; i += chunkSize) {
    const chunk = raw.slice(i, i + chunkSize);
    const processed = await Promise.all(chunk.map(async (item) => {
      const enriched = await enrichItemFromTmdb(item, type);
      if (shouldExcludeTrendingItem(enriched, type)) return null;
      if (await isAnimeViaTmdb(enriched, type)) return null;
      return enriched;
    }));
    for (const res of processed) {
      if (res && out.length < limit) out.push(res);
    }
    if (out.length >= limit) break;
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
 * Apple TV / Netflix style rank — metallic gradient, soft depth, top-left.
 * SVG vector at poster resolution for crisp edges (no fuzzy PNG outlines).
 */
async function loadRankOverlay(targetH, rank, posterBuffer, targetW) {
  const n = Math.min(10, Math.max(1, parseInt(rank, 10) || 1));
  const fontSize = Math.round(targetH * 0.30);
  const leftPad = Math.round(targetW * 0.045);
  const topPad = Math.round(targetH * 0.04);
  // baseline for dominant baseline text
  const baseline = topPad + Math.round(fontSize * 0.82);
  const tracking = n >= 10 ? -0.06 : 0;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${targetW}" height="${targetH}" viewBox="0 0 ${targetW} ${targetH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.96"/>
      <stop offset="35%" stop-color="#F1F5F9" stop-opacity="0.90"/>
      <stop offset="70%" stop-color="#CBD5E1" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#94A3B8" stop-opacity="0.18"/>
    </linearGradient>
    <filter id="depth" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.45"/>
      <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.30"/>
    </filter>
  </defs>
  <text
    x="${leftPad}"
    y="${baseline}"
    font-family="Inter Display"
    font-weight="900"
    font-size="${fontSize}"
    fill="url(#metal)"
    letter-spacing="${tracking}em"
    filter="url(#depth)"
  >${n}</text>
</svg>`;

  try {
    const buf = renderSvgToPng(svg, targetW);
    return { buf, left: 0, top: 0 };
  } catch (e) {
    console.error("Rank SVG:", e.message);
    // Fallback: custom digit PNG if SVG fails
    const digitPath = resolveDigitPath(n);
    if (!digitPath) return null;
    const digitH = Math.round(targetH * 0.30);
    const buf = await sharp(digitPath)
      .resize({ height: digitH, fit: "inside" })
      .png()
      .toBuffer();
    return {
      buf,
      left: Math.round(targetW * 0.04),
      top: Math.round(targetH * 0.03),
    };
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

  // SF Pro Display Thin — subtle bottom meta
  const fontSize = Math.round(height * 0.038);
  const y = Math.round(height * 0.94);
  const x = Math.round(width / 2);
  const safe = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="tshadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000000" flood-opacity="0.45"/>
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
    fill-opacity="0.88"
    letter-spacing="0.12em"
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
  const { black, semi, sfMed, sfBold, sfThin } = resolveFonts();
  // Medium = Regular for genre · rating; Thin/Bold available if needed
  const files = [sfThin, black, sfMed, sfBold, semi].filter((p) => p && fs.existsSync(p));
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

    // Primary: PostersPlus portrait
    try {
      const ppUrl = buildPostersPlusUrl({
        imdbId: cleanImdb,
        tmdbId,
        stremioId: id,
        type: mediaType,
        shape: "poster",
      });
      if (ppUrl) {
        const r = await axios.get(ppUrl, {
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
      console.error("PostersPlus:", e.message);
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

    const TARGET_W = 1000;
    const TARGET_H = 1500;
    const num = parseInt(rank, 10) || 1;
    const isTen = num >= 10;

    // 1. Base Poster (Fill exactly 2:3)
    const basePoster = await sharp(posterBuffer)
      .resize(TARGET_W, TARGET_H, { fit: "cover", position: "centre" })
      .toBuffer();

    // 2. Number Overlay (Top-Left)
    const rankFont = Math.round(TARGET_H * 0.26); // 26% of height, visible but not blocking the whole poster
    const rankX = Math.round(TARGET_W * (isTen ? 0.01 : 0.03)); 
    const rankBaseline = Math.round(TARGET_H * 0.03 + rankFont * 0.72); // Top left corner
    const tracking = isTen ? -0.06 : 0;

    const rankSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TARGET_W}" height="${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="100%" stop-color="#E2E8F0" stop-opacity="0.85"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.85"/>
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>
  <text
    x="${rankX}"
    y="${rankBaseline}"
    font-family="Inter Display"
    font-weight="900"
    font-size="${rankFont}"
    fill="url(#grad)"
    letter-spacing="${tracking}em"
    filter="url(#shadow)"
  >${num}</text>
</svg>`;

    const rankPng = renderSvgToPng(rankSvg, TARGET_W);

    // 3. Composite
    const composites = [
      { input: rankPng, top: 0, left: 0 }
    ];

    // Add Genre/Rating if available (at the bottom)
    const genreSvg = buildGenreRatingSvg(TARGET_W, TARGET_H, genre, imdbRating);
    if (genreSvg) {
      try {
        const genrePng = renderSvgToPng(genreSvg, TARGET_W);
        composites.push({ input: genrePng, top: 0, left: 0 });
      } catch (e) {
        console.error("Genre overlay:", e.message);
      }
    }

    const out = await sharp(basePoster)
      .composite(composites)
      .jpeg({ quality: 92 })
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
