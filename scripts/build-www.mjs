// Assembles ./www/ — the directory Capacitor bundles into the iOS/Android
// app, and that the PWA service worker treats as the app shell.
//
// What it does:
//   1. Wipes ./www/
//   2. Copies the static site (index.html, styles.css, src/, manifest, sw.js)
//   3. Copies ./vendor/ (run `npm run vendor` first if missing) into ./www/vendor/
//   4. Rewrites the importmap in index.html so it points at the local vendor
//      files instead of cdn.jsdelivr.net
//   5. Rewrites the tz-lookup dynamic import and the earth-texture URL in src/
//
// The source tree at the repo root is untouched, so `python3 -m http.server`
// in dev still works against the CDN.

import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const OUT = resolve(ROOT, "www");
const VENDOR = resolve(ROOT, "vendor");

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

if (!(await exists(VENDOR))) {
  console.error("Missing ./vendor — run `npm run vendor` first.");
  process.exit(1);
}

console.log(`Building ${OUT}`);
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Static copies
const COPY = ["styles.css", "src", "manifest.webmanifest", "sw.js", "vendor"];
for (const p of COPY) {
  const from = resolve(ROOT, p);
  if (!(await exists(from))) continue;
  await cp(from, resolve(OUT, p), { recursive: true });
}

// index.html with rewritten importmap
const indexSrc = await readFile(resolve(ROOT, "index.html"), "utf8");
const indexOut = indexSrc.replace(
  /<script type="importmap">[\s\S]*?<\/script>/,
  `<script type="importmap">
  {
    "imports": {
      "three": "./vendor/three/three.module.js",
      "three/addons/": "./vendor/three/addons/",
      "adhan": "./vendor/adhan/adhan.js"
    }
  }
  </script>`
);
await writeFile(resolve(OUT, "index.html"), indexOut);

// Patch tz-lookup import inside the bundled src/panel.js
const panelPath = resolve(OUT, "src/panel.js");
const panelSrc = await readFile(panelPath, "utf8");
const panelOut = panelSrc.replace(
  /import\("https:\/\/cdn\.jsdelivr\.net\/npm\/tz-lookup@[^"]+"\)/,
  'import("../vendor/tz-lookup/tz-lookup.js")'
);
if (panelOut === panelSrc) {
  console.warn("  ! tz-lookup import in src/panel.js was not patched (regex mismatch)");
}
await writeFile(panelPath, panelOut);

// Patch the earth texture URL in src/main.js
const mainPath = resolve(OUT, "src/main.js");
const mainSrc = await readFile(mainPath, "utf8");
const mainOut = mainSrc.replace(
  /"https:\/\/unpkg\.com\/three-globe\/example\/img\/earth-blue-marble\.jpg"/,
  '"./vendor/textures/earth-blue-marble.jpg"'
);
if (mainOut === mainSrc) {
  console.warn("  ! earth-blue-marble.jpg URL in src/main.js was not patched (regex mismatch)");
}
await writeFile(mainPath, mainOut);

console.log("Done.");
