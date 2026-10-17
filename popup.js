const unlock = document.getElementById("unlock");
const status = document.getElementById("status");

chrome.storage.local.get({ unlock: true }, (r) => { unlock.checked = r.unlock; });
unlock.addEventListener("change", () => chrome.storage.local.set({ unlock: unlock.checked }));

document.getElementById("saveAll").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  status.textContent = "Snatching…";
  const r = await chrome.runtime.sendMessage({ type: "saveAll", tabId: tab.id });
  status.textContent = r?.count ? `Saved ${r.count} file${r.count === 1 ? "" : "s"}` : "No media found on this page";
});
