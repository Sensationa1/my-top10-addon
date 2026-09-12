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
  version: "1.7.0",
  name: "Live Top 10",
  description: "MDBList Top 10 with custom ranking numbers",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "my_top_movies", name: "🔥 Live Top 10 Movies" },
    { type: "series", id: "my_top_series", name: "📺 Live Top 10 Series" }
  ]
};

const MDBLIST_API_KEY = "84k3gqmfidzkniqojvnman7lk";
const POSTER_BASE = "https://raw.githubusercontent.com/Sensationa1/my-top10-addon/main/public/posters";

async function getMDBList(listPath, type) {
  try {
    const url = `https://api.mdblist.com/lists/${listPath}/items?apikey=${MDBLIST_API_KEY}&limit=10`;
    const res = await fetch(url);
    const data = await res.json();

    let items = data.movies || data.shows || data.items || [];

    return items.slice(0, 10).map((item, index) => {
      const rank = index + 1;
      const id = item.ids?.tmdb || item.id;
      const name = item.title || item.name || "Unknown";
      const year = item.release_year || item.year || "";

      return {
        id: `tmdb:${id}`,
        type: type,
        name: name,
        poster: `${POSTER_BASE}/${type}_${rank}.jpg`,
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
