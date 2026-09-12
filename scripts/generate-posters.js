const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const MDBLIST_API_KEY = "84k3gqmfidzkniqojvnman7lk";
const OUT_DIR = path.join(__dirname, '../public/posters');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function getMDBList(listPath) {
  const url = `https://api.mdblist.com/lists/${listPath}/items?apikey=${MDBLIST_API_KEY}&limit=10`;
  const res = await fetch(url);
  const data = await res.json();

  let items = data.movies || data.shows || data.items || [];
  return items.slice(0, 10);
}

async function generatePoster(item, type, rank) {
  const id = item.ids?.tmdb || item.id;
  if (!id) return;

  const mediaType = type === 'movie' ? 'movie' : 'show';
  const xrdbUrl = `https://extendedratings.com/poster/tmdb:${mediaType}:${id}?config=russel&key=Kolkko11&v=fd3ce853`;

  const tempFile = path.join(OUT_DIR, `temp_${type}_${rank}.jpg`);
  const outFile = path.join(OUT_DIR, `${type}_${rank}.jpg`);

  try {
    await download(xrdbUrl, tempFile);

    // Big white Netflix-style number (top left)
    const cmd = `convert "${tempFile}" \
      -font Arial-Bold -pointsize 220 -fill "rgba(0,0,0,0.55)" \
      -gravity NorthWest -annotate +55+45 "${rank}" \
      -font Arial-Bold -pointsize 220 -fill white \
      -gravity NorthWest -annotate +50+40 "${rank}" \
      -quality 90 "${outFile}"`;

    execSync(cmd, { stdio: 'inherit' });
    console.log(`✓ ${type} #${rank}`);
  } catch (err) {
    console.error(`Failed ${type} #${rank}:`, err.message);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

async function main() {
  console.log('Generating Movies...');
  const movies = await getMDBList('snoak/trending-movies');
  for (let i = 0; i < movies.length; i++) {
    await generatePoster(movies[i], 'movie', i + 1);
  }

  console.log('Generating Series...');
  const series = await getMDBList('snoak/trakt-s-trending-shows');
  for (let i = 0; i < series.length; i++) {
    await generatePoster(series[i], 'series', i + 1);
  }

  console.log('Done!');
}

main().catch(console.error);
