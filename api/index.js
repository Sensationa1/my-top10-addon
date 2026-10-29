"use strict";
// Top 10 for Nuvio | v5.8.0. Official TMDB Trending Today charts; premium side-rank cinematic layout.
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { Resvg } = require('@resvg/resvg-js');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.use(cors());
const api = axios.create({
  httpAgent: new http.Agent({keepAlive: true, maxSockets: 16}),
  httpsAgent: new https.Agent({keepAlive: true, maxSockets: 16}),
  maxRedirects: 3,
});
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const MDBLIST_KEY = process.env.MDBLIST_API_KEY || '';
const TMDB_BASE = (process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/$/, '');
const MDBLIST_BASE = (process.env.MDBLIST_BASE || 'https://mdblist.com').replace(/\/$/, '');
const POSTERSPLUS_BASE = (process.env.POSTERSPLUS_BASE_URL || 'https://postersplus.slokker.cc').replace(/\/$/, '');
const POSTER_WIDTH = Math.max(720, Math.min(2160, Number(process.env.POSTER_WIDTH || 1080) || 1080));
const TARGET_W = Math.round(POSTER_WIDTH / 2) * 2;
const TARGET_H = Math.round(TARGET_W * 1.5);
const POSTER_CACHE_VERSION = 'v580-tmdb-trending-today'; // Same poster design; refresh URLs after chart source change
const CATALOG_TTL = 60 * 60 * 1000; // Refresh official daily chart about hourly
const CATALOG_SUCCESS_HEADER = 'public, max-age=60, s-maxage=1800, stale-while-revalidate=3600, stale-if-error=86400';
const LOG = (...args) => console.log('[top10]', ...args);
const catalogCache = new Map();
const catalogInFlight = new Map();
const posterCache = new Map();
const posterInFlight = new Map();
const rankAssetCache = new Map();
const genrePngCache = new Map();
const imdbRatingCache = new Map();
const tmdbDetailsCache = new Map();
const tmdbDetailsInFlight = new Map();
const TMDB_ENRICHMENT_ENABLED = process.env.TMDB_META_ENRICHMENT !== 'false';
const TMDB_ENRICHMENT_TTL = 12 * 60 * 60 * 1000;
let CACHED_BACKGROUND_OVERLAY_PNG = null;
let CACHED_CARD_FRAME_PNG = null;

