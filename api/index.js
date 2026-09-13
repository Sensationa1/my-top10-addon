const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sharp = require("sharp");
require("dotenv").config();

const app = express();
app.use(cors());

// Snoak MDBList sources (public JSON endpoints)
const SNOAK_MOVIES_URL = "https://mdblist.com/lists/snoak/trending-movies/json";
const SNOAK_SHOWS_URL = "https://mdblist.com/lists/snoak/trakt-s-trending-shows/json";
const SNOAK_SHOWS_ALT_URL = "https://mdblist.com/lists/snoak/most-popular-shows-on-rotten-tomatoes/json";

// Cache-bust version — bump whenever poster design changes
const POSTER_CACHE_VERSION = "55";

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "1.2.0",
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

// ---------------------------------------------------------------------------
// TMDB genre ID → uppercase name
// ---------------------------------------------------------------------------
const GENRE_MAP = {
  28: "ACTION",
  12: "ADVENTURE",
  16: "ANIMATION",
  35: "COMEDY",
  80: "CRIME",
  99: "DOCUMENTARY",
  18: "DRAMA",
  10751: "FAMILY",
  14: "FANTASY",
  36: "HISTORY",
  27: "HORROR",
  10402: "MUSIC",
  9648: "MYSTERY",
  10749: "ROMANCE",
  878: "SCI-FI",
  10770: "TV MOVIE",
  53: "THRILLER",
  10752: "WAR",
  37: "WESTERN",
  10759: "ACTION",
  10762: "KIDS",
  10763: "NEWS",
  10764: "REALITY",
  10765: "SCI-FI",
  10766: "SOAP",
  10767: "TALK",
  10768: "WAR",
};

function getHostUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return `${protocol}://${host}`;
}

// ---------------------------------------------------------------------------
// PURE VECTOR DIGITS — no fonts, works on every Vercel / librsvg image.
// Each digit is a filled path inside a 100×160 unit box.
// Styled with metallic gradient + thick white outline + shadow.
// ---------------------------------------------------------------------------
const DIGIT_W = 100;
const DIGIT_H = 160;

// Bold rounded digit paths (viewBox 0 0 100 160)
const DIGIT_PATHS = {
  "0": "M50 8 C22 8 8 28 8 80 C8 132 22 152 50 152 C78 152 92 132 92 80 C92 28 78 8 50 8 Z M50 28 C68 28 72 42 72 80 C72 118 68 132 50 132 C32 132 28 118 28 80 C28 42 32 28 50 28 Z",
  "1": "M58 12 L58 140 L78 140 L78 152 L22 152 L22 140 L38 140 L38 36 L22 48 L22 28 Z",
  "2": "M12 48 C12 28 28 12 50 12 C72 12 88 26 88 48 C88 66 78 78 58 92 L28 112 L28 140 L88 140 L88 152 L12 152 L12 128 L52 98 C66 88 72 78 72 52 C72 38 64 28 50 28 C36 28 28 36 28 48 Z",
  "3": "M18 28 C22 16 34 12 50 12 C72 12 88 26 88 48 C88 64 78 74 64 78 C78 82 90 94 90 114 C90 138 72 152 48 152 C28 152 14 142 10 126 L28 118 C30 128 38 136 50 136 C64 136 72 126 72 114 C72 100 62 92 48 92 L36 92 L36 76 L50 76 C64 76 72 68 72 54 C72 40 64 28 50 28 C38 28 30 34 28 44 Z",
  "4": "M62 12 L62 100 L88 100 L88 116 L62 116 L62 152 L42 152 L42 116 L10 116 L10 98 L42 12 Z M42 100 L42 36 L18 100 Z",
  "5": "M78 12 L22 12 L18 88 L48 88 C66 88 78 100 78 118 C78 136 66 148 48 148 C30 148 20 138 18 124 L36 118 C38 128 42 132 48 132 C56 132 60 126 60 118 C60 110 56 104 48 104 L12 104 L18 12 Z",
  "6": "M50 8 C28 8 12 28 12 80 C12 132 28 152 52 152 C76 152 90 136 90 112 C90 90 76 76 56 76 L40 76 C36 68 34 56 34 46 C34 32 40 24 52 24 C62 24 68 30 70 40 L88 34 C84 16 70 8 50 8 Z M52 92 C66 92 74 102 74 114 C74 128 66 136 52 136 C38 136 30 126 30 112 C30 100 38 92 52 92 Z",
  "7": "M12 12 L88 12 L88 32 L48 152 L26 152 L62 36 L12 36 Z",
  "8": "M50 8 C28 8 14 22 14 44 C14 60 24 72 38 78 C24 84 12 98 12 118 C12 140 28 152 50 152 C72 152 88 140 88 118 C88 98 76 84 62 78 C76 72 86 60 86 44 C86 22 72 8 50 8 Z M50 24 C62 24 70 32 70 44 C70 56 62 64 50 64 C38 64 30 56 30 44 C30 32 38 24 50 24 Z M50 92 C64 92 72 102 72 116 C72 130 64 140 50 140 C36 140 28 130 28 116 C28 102 36 92 50 92 Z",
  "9": "M50 8 C26 8 12 24 12 48 C12 70 26 84 46 84 L60 84 C64 92 66 104 66 114 C66 128 60 136 48 136 C38 136 32 130 30 120 L12 126 C16 144 30 152 50 152 C72 152 88 132 88 80 C88 28 72 8 50 8 Z M50 24 C62 24 70 34 70 48 C70 62 62 72 48 72 C34 72 26 62 26 48 C26 34 34 24 50 24 Z",
};

