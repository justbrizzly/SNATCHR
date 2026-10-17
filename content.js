// SNATCHR — content script · Made by your friendly neighborhood bear Brizzly
// Runs before page scripts, so its capture listeners fire first.

let lastFound = [];
let unlock = true;

chrome.storage.local.get({ unlock: true }, (r) => { unlock = r.unlock; });
chrome.storage.onChanged.addListener((c) => {
  if (c.unlock) unlock = c.unlock.newValue;
});

// ---------- URL extraction ----------

function abs(u) {
  if (!u) return null;
  u = String(u).trim();
  if (!u || u === "about:blank") return null;
  try { return new URL(u, location.href).href; } catch { return null; }
}

function bestFromSrcset(srcset) {
  if (!srcset) return null;
  let best = null, bestScore = -1;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, desc = "1x"] = part.trim().split(/\s+/);
    const n = parseFloat(desc) || 1;
    const score = desc.endsWith("w") ? n : n * 1000; // treat 2x ~ 2000w
    if (score > bestScore) { bestScore = score; best = url; }
  }
  return abs(best);
}

function bgUrls(el) {
  const out = [];
  let bg;
  try { bg = getComputedStyle(el).backgroundImage; } catch { return out; }
  if (!bg || bg === "none") return out;
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
  let m;
  while ((m = re.exec(bg))) { const u = abs(m[2]); if (u) out.push(u); }
  return out;
}

const LAZY_ATTRS = ["data-src", "data-original", "data-lazy-src", "data-full", "data-hi-res", "data-zoom-image"];

function collect(el) {
  const out = [];
  const tag = el.tagName;

  if (tag === "IMG") {
    const pic = el.closest("picture");
    if (pic) for (const s of pic.querySelectorAll("source")) out.push(bestFromSrcset(s.srcset));
    out.push(bestFromSrcset(el.srcset));
    for (const a of LAZY_ATTRS) out.push(abs(el.getAttribute(a)));
    out.push(abs(el.currentSrc), abs(el.src));
  } else if (tag === "VIDEO" || tag === "AUDIO") {
    out.push(abs(el.currentSrc), abs(el.src));
    for (const s of el.querySelectorAll("source")) out.push(abs(s.src));
    if (tag === "VIDEO") out.push(abs(el.poster)); // last resort: the thumbnail
  } else if (tag === "CANVAS") {
    try { out.push(el.toDataURL("image/png")); } catch { /* tainted canvas */ }
  } else if (tag === "image" || tag === "IMAGE") { // SVG <image>
    out.push(abs(el.getAttribute("href") || el.getAttribute("xlink:href")));
  }

  out.push(...bgUrls(el));
  return out.filter(Boolean);
}

function rank(u) {
  // Real files first, page-local blobs next, data: URLs last.
  if (u.startsWith("blob:")) return 1;
  if (u.startsWith("data:")) return 2;
  return 0;
}

function dedupe(list) {
  return [...new Set(list)].sort((a, b) => rank(a) - rank(b));
}

function elementsAt(x, y) {
  const seen = new Set();
  const out = [];
  const add = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };

  // Everything stacked at the point (overlays included), piercing open shadow roots.
  const walk = (root, depth) => {
    let stack = [];
    try { stack = root.elementsFromPoint(x, y); } catch {}
    for (const el of stack) {
      add(el);
      if (el.shadowRoot && depth < 5) walk(el.shadowRoot, depth + 1);
    }
  };
  walk(document, 0);

  // elementsFromPoint skips pointer-events:none elements — sweep media by geometry too.
  for (const el of document.querySelectorAll("img, video, picture source, canvas, audio")) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) add(el);
  }
  return out;
}

function mediaAt(x, y) {
  const found = [];
  for (const el of elementsAt(x, y)) {
    found.push(...collect(el));
    // Overlay wrapper? Check its media descendants that cover the point.
    if (!/^(IMG|VIDEO|CANVAS)$/.test(el.tagName)) {
      for (const child of el.querySelectorAll?.("img, video") || []) {
        const r = child.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found.push(...collect(child));
      }
    }
  }
  return dedupe(found);
}

function allMediaOnPage() {
  const found = [];
  for (const el of document.querySelectorAll("img, video, picture source")) {
    if (el.tagName === "SOURCE") found.push(bestFromSrcset(el.srcset), abs(el.src));
    else found.push(...collect(el).filter((u) => !u.startsWith("data:")));
  }
  return dedupe(found.filter(Boolean)).filter((u) => !u.startsWith("data:"));
}

// ---------- Right-click unblocking ----------

function onContextMenu(e) {
  lastFound = mediaAt(e.clientX, e.clientY);
  // Stop the page's own handlers (the ones that call preventDefault / show "no saving" popups).
  if (unlock) e.stopImmediatePropagation();
}

function onRightButton(e) {
  if (unlock && e.button === 2) e.stopImmediatePropagation();
}

window.addEventListener("contextmenu", onContextMenu, true);
window.addEventListener("mousedown", onRightButton, true);
window.addEventListener("mouseup", onRightButton, true);
window.addEventListener("pointerdown", onRightButton, true);

// ---------- Messages from background ----------

function filenameFrom(url, type) {
  let name = "media";
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (p) name = decodeURIComponent(p);
  } catch {}
  if (!/\.[a-z0-9]{2,5}$/i.test(name) && type) {
    const ext = type.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg").replace("svg+xml", "svg");
    if (ext) name += "." + ext;
  }
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

async function fetchAndSave(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filenameFrom(url, blob.type);
  a.style.display = "none";
  (document.body || document.documentElement).appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "getMedia") {
    sendResponse({ urls: lastFound });
  } else if (msg.type === "getAllMedia") {
    sendResponse({ urls: allMediaOnPage() });
  } else if (msg.type === "fetchSave") {
    fetchAndSave(msg.url)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async
  }
});
