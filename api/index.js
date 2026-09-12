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
  version: "1.3.0",
  name: "Live TMDB Top 10",
  description: "Top 10 Movies & Series + custom ranked poster service",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "my_top_movies", name: "🔥 Live Top 10 Movies" },
    { type: "series", id: "my_top_series", name: "📺 Live Top 10 Series" }
  ]
};

const TMDB_API_KEY = "dc1ae8c943c805800112762a3afbc1b6";

// ========== CUSTOM RANKED POSTER ENDPOINT ==========
app.get('/poster', async (req, res) => {
  try {
    const { url, rank } = req.query;

    if (!url || !rank) {
      return res.status(400).json({ error: 'Missing url or rank parameter' });
    }

    const rankNum = parseInt(rank);
    if (isNaN(rankNum) || rankNum < 1 || rankNum > 20) {
      return res.status(400).json({ error: 'Rank must be a number between 1 and 20' });
    }

    // Download original poster
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to download poster');
    const buffer = Buffer.from(await response.arrayBuffer());

    // Get image metadata
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const width = metadata.width || 780;
    const height = metadata.height || 1170;

    // Create ranking number as SVG (big, clean, Apple TV style)
    const fontSize = Math.floor(Math.min(width, height) * 0.28);
    const svg = `
      <svg width="${width}" height="${height}">
        <style>
          .rank { 
            fill: rgba(255,255,255,0.92); 
            font-family: Arial Black, Arial, sans-serif; 
            font-weight: 900; 
            font-size: ${fontSize}px;
          }
        </style>
        <text x="40" y="${fontSize + 20}" class="rank">${rankNum}</text>
      </svg>
    `;

    // Composite the number onto the poster
    const output = await image
      .composite([{
        input: Buffer.from(svg),
        top: 0,
        left: 0
      }])
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

// ========== CATALOG ==========
async function getTrending(type) {
  try {
    const tmdbType = type === 'movie' ? 'movie' : 'tv';
    const url = `https://api.themoviedb.org/3/trending/${tmdbType}/week?api_key=${TMDB_API_KEY}&language=en-US`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    const data = await res.json();

    return data.results.slice(0, 10).map((item, index) => {
      const rank = index + 1;
      const id = item.id;
      const name = item.title || item.name || "Unknown";
      const year = (item.release_date || item.first_air_date || "").slice(0, 4);

      // Use our own ranked poster endpoint
      const originalPoster = item.poster_path
        ? `https://image.tmdb.org/t/p/w780${item.poster_path}`
        : null;

      const poster = originalPoster
        ? `https://my-top10-addon.vercel.app/poster?url=${encodeURIComponent(originalPoster)}&rank=${rank}`
        : null;

      return {
        id: `tmdb:${id}`,
        type: type,
        name: name,
        poster: poster,
        posterShape: "landscape",
        background: item.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
          : undefined,
        description: item.overview || undefined,
        releaseInfo: year || undefined,
        imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined
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

  if (cleanId === 'my_top_movies') metas = await getTrending('movie');
  else if (cleanId === 'my_top_series') metas = await getTrending('series');

  res.setHeader('Content-Type', 'application/json');
  res.json({ metas });
});

module.exports = app;