function digitPath(d) {
  return DIGIT_PATHS[d] || DIGIT_PATHS["1"];
}

/**
 * Build pure-vector rank markup (no <text>, no fonts).
 * Metallic fill + thick white outline + deep shadow.
 * Rank 10 uses tight horizontal overlap (spacing ≈ 0.40 × digit width).
 */
function generateRankSvg(rank) {
  const r = String(rank);
  const isTen = r === "10";
  // Tight overlap for 10: advance only 40% of a full digit width after "1"
  const gap = isTen ? DIGIT_W * 0.40 : DIGIT_W * 0.12;

  let x = 0;
  let shadowPaths = "";
  let outlinePaths = "";
  let fillPaths = "";

  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    const path = digitPath(ch);
    // Shadow (offset down-right, dark)
    shadowPaths += `<path transform="translate(${x + 10},${14})" d="${path}" fill="#000000" opacity="0.55"/>`;
    // Thick white outline (slightly scaled up)
    outlinePaths += `<path transform="translate(${x},0)" d="${path}" fill="#FFFFFF"/>`;
    // Metallic fill on top
    fillPaths += `<path transform="translate(${x},0)" d="${path}" fill="url(#metallicGrad)"/>`;

    // Advance — "1" is narrower
    const advance = ch === "1" ? DIGIT_W * 0.62 : DIGIT_W;
    x += advance + gap;
  }

  // Outline is drawn by scaling the whole group slightly larger behind the fill
  // Using a second pass with stroke is unreliable in some librsvg builds,
  // so we draw a white enlarged silhouette then the gradient fill on top.
  return {
    unitW: x,
    unitH: DIGIT_H,
    markup: `
      <defs>
        <linearGradient id="metallicGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF"/>
          <stop offset="40%" stop-color="#E8EEF4"/>
          <stop offset="100%" stop-color="#94A3B8"/>
        </linearGradient>
      </defs>
      <!-- soft shadow -->
      <g>${shadowPaths}</g>
      <!-- white outline halo (scaled 1.14 around center of each digit is approximated by a second larger draw) -->
      <g transform="translate(-7,-7) scale(1.14)" opacity="1">${outlinePaths.replace(/fill="#FFFFFF"/g, 'fill="#FFFFFF"')}</g>
      <!-- metallic body -->
      <g>${fillPaths}</g>
    `,
  };
}

