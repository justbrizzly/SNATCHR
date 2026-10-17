# SNATCHR

Right-click → **Save media here** on any image or video, including ones hidden under transparent overlays or on sites that block right-click.

## Install
1. Unzip this folder.
2. Go to `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `snatchr` folder.

## Use
- **Toolbar icon** — popup with the right-click unblock toggle and a one-click "Save all media on this page".
- **Save media here** — saves the image/video under your cursor. Sees through overlay divs, lazy-loaded images, `srcset` (grabs the highest resolution), `<picture>`, CSS background images, and canvases.
- **Save all media on this page** — bulk-downloads every image/video file found.
- **Unblock right-click on sites** — checkbox. When on, the site's own right-click / mouse-button blockers never run, so you get Chrome's normal menu back. Turn it off if it breaks a site that uses its own right-click menu (e.g. Google Docs).

## Badge codes (on the extension icon)
- `OK` saved · `NONE` nothing found under cursor · `ERR` every download route failed · `STRM` it's a streamed video (see below)

## Download strategy
1. Direct `chrome.downloads`.
2. If blocked (hotlink protection / 403), refetch from inside the page with the page's cookies and referrer.
3. If that's blocked by CORS, refetch from the extension background (host permissions bypass CORS).

## What it will not do
- **Streamed video** (`blob:` MediaSource players — YouTube, Instagram/TikTok reels in most cases, Twitch). Those aren't files; they're hundreds of segments stitched together by the player. You need a stream downloader (e.g. yt-dlp) for those.
- **DRM-protected video** (Netflix, Disney+, Prime, etc.). Encrypted media can't be grabbed this way and this extension doesn't attempt it.

---
Made by your friendly neighborhood bear **Brizzly**. 🐻
