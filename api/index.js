const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sharp = require("sharp");
require("dotenv").config();

const app = express();
app.use(cors());

// Snoak MDBList & Trakt Sources
const SNOAK_MOVIES_URL =
  "https://mdblist.com/lists/snoak/trending-movies/json";

const SNOAK_SHOWS_URL =
  "https://mdblist.com/lists/snoak/trakt-s-trending-shows/json";

const SNOAK_SHOWS_ALT_URL =
  "https://mdblist.com/lists/snoak/most-popular-shows-on-rotten-tomatoes/json";

const MANIFEST = {
  id: "com.sensationa1.top10.cloud",
  version: "1.0.0",
  name: "Top 10 Trending (Netflix Style)",
  description:
    "Top 10 Trending Movies & TV Shows with embedded Netflix-style numbers on landscape posters.",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      id: "top10_trending_movies",
      type: "movie",
      name: "Top 10 Trending Movies",
      extraSupported: [],
      posterShape: "landscape"
    },
    {
      id: "top10_trending_shows",
      type: "series",
      name: "Top 10 Trending Shows",
      extraSupported: [],
      posterShape: "landscape"
    }
  ],
  idPrefixes: ["tt"]
};

// -----------------------------------------------------------------------------
// NETFLIX-STYLE NUMBER
//
// Uses a real condensed typographic SVG text treatment instead of custom
// hand-drawn glyph paths.
//
// Large, narrow, outlined white numerals with a subtle black shadow.
// -----------------------------------------------------------------------------

function generateNetflixNumberSvg(rank, width, height) {
  const number = String(rank);

  // Netflix-style proportions:
  // Large relative to card, very condensed, low on the artwork.
  const fontSize = Math.round(height * 0.78);

  // Slightly narrower than normal typography.
  const letterSpacing = number === "10"
    ? Math.round(-height * 0.035)
    : Math.round(-height * 0.025);

  // Outline thickness.
  const strokeWidth = Math.max(
    5,
    Math.round(height * 0.014)
  );

  // Subtle dimensional shadow.
  const shadowOffset = Math.max(
    3,
    Math.round(height * 0.012)
  );

  // Position.
  const x = Math.round(width * 0.035);
  const y = Math.round(height * 0.91);

  return `
    <g
      transform="translate(${x}, ${y})"
      font-family="Arial Narrow, Liberation Sans Narrow, DejaVu Sans"
      font-weight="900"
      font-stretch="condensed"
      text-anchor="start"
      style="font-variant-numeric: tabular-nums;"
    >

      <!-- Deep Netflix-style shadow -->
      <text
        x="${shadowOffset}"
        y="${shadowOffset}"
        font-size="${fontSize}"
        letter-spacing="${letterSpacing}"
        fill="#000000"
        fill-opacity="0.82"
        stroke="#000000"
        stroke-width="${strokeWidth + 3}"
        stroke-linejoin="round"
        paint-order="stroke fill"
      >${number}</text>

      <!-- Clean white outline -->
      <text
        x="0"
        y="0"
        font-size="${fontSize}"
        letter-spacing="${letterSpacing}"
        fill="#000000"
        fill-opacity="0.12"
        stroke="#FFFFFF"
        stroke-width="${strokeWidth}"
        stroke-linejoin="round"
        paint-order="stroke fill"
      >${number}</text>

      <!-- Extremely subtle inner dark edge -->
      <text
        x="0"
        y="0"
        font-size="${fontSize}"
        letter-spacing="${letterSpacing}"
        fill="#000000"
        fill-opacity="0.04"
        stroke="#111111"
        stroke-opacity="0.16"
        stroke-width="2"
        paint-order="stroke fill"
      >${number}</text>

    </g>
  `;
}

function getHostUrl(req) {
  const protocol =
    req.headers["x-forwarded-proto"] || "https";

  const host = req.headers.host;

  return `${protocol}://${host}`;
}

// -----------------------------------------------------------------------------
// HOME
// -----------------------------------------------------------------------------

