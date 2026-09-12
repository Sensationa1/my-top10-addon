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
  version: "1.6.0",
  name: "Live Top 10",
  description: "MDBList Top 10 with XRDB + Netflix-style ranking numbers",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "my_top_movies", name: "🔥 Live Top 10 Movies" },
    { type: "series", id: "my_top_series", name: "📺 Live Top 10 Series" }
  ]
};

const MDBLIST_API_KEY = "84k3gqmfidzkniqojvnman7lk";
const BASE_URL = "https://my-top10-addon.vercel.app";

// ========== CUSTOM RANKED POSTER (XRDB + Number) ==========
app.get('/poster', async (req, res) => {
  try {
    const { id, type, rank } = req.query;

    if (!id || !rank) {
      return res.status(400).json({ error: 'Missing id or rank' });
    }

    const rankNum = parseInt(rank);
    const mediaType = type === 'series' || type === 'tv' ? 'show' : 'movie';

    // XRDB base poster
    const xrdbUrl = `https://extendedratings.com/poster/tmdb:${mediaType}:${id}?config=russel&key=Kolkko11&v=fd3ce853`;

    const response = await fetch(xrdbUrl);
    if (!response.ok) throw new Error('Failed to fetch XRDB poster');
    const buffer = Buffer.from(await response.arrayBuffer());

    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 500;
    const height = metadata.height || 750;

    // Netflix-style big white number
    const fontSize = Math.round(Math.min(width, height) * 0.42);
    const x = Math.round(width * 0.05);
    const y = Math.round(fontSize * 1.1);

    const svg = `
      <svg width="${width}" height="${height}">
        <text x="${x + 5}" y="${y + 5}" 
              font-family="Arial Black, Impact, sans-serif" 
              font-size="${fontSize}" 
              font-weight="900" 
              fill="rgba(0,0,0,0.55)">${rankNum}</text>
        <text x="${x}" y="${y}" 
              font-family="Arial Black, Impact, sans-serif" 
              font-size="${fontSize}" 
              font-weight="900" 
              fill="white">${rankNum}</text>
      </svg>
    `;

    const output = await sharp(buffer)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(output);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========== MDBLIST ==========
async function getMDBList(listPath, type) {
  try {
    const url = `https://api.mdblist.com/lists/${listPath}/items?apikey=${MDBLIST_API_KEY}&limit=10`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MDBList ${res.status}`);
    const data = await res.json();

    let items = data.movies || data.shows || data.items || (Array.isArray(data) ? data : []);

    return items.slice(0, 10).map((item, index) => {
      const rank = index + 1;
      const id = item.ids?.tmdb || item.id;
      const name = item.title || item.name || "Unknown";
      const year = item.release_year || item.year || "";

      const poster = `${BASE_URL}/poster?id=${id}&type=${type}&rank=${rank}`;

      return {
        id: `tmdb:${id}`,
        type: type,
        name: name,
        poster: poster,
        posterShape: "landscape",
        releaseInfo: year ? String(year) : undefined
      };
    });
  } catch (err) {
    console.error(err);
    return [];
  }
}

app.get(['/', '/manifest.json'], (req, res) => res.json(manifest));

app.get('/catalog/:type/:id*', async (req, res) => {
  const cleanId = (req.params.id || '').replace(/\.json$/, '');
  let metas = [];

  if (cleanId === 'my_top_movies') {
    metas = await getMDBList('snoak/trending-movies', 'movie');
  } else if (cleanId === 'my_top_series') {
    metas = await getMDBList('snoak/trakt-s-trending-shows', 'series');
  }

  res.json({ metas });
});

module.exports = app;
