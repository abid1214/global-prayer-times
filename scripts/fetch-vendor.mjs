// Downloads CDN-loaded JS/asset dependencies into ./vendor/ so the native
// app (and offline PWA) can run without network access on first launch.
//
// Re-run any time the pinned versions in this file change.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const OUT = resolve(ROOT, "vendor");

const VENDOR_FILES = [
  // three.js core (ES module build)
  {
    url: "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    dest: "three/three.module.js",
  },
  // three.js Line2 addons (used for the qibla great-circle arc)
  {
    url: "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/Line2.js",
    dest: "three/addons/lines/Line2.js",
  },
  {
    url: "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineMaterial.js",
    dest: "three/addons/lines/LineMaterial.js",
  },
  {
    url: "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineGeometry.js",
    dest: "three/addons/lines/LineGeometry.js",
  },
  {
    url: "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineSegments2.js",
    dest: "three/addons/lines/LineSegments2.js",
  },
  {
    url: "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/lines/LineSegmentsGeometry.js",
    dest: "three/addons/lines/LineSegmentsGeometry.js",
  },
  // Prayer-time math
  {
    url: "https://cdn.jsdelivr.net/npm/adhan@4.4.3/+esm",
    dest: "adhan/adhan.js",
  },
  // IANA timezone lookup
  {
    url: "https://cdn.jsdelivr.net/npm/tz-lookup@6.1.25/+esm",
    dest: "tz-lookup/tz-lookup.js",
  },
  // Earth Blue Marble texture (composite, uniformly lit)
  {
    url: "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg",
    dest: "textures/earth-blue-marble.jpg",
    binary: true,
  },
];

async function fetchOne({ url, dest, binary }) {
  const target = resolve(OUT, dest);
  await mkdir(dirname(target), { recursive: true });
  process.stdout.write(`  → ${dest} ... `);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  await writeFile(target, body);
  process.stdout.write(`${body.length.toLocaleString()} bytes\n`);
}

console.log(`Vendoring CDN deps into ${OUT}`);
for (const f of VENDOR_FILES) {
  await fetchOne(f);
}
console.log("Done.");