function putLru(map, key, value, max) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}
const GENRE_MAP = {
  28:'ACTION',12:'ADVENTURE',16:'ANIMATION',35:'COMEDY',80:'CRIME',99:'DOCUMENTARY',
  18:'DRAMA',10751:'FAMILY',14:'FANTASY',36:'HISTORY',27:'HORROR',10402:'MUSIC',
  9648:'MYSTERY',10749:'ROMANCE',878:'SCI-FI',10770:'TV MOVIE',53:'THRILLER',
  10752:'WAR',37:'WESTERN',10759:'ACTION',10765:'SCI-FI',10768:'WAR'
};
const MANIFEST = {
  id: 'com.sensationa1.top10.cloud',
  version: '5.8.0',
  name: 'Top 10 Trending (Apple TV Style)',
  description: 'Official TMDB Trending Today Top 10 movies and series with TMDB title details, backdrops, title logos, and premium ranked posters.',
  resources: ['catalog'],
  types: ['movie','series'],
  idPrefixes: ['tt'],
  catalogs: [
    { id:'top10_trending_shows', type:'series', name:'Top 10 Trending Shows', posterShape:'poster', extraSupported:[] },
    { id:'top10_trending_movies',type:'movie',name:'Top 10 Trending Movies',posterShape:'poster',extraSupported:[] }
  ]
};
function hostUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const forwarded = String(req.get('x-forwarded-proto') || 'https').split(',')[0];
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : 'https';
  return `${proto}://${req.get('host')}`;
}
function validImdb(id) { return /^tt\d{5,12}$/.test(String(id || '')); }
function cleanTmdb(id) {return /^\d+$/.test(String(id || '')) ? String(id) : '';}
async function tmdbGet(uri, params={}, timeout=4500) {
  if (!TMDB_KEY) throw new Error('Missing TMDB_API_KEY in Vercel environment');
  const r = await api.get(`${TMDB_BASE}${uri}`, {params:{api_key:TMDB_KEY,...params}, timeout});
  return r.data;
}
// Per-request limit on lookup bursts; tiny enough to avoid API spikes.
async function mapLimited(items, concurrency, fn) {
  let cursor = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while (cursor < items.length) {
      const i = cursor++;
      try {out[i] = await fn(items[i], i);} catch (_) {out[i]=null;}
    }
  }));
  return out;
}
function rawList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}
function distinct(items) {
  const ids = new Set();
  return items.filter(it=>{
    const k = String(it.tmdb_id || it.tmdbid || it.id || it.imdb_id || it.imdbid || '').trim();
    if (!k || ids.has(k)) return false;
    ids.add(k);return true;
  });
}
// Official, unmodified TMDB Trending Today order. Exactly the first ten chart
// entries are eligible: no regional Discover, genre, language, or release gates.
// Unlike a custom ranking, items remain at their native TMDB chart positions.
async function fetchCandidates(type) {
  const media = type === 'series' ? 'tv' : 'movie';
  const data = await tmdbGet(`/trending/${media}/day`, {language:'en-US',page:1}, 5500);
  const items = rawList(data).slice(0,10);
  if (!items.length) throw new Error(`TMDB Trending Today returned no ${type} titles`);
  return items;
}
const imdbCache = new Map();
async function resolveImdbId(item,type) {
  const imdb = item.imdb_id || item.imdbid || item.external_ids?.imdb_id;
  if (validImdb(imdb)) return imdb;
  let tmdb = item.tmdb_id || item.tmdbid || item.id;
  tmdb=cleanTmdb(tmdb);
  if(!tmdb) return null;
  const key = `${type}:${tmdb}`;
  const hit=imdbCache.get(key);
  if(hit && Date.now()-hit.ts<86400000) return hit.id;
  try {
    const data=await tmdbGet(`/${type==='series'?'tv':'movie'}/${tmdb}/external_ids`,{},3500);
    const found = validImdb(data?.imdb_id) ? data.imdb_id : null;
    if(found) putLru(imdbCache,key,{id:found,ts:Date.now()},500);
    return found;
  }catch(_){return null;}
}
function genreFromItem(item) {
  const gid=Array.isArray(item.genre_ids) ? Number(item.genre_ids[0]) : null;
  if (GENRE_MAP[gid]) return GENRE_MAP[gid];
  const g = item.genres?.[0];
  return String(typeof g==='string' ? g : g?.name || '').trim().toUpperCase().slice(0,30);
}
function tmdbPoster(item){
  const path=String(item.poster_path || '');
  return /^\/[\w\-.]+$/.test(path) ? `https://image.tmdb.org/t/p/original${path}` : '';
}
function tmdbBackdrop(item){
  const path=String(item.backdrop_path || '');
  // TMDB original artwork retains the full backdrop resolution for 4K TVs.
  return /^\/[\w\-.]+$/.test(path) ? `https://image.tmdb.org/t/p/original${path}` : '';
}
function tmdbLogoPath(path){
  const value=String(path || '');
  // TMDB title logo images are typically transparent PNGs.
  return /^\/[\w\-.]+\.png$/i.test(value) ? `https://image.tmdb.org/t/p/original${value}` : '';
}
function bestTmdbLogo(images, originalLanguage='en') {
  const logos=(Array.isArray(images?.logos)?images.logos:[])
    .filter(img => tmdbLogoPath(img?.file_path));
  if(!logos.length) return '';
  function priority(img) {
    const lang=img.iso_639_1;
    return lang==='en' ? 3 : lang===null || lang===undefined ? 2 : lang===originalLanguage ? 1 : 0;
  }
  logos.sort((a,b)=>priority(b)-priority(a) ||
    Number(b.vote_average||0)-Number(a.vote_average||0) ||
    Number(b.vote_count||0)-Number(a.vote_count||0) ||
    Number(b.width||0)-Number(a.width||0));
  return tmdbLogoPath(logos[0].file_path);
}
async function tmdbDetailsFor(item,type) {
  if(!TMDB_ENRICHMENT_ENABLED) return null;
  const id=cleanTmdb(item?.tmdb_id||item?.tmdbid||item?.id);
  if(!id) return null;
  const key=`${type}:${id}`;
  const now=Date.now();
  const cached=tmdbDetailsCache.get(key);
  if(cached && cached.expiry>now) return cached.data;
  if(tmdbDetailsInFlight.has(key)) return tmdbDetailsInFlight.get(key);
  const pending=(async()=>{
    try {
      const originalLang=/^[a-z]{2}$/i.test(String(item.original_language||''))
        ? String(item.original_language).toLowerCase() : 'en';
      const langs=[...new Set(['en','null',originalLang])].join(',');
      const data=await tmdbGet(`/${type==='series'?'tv':'movie'}/${id}`,
        {language:'en-US',append_to_response:'images,credits,videos',include_image_language:langs},
        Number(process.env.TMDB_META_TIMEOUT_MS||4000));
      putLru(tmdbDetailsCache,key,{data,expiry:now+TMDB_ENRICHMENT_TTL},240);
      return data;
    }catch(err){
      LOG('TMDB metadata enrichment unavailable',type,id,err.message);
      // Avoid hammering a failing upstream, but retry after a short interval.
      putLru(tmdbDetailsCache,key,{data:null,expiry:now+5*60000},240);
      return null;
    }finally{tmdbDetailsInFlight.delete(key);}
  })();
  tmdbDetailsInFlight.set(key,pending);
  return pending;
}
function enrichMetaFromTmdb(base, item, details, type, rating) {
  // TMDB Discover already includes overview / date / backdrop. Details add
  // official genres, crew, runtime, trailers and clearlogos when available.
  const d=details && typeof details==='object' ? details : {};
  const date=String((type==='series'?d.first_air_date:d.release_date) ||
    (type==='series'?item.first_air_date:item.release_date) || item.released || '').slice(0,10);
  const meta={...base};
  const description=String(d.overview||item.overview||item.description||'').trim();
  if(description) meta.description=description;
  const backdrop=tmdbBackdrop(d) || tmdbBackdrop(item);
  if(backdrop) meta.background=backdrop;
  const logo=bestTmdbLogo(d.images,d.original_language||item.original_language);
  if(logo) meta.logo=logo;
  const genres=Array.isArray(d.genres) ? d.genres.map(g=>String(g?.name||'').trim()).filter(Boolean) : [];
  if(genres.length)meta.genres=genres;
  else if(Array.isArray(item.genre_ids)) {
    const fallback=item.genre_ids.map(g=>GENRE_MAP[Number(g)]).filter(Boolean).map(g=>formatGenreLabel(g));
    if(fallback.length)meta.genres=[...new Set(fallback)];
  }
  const year=/^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0,4) : '';
  if(year){
    meta.released=`${date}T00:00:00.000Z`;
    const lastYear=String(d.last_air_date||'').slice(0,4);
    meta.releaseInfo=type==='series' ? (
      d.in_production===true ? `${year}-` : lastYear && lastYear!==year ? `${year}-${lastYear}` : year
    ) : year;
  }
  const runtime=type==='movie' ? Number(d.runtime) :
    Array.isArray(d.episode_run_time) ? Number(d.episode_run_time.find(n=>Number(n)>0)) : 0;
  if(Number.isFinite(runtime) && runtime>0) meta.runtime=`${Math.round(runtime)} min`;
  const cast=(Array.isArray(d.credits?.cast)?d.credits.cast:[])
    .map(person=>String(person?.name||'').trim()).filter(Boolean).slice(0,8);
  if(cast.length)meta.cast=cast;
  const directors=type==='movie' ? (Array.isArray(d.credits?.crew)?d.credits.crew:[])
    .filter(p=>p.job==='Director').map(p=>String(p.name||'').trim()).filter(Boolean) :
    (Array.isArray(d.created_by)?d.created_by:[]).map(p=>String(p.name||'').trim()).filter(Boolean);
  if(directors.length)meta.director=[...new Set(directors)].slice(0,5);
  const trailers=(Array.isArray(d.videos?.results)?d.videos.results:[])
    .filter(v=>v.site==='YouTube' && v.type==='Trailer' && /^[a-zA-Z0-9_-]{11}$/.test(v.key||''))
    .sort((a,b)=>Number(Boolean(b.official))-Number(Boolean(a.official)))
    .slice(0,2).map(v=>({source:v.key,type:'Trailer'}));
  if(trailers.length)meta.trailers=trailers;
  if(rating)meta.imdbRating=rating;
  const language=String(d.original_language||item.original_language||'');
  if(language)meta.language=language;
  const countries=Array.isArray(d.origin_country)?d.origin_country:
    Array.isArray(d.production_countries)?d.production_countries.map(v=>v.iso_3166_1):[];
  if(countries.length)meta.country=countries.filter(Boolean).join(', ');
  return meta;
}
function rankPosterUrl(host,item,type,rank,imdb,displayRating){
  const p = new URLSearchParams({id:imdb, rank:String(rank),type,
    tmdb:cleanTmdb(item.tmdb_id||item.tmdbid||item.id),
    g:genreFromItem(item), r: displayRating || '',
    p:tmdbPoster(item), n:String(item.title||item.name||''), v:POSTER_CACHE_VERSION});
  return `${host}/api/poster?${p.toString()}`;
}

function normalizeRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n.toFixed(1) : '';
}
function extractImdbRating(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [
    payload.imdb_rating,
    payload.imdbRating,
    payload?.ratings?.imdb,
    payload?.scores?.imdb,
    payload?.score?.imdb,
    payload?.score_average?.imdb,
    payload?.rating?.imdb,
    payload?.imdbrating,
    payload?.imdb?.rating
  ];
  for (const c of candidates) {
    const v = normalizeRating(c);
    if (v) return v;
  }
  return '';
}
async function imdbRatingFor(tmdbId, type, fallback) {
  const tmdb = cleanTmdb(tmdbId);
  const fallbackRating = normalizeRating(fallback);
  if (!tmdb || !MDBLIST_KEY) return fallbackRating;
  const key = `${type}:${tmdb}`;
  const cached = imdbRatingCache.get(key);
  if (cached && Date.now() - cached.ts < 7 * 24 * 60 * 60 * 1000) return cached.value || fallbackRating;
  const mediaPath = type === 'series' ? 'show' : 'movie';
  const url = `https://api.mdblist.com/tmdb/${mediaPath}/${tmdb}?apikey=${MDBLIST_KEY}`;
  try {
    const res = await api.get(url, { timeout: Number(process.env.MDBLIST_TIMEOUT_MS || 3500) });
    const value = extractImdbRating(res.data) || fallbackRating;
    imdbRatingCache.set(key, { value, ts: Date.now() });
    return value;
  } catch (err) {
    LOG('IMDb rating lookup failed', type, tmdb, err.message);
    imdbRatingCache.set(key, { value: fallbackRating, ts: Date.now() });
    return fallbackRating;
  }
}
async function buildCatalog(type,host) {
  const top10 = await fetchCandidates(type);
  // Get IMDb IDs only for the official Top 10. Never substitute #11+ titles
  // or renumber remaining cards when an entry lacks a usable IMDb ID.
  // IMDb IDs remain necessary for the user's existing Nuvio stream resolvers.
  const resolved = await mapLimited(top10,8,async (item,index)=>{
    const id = await resolveImdbId(item,type);
    if (!validImdb(id)) {
      LOG('Official TMDB trending chart item lacks IMDb ID',type,index+1,item.id);
      return null;
    }
    const imdbRating = await imdbRatingFor(item.tmdb_id||item.tmdbid||item.id,type,item.vote_average);
    return {item,id,imdbRating,rank:index+1};
  });
  const eligible = resolved.filter(Boolean);
  if(!eligible.length) throw new Error(`No TMDB Trending Today ${type} titles have resolvable IMDb IDs`);
  // Metadata enrichment preserves original TMDB ordering and rank position.
  const metas = await mapLimited(eligible,8,async ({item,id,imdbRating,rank})=>{
    const base={id,type,name:String(item.title||item.name||'Untitled'),
      poster:rankPosterUrl(host,item,type,rank,id,imdbRating),posterShape:'poster'};
    const details=await tmdbDetailsFor(item,type);
    return enrichMetaFromTmdb(base,item,details,type,imdbRating);
  });
  return metas.filter(Boolean);
}