// ---------------------------------------------------------------------------
// Frosted genre badge — uses ONLY shapes + a minimal 5x7 bitmap font
// so no system font is required on Vercel.
// ---------------------------------------------------------------------------
const BITMAP_FONT = {
  // 5×7 uppercase, 1 = pixel on. Each row is a 5-bit mask left-to-right.
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01111, 0b10000, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10001, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10001, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "-": [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  " ": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
  "&": [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
};

function bitmapTextPaths(text, pixelSize) {
  const gap = pixelSize; // 1px gap between letters
  let x = 0;
  let paths = "";
  for (const ch of text.toUpperCase()) {
    const rows = BITMAP_FONT[ch] || BITMAP_FONT[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (rows[row] & (1 << (4 - col))) {
          const px = x + col * pixelSize;
          const py = row * pixelSize;
          paths += `<rect x="${px}" y="${py}" width="${pixelSize}" height="${pixelSize}" fill="#FFFFFF"/>`;
        }
      }
    }
    x += 5 * pixelSize + gap;
  }
  return { width: x - gap, height: 7 * pixelSize, paths };
}

function generateGenreBadge(genreText, width, height) {
  if (!genreText) return "";

  const pixelSize = Math.max(2, Math.round(height * 0.007));
  const { width: textW, height: textH, paths } = bitmapTextPaths(genreText, pixelSize);

  const paddingX = Math.round(pixelSize * 4);
  const paddingY = Math.round(pixelSize * 2.5);
  const badgeW = textW + paddingX * 2;
  const badgeH = textH + paddingY * 2;
  const rx = Math.round(badgeH / 2);

  const cx = Math.round(width / 2);
  const cy = height - Math.round(height * 0.08);
  const bx = cx - Math.round(badgeW / 2);
  const by = cy - Math.round(badgeH / 2);
  const tx = bx + paddingX;
  const ty = by + paddingY;

  return `
    <!-- soft shadow under badge -->
    <rect x="${bx + 2}" y="${by + 3}" width="${badgeW}" height="${badgeH}"
          rx="${rx}" ry="${rx}" fill="#000000" opacity="0.45"/>
    <rect x="${bx}" y="${by}" width="${badgeW}" height="${badgeH}"
          rx="${rx}" ry="${rx}"
          fill="rgba(25, 25, 32, 0.78)"
          stroke="rgba(255,255,255,0.45)"
          stroke-width="1.5"/>
    <g transform="translate(${tx},${ty})">${paths}</g>
  `;
}

// ---------------------------------------------------------------------------
// TMDB helpers
// ---------------------------------------------------------------------------
async function getTmdbData(imdbId, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey || !imdbId || !imdbId.startsWith("tt")) {
    return { backdropUrl: null, genre: null };
  }

  try {
    const findRes = await axios.get(
      `https://api.themoviedb.org/3/find/${imdbId}`,
      {
        params: { api_key: apiKey, external_source: "imdb_id" },
        timeout: 4500,
      }
    );

    const isSeries = type === "series";
    const results = isSeries
      ? findRes.data.tv_results
      : findRes.data.movie_results;
    const match = results && results[0];

    if (!match) return { backdropUrl: null, genre: null };

    const backdropUrl = match.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
      : null;

    let genre = null;
    if (Array.isArray(match.genre_ids) && match.genre_ids.length > 0) {
      const primary = GENRE_MAP[match.genre_ids[0]];
      if (primary) genre = primary;
    }

    if (!genre && match.id) {
      try {
        const detailPath = isSeries ? `tv/${match.id}` : `movie/${match.id}`;
        const detailRes = await axios.get(
          `https://api.themoviedb.org/3/${detailPath}`,
          { params: { api_key: apiKey }, timeout: 4000 }
        );
        if (detailRes.data.genres && detailRes.data.genres[0]) {
          genre = detailRes.data.genres[0].name.toUpperCase();
        }
      } catch (_) {}
    }

    return { backdropUrl, genre };
  } catch (err) {
    console.error(`TMDB lookup error for ${imdbId}:`, err.message);
    return { backdropUrl: null, genre: null };
  }
}

