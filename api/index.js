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
  version: "1.2.0",
  name: "Live TMDB Top 10",
  description: "Top 10 Movies & Series with ranking numbers",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "my_top_movies", name: "🔥 Live Top 10 Movies" },
    { type: "series", id: "my_top_series", name: "📺 Live Top 10 Series" }
  ]
};

const TMDB_API_KEY = "dc1ae8c943c805800112762a3afbc1b6";

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

      // llamayu ranked poster (big numbers)
      const poster = `https://toptoday.llamayu.com/poster/${id}.png?type=${tmdbType}&rank=${rank}`;

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