function catalogValid(type,id){return (type==='movie'&&id==='top10_trending_movies')||(type==='series'&&id==='top10_trending_shows');}
async function getCatalog(type,host,force=false){
  const key=`${type}:${host}`;
  const cached=catalogCache.get(key);
  if(!force && cached && Date.now()-cached.ts<CATALOG_TTL)return cached.metas;
  if(catalogInFlight.has(key))return catalogInFlight.get(key);
  const pending=(async()=>{
    try{
      const metas=await buildCatalog(type,host);
      putLru(catalogCache,key,{metas,ts:Date.now()},8);
      LOG('Catalog refreshed',type,metas.length);
      return metas;
    }catch(err){
      LOG('Catalog error',type,err.message);
      if(cached?.metas?.length) return cached.metas;
      throw err;
    }finally{catalogInFlight.delete(key);}
  })();
  catalogInFlight.set(key,pending);
  return pending;
}

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
  const ratingValue = rating ? String(rating).trim() : '';
  const parts = [];
  if (g) parts.push(g);
  if (ratingValue) parts.push(ratingValue);
  if (!parts.length) return null;

  const safeGenre = g ? g.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';
  const safeRating = ratingValue ? ratingValue.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';
  const fontSize = Math.round(height * 0.029);
  const x = Math.round(width * 0.58);
  const y = Math.round(height * 0.915);
  const gap = Math.round(fontSize * 0.85);
  const genreLen = safeGenre ? Math.max(4, safeGenre.length) : 0;
  const genreApprox = genreLen * fontSize * 0.46;
  const ratingApprox = safeRating ? Math.max(3, safeRating.length) * fontSize * 0.46 : 0;
  const totalApprox = genreApprox + (safeGenre && safeRating ? gap : 0) + ratingApprox;
  let cursor = x - totalApprox / 2;
  const genreX = cursor + genreApprox / 2;
  cursor += genreApprox + (safeGenre && safeRating ? gap : 0);
  const ratingX = cursor + ratingApprox / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="metaShadow" x="-60%" y="-100%" width="220%" height="280%">
      <feDropShadow dx="0" dy="2" stdDeviation="3.2" flood-color="#000000" flood-opacity="0.38"/>
    </filter>
  </defs>
  <g filter="url(#metaShadow)">
    ${safeGenre ? `<text x="${genreX}" y="${y}" text-anchor="middle" font-family="SF Pro Display" font-weight="400" font-size="${fontSize}" fill="#F4F7FB" fill-opacity="0.96" letter-spacing="0.01em">${safeGenre}</text>` : ''}
    ${safeRating ? `<text x="${ratingX}" y="${y}" text-anchor="middle" font-family="SF Pro Display" font-weight="400" font-size="${fontSize}" fill="#DCE4EE" fill-opacity="0.92" letter-spacing="0.01em">${safeRating}</text>` : ''}
  </g>
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
 * Pre-renders and caches the static side-mounted ranking layer (1..10),
 * giving every poster a consistent Netflix-style number position.
 */
