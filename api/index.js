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

// Cache-bust version — bump this whenever poster design changes
const POSTER_CACHE_VERSION = "42";

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "1.1.0",
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
// TMDB genre ID → uppercase name (shared across movies & TV where IDs overlap)
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
  // TV-specific
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
// Apple TV style rank numbers
// Metallic vertical gradient (white → #94A3B8), thick white stroke, deep shadow.
// Rank 10 uses tight horizontal overlap between "1" and "0".
// ---------------------------------------------------------------------------
function generateRankSvg(rank, fontSize) {
  const r = String(rank);
  const isTen = r === "10";

  // Tight overlap for "10" — spacing = fontSize * 0.40
  const letterSpacing = isTen ? fontSize * 0.40 : fontSize * 0.08;

  // Approximate glyph width for positioning
  const approxCharW = fontSize * 0.55;

  // Render each digit as its own <text> so we can control x precisely
  // for the overlapping "10" case, while still using a reliable Linux font.
  let digitsMarkup = "";
  let x = 0;

  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    digitsMarkup += `
      <text
        x="${x}"
        y="0"
        font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="900"
        fill="url(#metallicGrad)"
        stroke="#ffffff"
        stroke-width="14"
        stroke-linejoin="round"
        stroke-linecap="round"
        paint-order="stroke fill"
        dominant-baseline="hanging"
      >${ch}</text>`;
    x += (ch === "1" ? approxCharW * 0.55 : approxCharW) + letterSpacing;
  }

  // Deep dark drop shadow
  const shadowOffset = Math.round(fontSize * 0.06);
  const shadowOpacity = 0.55;

  return {
    markup: `
      <defs>
        <linearGradient id="metallicGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF"/>
          <stop offset="45%" stop-color="#E2E8F0"/>
          <stop offset="100%" stop-color="#94A3B8"/>
        </linearGradient>
        <filter id="rankShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="${shadowOffset}" dy="${shadowOffset + 4}" stdDeviation="8" flood-color="#000000" flood-opacity="${shadowOpacity}"/>
          <feDropShadow dx="2" dy="6" stdDeviation="14" flood-color="#000000" flood-opacity="0.35"/>
        </filter>
      </defs>
      <g filter="url(#rankShadow)">
        ${digitsMarkup}
      </g>
    `,
  };
}

// ---------------------------------------------------------------------------
// Frosted-glass genre pill (bottom center)
// ---------------------------------------------------------------------------
function generateGenreBadge(genreText, width, height) {
  if (!genreText) return "";

  const fontSize = Math.round(height * 0.042);
  const paddingX = Math.round(fontSize * 1.6);
  const paddingY = Math.round(fontSize * 0.55);
  const badgeH = fontSize + paddingY * 2;
  const approxTextW = genreText.length * fontSize * 0.58;
  const badgeW = Math.ceil(approxTextW + paddingX * 2);
  const rx = Math.round(badgeH / 2);

  const cx = Math.round(width / 2);
  const cy = height - Math.round(height * 0.075);
  const x = cx - Math.round(badgeW / 2);
  const y = cy - Math.round(badgeH / 2);

  return `
    <defs>
      <filter id="badgeShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000000" flood-opacity="0.45"/>
      </filter>
    </defs>
    <g filter="url(#badgeShadow)">
      <rect
        x="${x}"
        y="${y}"
        width="${badgeW}"
        height="${badgeH}"
        rx="${rx}"
        ry="${rx}"
        fill="rgba(25, 25, 32, 0.75)"
        stroke="rgba(255,255,255,0.4)"
        stroke-width="1.5"
      />
      <text
        x="${cx}"
        y="${cy + Math.round(fontSize * 0.35)}"
        font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        fill="#FFFFFF"
        text-anchor="middle"
        dominant-baseline="middle"
      >${genreText}</text>
    </g>
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

    // If find endpoint didn't give genres, fetch full details
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

        // Poster endpoint resolves genre via TMDB; cache-bust with v=
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

    // 1) Prefer ExtendedRatings landscape backdrop
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

    // 2) TMDB fallback (also resolves primary genre)
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

    // Fallback genre label
    if (!resolvedGenre) {
      resolvedGenre = type === "series" ? "SERIES" : "MOVIE";
    }

    const numRank = parseInt(rank, 10) || 1;
    // Rank numbers sit in the top-left, roughly 30 % of poster height
    const fontSize = Math.round(height * 0.30);
    const rankSvg = generateRankSvg(numRank, fontSize);

    const xPos = Math.round(width * 0.035);
    const yPos = Math.round(height * 0.06);

    const genreBadge = generateGenreBadge(resolvedGenre, width, height);

    const svgOverlay = Buffer.from(`
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
           xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- Left-side vignette covering ~55 % of the poster -->
          <linearGradient id="leftVignette" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stop-color="#000000" stop-opacity="0.82"/>
            <stop offset="45%"  stop-color="#000000" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </linearGradient>
        </defs>

        <!-- Left vignette -->
        <rect width="${Math.round(width * 0.55)}" height="${height}"
              fill="url(#leftVignette)"/>

        <!-- Cinematic rank number (top-left) -->
        <g transform="translate(${xPos}, ${yPos})">
          ${rankSvg.markup}
        </g>

        <!-- Frosted genre badge (bottom center) -->
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
