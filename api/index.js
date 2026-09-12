const MDBLIST_KEY = process.env.MDBLIST_API_KEY;

const SOURCES = {
  "movie/top10-movies": {
    listId: "87667",
    stremioType: "movie",
  },

  "series/top10-series": {
    listId: "88434",
    stremioType: "series",
  },
};

const MANIFEST = {
  id: "community.nuvio.top10.ranked",
  version: "5.0.0",
  name: "Top 10 Trending",

  description:
    "Top 10 Trakt trending movies and series from Snoak MDBList.",

  resources: ["catalog"],

  types: ["movie", "series"],

  idPrefixes: ["tt"],

  catalogs: [
    {
      id: "top10-movies",
      type: "movie",
      name: "🔥 Top 10 Movies",
    },

    {
      id: "top10-series",
      type: "series",
      name: "🔥 Top 10 Series",
    },
  ],

  behaviorHints: {
    adult: false,
    p2pNotSupported: true,
  },
};


/* ==========================================================================
   MDBLIST
   ========================================================================== */

/*
 * Snoak's MDBList lists:
 *
 * 87667 = Trakt Trending Movies
 * 88434 = Trakt Trending Shows
 *
 * We deliberately use MDBList rather than the Trakt API.
 *
 * This means:
 *
 * - No Trakt VIP
 * - No Trakt OAuth
 * - No Trakt API calls
 * - No Trakt client ID required
 *
 * Snoak's lists provide the ordering.
 */

async function fetchList(listId) {
  if (!MDBLIST_KEY) {
    throw new Error("MDBLIST_API_KEY is not configured");
  }

  const url =
    `https://api.mdblist.com/lists/${listId}/items` +
    `?apikey=${encodeURIComponent(MDBLIST_KEY)}` +
    `&limit=10`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `MDBList request failed: ${response.status}`
    );
  }

  const data = await response.json();

  /*
   * MDBList may return:
   *
   * movies
   * shows
   * items
   *
   * depending on the list type/API response.
   */

  const items =
    data.movies ||
    data.shows ||
    data.items ||
    [];

  return Array.isArray(items)
    ? items.slice(0, 10)
    : [];
}


/* ==========================================================================
   IMDb ID
   ========================================================================== */

function getImdbId(item) {
  return (
    item.imdb_id ||
    item.imdbid ||
    item.imdb ||
    item.ids?.imdb ||
    null
  );
}


/* ==========================================================================
   EXTENDED RATINGS
   ========================================================================== */

/*
 * THIS IS THE IMPORTANT CHANGE.
 *
 * We are NOT using:
 *
 * /poster/{id}
 *
 * because that is portrait artwork.
 *
 * We are using:
 *
 * /backdrop/{id}
 *
 * which is ExtendedRatings' actual landscape artwork.
 *
 * Example:
 *
 * https://extendedratings.com/backdrop/tt1234567
 * ?config=russel&key=Kolkko11&v=fd3ce853
 */

function extendedRatingsBackdrop(imdbId) {
  if (!imdbId) {
    return null;
  }

  return (
    `https://extendedratings.com/backdrop/` +
    `${encodeURIComponent(imdbId)}` +
    `?config=russel&key=Kolkko11&v=fd3ce853`
  );
}


/* ==========================================================================
   BTTTR
   ========================================================================== */

/*
 * BTTTR remains available as the genre/tag artwork source.
 *
 * It is NOT used to stretch the ExtendedRatings artwork.
 */

function btttrPoster(imdbId) {
  if (!imdbId) {
    return null;
  }

  return (
    `https://btttr.cc/poster-g/imdb/poster-default/` +
    `${encodeURIComponent(imdbId)}.jpg?tag=none`
  );
}


/* ==========================================================================
   RANKED LANDSCAPE IMAGE
   ========================================================================== */

/*
 * The image entering this function is ALREADY a landscape image:
 *
 * ExtendedRatings BACKDROP
 *
 * We then put the Apple-TV-style ranking number over it.
 *
 * The important distinction is:
 *
 * BEFORE:
 *
 * ExtendedRatings portrait poster
 *          ↓
 * force 16:9
 *
 * NOW:
 *
 * ExtendedRatings landscape backdrop
 *          ↓
 * add number
 *          ↓
 * Nuvio
 *
 * No portrait poster is stretched.
 */

function rankedLandscapePoster(imdbId, rank) {
  const backdrop =
    extendedRatingsBackdrop(imdbId);

  if (!backdrop) {
    return null;
  }

  /*
   * wsrv.nl performs the image transformation.
   *
   * The source is the ExtendedRatings BACKDROP.
   *
   * 780 × 439 = 16:9 output.
   *
   * fit=cover is only used to guarantee the final image
   * has the exact landscape dimensions. It is NOT converting
   * a portrait poster into landscape.
   */

  const encodedSource =
    encodeURIComponent(backdrop);

  const number =
    String(rank);

  return (
    `https://wsrv.nl/?` +
    `url=${encodedSource}` +
    `&w=780` +
    `&h=439` +
    `&fit=cover` +
    `&output=jpg` +
    `&q=95` +

    /*
     * Text overlay
     */
    `&wtl=${encodeURIComponent(number)}` +
    `&wts=120` +
    `&wtc=ffffff` +
    `&wtb=1` +
    `&wtp=0` +
    `&wta=0` +
    `&wtx=24` +
    `&wty=24`
  );
}


