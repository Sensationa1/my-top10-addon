const TMDB_KEY = process.env.TMDB_API_KEY;
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

/* -------------------------------------------------------------------------- */
/* MDBLIST                                                                    */
/* -------------------------------------------------------------------------- */

async function fetchList(listId) {
  const url =
    `https://api.mdblist.com/lists/${listId}/items` +
    `?apikey=${encodeURIComponent(MDBLIST_KEY)}` +
    `&limit=10`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`MDBList returned ${response.status}`);
  }

  const data = await response.json();

  /*
   * Snoak MDBList lists can return movies/shows depending on the list.
   * Keep all common formats supported.
   */
  return (
    data.movies ||
    data.shows ||
    data.items ||
    []
  ).slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* TMDB                                                                       */
/*                                                                            */
/* Used only for metadata/background information.                             */
/* The actual Nuvio poster comes from ExtendedRatings.                        */
/* -------------------------------------------------------------------------- */

async function fetchTMDB(imdbId, stremioType) {
  if (!TMDB_KEY || !imdbId) {
    return null;
  }

  try {
    const url =
      `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}` +
      `?api_key=${encodeURIComponent(TMDB_KEY)}` +
      `&external_source=imdb_id`;

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    const item =
      stremioType === "movie"
        ? (data.movie_results || [])[0]
        : (data.tv_results || [])[0];

    if (!item) {
      return null;
    }

    return {
      backdrop: item.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
        : null,

      overview: item.overview || "",

      releaseDate:
        item.release_date ||
        item.first_air_date ||
        null,
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* EXTENDEDRATINGS                                                            */
/*                                                                            */
/* Main artwork source.                                                       */
/*                                                                            */
/* IMPORTANT: This is deliberately NOT a TMDB poster.                        */
/* ExtendedRatings supplies the landscape poster.                            */
/*                                                                            */
/* IMDb ID example: tt1234567                                                  */
/*                                                                            */
/* https://extendedratings.com/poster/tt1234567                               */
/* ?config=russel&key=Kolkko11&v=fd3ce853                                      */
/* -------------------------------------------------------------------------- */

function extendedRatingsPoster(imdbId) {
  if (!imdbId) {
    return null;
  }

  return (
    `https://extendedratings.com/poster/${encodeURIComponent(imdbId)}` +
    `?config=russel&key=Kolkko11&v=fd3ce853`
  );
}

/* -------------------------------------------------------------------------- */
/* BTTTR                                                                       */
/*                                                                            */
/* Genre/tag artwork source requested by you.                                  */
/*                                                                            */
/* Example:                                                                    */
/* https://btttr.cc/poster-g/imdb/poster-default/tt1234567.jpg?tag=none       */
/* -------------------------------------------------------------------------- */

function btttrPoster(imdbId) {
  if (!imdbId) {
    return null;
  }

  return (
    `https://btttr.cc/poster-g/imdb/poster-default/` +
    `${encodeURIComponent(imdbId)}.jpg?tag=none`
  );
}

/* -------------------------------------------------------------------------- */
/* APPLE-TV STYLE RANKED LANDSCAPE POSTER                                      */
/*                                                                            */
/* The rank is rendered INTO the image itself.                                */
/*                                                                            */
/* Nuvio therefore receives ONE landscape image instead of:                   */
/*                                                                            */
/*   poster + separate badge                                                   */
/*                                                                            */
/* It receives:                                                               */
/*                                                                            */
/*   [ 1 ] LANDSCAPE POSTER                                                    */
/*                                                                            */
/* This is much closer to the Apple TV / TopToday presentation.                */
/* -------------------------------------------------------------------------- */

function rankedLandscapePoster(imdbId, rank) {
  const source = extendedRatingsPoster(imdbId);

  if (!source) {
    return null;
  }

  /*
   * wsrv.nl is used as an image-processing layer.
   *
   * The source remains the ExtendedRatings landscape artwork.
   *
   * w/h = 16:9
   * fit=cover = force landscape output
   *
   * wt* parameters add the rank directly to the returned image.
   */
  const encodedSource = encodeURIComponent(source);
  const number = String(rank);

  return (
    `https://wsrv.nl/?` +
    `url=${encodedSource}` +
    `&w=780` +
    `&h=439` +
    `&fit=cover` +
    `&output=jpg` +
    `&q=95` +
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

/* -------------------------------------------------------------------------- */
/* META                                                                       */
/* -------------------------------------------------------------------------- */

async function buildMeta(item, rank, stremioType) {
  /*
   * MDBList/Snoak can expose the IMDb identifier under either
   * imdb_id or imdbid depending on the endpoint/list.
   */
  const imdbId =
    item.imdb_id ||
    item.imdbid ||
    item.imdb ||
    null;

  const title =
    item.title ||
    item.name ||
    "";

  const year =
    item.release_year ||
    item.year ||
    null;

  if (!imdbId) {
    console.warn(
      `Skipping "${title}" because no IMDb ID was returned by MDBList`
    );

    return null;
  }

  const tmdb = await fetchTMDB(
    imdbId,
    stremioType
  );

  /*
   * Primary poster:
   *
   * ExtendedRatings
   *        ↓
   * 16:9 crop
   *        ↓
   * rank embedded into image
   *        ↓
   * Nuvio
   */
  const rankedPoster =
    rankedLandscapePoster(
      imdbId,
      rank
    );

  /*
   * If the image processor temporarily fails,
   * return the raw ExtendedRatings image.
   */
  const rawExtendedPoster =
    extendedRatingsPoster(imdbId);

  /*
   * Final fallback is the BTTTR poster.
   *
   * This means an item should still have artwork even if
   * ExtendedRatings is unavailable.
   */
  const fallbackPoster =
    btttrPoster(imdbId);

  const poster =
    rankedPoster ||
    rawExtendedPoster ||
    fallbackPoster ||
    tmdb?.backdrop ||
    undefined;

  return {
    /*
     * Nuvio/Stremio needs IMDb IDs for the catalog item.
     */
    id: imdbId,

    type: stremioType,

    name: title,

    /*
     * THIS IS THE IMPORTANT PART FOR NUVIO.
     *
     * The returned artwork is explicitly landscape.
     */
    poster,

    posterShape: "landscape",

    /*
     * Nuvio can use this when opening the title.
     */
    background:
      tmdb?.backdrop ||
      undefined,

    description:
      item.description ||
      item.overview ||
      tmdb?.overview ||
      "",

    releaseInfo:
      year
        ? String(year)
        : tmdb?.releaseDate
          ? String(tmdb.releaseDate).slice(0, 4)
          : undefined,

    imdbRating:
      item.imdbrating != null
        ? Number(item.imdbrating).toFixed(1)
        : undefined,

    /*
     * Extra information retained in the metadata object.
     * Useful if you later want Nuvio-specific rendering.
     */
    imdb_id: imdbId,

    rank,

    /*
     * Keep the BTTTR source available in the metadata without
     * replacing the main landscape poster.
     */
    genrePoster: fallbackPoster,
  };
}

/* -------------------------------------------------------------------------- */
/* CATALOG                                                                    */
/* -------------------------------------------------------------------------- */

async function buildCatalog(type, listId) {
  const items =
    await fetchList(listId);

  const firstTen =
    items.slice(0, 10);

  /*
   * Keep the original MDBList ordering.
   *
   * This is important:
   *
   * MDBList rank 1 → number 1
   * MDBList rank 2 → number 2
   * ...
   * MDBList rank 10 → number 10
   */
  const results =
    await Promise.all(
      firstTen.map(
        (item, index) =>
          buildMeta(
            item,
            index + 1,
            type
          )
      )
    );

  return results.filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* HTTP HANDLER                                                               */
/* -------------------------------------------------------------------------- */

export default async function handler(req, res) {
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
    return res.status(200).end();
  }

  const requestUrl =
    req.url || "/";

  const path =
    requestUrl
      .split("?")[0]
      .replace(/^\/api/, "");

  /* ---------------------------------------------------------------------- */
  /* MANIFEST                                                               */
  /* ---------------------------------------------------------------------- */

  if (
    path === "/" ||
    path === "" ||
    path === "/manifest.json"
  ) {
    res.setHeader(
      "Content-Type",
      "application/json"
    );

    return res.status(200).json(
      MANIFEST
    );
  }

  /* ---------------------------------------------------------------------- */
  /* CATALOG                                                                */
  /* ---------------------------------------------------------------------- */

  const match =
    path.match(
      /^\/catalog\/([^/]+)\/([^/]+?)(?:\.json)?$/
    );

  if (match) {
    const type =
      match[1];

    const catalogId =
      match[2];

    const key =
      `${type}/${catalogId}`;

    const source =
      SOURCES[key];

    if (!source) {
      res.setHeader(
        "Content-Type",
        "application/json"
      );

      return res.status(404).json({
        metas: [],
      });
    }

    if (!MDBLIST_KEY) {
      res.setHeader(
        "Content-Type",
        "application/json"
      );

      return res.status(500).json({
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
       * Snoak/MDBList handles the actual Trakt Trending
       * refresh; your Nuvio addon does not hammer MDBList.
       */
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=900, stale-while-revalidate=1800"
      );

      return res.status(200).json({
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

      return res.status(502).json({
        error:
          error?.message ||
          "Unable to load MDBList",
        metas: [],
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* NOT FOUND                                                              */
  /* ---------------------------------------------------------------------- */

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  return res.status(404).json({
    error: "Not found",
  });
}
