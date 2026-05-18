// High-latitude populated places (|lat| ≥ 50°), used by the
// "aqrab al-bilād — nearest city" option to snap polar-cap requests to a
// real city's coordinates.
//
// Provenance: hand-curated seed list of well-known cities. TODO: replace
// at build time with Natural Earth `ne_10m_populated_places` filtered to
// |lat| ≥ 50°, sorted by population, capped at ~500. Source:
//   https://github.com/nvkelso/natural-earth-vector
// Until then, the snap may miss less-prominent cities; the panel falls
// back to the same-longitude projection when no candidate is in window.
//
// Schema: { name, country, lat, lon, pop }
//   lat/lon in degrees, lon in -180..180 (east positive).

export const HIGH_LAT_CITIES = [
  // Northern hemisphere — Europe
  { name: "Moscow",         country: "RU", lat: 55.75, lon:  37.62, pop: 12500000 },
  { name: "London",         country: "GB", lat: 51.51, lon:  -0.13, pop:  9000000 },
  { name: "Saint Petersburg", country: "RU", lat: 59.93, lon: 30.36, pop: 5400000 },
  { name: "Berlin",         country: "DE", lat: 52.52, lon:  13.40, pop:  3700000 },
  { name: "Kyiv",           country: "UA", lat: 50.45, lon:  30.52, pop:  3000000 },
  { name: "Minsk",          country: "BY", lat: 53.90, lon:  27.57, pop:  2000000 },
  { name: "Hamburg",        country: "DE", lat: 53.55, lon:   9.99, pop:  1900000 },
  { name: "Warsaw",         country: "PL", lat: 52.23, lon:  21.01, pop:  1800000 },
  { name: "Stockholm",      country: "SE", lat: 59.33, lon:  18.07, pop:  1500000 },
  { name: "Prague",         country: "CZ", lat: 50.08, lon:  14.43, pop:  1300000 },
  { name: "Brussels",       country: "BE", lat: 50.85, lon:   4.35, pop:  1200000 },
  { name: "Birmingham",     country: "GB", lat: 52.49, lon:  -1.90, pop:  1150000 },
  { name: "Cologne",        country: "DE", lat: 50.94, lon:   6.96, pop:  1090000 },
  { name: "Amsterdam",      country: "NL", lat: 52.37, lon:   4.90, pop:   870000 },
  { name: "Copenhagen",     country: "DK", lat: 55.68, lon:  12.57, pop:   800000 },
  { name: "Leeds",          country: "GB", lat: 53.80, lon:  -1.55, pop:   790000 },
  { name: "Frankfurt",      country: "DE", lat: 50.11, lon:   8.68, pop:   760000 },
  { name: "Łódź",           country: "PL", lat: 51.76, lon:  19.46, pop:   670000 },
  { name: "Helsinki",       country: "FI", lat: 60.17, lon:  24.94, pop:   660000 },
  { name: "Rotterdam",      country: "NL", lat: 51.92, lon:   4.48, pop:   650000 },
  { name: "Wrocław",        country: "PL", lat: 51.11, lon:  17.04, pop:   640000 },
  { name: "Glasgow",        country: "GB", lat: 55.86, lon:  -4.25, pop:   630000 },
  { name: "Düsseldorf",     country: "DE", lat: 51.23, lon:   6.78, pop:   620000 },
  { name: "Riga",           country: "LV", lat: 56.95, lon:  24.10, pop:   615000 },
  { name: "Leipzig",        country: "DE", lat: 51.34, lon:  12.37, pop:   600000 },
  { name: "Oslo",           country: "NO", lat: 59.91, lon:  10.75, pop:   700000 },
  { name: "Dublin",         country: "IE", lat: 53.35, lon:  -6.26, pop:   590000 },
  { name: "Dortmund",       country: "DE", lat: 51.51, lon:   7.47, pop:   590000 },
  { name: "Essen",          country: "DE", lat: 51.46, lon:   7.01, pop:   580000 },
  { name: "Vilnius",        country: "LT", lat: 54.69, lon:  25.28, pop:   580000 },
  { name: "Sheffield",      country: "GB", lat: 53.38, lon:  -1.47, pop:   580000 },
  { name: "Gothenburg",     country: "SE", lat: 57.71, lon:  11.97, pop:   580000 },
  { name: "Dresden",        country: "DE", lat: 51.05, lon:  13.74, pop:   560000 },
  { name: "Manchester",     country: "GB", lat: 53.48, lon:  -2.24, pop:   550000 },
  { name: "Hannover",       country: "DE", lat: 52.37, lon:   9.74, pop:   540000 },
  { name: "Antwerp",        country: "BE", lat: 51.22, lon:   4.40, pop:   530000 },
  { name: "Bremen",         country: "DE", lat: 53.08, lon:   8.80, pop:   570000 },
  { name: "Liverpool",      country: "GB", lat: 53.40, lon:  -2.99, pop:   500000 },
  { name: "Edinburgh",      country: "GB", lat: 55.95, lon:  -3.19, pop:   480000 },
  { name: "Bristol",        country: "GB", lat: 51.45, lon:  -2.59, pop:   470000 },
  { name: "Gdańsk",         country: "PL", lat: 54.35, lon:  18.65, pop:   470000 },
  { name: "Tallinn",        country: "EE", lat: 59.44, lon:  24.75, pop:   440000 },
  { name: "Cardiff",        country: "GB", lat: 51.48, lon:  -3.18, pop:   360000 },
  { name: "Coventry",       country: "GB", lat: 52.41, lon:  -1.51, pop:   360000 },
  { name: "Malmö",          country: "SE", lat: 55.61, lon:  13.00, pop:   350000 },
  { name: "Belfast",        country: "GB", lat: 54.60, lon:  -5.93, pop:   340000 },
  { name: "Nottingham",     country: "GB", lat: 52.95, lon:  -1.15, pop:   330000 },
  { name: "Newcastle",      country: "GB", lat: 54.97, lon:  -1.61, pop:   300000 },
  { name: "Bergen",         country: "NO", lat: 60.39, lon:   5.32, pop:   280000 },
  { name: "Aberdeen",       country: "GB", lat: 57.15, lon:  -2.10, pop:   200000 },
  { name: "Trondheim",      country: "NO", lat: 63.43, lon:  10.39, pop:   200000 },
  { name: "Reykjavík",      country: "IS", lat: 64.13, lon: -21.82, pop:   130000 },
  { name: "Tartu",          country: "EE", lat: 58.38, lon:  26.72, pop:    91000 },
  { name: "Tórshavn",       country: "FO", lat: 62.01, lon:  -6.77, pop:    13000 },

  // Northern hemisphere — Russia (Asia)
  { name: "Novosibirsk",    country: "RU", lat: 55.04, lon:  82.93, pop:  1600000 },
  { name: "Yekaterinburg",  country: "RU", lat: 56.85, lon:  60.61, pop:  1490000 },
  { name: "Kazan",          country: "RU", lat: 55.83, lon:  49.07, pop:  1250000 },
  { name: "Nizhny Novgorod", country: "RU", lat: 56.30, lon: 43.99, pop:  1250000 },
  { name: "Omsk",           country: "RU", lat: 54.99, lon:  73.37, pop:  1170000 },
  { name: "Ufa",            country: "RU", lat: 54.74, lon:  55.97, pop:  1120000 },
  { name: "Krasnoyarsk",    country: "RU", lat: 56.01, lon:  92.85, pop:  1100000 },
  { name: "Perm",           country: "RU", lat: 58.01, lon:  56.25, pop:  1050000 },
  { name: "Tyumen",         country: "RU", lat: 57.15, lon:  65.53, pop:   800000 },
  { name: "Tomsk",          country: "RU", lat: 56.50, lon:  84.97, pop:   580000 },
  { name: "Arkhangelsk",    country: "RU", lat: 64.54, lon:  40.51, pop:   350000 },
  { name: "Yakutsk",        country: "RU", lat: 62.03, lon: 129.73, pop:   320000 },
  { name: "Murmansk",       country: "RU", lat: 68.97, lon:  33.08, pop:   270000 },
  { name: "Norilsk",        country: "RU", lat: 69.35, lon:  88.20, pop:   175000 },
  { name: "Magadan",        country: "RU", lat: 59.57, lon: 150.80, pop:    92000 },

  // Northern hemisphere — North America
  { name: "Calgary",        country: "CA", lat: 51.05, lon: -114.08, pop: 1300000 },
  { name: "Edmonton",       country: "CA", lat: 53.55, lon: -113.49, pop: 1000000 },
  { name: "Anchorage",      country: "US", lat: 61.22, lon: -149.90, pop:  290000 },
  { name: "Fairbanks",      country: "US", lat: 64.84, lon: -147.72, pop:   32000 },
  { name: "Whitehorse",     country: "CA", lat: 60.72, lon: -135.05, pop:   25000 },
  { name: "Yellowknife",    country: "CA", lat: 62.45, lon: -114.37, pop:   20000 },
  { name: "Nuuk",           country: "GL", lat: 64.18, lon:  -51.74, pop:   18000 },
  { name: "Iqaluit",        country: "CA", lat: 63.75, lon:  -68.52, pop:    7700 },
  { name: "Nome",           country: "US", lat: 64.50, lon: -165.41, pop:    3800 },

  // Northern hemisphere — Arctic outposts
  { name: "Tromsø",         country: "NO", lat: 69.65, lon:  18.96, pop:    76000 },
  { name: "Longyearbyen",   country: "NO", lat: 78.22, lon:  15.65, pop:     2400 },

  // Southern hemisphere — very few populated places above 50°S
  { name: "Punta Arenas",   country: "CL", lat: -53.16, lon: -70.92, pop:  130000 },
  { name: "Río Gallegos",   country: "AR", lat: -51.62, lon: -69.22, pop:   95000 },
  { name: "Ushuaia",        country: "AR", lat: -54.81, lon: -68.30, pop:   81000 },
  { name: "Puerto Williams", country: "CL", lat: -54.93, lon: -67.62, pop:   2800 },
  { name: "Stanley",        country: "FK", lat: -51.69, lon: -57.85, pop:    2500 },
];