async function fetchTrendingList(type) {
  let rawItems = [];
  const apiKey = process.env.TMDB_API_KEY;

  if (type === "movie") {
    try {
      const res = await axios.get(SNOAK_MOVIES_URL, { timeout: 6000 });
      if (Array.isArray(res.data)) rawItems = res.data;
    } catch (e) {
      console.warn("MDBList movies failed, falling back to TMDB trending…");
    }

    if (rawItems.length === 0 && apiKey) {
      const tmdbRes = await axios.get(
        `https://api.themoviedb.org/3/trending/movie/day`,
        { params: { api_key: apiKey }, timeout: 5000 }
      );
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
        console.warn("MDBList TV shows failed, falling back to TMDB trending…");
      }
    }

    if (rawItems.length === 0 && apiKey) {
      const tmdbRes = await axios.get(
        `https://api.themoviedb.org/3/trending/tv/day`,
        { params: { api_key: apiKey }, timeout: 5000 }
      );
      rawItems = tmdbRes.data.results || [];
    }
  }

  return rawItems;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  const hostUrl = getHostUrl(req);
  res.send(`
    <html>
      <head><title>Top 10 Trending Addon</title></head>
      <body style="font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0f0f12; color: #fff;">
        <h1>Top 10 Trending Addon</h1>
        <p>Landscape posters with Apple TV-style metallic rank numbers &amp; frosted genre badges.</p>
        <a href="stremio://${req.headers.host}/manifest.json"
           style="background: #e50914; color: white; padding: 14px 28px; text-decoration: none;
                  font-size: 18px; font-weight: bold; border-radius: 6px; display: inline-block; margin-top: 20px;">
          Install in Stremio
        </a>
        <p style="margin-top: 20px; font-size: 13px; color: #888;">
          Manifest URL: ${hostUrl}/manifest.json
        </p>
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

app.get("/catalog/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const { type } = req.params;
  const hostUrl = getHostUrl(req);

  if (type !== "movie" && type !== "series") {
    return res.json({ metas: [] });
  }

  try {
    const rawItems = await fetchTrendingList(type);
    const top10 = rawItems.slice(0, 10);

    const metas = top10
      .map((item, index) => {
        const imdbId =
          item.imdb_id ||
          item.imdbid ||
          (item.external_ids && item.external_ids.imdb_id);
        const tmdbId = item.id || item.tmdb_id || item.tmdbid;
        const idToUse = imdbId || (tmdbId ? `tmdb:${tmdbId}` : null);

        if (!idToUse) return null;

        const title = item.title || item.name || "Unknown";
        const rank = index + 1;

        const posterUrl = `${hostUrl}/api/poster?id=${encodeURIComponent(
          imdbId || idToUse
        )}&rank=${rank}&type=${type}&v=${POSTER_CACHE_VERSION}`;

        return {
          id: idToUse,
          type,
          name: `${rank}. ${title}`,
          poster: posterUrl,
          posterShape: "landscape",
          description: item.description || item.overview || "",
        };
      })
      .filter(Boolean);

    res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=1800");
    res.json({ metas });
  } catch (err) {
    console.error(`Catalog Error (${type}):`, err.message);
    res.json({ metas: [] });
  }
});

app.get("/api/poster", async (req, res) => {
  const { id, rank, type } = req.query;

  if (!id) {
    return res.status(400).send("Missing ID parameter");
  }

  try {
    let backdropBuffer = null;
    const cleanImdbId = id.startsWith("tt") ? id : null;
    let resolvedGenre = null;

    // 1) ExtendedRatings landscape backdrop
    if (cleanImdbId) {
      try {
        const extUrl = `https://extendedratings.com/backdrop/${cleanImdbId}?config=russel&key=Kolkko11&v=fd3ce853`;
        const response = await axios.get(extUrl, {
          responseType: "arraybuffer",
          timeout: 4500,
        });
        backdropBuffer = Buffer.from(response.data);
      } catch (_) {}
    }

    // 2) TMDB (backdrop + genre)
    const tmdbInfo = await getTmdbData(cleanImdbId, type || "movie");
    if (tmdbInfo.genre) resolvedGenre = tmdbInfo.genre;

    if (!backdropBuffer && tmdbInfo.backdropUrl) {
      try {
        const tmdbRes = await axios.get(tmdbInfo.backdropUrl, {
          responseType: "arraybuffer",
          timeout: 4500,
        });
        backdropBuffer = Buffer.from(tmdbRes.data);
      } catch (_) {}
    }

    // 3) Solid fallback
    if (!backdropBuffer) {
      backdropBuffer = await sharp({
        create: {
          width: 1280,
          height: 720,
          channels: 3,
          background: { r: 20, g: 20, b: 28 },
        },
      })
        .jpeg()
        .toBuffer();
    }

    const metadata = await sharp(backdropBuffer).metadata();
    const width = metadata.width || 1280;
    const height = metadata.height || 720;

    if (!resolvedGenre) {
      resolvedGenre = type === "series" ? "SERIES" : "MOVIE";
    }

    const numRank = parseInt(rank, 10) || 1;
    const rankSvg = generateRankSvg(numRank);

    // Scale rank so it occupies ~32% of poster height
    const targetH = height * 0.32;
    const scale = targetH / DIGIT_H;
    const xPos = Math.round(width * 0.03);
    const yPos = Math.round(height * 0.05);

    const genreBadge = generateGenreBadge(resolvedGenre, width, height);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
           xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="leftVignette" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stop-color="#000000" stop-opacity="0.80"/>
            <stop offset="50%"  stop-color="#000000" stop-opacity="0.40"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </linearGradient>
        </defs>

        <!-- Left vignette (~55%) -->
        <rect width="${Math.round(width * 0.55)}" height="${height}"
              fill="url(#leftVignette)"/>

        <!-- Cinematic rank number (top-left) — pure vector, no fonts -->
        <g transform="translate(${xPos}, ${yPos}) scale(${scale.toFixed(4)})">
          ${rankSvg.markup}
        </g>

        <!-- Frosted genre badge (bottom center) — bitmap font, no system fonts -->
        ${genreBadge}
      </svg>
    `);

    const result = await sharp(backdropBuffer)
      .composite([{ input: svgOverlay, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=86400"
    );
    return res.send(result);
  } catch (err) {
    console.error("Poster rendering error:", err.message);
    return res.status(500).send("Error rendering poster image");
  }
});

module.exports = app;
