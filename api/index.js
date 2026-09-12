const express = require('express');
const sharp = require('sharp');
const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const manifest = {
  id: "community.mytoptenaddon",
  version: "1.4.1",
  name: "Live Top 10",
  description: "Top 10 Movies & Series from MDBList with ranking numbers",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "my_top_movies", name: "🔥 Live Top 10 Movies" },
    { type: "series", id: "my_top_series", name: "📺 Live Top 10 Series" }
  ]
};

// ====== CONFIG ======
const MDBLIST_API_KEY = "84k3gqmfidzkniqojvnman7lk";   // ← make sure your real key is here
const BASE_URL = "https://my-top10-addon.vercel.app";

// ========== CUSTOM RANKED POSTER ENDPOINT ==========
app.get('/poster', async (req, res) => {
  try {
    const { url, rank } = req.query;

    if (!url || !rank) {
      return res.status(400).json({ error: 'Missing url or rank parameter' });
    }

    const rankNum = parseInt(rank);
    if (isNaN(rankNum) || rankNum < 1 || rankNum > 20) {
      return res.status(400).json({ error: 'Rank must be between 1 and 20' });
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to download poster');
    const buffer = Buffer.from(await response.arrayBuffer());

    const image = sharp(buffer);
    const metadata = await image.metadata();
    const width = metadata.width || 780;
    const height = metadata.height || 1170;

    const fontSize = Math.floor(Math.min(width, height) * 0.32);

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow">
            <feDropShadow dx="3" dy="3" stdDeviation="4" flood-color="black" flood-opacity="0.7"/>
          </filter>
        </defs>
        <text 
          x="50" 
          y="${fontSize + 30}" 
          font-family="Arial Black, Arial, sans-serif" 
          font-weight="900" 
          font-size="${fontSize}px" 
          fill="white"
          filter="url(#shadow)"
        >${rankNum}</text>
      </svg>
    `;

    const output = await image
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(output);

  } catch (err) {
    console.error('Poster error:', err.message);
    res.status(500).json({ error: 'Failed to generate ranked poster' });
  }
});

// ========== MDBLIST HELPER ==========
async function getMDBList(listPath, type) {
  try {
    const url = `https://api.mdblist.com/lists/${listPath}/items?apikey=${MDBLIST_API_KEY}&limit=10&append_to_response=poster`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`MDBList ${res.status}`);

    const data = await res.json();

    // Handle different possible response structures
    let items = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data.movies) {
      items = data.movies;
    } else if (data.shows) {
      items = data.shows;
    } else if (data.items) {
      items = data.items;
    }

    return items.slice(0, 10).map((item, index) => {
      const rank = index + 1;
      const id = item.id || item.ids?.tmdb || item.tmdb_id || item.ids?.imdb;
      const name = item.title || item.name || "Unknown";
      const year = item.release_year || item.year || "";

      let originalPoster = item.poster || item.poster_path;
      if (originalPoster && !originalPoster.startsWith('http')) {
        originalPoster = `https://image.tmdb.org/t/p/w780${originalPoster}`;
      }

      const poster = originalPoster
        ? `${BASE_URL}/poster?url=${encodeURIComponent(originalPoster)}&rank=${rank}`
        : null;

      return {
        id: `tmdb:${id}`,
        type: type,
        name: name,
        poster: poster,
        posterShape: "landscape",
        description: item.description || undefined,
        releaseInfo: year ? String(year) : undefined,
        imdbRating: item.score ? (item.score / 10).toFixed(1) : undefined
      };
    });
  } catch (err) {
    console.error(`MDBList error (${listPath}):`, err.message);
    return [];
  }
}

// ========== CATALOG ROUTES ==========
app.get(['/', '/manifest.json'], (req, res) => res.json(manifest));

app.get('/catalog/:type/:id*', async (req, res) => {
  const cleanId = (req.params.id || '').replace(/\.json$/, '');
  let metas = [];

  if (cleanId === 'my_top_movies') {
    metas = await getMDBList('snoak/trending-movies', 'movie');
  } else if (cleanId === 'my_top_series') {
    // Primary list
    metas = await getMDBList('snoak/trakt-s-trending-shows', 'series');

    // Fallback if empty
    if (metas.length === 0) {
      metas = await getMDBList('snoak/trakt-trending-shows', 'series');
    }
  }

  res.setHeader('Content-Type', 'application/json');
  res.json({ metas });
});

module.exports = app;