app.get("/", (req, res) => {
  const hostUrl = getHostUrl(req);

  res.send(`
    <html>
      <head>
        <title>Top 10 Trending Addon</title>
      </head>

      <body
        style="
          font-family: system-ui, sans-serif;
          text-align: center;
          padding: 50px;
          background: #0f0f12;
          color: #fff;
        "
      >
        <h1>Top 10 Trending Addon</h1>

        <p>
          Landscape posters with embedded Netflix-style numbers & genre tags.
        </p>

        <a
          href="stremio://${req.headers.host}/manifest.json"
          style="
            background: #e50914;
            color: white;
            padding: 14px 28px;
            text-decoration: none;
            font-size: 18px;
            font-weight: bold;
            border-radius: 6px;
            display: inline-block;
            margin-top: 20px;
          "
        >
          Install in Stremio
        </a>

        <p
          style="
            margin-top: 20px;
            font-size: 13px;
            color: #888;
          "
        >
          Manifest URL: ${hostUrl}/manifest.json
        </p>
      </body>
    </html>
  `);
});

// -----------------------------------------------------------------------------
// MANIFEST
// -----------------------------------------------------------------------------

app.get("/manifest.json", (req, res) => {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "*"
  );

  res.setHeader(
    "Cache-Control",
    "max-age=86400, public"
  );

  res.json(MANIFEST);
});

// -----------------------------------------------------------------------------
// TMDB BACKDROP FALLBACK
// -----------------------------------------------------------------------------

async function getTmdbData(imdbId, type) {
  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    return {
      backdropUrl: null
    };
  }

  try {
    const findRes = await axios.get(
      `https://api.themoviedb.org/3/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id`,
      {
        timeout: 4000
      }
    );

    const isSeries = type === "series";

    const results = isSeries
      ? findRes.data.tv_results
      : findRes.data.movie_results;

    const match =
      results && results[0];

    if (match) {
      const backdropUrl =
        match.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${match.backdrop_path}`
          : null;

      return {
        backdropUrl
      };
    }
  } catch (err) {
    console.error(
      `TMDB lookup error for ${imdbId}:`,
      err.message
    );
  }

  return {
    backdropUrl: null
  };
}

// -----------------------------------------------------------------------------
// SNOAK TRENDING LISTS
// -----------------------------------------------------------------------------

async function fetchTrendingList(type) {
  let rawItems = [];

  const apiKey =
    process.env.TMDB_API_KEY;

  // ---------------------------------------------------------------------------
  // MOVIES
  // ---------------------------------------------------------------------------

  if (type === "movie") {
    try {
      const res = await axios.get(
        SNOAK_MOVIES_URL,
        {
          timeout: 6000
        }
      );

      if (Array.isArray(res.data)) {
        rawItems = res.data;
      }
    } catch (e) {
      console.warn(
        "MDBList movies failed, fetching TMDB trending fallback..."
      );
    }

    if (
      rawItems.length === 0 &&
      apiKey
    ) {
      const tmdbRes =
        await axios.get(
          `https://api.themoviedb.org/3/trending/movie/day?api_key=${apiKey}`,
          {
            timeout: 5000
          }
        );

      rawItems =
        tmdbRes.data.results || [];
    }
  }

  // ---------------------------------------------------------------------------
  // SERIES
  // ---------------------------------------------------------------------------

  else if (type === "series") {
    try {
      const res = await axios.get(
        SNOAK_SHOWS_URL,
        {
          timeout: 6000
        }
      );

      if (Array.isArray(res.data)) {
        rawItems = res.data;
      }
    } catch (e) {
      try {
        const resAlt =
          await axios.get(
            SNOAK_SHOWS_ALT_URL,
            {
              timeout: 6000
            }
          );

        if (Array.isArray(resAlt.data)) {
          rawItems = resAlt.data;
        }
      } catch (err) {
        console.warn(
          "MDBList TV shows failed, fetching TMDB trending fallback..."
        );
      }
    }

    if (
      rawItems.length === 0 &&
      apiKey
    ) {
      const tmdbRes =
        await axios.get(
          `https://api.themoviedb.org/3/trending/tv/day?api_key=${apiKey}`,
          {
            timeout: 5000
          }
        );

      rawItems =
        tmdbRes.data.results || [];
    }
  }

  return rawItems;
}

// -----------------------------------------------------------------------------
// CATALOG
// -----------------------------------------------------------------------------

