// SNATCHR — service worker
// Made by your friendly neighborhood bear Brizzly

const pending = new Map(); // downloadId -> { url, tabId, frameId }

// Keep the right-click checkbox in sync when the popup toggle changes.
chrome.storage.onChanged.addListener((c) => {
  if (c.unlock) chrome.contextMenus.update("unlock", { checked: c.unlock.newValue }, () => void chrome.runtime.lastError);
});

chrome.runtime.onInstalled.addListener(async () => {
  const { unlock = true } = await chrome.storage.local.get("unlock");
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save-here", title: "Save media here", contexts: ["all"] });
    chrome.contextMenus.create({ id: "save-all", title: "Save all media on this page", contexts: ["all"] });
    chrome.contextMenus.create({ id: "sep", type: "separator", contexts: ["all"] });
    chrome.contextMenus.create({
      id: "unlock", type: "checkbox", checked: unlock,
      title: "Unblock right-click on sites", contexts: ["all"]
    });
  });
});

function flash(tabId, text, color = "#d33") {
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeText({ text, tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }), 2500);
}

async function ask(tabId, frameId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg, { frameId }); }
  catch { return null; }
}

// Last resort: fetch from the extension (bypasses CORS via host_permissions), save as data URL.
async function backgroundFetchSave(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const blob = await res.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  await chrome.downloads.download({ url: dataUrl });
}

async function fallback(url, tabId, frameId) {
  const r = await ask(tabId, frameId, { type: "fetchSave", url });
  if (r?.ok) return true;
  if (url.startsWith("blob:")) return false; // blob URLs only live in the page
  try { await backgroundFetchSave(url); return true; } catch { return false; }
}

async function save(url, tabId, frameId) {
  // blob: URLs belong to the page, so the page has to read them.
  if (url.startsWith("blob:")) {
    const ok = await fallback(url, tabId, frameId);
    if (!ok) flash(tabId, "STRM"); // MediaSource stream — not a file
    return ok;
  }
  try {
    const id = await chrome.downloads.download({ url });
    pending.set(id, { url, tabId, frameId });
    return true;
  } catch {
    const ok = await fallback(url, tabId, frameId);
    if (!ok) flash(tabId, "ERR");
    return ok;
  }
}

// If a direct download gets interrupted (hotlink protection, 403, etc.), retry via the page.
chrome.downloads.onChanged.addListener(async (d) => {
  const job = pending.get(d.id);
  if (!job || !d.state) return;
  if (d.state.current === "complete") { pending.delete(d.id); return; }
  if (d.state.current === "interrupted") {
    pending.delete(d.id);
    chrome.downloads.erase({ id: d.id });
    const ok = await fallback(job.url, job.tabId, job.frameId);
    if (!ok) flash(job.tabId, "ERR");
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "unlock") {
    await chrome.storage.local.set({ unlock: info.checked });
    return;
  }
  if (!tab?.id) return;
  const frameId = info.frameId ?? 0;

  if (info.menuItemId === "save-here") {
    const r = await ask(tab.id, frameId, { type: "getMedia" });
    const urls = [...(info.srcUrl ? [info.srcUrl] : []), ...(r?.urls || [])];
    const unique = [...new Set(urls)];
    if (!unique.length) { flash(tab.id, "NONE"); return; }

    // Try candidates in order until one works.
    for (const url of unique) {
      if (await save(url, tab.id, frameId)) { flash(tab.id, "OK", "#2a2"); return; }
    }
  }

  if (info.menuItemId === "save-all") await saveAll(tab.id, frameId);
});

async function saveAll(tabId, frameId = 0) {
  const r = await ask(tabId, frameId, { type: "getAllMedia" });
  const urls = r?.urls || [];
  if (!urls.length) { flash(tabId, "NONE"); return 0; }
  for (const url of urls) await save(url, tabId, frameId);
  flash(tabId, String(urls.length), "#2a2");
  return urls.length;
}

// From the toolbar popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "saveAll") {
    saveAll(msg.tabId).then((count) => sendResponse({ count }));
    return true;
  }
});