function getRankAssets(num) {
  if (rankAssetCache.has(num)) return rankAssetCache.get(num);
  const value = Number(num);
  const isTen = value === 10;
  const isOne = value === 1;
  const railCenterX = Math.round(TARGET_W * (isTen ? 0.132 : isOne ? 0.145 : 0.158));
  const rankY = Math.round(TARGET_H * 0.60);
  const rankFont = Math.round(TARGET_H * (isTen ? 0.285 : isOne ? 0.335 : 0.302));
  const tracking = isTen ? '-0.055em' : '-0.06em';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${TARGET_W}" height="${TARGET_H}" viewBox="0 0 ${TARGET_W} ${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="rankFill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="20%" stop-color="#F7F9FC"/>
      <stop offset="58%" stop-color="#D4DDE6"/>
      <stop offset="100%" stop-color="#99A6B4"/>
    </linearGradient>
    <filter id="rankShadow" x="-100%" y="-100%" width="300%" height="300%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000000" flood-opacity="0.30"/>
    </filter>
  </defs>
  <text x="${railCenterX}" y="${rankY}" text-anchor="middle" dominant-baseline="middle" font-family="Inter Display" font-weight="900" font-size="${rankFont}" letter-spacing="${tracking}" fill="url(#rankFill)" filter="url(#rankShadow)">${num}</text>
</svg>`;
  const assets = {rankLayer: renderSvgToPng(svg, TARGET_W)};
  rankAssetCache.set(num, assets);
  return assets;
}

async function getBackgroundOverlayPng() {
  if (CACHED_BACKGROUND_OVERLAY_PNG) return CACHED_BACKGROUND_OVERLAY_PNG;
  const overlaySvg = Buffer.from(`
    <svg width="${TARGET_W}" height="${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="leftFade" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#05070B" stop-opacity="0.62"/>
          <stop offset="24%" stop-color="#05070B" stop-opacity="0.42"/>
          <stop offset="52%" stop-color="#05070B" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#05070B" stop-opacity="0.00"/>
        </linearGradient>
        <linearGradient id="globalDim" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#09111A" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="#02050A" stop-opacity="0.18"/>
        </linearGradient>
      </defs>
      <rect width="${TARGET_W}" height="${TARGET_H}" fill="url(#globalDim)"/>
      <rect width="${Math.round(TARGET_W * 0.42)}" height="${TARGET_H}" fill="url(#leftFade)"/>
    </svg>`);
  CACHED_BACKGROUND_OVERLAY_PNG = await sharp(overlaySvg).png().toBuffer();
  return CACHED_BACKGROUND_OVERLAY_PNG;
}

async function getCardFramePng() {
  if (CACHED_CARD_FRAME_PNG) return CACHED_CARD_FRAME_PNG;
  const cardLeft = Math.round(TARGET_W * 0.17);
  const cardTop = Math.round(TARGET_H * 0.045);
  const cardW = Math.round(TARGET_W * 0.79);
  const cardH = Math.round(TARGET_H * 0.91);
  const radius = Math.round(TARGET_W * 0.028);
  const frameSvg = Buffer.from(`
    <svg width="${TARGET_W}" height="${TARGET_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="cardShadow" x="-40%" y="-40%" width="180%" height="220%">
          <feDropShadow dx="0" dy="26" stdDeviation="22" flood-color="#000000" flood-opacity="0.46"/>
        </filter>
        <linearGradient id="cardStroke" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.10"/>
        </linearGradient>
      </defs>
      <rect x="${cardLeft}" y="${cardTop}" width="${cardW}" height="${cardH}" rx="${radius}" fill="#000000" fill-opacity="0.01" filter="url(#cardShadow)"/>
      <rect x="${cardLeft}" y="${cardTop}" width="${cardW}" height="${cardH}" rx="${radius}" fill="none" stroke="url(#cardStroke)" stroke-width="1.3"/>
    </svg>`);
  CACHED_CARD_FRAME_PNG = await sharp(frameSvg).png().toBuffer();
  return CACHED_CARD_FRAME_PNG;
}


function buildPostersPlusUrl({imdbId,tmdbId,stremioId,type}) {
  const params=new URLSearchParams();
  if(tmdbId)params.set('tmdb_id',String(tmdbId));
  if(imdbId)params.set('imdb_id',String(imdbId));
  params.set('stremio_id',stremioId||imdbId||'');
  params.set('type',type);
  params.set('shape','poster');
  params.set('pc','stremio_tv_nuvio');
  params.set('sbi','0.010');
  if(TMDB_KEY)params.set('tmdb_key',TMDB_KEY);
  if(MDBLIST_KEY)params.set('mdblist_key',MDBLIST_KEY);
  // Use the exact Posters+ tuning specified for your personal Nuvio instance.
  const presets={tg:'off',bgr:'custom',bgo:'0.3',bgh:'0.55',tvso:'1',vpct:'1',vpcb:'1',
    vcsa:'1.55',vcb:'0.60',vcli:'1.60',vcs:'muted',hg:'1',hr:'1',sm:'hidden',
    _bgr:'off',_vcsa:'2.00',_vcb:'1.00',_vcli:'1.30',_vcs:'shade',
    _hy:'1',_art:'original',bp:'top_left',_cl:'off',fti:'1',trs:'direct',
    rdm:'3',mam:'1',mmfsr:'0.056',msoo10:'1',rtc:'FFFFFF',
    mw:'lb:.25,pc:.1,im:.4,mal:.25',tw:'pc:.1,im:.5,mc:.15,mal:.25',
    pp:'random',ll:'fi',lp:'original,native,custom,english,neutral,native_if_original,text',lls:'fi',
    fbs:'photoreal',lmwr:'0.80',lmhr:'0.40',lbr:'0.12',cg:'0',hur:'1',bdm:'7',
    bg1:'0.9,0.075,r:4:network',bls:'1.05'};
  Object.entries(presets).forEach(([k,v])=>params.set(k,v));
  return `${POSTERSPLUS_BASE}/poster?${params.toString()}`;
}
function cleanArtwork(url) {
  try {
    const u=new URL(url);
    return u.protocol==='https:' && u.hostname==='image.tmdb.org' && u.pathname.startsWith('/t/p/') ? u.href : null;
  }catch(_){return null;}
}
function xmlEscape(str) {return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
async function fallbackArt(posterUrl,title) {
  const url=cleanArtwork(posterUrl);
  if(url){
    try{
      const r=await api.get(url,{responseType:'arraybuffer',timeout:4500,maxContentLength:12*1024*1024});
      if(r.data?.byteLength>1000)return Buffer.from(r.data);
    }catch(e){LOG('TMDB artwork fallback',e.message);}
  }
  const safe=xmlEscape(String(title||'TOP 10').slice(0,44));
  const svg=`<svg width="${TARGET_W}" height="${TARGET_H}" xmlns="http://www.w3.org/2000/svg"><defs>
    <linearGradient id="g" x2="1" y2="1"><stop stop-color="#253449"/><stop offset="0.55" stop-color="#151C2A"/><stop offset="1" stop-color="#080D14"/></linearGradient>
    </defs><rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="60%" text-anchor="middle" fill="#f0f4fa" font-size="${Math.round(TARGET_W*.045)}" font-family="sans-serif" font-weight="600">${safe}</text></svg>`;
  return Buffer.from(svg);
}
function tryVercelWaitUntil(promise){
  try{const {waitUntil}=require('@vercel/functions');waitUntil(promise);}catch(_){promise.catch(()=>{});}
}
app.get('/manifest.json',(_req,res)=>{
  res.set('Cache-Control','public, max-age=300, s-maxage=3600');res.json(MANIFEST);
});
app.get('/catalog/:type/:id.json',async(req,res)=>{
  const {type,id}=req.params;
  if(!catalogValid(type,id))return res.status(404).json({error:'Unknown catalog'});
  try{
    const metas=await getCatalog(type,hostUrl(req));
    res.set('Cache-Control',CATALOG_SUCCESS_HEADER);
    return res.json({metas});
  }catch(err){
    res.set('Cache-Control','no-store');
    res.set('Retry-After','30');
    return res.status(503).json({error:'Catalog temporarily unavailable. Retry soon.'});
  }
});
app.get('/api/status',(_req,res)=>res.set('Cache-Control','no-store').json({
  ok:true,version:MANIFEST.version,tmdbConfigured:Boolean(TMDB_KEY),rankingSource:'TMDB Trending Today',digitalReleaseStrict:false,posterWidth:TARGET_W,
  posterCacheItems:posterCache.size,tmdbEnrichment:TMDB_ENRICHMENT_ENABLED,tmdbMetadataCached:tmdbDetailsCache.size,catalogs:[...catalogCache.values()].map(v=>({items:v.metas.length,ageSeconds:Math.round((Date.now()-v.ts)/1000)})),
}));
app.get('/api/poster',async(req,res)=>{
  const {id,rank,type,tmdb,g,r,p,n}=req.query;
  if(!validImdb(id))return res.status(400).send('Invalid IMDb ID');
  const num=Math.min(10,Math.max(1,Number.parseInt(rank,10)||1));
  const mediaType=type==='series'?'series':'movie';
  const signature=`${id}:${num}:${mediaType}:${tmdb}:${g}:${r}:${p}:${POSTER_CACHE_VERSION}:${TARGET_W}`;
  const cached=posterCache.get(signature);
  if(cached) {
    res.set('Content-Type','image/jpeg');res.set('Cache-Control',cached.cacheHeader);
    return res.send(cached.bytes);
  }
  let pending=posterInFlight.get(signature);
  if(!pending){
    pending=(async()=>{
      let source='postersplus';
      let base=null;
      try {
        const pp=await api.get(buildPostersPlusUrl({imdbId:id,tmdbId:cleanTmdb(tmdb),stremioId:id,type:mediaType}),{
          responseType:'arraybuffer',timeout:Number(process.env.POSTERSPLUS_TIMEOUT_MS||9000),
          maxContentLength:14*1024*1024,headers:{Accept:'image/*'}
        });
        if(pp.data?.byteLength>1500 && /image\//i.test(String(pp.headers?.['content-type']||'')))base=Buffer.from(pp.data);
      }catch(e){LOG('PostersPlus timeout / error',e.message);}
      if(!base){source='tmdb-fallback';base=await fallbackArt(p,n);}      const assets = getRankAssets(num);
      const cardLeft = Math.round(TARGET_W * 0.17);
      const cardTop = Math.round(TARGET_H * 0.045);
      const cardW = Math.round(TARGET_W * 0.79);
      const cardH = Math.round(TARGET_H * 0.91);
      const cardRadius = Math.round(TARGET_W * 0.028);

      const roundedMask = Buffer.from(`<svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg"><rect width="${cardW}" height="${cardH}" rx="${cardRadius}" ry="${cardRadius}" fill="#ffffff"/></svg>`);
      let bgPipeline = sharp(base,{limitInputPixels:24e6})
        .resize(TARGET_W, TARGET_H, {fit:'cover', position:'centre'});
      if (typeof bgPipeline.blur === 'function') bgPipeline = bgPipeline.blur(24);
      if (typeof bgPipeline.modulate === 'function') bgPipeline = bgPipeline.modulate({brightness:0.63, saturation:0.88});
      const background = await bgPipeline
        .jpeg({quality:86, chromaSubsampling:'4:4:4', mozjpeg:false})
        .toBuffer();
      let cardPipeline = sharp(base,{limitInputPixels:24e6})
        .resize(cardW, cardH, {fit:'cover', position:'centre'});
      if (typeof cardPipeline.composite === 'function') cardPipeline = cardPipeline.composite([{input:roundedMask, blend:'dest-in'}]);
      const cardImage = await cardPipeline
        .png()
        .toBuffer();
      const composites = [
        {input: await getBackgroundOverlayPng(), top:0, left:0},
        {input: assets.rankLayer, top:0, left:0},
        {input: await getCardFramePng(), top:0, left:0},
        {input: cardImage, top:cardTop, left:cardLeft}
      ];
      const label = buildGenreRatingSvg(TARGET_W, TARGET_H, g||'', r||'');
      if (label) {
        const key = `${g||''}|${r||''}|${TARGET_W}`;
        let png = genrePngCache.get(key);
        if (!png) { png = renderSvgToPng(label, TARGET_W); putLru(genrePngCache, key, png, 25); }
        composites.push({input: png, top:0, left:0});
      }
      const bytes = await sharp(background,{limitInputPixels:24e6})
        .composite(composites)
        .jpeg({quality:90, chromaSubsampling:'4:4:4', mozjpeg:false})
        .toBuffer();
      const cacheHeader=source==='postersplus'
        ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000'
        : 'public, max-age=60, s-maxage=900, stale-while-revalidate=1800';
      const output={bytes,cacheHeader};
      putLru(posterCache,signature,output,24);
      return output;
    })().finally(()=>posterInFlight.delete(signature));
    posterInFlight.set(signature,pending);
  }
  try {
    const result=await pending;
    res.set('Content-Type','image/jpeg');res.set('Cache-Control',result.cacheHeader);
    res.send(result.bytes);
  }catch(err){LOG('Poster render failed',err.message);res.set('Cache-Control','no-store').status(503).send('Poster temporary unavailable');}
});
// Optional Vercel Cron or your own scheduled ping. A valid CRON_SECRET is required.
app.get('/api/refresh',async(req,res)=>{
  const secret=process.env.CRON_SECRET;
  if(!secret || req.get('authorization')!==`Bearer ${secret}`)return res.status(401).send('Unauthorized');
  const host=hostUrl(req);
  // Use same public catalog URLs to warm Vercel's CDN (not in-process memory alone).
  const task=Promise.allSettled(['movie','series'].map(type=>api.get(
    `${host}/catalog/${type}/${type==='movie'?'top10_trending_movies':'top10_trending_shows'}.json`,{timeout:25000,headers:{Pragma:'no-cache','Cache-Control':'no-cache'}}
  )));
  tryVercelWaitUntil(task);
  res.set('Cache-Control','no-store').json({ok:true,requested:['movie','series']});
});
app.get('/',(req,res)=>{
 const h=hostUrl(req);
 res.set('Content-Type','text/html; charset=utf-8').set('Cache-Control','public, max-age=600');
 res.send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>Top 10 — Nuvio</title><style>
 :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 72% 10%,#202a39 0%,#0d121c 40%,#080a0f 80%);color:#f2f5f8;font:16px -apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif;display:grid;place-items:center;padding:24px}
 main{width:min(620px,100%);padding:56px 42px;border-radius:28px;border:1px solid #ffffff16;background:#ffffff08;box-shadow:0 22px 80px #0008}small{color:#9ca9bc;letter-spacing:.3em;font-weight:600}h1{font-size:clamp(2.8rem,6vw,4.2rem);letter-spacing:-.06em;margin:14px 0}p{color:#b8c3d1;line-height:1.6}a{color:#dbe7f8;text-decoration:none}nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}nav a{border-radius:14px;background:#ffffff14;border:1px solid #ffffff22;padding:12px 18px}nav a:hover{background:#ffffff24}footer{font-size:12px;color:#8290a4;margin-top:36px}
 </style><main><small>NUVIO • CINEMATIC CATALOGS</small><h1>Top 10<span style="color:#a5afbd">.</span></h1><p>Trending films and series, curated daily. Premium artwork, side-mounted elite ranks, built for a seamless home screen.</p><nav><a href="${h}/manifest.json">Manifest</a><a href="${h}/api/status">System status</a><a href="stremio://${req.get('host')}/manifest.json">Install in Stremio</a></nav><footer>Version ${MANIFEST.version} · Netflix × Apple TV-inspired independent add-on · Nuvio-compatible</footer></main></html>`);
});
module.exports=app;
if(require.main===module){app.listen(Number(process.env.PORT||3000),()=>LOG('Listening on',process.env.PORT||3000));}