app.get(
  "/catalog/:type/:id.json",
  async (req, res) => {
    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "*"
    );

    const {
      type,
      id
    } = req.params;

    const hostUrl =
      getHostUrl(req);

    if (
      type !== "movie" &&
      type !== "series"
    ) {
      return res.json({
        metas: []
      });
    }

    try {
      const rawItems =
        await fetchTrendingList(type);

      const top10 =
        rawItems.slice(0, 10);

      const metas =
        top10
          .map(
            (item, index) => {
              const imdbId =
                item.imdb_id ||
                item.imdbid ||
                (
                  item.external_ids &&
                  item.external_ids.imdb_id
                );

              const tmdbId =
                item.id ||
                item.tmdb_id ||
                item.tmdbid;

              const idToUse =
                imdbId ||
                (
                  tmdbId
                    ? `tmdb:${tmdbId}`
                    : null
                );

              if (!idToUse) {
                return null;
              }

              const title =
                item.title ||
                item.name ||
                "Unknown";

              const rank =
                index + 1;

              let genres = "";

              if (
                Array.isArray(
                  item.genres
                )
              ) {
                genres =
                  item.genres
                    .slice(0, 2)
                    .join(",");
              } else if (
                typeof item.genres ===
                "string"
              ) {
                genres =
                  item.genres;
              }

              const posterUrl =
                `${hostUrl}/api/poster` +
                `?id=${encodeURIComponent(imdbId || idToUse)}` +
                `&rank=${rank}` +
                `&type=${encodeURIComponent(type)}` +
                `&genres=${encodeURIComponent(genres)}` +
                `&v=31`;

              return {
                id: idToUse,

                type: type,

                name:
                  `${rank}. ${title}`,

                poster:
                  posterUrl,

                posterShape:
                  "landscape",

                description:
                  item.description ||
                  item.overview ||
                  ""
              };
            }
          )
          .filter(Boolean);

      res.setHeader(
        "Cache-Control",
        "public, max-age=1800, s-maxage=1800"
      );

      return res.json({
        metas
      });

    } catch (err) {
      console.error(
        `Catalog Error (${type}):`,
        err.message
      );

      return res.json({
        metas: []
      });
    }
  }
);

// -----------------------------------------------------------------------------
// POSTER RENDERER
// -----------------------------------------------------------------------------

