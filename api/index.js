"use strict";
// Top 10 for Nuvio | v5.1.0. Strict digital-release gate; premium side-rank cinematic layout.
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
const POSTER_CACHE_VERSION = 'v510-side-rank-clean-meta';
const DIGITAL_RELEASE_STRICT = process.env.DIGITAL_RELEASE_STRICT !== 'false';
const digitalCache = new Map();
const digitalInFlight = new Map();
const CATALOG_TTL = 6 * 60 * 60 * 1000;
const CATALOG_SUCCESS_HEADER = 'public, max-age=60, s-maxage=21600, stale-while-revalidate=86400, stale-if-error=86400';
const LOG = (...args) => console.log('[top10]', ...args);
const catalogCache = new Map();
const catalogInFlight = new Map();
const posterCache = new Map();
const posterInFlight = new Map();
const rankAssetCache = new Map();
const genrePngCache = new Map();
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
  version: '5.1.0',
  name: 'Top 10 Trending (Apple TV Style)',
  description: 'Premium cinematic Top 10 for Nuvio. Strict digital-release movies with elite side-rank poster design and refined Apple TV-style metadata.',
  resources: ['catalog'],
  types: ['movie','series'],
  idPrefixes: ['tt'],
  catalogs: [
    { id:'top10_trending_shows', type:'series', name:'Top 10 Trending Shows', posterShape:'poster', extraSupported:[] },
    { id:'top10_trending_movies',type:'movie',name:'Top 10 Trending Movies',posterShape:'poster',extraSupported:[] }
  ]
};
// The original filtering preferences are retained (with a safe relaxed fallback).
const ANIME_TITLE_RE = /\b(anime|one piece|naruto|boruto|demon slayer|kimetsu|jujutsu kaisen|attack on titan|shingeki|solo leveling|frieren|bleach|dragon ball|chainsaw man|spy x family|my hero academia|hunter x hunter|tokyo ghoul|death note|evangelion|studio ghibli|ghibli|pokemon|pokémon|digimon|sailor moon|inuyasha|fullmetal|haikyuu|black clover|one punch|mob psycho|vinland saga|dandadan|kaiju no\.?\s*8|blue lock|oshi no ko)\b/i;
function isAnime(item) {
  const title = String(item.title || item.name || '');
  const isJapanAnimation = item.original_language === 'ja' && (item.genre_ids || []).includes(16);
  return ANIME_TITLE_RE.test(title) || isJapanAnimation || String(item.mediatype || '').toLowerCase() === 'anime';
}
function excluded(item, type) {
  if (!item) return true;
  if (isAnime(item) && !/cyberpunk.*edge\s*runners/i.test(item.title || item.name || '')) return true;
  if (type === 'series' && (item.genre_ids || []).some(id => [10762,10763,10767].includes(Number(id)))) return true;
  if (String(item.original_language || '').toLowerCase().startsWith('zh')) return true;
  return false;
}
function released(item,type) {
  const date = type === 'movie' ? item.release_date || item.released : item.first_air_date || item.release_date;
  if (!date || !/^\d{4}-\d\d-\d\d/.test(String(date))) return true;
  return String(date).slice(0,10) <= new Date().toISOString().slice(0,10);
}
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
async function mdblistFallback(type) {
  const paths = type === 'movie'
    ? ['/lists/snoak/trending-movies/json']
    : ['/lists/snoak/trakt-s-trending-shows/json','/lists/snoak/most-popular-shows-on-rotten-tomatoes/json'];
  for (const p of paths) {
    try {
      const r = await api.get(`${MDBLIST_BASE}${p}`,{timeout:5000});
      const list = rawList(r.data);
      if(list.length) return list;
    } catch (e) {LOG('MDBList fallback unavailable',type,e.message);}
  }
  return [];
}
async function fetchCandidates(type) {
  const media = type==='series' ? 'tv':'movie';
  const paths = [`/trending/${media}/day`, `/trending/${media}/week`];
  let all = [];
  for(const route of paths) {
    if (!TMDB_KEY) break;
    const responses = await Promise.allSettled([1,2].map(page=>tmdbGet(route,{page},5500)));
    for (const result of responses) {
      if(result.status==='fulfilled') all.push(...rawList(result.value));
      else LOG('TMDB unavailable',route,result.reason?.message);
    }
    if(all.length>=35) break;
  }
  all = distinct(all);
  if(all.length < 10) all = distinct([...all,...await mdblistFallback(type)]);
  return all.slice(0,65);
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
/**
 * TMDB release type 4 is Digital; type 3 is theatrical, 5 physical.
 * For movies we only accept a confirmed digital date on/before today.
 * An unknown date, an API error, or a scheduled future date is NOT confirmation.
 * Values are cached separately so many catalog refreshes do not hammer TMDB.
 */
async function digitalStatus(tmdbId) {
  tmdbId = cleanTmdb(tmdbId);
  if (!tmdbId) return null;
  const now = Date.now();
  const hit = digitalCache.get(tmdbId);
  if (hit && hit.expiry > now) return hit.value;
  if (digitalInFlight.has(tmdbId)) return digitalInFlight.get(tmdbId);
  const pending = (async () => {
    try {
      const data = await tmdbGet(`/movie/${tmdbId}/release_dates`, {}, 4000);
      const today = new Date().toISOString().slice(0,10);
      const dates = (data?.results || []).flatMap(c => c?.release_dates || [])
        .filter(r => Number(r.type) === 4)
        .map(r => String(r.release_date || '').slice(0,10))
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
      const available = dates.some(d => d <= today);
      // A film can have a theatrical date in the past and a digital date in the future.
      // Both missing and future-only digital dates are excluded in strict mode.
      putLru(digitalCache, tmdbId,
        {value: available, expiry: now + (available ? 24*3600000 : 3*3600000)}, 600);
      return available;
    } catch(e) {
      LOG('Digital release check unavailable',tmdbId,e.message);
      // Retry uncertain API responses; never treat a failure as a confirmed release.
      putLru(digitalCache, tmdbId, {value:null,expiry:now+5*60000},600);
      return null;
    } finally {
      digitalInFlight.delete(tmdbId);
    }
  })();
  digitalInFlight.set(tmdbId,pending);
  return pending;
}

/** Additional popular movies with confirmed digital release dates in TMDB's
 *  discover index. Only fetched when the trending candidates cannot fill 10.
 *  Regions broaden coverage; digitalStatus still independently validates every
 *  selected movie against all available dated type-4 records.
 */
async function extraDigitalCandidates() {
  if (!TMDB_KEY) return [];
  const today = new Date().toISOString().slice(0,10);
  const regions = ['US','FI','GB'];
  const calls = regions.flatMap(region => [1,2].map(page =>
    tmdbGet('/discover/movie', {
      region, page, with_release_type:4, 'release_date.lte':today,
      sort_by:'popularity.desc', include_adult:false, 'vote_count.gte':30
    },5500).then(rawList).catch(e => {LOG('Digital discover failed',region,page,e.message);return [];})
  ));
  const result = await Promise.all(calls);
  return distinct(result.flat()).slice(0,100);
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
  return /^\/[\w\-.]+$/.test(path) ? `https://image.tmdb.org/t/p/w1280${path}` : '';
}
function rankPosterUrl(host,item,type,rank,imdb){
  const p = new URLSearchParams({id:imdb, rank:String(rank),type,
    tmdb:cleanTmdb(item.tmdb_id||item.tmdbid||item.id),
    g:genreFromItem(item), r: Number(item.vote_average)>0?Number(item.vote_average).toFixed(1):'',
    p:tmdbPoster(item), n:String(item.title||item.name||''), v:POSTER_CACHE_VERSION});
  return `${host}/api/poster?${p.toString()}`;
}
async function buildCatalog(type,host) {
  const raw = await fetchCandidates(type);
  let queue = distinct(raw).filter(item => !excluded(item,type) && released(item,type));
  const resolved=[];
  const usedImdb=new Set();
  const checkedTmdb=new Set();
  async function fill(candidates) {
    for (let i=0; i<candidates.length && resolved.length<10; i+=12) {
      const group=candidates.slice(i,i+12).filter(item => {
        const tmdb=cleanTmdb(item.tmdb_id||item.tmdbid||item.id);
        if (!tmdb || checkedTmdb.has(tmdb)) return false;
        checkedTmdb.add(tmdb);
        return true;
      });
      if(!group.length)continue;
      const results=await mapLimited(group,8,async item=>{
        if (type==='movie' && DIGITAL_RELEASE_STRICT) {
          const digital=await digitalStatus(item.tmdb_id||item.tmdbid||item.id);
          if (digital!==true) return null;
        }
        const id=await resolveImdbId(item,type);
        return validImdb(id) ? {item,id} : null;
      });
      for(const result of results) {
        if(!result || usedImdb.has(result.id) || resolved.length>=10)continue;
        usedImdb.add(result.id);
        resolved.push(result);
      }
    }
  }
  await fill(queue);
  if(type==='movie' && resolved.length<10) {
    const extra=await extraDigitalCandidates();
    queue=extra.filter(item=>!excluded(item,'movie')&&released(item,'movie'));
    await fill(queue);
  }
  if(!resolved.length) throw new Error(`No confirmed ${type==='movie'?'digital movies':'shows'} with IMDb IDs`);
  if(resolved.length<10) LOG('Only',resolved.length,'eligible',type,'titles found');
  return resolved.map(({item,id},i)=>{
    const meta={id,type,name:String(item.title||item.name||'Untitled'),
      poster:rankPosterUrl(host,item,type,i+1,id),posterShape:'poster',
      description:String(item.overview||item.description||'')};
    const bg=tmdbBackdrop(item);
    if(bg)meta.background=bg;
    const date=item.release_date||item.first_air_date||item.released;
    if(date)meta.releaseInfo=String(date).slice(0,10);
    return meta;
  });
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
  const isTen = Number(num) === 10;
  const railCenterX = Math.round(TARGET_W * 0.132);
  const rankY = Math.round(TARGET_H * 0.60);
  const rankFont = Math.round(TARGET_H * (isTen ? 0.285 : 0.335));
  const tracking = isTen ? '-0.055em' : '-0.07em';
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
  // Preserve original artwork design (textless film art + title-logo where available).
  const presets={tg:'off',bgr:'custom',bgo:'0.3',bgh:'0.55',tvso:'1',vpct:'1',vpcb:'1',
    vcsa:'1.55',vcb:'0.60',vcli:'1.60',vcs:'muted',hg:'1',sm:'hidden',
    _bgr:'off',_vcsa:'2.00',_vcb:'1.00',_vcli:'1.30',_vcs:'shade',
    _hy:'1',_hr:'1',_art:'original',bp:'top_left',_cl:'off',fti:'1',trs:'direct',
    mw:'lb:.25,pc:.1,im:.4,mal:.25',tw:'pc:.1,im:.5,mc:.15,mal:.25',
    rdm:'0',pp:'random',ll:'fi',lp:'native,custom,english,neutral,native_if_original,original,text',
    lls:'fi',fbs:'photoreal',lmwr:'0.80',lmhr:'0.40',lbr:'0.20',cg:'0',hur:'1',bdm:'0'};
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
  ok:true,version:MANIFEST.version,tmdbConfigured:Boolean(TMDB_KEY),digitalReleaseStrict:DIGITAL_RELEASE_STRICT,posterWidth:TARGET_W,
  posterCacheItems:posterCache.size,catalogs:[...catalogCache.values()].map(v=>({items:v.metas.length,ageSeconds:Math.round((Date.now()-v.ts)/1000)})),
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