/* ==========================================================================
   BUILD META
   ========================================================================== */

async function buildMeta(
  item,
  rank,
  stremioType
) {
  const imdbId =
    getImdbId(item);

  const title =
    item.title ||
    item.name ||
    "";

  const year =
    item.release_year ||
    item.year ||
    null;

  /*
   * If MDBList somehow returns an item without an IMDb ID,
   * don't create a broken Nuvio item.
   */

  if (!imdbId) {
    console.warn(
      `Skipping "${title}" because no IMDb ID was returned.`
    );

    return null;
  }

  /*
   * Main poster:
   *
   * ExtendedRatings BACKDROP
   * + rank number
   */

  const rankedPoster =
    rankedLandscapePoster(
      imdbId,
      rank
    );

  /*
   * Raw ExtendedRatings backdrop is our fallback.
   */

  const rawBackdrop =
    extendedRatingsBackdrop(
      imdbId
    );

  /*
   * BTTTR is the final artwork fallback.
   */

  const btttr =
    btttrPoster(
      imdbId
    );

  const poster =
    rankedPoster ||
    rawBackdrop ||
    btttr ||
    undefined;

  return {
    /*
     * IMDb ID is what Nuvio/Stremio uses.
     */

    id: imdbId,

    type: stremioType,

    name: title,

    /*
     * The actual returned image is landscape.
     */

    poster,

    posterShape: "landscape",

    /*
     * Keep these useful fields available.
     */

    description:
      item.description ||
      item.overview ||
      "",

    releaseInfo:
      year
        ? String(year)
        : undefined,

    imdbRating:
      item.imdbrating != null
        ? Number(item.imdbrating).toFixed(1)
        : undefined,

    /*
     * Additional information.
     */

    imdb_id: imdbId,

    rank: rank,

    /*
     * BTTTR genre/tag artwork remains available
     * without replacing the main landscape poster.
     */

    genrePoster: btttr,
  };
}


/* ==========================================================================
   BUILD TOP 10
   ========================================================================== */

async function buildCatalog(
  type,
  listId
) {
  const items =
    await fetchList(listId);

  /*
   * The order from Snoak MDBList is preserved.
   *
   * Position 1 = #1
   * Position 2 = #2
   * ...
   * Position 10 = #10
   */

  const topTen =
    items.slice(0, 10);

  const metas =
    await Promise.all(
      topTen.map(
        (item, index) =>
          buildMeta(
            item,
            index + 1,
            type
          )
      )
    );

  return metas.filter(Boolean);
}


/* ==========================================================================
   HTTP HANDLER
   ========================================================================== */

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res
      .status(200)
      .end();
  }

  const requestUrl =
    req.url || "/";

  const path =
    requestUrl
      .split("?")[0]
      .replace(/^\/api/, "");


  /* ------------------------------------------------------------------------
     MANIFEST
     ------------------------------------------------------------------------ */

  if (
    path === "/" ||
    path === "" ||
    path === "/manifest.json"
  ) {
    res.setHeader(
      "Content-Type",
      "application/json"
    );

    return res
      .status(200)
      .json(MANIFEST);
  }


  /* ------------------------------------------------------------------------
     CATALOG
     ------------------------------------------------------------------------ */

  const match =
    path.match(
      /^\/catalog\/([^/]+)\/([^/]+?)(?:\.json)?$/
    );

  if (match) {
    const type =
      match[1];

    const catalogId =
      match[2];

    const sourceKey =
      `${type}/${catalogId}`;

    const source =
      SOURCES[sourceKey];


    if (!source) {
      res.setHeader(
        "Content-Type",
        "application/json"
      );

      return res
        .status(404)
        .json({
          metas: [],
        });
    }


    if (!MDBLIST_KEY) {
      res.setHeader(
        "Content-Type",
        "application/json"
      );

      return res
        .status(500)
        .json({
          error:
            "MDBLIST_API_KEY is not configured",
          metas: [],
        });
    }


    try {
      const metas =
        await buildCatalog(
          source.stremioType,
          source.listId
        );


      res.setHeader(
        "Content-Type",
        "application/json"
      );


      /*
       * Cache for 15 minutes.
       *
       * This prevents excessive MDBList requests while
       * allowing the Top 10 list to update regularly.
       */

      res.setHeader(
        "Cache-Control",
        "public, s-maxage=900, stale-while-revalidate=1800"
      );


      return res
        .status(200)
        .json({
          metas,
        });

    } catch (error) {
      console.error(
        "Top 10 catalog error:",
        error
      );

      res.setHeader(
        "Content-Type",
        "application/json"
      );

      return res
        .status(502)
        .json({
          error:
            error?.message ||
            "Unable to load MDBList",
          metas: [],
        });
    }
  }


  /* ------------------------------------------------------------------------
     404
     ------------------------------------------------------------------------ */

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res
    .status(404)
    .json({
      error: "not found",
    });
}
