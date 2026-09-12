const express = require('express');
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
  version: "1.5.0",
  name: "Live Top 10",
  description: "Top 10 Movies & Series from MDBList with llamayu ranking numbers",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "my_top_movies", name: "🔥 Live Top 10 Movies" },
    { type: "series", id: "my_top_series", name: "📺 Live Top 10 Series" }
  ]
};

// ====== CONFIG ======
const MDBLIST_API_KEY = "84k3gqmfidzkniqojvnman7lk";

// ========== MDBLIST + LLAMAYU ==========
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

    const tmdbType = type === 'movie' ? 'movie' : 'tv';

    return items.slice(0, 10).map((item, index) => {
      const rank = index + 1;
      const id = item.ids?.tmdb || item.id || item.tmdb_id;
      const name = item.title || item.name || "Unknown";
      const year = item.release_year || item.year || "";

      // llamayu ranked poster
      const poster = `https://toptoday.llamayu.com/poster/${id}.png?type=${tmdbType}&rank=${rank}`;

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

// ========== ROUTES ==========
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
