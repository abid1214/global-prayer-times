// City search via OSM Nominatim. CORS-enabled, no key required.
// Be a polite citizen: debounce and cap results.

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

const input = document.getElementById("search");
const results = document.getElementById("searchResults");

let abortCtrl = null;
let debounceId = null;

export function initSearch(onSelect) {
  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (debounceId) clearTimeout(debounceId);
    if (q.length < 2) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    debounceId = setTimeout(() => runSearch(q, onSelect), 300);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => { results.hidden = true; }, 150);
  });
  input.addEventListener("focus", () => {
    if (results.children.length) results.hidden = false;
  });
}

async function runSearch(q, onSelect) {
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&format=json&limit=8&addressdetails=1`;
  let data;
  try {
    const resp = await fetch(url, {
      signal: abortCtrl.signal,
      headers: { "Accept-Language": navigator.language || "en" },
    });
    if (!resp.ok) return;
    data = await resp.json();
  } catch (err) {
    if (err.name !== "AbortError") console.warn("search failed", err);
    return;
  }

  results.innerHTML = "";
  if (!data.length) {
    results.hidden = true;
    return;
  }
  for (const item of data) {
    const el = document.createElement("div");
    el.className = "result";
    const name = item.display_name.split(",")[0];
    const sub = item.display_name.split(",").slice(1, 4).join(",").trim();
    el.innerHTML = `<div>${name}</div><div class="sub">${sub}</div>`;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      results.hidden = true;
      input.value = name;
      onSelect({
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        name: item.display_name,
      });
    });
    results.appendChild(el);
  }
  results.hidden = false;
}
