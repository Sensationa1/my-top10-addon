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
const MDBLIST_API_KEY = "84k3gqmfidzkniqojvnman7lk";
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

    // Download original poster
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to download poster');
    const buffer = Buffer.from(await response.arrayBuffer());

    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 780;
    const height = metadata.height || 1170;

    // Bigger number for better visibility
    const fontSize = Math.round(Math.min(width, height) * 0.38);
    const x = Math.round(width * 0.06);
    const y = Math.round(fontSize * 1.15);

    // Create SVG with stronger styling
    const svg = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="4" dy="4" stdDeviation="5" flood-color="#000" flood-opacity="0.75"/>
          </filter>
        </defs>
        <text 
          x="${x}" 
          y="${y}" 
          font-family="Arial, Helvetica, sans-serif" 
          font-size="${fontSize}" 
          font-weight="900"
          fill="#FFFFFF"
          filter="url(#s)"
        >${rankNum}</text>
      </svg>
    `);

    const output = await sharp(buffer)
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(output);

  } catch (err) {
    console.error('Poster generation error:', err);
    res.status(500).json({ 
      error: 'Failed to generate ranked poster', 
      message: err.message 
    });
  }
});

// ========== MDBLIST HELPER ==========
async function getMDBList(listPath, type) {
  try {
    const url = `https://api.mdblist.com/lists/${listPath}/items?apikey=${MDBLIST_API_KEY}&limit=10&append_to_response=poster`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`MDBList ${res.status}`);

    const data = await res.json();

    let items = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data.movies && data.movies.length > 0) {
      items = data.movies;
    } else if (data.shows && data.shows.length > 0) {
      items = data.shows;
    } else if (data.items) {
      items = data.items;
    }

    return items.slice(0, 10).map((item, index) => {
      const rank = index + 1;
      const id = item.ids?.tmdb || item.id || item.tmdb_id;
      const name = item.title || item.name || "Unknown";
      const year = item.release_year || item.year || "";

      let originalPoster = item.poster || item.poster_path;
      if (originalPoster && !originalPoster.startsWith('http')) {
        originalPoster = `https://image.tmdb.org/t/p/w780${originalPoster}`;
      }

      // Prefer higher quality poster
      if (originalPoster && originalPoster.includes('/w200/')) {
        originalPoster = originalPoster.replace('/w200/', '/w780/');
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
    metas = await getMDBList('snoak/trakt-s-trending-shows', 'series');
  }

  res.setHeader('Content-Type', 'application/json');
  res.json({ metas });
});

module.exports = app;