app.get(
  "/api/poster",
  async (req, res) => {
    const {
      id,
      rank,
      type,
      genres
    } = req.query;

    if (!id) {
      return res
        .status(400)
        .send("Missing ID parameter");
    }

    try {
      let backdropBuffer =
        null;

      const cleanImdbId =
        id.startsWith("tt")
          ? id
          : null;

      // -----------------------------------------------------------------------
      // EXTENDEDRATINGS BACKDROP
      // -----------------------------------------------------------------------

      if (cleanImdbId) {
        try {
          const extUrl =
            `https://extendedratings.com/backdrop/` +
            `${cleanImdbId}` +
            `?config=russel&key=Kolkko11&v=fd3ce853`;

          const response =
            await axios.get(
              extUrl,
              {
                responseType:
                  "arraybuffer",
                timeout: 4500
              }
            );

          backdropBuffer =
            Buffer.from(
              response.data
            );
        } catch (e) {
          console.warn(
            `ExtendedRatings failed for ${cleanImdbId}`
          );
        }
      }

      // -----------------------------------------------------------------------
      // TMDB FALLBACK
      // -----------------------------------------------------------------------

      if (
        !backdropBuffer &&
        cleanImdbId
      ) {
        const tmdbInfo =
          await getTmdbData(
            cleanImdbId,
            type
          );

        if (
          tmdbInfo.backdropUrl
        ) {
          try {
            const tmdbRes =
              await axios.get(
                tmdbInfo.backdropUrl,
                {
                  responseType:
                    "arraybuffer",
                  timeout: 4500
                }
              );

            backdropBuffer =
              Buffer.from(
                tmdbRes.data
              );
          } catch (e) {
            console.warn(
              `TMDB backdrop failed for ${cleanImdbId}`
            );
          }
        }
      }

      // -----------------------------------------------------------------------
      // EMPTY FALLBACK
      // -----------------------------------------------------------------------

      if (!backdropBuffer) {
        backdropBuffer =
          await sharp({
            create: {
              width: 1280,
              height: 720,
              channels: 3,
              background: {
                r: 20,
                g: 20,
                b: 28
              }
            }
          })
            .jpeg()
            .toBuffer();
      }

      // -----------------------------------------------------------------------
      // ORIGINAL IMAGE DIMENSIONS
      // -----------------------------------------------------------------------

      const metadata =
        await sharp(
          backdropBuffer
        ).metadata();

      const width =
        metadata.width || 1280;

      const height =
        metadata.height || 720;

      // -----------------------------------------------------------------------
      // GENRE
      // -----------------------------------------------------------------------

      const formattedGenres =
        genres
          ? genres
              .split(",")
              .slice(0, 2)
              .join(" • ")
              .toUpperCase()
          : "";

      const numRank =
        parseInt(rank, 10) || 1;

      // -----------------------------------------------------------------------
      // NUMBER
      // -----------------------------------------------------------------------

      const numberSvg =
        generateNetflixNumberSvg(
          numRank,
          width,
          height
        );

      // -----------------------------------------------------------------------
      // GENRE PILL
      // -----------------------------------------------------------------------

      const pillWidth =
        Math.max(
          110,
          formattedGenres.length * 12 + 32
        );

      const pillXPos =
        width -
        pillWidth -
        Math.round(
          width * 0.04
        );

      const pillYPos =
        Math.round(
          height * 0.05
        );

      const pillHeight =
        Math.round(
          height * 0.058
        );

      // -----------------------------------------------------------------------
      // OVERLAY
      // -----------------------------------------------------------------------

      const svgOverlay =
        Buffer.from(`
          <svg
            width="${width}"
            height="${height}"
            viewBox="0 0 ${width} ${height}"
            xmlns="http://www.w3.org/2000/svg"
          >

            <defs>

              <!-- Netflix-like darkening toward the number -->
              <linearGradient
                id="netflixGradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop
                  offset="0%"
                  stop-color="#000000"
                  stop-opacity="0.88"
                />

                <stop
                  offset="35%"
                  stop-color="#000000"
                  stop-opacity="0.48"
                />

                <stop
                  offset="70%"
                  stop-color="#000000"
                  stop-opacity="0"
                />
              </linearGradient>

            </defs>

            <!-- LEFT VIGNETTE -->

            <rect
              width="${Math.round(
                width * 0.55
              )}"
              height="${height}"
              fill="url(#netflixGradient)"
            />

            <!-- NETFLIX TOP 10 NUMBER -->

            ${numberSvg}

            <!-- GENRE -->

            ${
              formattedGenres
                ? `
              <g
                transform="
                  translate(
                    ${pillXPos},
                    ${pillYPos}
                  )
                "
              >

                <rect
                  rx="${Math.round(
                    height * 0.018
                  )}"
                  ry="${Math.round(
                    height * 0.018
                  )}"
                  width="${pillWidth}"
                  height="${pillHeight}"
                  fill="#000000"
                  fill-opacity="0.75"
                  stroke="#FFFFFF"
                  stroke-opacity="0.30"
                  stroke-width="1.2"
                />

                <text
                  x="${Math.round(
                    pillWidth / 2
                  )}"
                  y="${Math.round(
                    height * 0.040
                  )}"
                  font-family="
                    system-ui,
                    -apple-system,
                    sans-serif
                  "
                  font-size="${Math.round(
                    height * 0.026
                  )}"
                  font-weight="700"
                  fill="#FFFFFF"
                  text-anchor="middle"
                >
                  ${formattedGenres}
                </text>

              </g>
            `
                : ""
            }

          </svg>
        `);

      // -----------------------------------------------------------------------
      // FINAL IMAGE
      // -----------------------------------------------------------------------

      const result =
        await sharp(
          backdropBuffer
        )
          .composite([
            {
              input:
                svgOverlay,
              top: 0,
              left: 0
            }
          ])
          .jpeg({
            quality: 92
          })
          .toBuffer();

      res.setHeader(
        "Content-Type",
        "image/jpeg"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=86400, s-maxage=86400"
      );

      return res.send(
        result
      );

    } catch (err) {
      console.error(
        "Poster rendering error:",
        err.message
      );

      return res
        .status(500)
        .send(
          "Error rendering poster image"
        );
    }
  }
);

module.exports = app;
