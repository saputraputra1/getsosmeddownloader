/**
 * Server Utama — MediaGet v3 (Multi-Platform Downloader)
 * Mendukung: Instagram, TikTok, YouTube, Facebook
 * Express.js + yt-dlp backend
 */

require('dotenv').config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const https = require("https");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dns = require("dns");
const { scrapeMedia, scrapeTikTokStoriesByUsername, scrapeYouTubePlaylist, scrapeInstagramPostsByUsername, scrapeTikTokPostsByUsername, scrapeYouTube, checkYtDlp, detectPlatform, isInstagramStoryUrl, PLATFORMS } = require("./scraper");

// Gunakan Cloudflare/Google DNS jika DNS sistem bermasalah (blokir ISP)
try {
  dns.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1']);
  console.log(`[DNS] Menggunakan DNS Cloudflare/Google`);
} catch (e) {
  console.warn(`[DNS] Gagal mengatur DNS: ${e.message}`);
}

// Proxy support via environment variables (HTTP_PROXY / HTTPS_PROXY)
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
if (proxyUrl) {
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    const { HttpProxyAgent } = require("http-proxy-agent");
    axios.defaults.httpsAgent = new HttpsProxyAgent(proxyUrl);
    axios.defaults.httpAgent = new HttpProxyAgent(proxyUrl);
    axios.defaults.proxy = false;
    console.log(`[Proxy] Menggunakan proxy: ${proxyUrl}`);
  } catch (e) {
    console.warn(`[Proxy] Gagal menginisialisasi proxy: ${e.message}`);
  }
}

// HTTPS agent yang toleran terhadap SSL cert expired (beberapa CDN如 cdn.videy.co)
const laxHttpsAgent = new https.Agent({ rejectUnauthorized: false });

// Ensure temp_downloads directory exists (for yt-dlp downloaded files)
const tempDir = path.join(__dirname, "temp_downloads");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// ─── Environment Variable Cookie Injector (Railway Support) ─────────────────
const cookiesDir = path.join(__dirname, "cookies");
if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });

if (process.env.IG_COOKIE) {
  try {
    fs.writeFileSync(path.join(cookiesDir, "railway_cookie.txt"), process.env.IG_COOKIE);
    console.log("[System] Berhasil menulis cookies dari process.env.IG_COOKIE");
  } catch (err) {
    console.error("[System] Gagal menulis cookies dari env:", err.message);
  }
} else if (process.env.IG_COOKIE_BASE64) {
  try {
    const decoded = Buffer.from(process.env.IG_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(path.join(cookiesDir, "railway_cookie.txt"), decoded);
    console.log("[System] Berhasil menulis cookies dari process.env.IG_COOKIE_BASE64");
  } catch (err) {
    console.error("[System] Gagal menulis cookies dari base64 env:", err.message);
  }
}

// UC Drive cookie dari env (untuk full download via save-to-drive auth flow)
if (process.env.UC_COOKIE) {
  try {
    fs.writeFileSync(path.join(cookiesDir, "uc_cookie.txt"), process.env.UC_COOKIE);
    console.log("[System] Berhasil menulis UC cookies dari process.env.UC_COOKIE");
  } catch (err) {
    console.error("[System] Gagal menulis UC cookies dari env:", err.message);
  }
} else if (process.env.UC_COOKIE_BASE64) {
  try {
    const decoded = Buffer.from(process.env.UC_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(path.join(cookiesDir, "uc_cookie.txt"), decoded);
    console.log("[System] Berhasil menulis UC cookies dari process.env.UC_COOKIE_BASE64");
  } catch (err) {
    console.error("[System] Gagal menulis UC cookies dari base64 env:", err.message);
  }
}

// UC Drive Playwright login credentials
if (process.env.UC_USERNAME && process.env.UC_PASSWORD) {
  console.log("[System] UC Drive: UC_USERNAME & UC_PASSWORD terdeteksi — Playwright browser login siap");
  console.log("[System] UC Drive: Full download via browser (bypass OSS anti-leech) tersedia");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validasi apakah URL mengarah ke platform yang didukung.
 * Menggunakan URL constructor untuk parsing yang aman.
 */
function isValidMediaUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return detectPlatform(urlString) !== null;
  } catch {
    return false;
  }
}

/**
 * Validasi apakah URL mengarah ke CDN yang diizinkan.
 * Mendukung CDN dari Instagram, TikTok, YouTube, dan Facebook.
 */
function isAllowedCdnUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    const allowedPatterns = [
      // Instagram / Meta CDN
      /\.cdninstagram\.com$/,
      /\.instagram\.com$/,
      /\.fbcdn\.net$/,
      /^scontent[\w-]*\.cdninstagram\.com$/,
      /^scontent[\w-]*\.xx\.fbcdn\.net$/,
      /^video[\w-]*\.cdninstagram\.com$/,
      /^scontent[\w-]*\.[\w-]+\.fbcdn\.net$/,  // scontent-xxx.xx.fbcdn.net (various regions)
      /^instagram\.[\w-]+\.fbcdn\.net$/,
      /^instagram\.[\w-]+\.[\w-]+\.fbcdn\.net$/,  // instagram.fpnk3-1.fna.fbcdn.net (regional CDN baru),
      // Facebook CDN
      /\.facebook\.com$/,
      /^video[\w-]*\.xx\.fbcdn\.net$/,
      /^scontent[\w-]*\.fbcdn\.net$/,
      /^fbvideo[\w-]*\.fbcdn\.net$/,
      /^external[\w-]*\.xx\.fbcdn\.net$/,      // external-xxx.xx.fbcdn.net (og:image)
      /\.snapcdn\.app$/,
      // Third-party API CDNs
      /\.igram\.world$/,
      // TikTok CDN
      /\.tiktokcdn\.com$/,
      /\.tiktokcdn-us\.com$/,
      /\.tiktokcdn-eu\.com$/,
      /\.tiktokcdn\.asia$/,
      /\.musical\.ly$/,
      /\.tiktokv\.com$/,
      /\.byteoversea\.com$/,
      /\.ibytedtos\.com$/,
      /\.muscdn\.com$/,
      /\.tikwm\.com$/,
      /^v[\d]*[\w-]*\.tiktokcdn\.com$/,
      /^v[\d]*[\w-]*\.tiktokcdn-eu\.com$/,
      /^v[\d]*[\w-]*\.tiktokcdn-us\.com$/,
      /^p[\d]*[\w-]*\.tiktokcdn\.com$/,        // p16-xxx.tiktokcdn.com (image CDN)
      /^p[\d]*[\w-]*\.tiktokcdn-eu\.com$/,     // p16-xxx.tiktokcdn-eu.com
      /^p[\d]*[\w-]*\.tiktokcdn-us\.com$/,     // p16-xxx.tiktokcdn-us.com
      /\.tiktokcdn\.com\.akamaized\.net$/,
      // YouTube / Google CDN
      /\.googlevideo\.com$/,
      /\.youtube\.com$/,
      /\.ytimg\.com$/,
      /\.googleusercontent\.com$/,
      /\.ggpht\.com$/,                          // Google profile/channel images
      /^rr[\d]*[\w-]*\.googlevideo\.com$/,
      // Cobalt / Y2Mate / SaveFrom CDN (YouTube download proxy)
      /\.cobalt\.tools$/,
      /\.wuk\.sh$/,
      /\.oofe\.org$/,
      /\.lrclib\.net$/,
      /\.y2mate\.com$/,
      /\.sf-tools\.com$/,
      /\.ssyoutube\.com$/,
      /\.siputzx\.my\.id$/,
      // Invidious / Piped instances (YouTube open-source proxy)
      /\.nadeko\.net$/,
      /\.privacydev\.net$/,
      /\.cdaut\.de$/,
      /\.fdn\.fr$/,
      /\.datura\.network$/,
      /\.perennialte\.ch$/,
      /\.nerdvpn\.de$/,
      /\.kavin\.rocks$/,
      /\.adminforge\.de$/,
      /\.drgns\.space$/,
      /\.garudalinux\.org$/,
      /\.reallyaweso\.me$/,
      /\.no-logs\.com$/,
      /\.puffyan\.us$/,
      /\.tokhmi\.xyz$/,
      /^piped\.video$/,
      // RapidAPI
      /\.rapidapi\.com$/,
      /\.p\.rapidapi\.com$/,
      // Twitter / X CDN
      /\.twimg\.com$/,
      /\.twitter\.com$/,
      /\.x\.com$/,
      /^pbs\.twimg\.com$/,                      // Twitter media images
      /^abs\.twimg\.com$/,
      // Pinterest CDN
      /\.pinimg\.com$/,
      /\.pinterest\.com$/,
      /^i\.pinimg\.com$/,
      /^v1\.pinimg\.com$/,
      /^s\.pinimg\.com$/,
      /^media[\w-]*\.pinimg\.com$/,
      // VKontakte CDN
      /\.vk\.com$/,
      /\.vk\.ru$/,
      /\.userapi\.com$/,
      /^vkvd\d+\.vk\.com$/,
      /^vkvd\d+\.vk\.ru$/,
      /\.vkuser\.net$/,
      /\.mycdn\.me$/,
      // Viday / Videy CDN
      /\.slicedrive\.com$/,               // viday.de CDN
      /^viday\.de$/,                      // viday.de (poster/thumbnail)
      /\.viday\.de$/,                     // subdomain viday.de
      /\.videy\.co$/,                     // videy.co CDN
      /\.videy\.llc$/,                    // videy.llc
      /\.videy\.it$/,                     // videy.it (alternate CDN)
      /\.vihey\.(co|llc)$/,              // vihey.co (alternate videy domain)
      /^cdn\.videy\.co$/,
      /^cdn2\.videy\.co$/,
      /^cdn2\.videy\.it$/,
      /^cdn2\.vihey\.co$/,
      /\.vizey\.de$/,                     // vizey.de (videy variant)
      /^cdn2\.vizey\.de$/,
      /\.slicidrive\.de$/,               // slicidrive.de (viday CDN variant)
      /^cdn2\.slicidrive\.de$/,
      /\.bokepbox\.media$/,               // bokepbox.media CDN
      /(^|\.)bokepbox\.tv$/,              // bokepbox.tv
      /^cdn\.bokepbox\.media$/,
      // UC Drive CDN (Alibaba OSS)
      /\.aliyuncs\.com$/,                  // UC Drive video CDN (Alibaba OSS)
      /\.pds\.yolicart\.com$/,             // UC Drive thumbnail CDN
      /\.peco\.uodoo\.com$/,               // UC Drive user assets
      /\.uc-share\.com$/,                  // uc-share.com (UC Drive mirror)
      // Local server (for yt-dlp downloaded files)
      /^localhost$/,
      /^127\.0\.0\.1$/,
      // Common deployment platforms (Railway, Render, etc.)
      /\.railway\.app$/,
      /\.up\.railway\.app$/,
      /\.onrender\.com$/,
      /\.herokuapp\.com$/,
      /\.fly\.dev$/,
      // Local development
      /^localhost$/,
    ];
    return allowedPatterns.some((pat) => pat.test(host));
  } catch {
    return false;
  }
}

/**
 * Tentukan Referer header berdasarkan URL CDN.
 */
function getRefererForCdn(urlString) {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    if (host.includes("igram.world")) {
      return "https://igram.world/";
    }
    if (host.includes("tikwm")) {
      return "https://www.tikwm.com/";
    }
    if (host.includes("tiktok") || host.includes("musical") || host.includes("byteoversea") || host.includes("ibytedtos") || host.includes("muscdn")) {
      return "https://www.tiktok.com/";
    }
    if (host.includes("googlevideo") || host.includes("youtube") || host.includes("ytimg")) {
      return "https://www.youtube.com/";
    }
    if (host.includes("facebook") || host.includes("fbcdn") || host.includes("fbvideo")) {
      return "https://www.facebook.com/";
    }
    if (host.includes("twimg") || host.includes("twitter") || host.includes("x.com")) {
      return "https://x.com/";
    }
    if (host.includes("vk.com") || host.includes("vk.ru") || host.includes("userapi") || host.includes("vkuser") || host.includes("mycdn")) {
      return "https://vk.com/";
    }
    if (host.includes("pinimg")) {
      return "https://www.pinterest.com/";
    }
    if (host.includes("slicedrive") || host.includes("slicidrive")) {
      return "https://viday.de/";
    }
    if (host.includes("videy") || host.includes("vihey") || host.includes("vizey")) {
      return "https://videy.co/";
    }
    if (host.includes("bokepbox")) {
      return "https://bokepbox.tv/";
    }
    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      return "";
    }
    return "https://www.instagram.com/";
  } catch {
    return "https://www.instagram.com/";
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Non-cache untuk HTML agar perubahan frontend langsung terlihat
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/temp", express.static(path.join(__dirname, "temp_downloads")));

// ─── Rate Limiter (in-memory) ────────────────────────────────────────────────
// Untuk production, ganti dengan express-rate-limit + Redis

const requestCounts = new Map();
const RATE_LIMIT = 10;     // maks request per IP
const RATE_WINDOW = 60000; // per 1 menit

// Bersihkan entri yang sudah kadaluwarsa setiap 5 menit
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestCounts) {
    if (now > entry.resetAt) {
      requestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = requestCounts.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW;
  }

  entry.count++;
  requestCounts.set(ip, entry);

  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({
      success: false,
      error: `Terlalu banyak request. Coba lagi dalam ${Math.ceil((entry.resetAt - now) / 1000)} detik.`,
    });
  }

  next();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/status
 * Cek status server dan ketersediaan yt-dlp
 */
app.get("/api/status", async (req, res) => {
  const ytdlpOk = await checkYtDlp();
  const platforms = Object.entries(PLATFORMS).map(([key, cfg]) => ({
    id: key,
    name: cfg.name,
    icon: cfg.icon,
  }));
  res.json({
    status: "ok",
    ytdlp: ytdlpOk,
    platforms,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/yt-search?q=...&limit=10
 * Mencari video YouTube berdasarkan kata kunci via yt-dlp ytsearch.
 * Mengembalikan daftar video dengan durasi, thumbnail, channel.
 */
app.get("/api/yt-search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q || q.trim().length === 0) return res.status(400).json({ success: false, error: "Parameter 'q' diperlukan" });

  const maxResults = Math.min(Math.max(parseInt(limit) || 50, 1), 1000);
  const searchQuery = `ytsearch${maxResults}:${q.trim()}`;

  try {
    const { spawn } = require('child_process');
    const raw = await new Promise((resolve, reject) => {
      const child = spawn('yt-dlp', [
        "--no-warnings",
        "--no-check-certificates",
        "--extractor-retries", "2",
        "--dump-single-json",
        "--flat-playlist",
        searchQuery,
      ], { timeout: 60000 });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`yt-dlp exit ${code}: ${stderr.substring(0, 200)}`));
      });
      child.on('error', (err) => reject(err));
    });

    const data = JSON.parse(raw);
    let entries = [];

    if (data._type === 'playlist' && data.entries) {
      entries = data.entries
        .filter(e => e.ie_key === 'Youtube' && /^[a-zA-Z0-9_\-]{11}$/.test(e.id || ''))
        .map(e => ({
          id: e.id || '',
          title: e.title || 'Untitled',
          url: e.url || e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`,
          duration: e.duration || 0,
          thumbnail: e.thumbnail || e.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
          channel: e.channel || e.uploader || e.channel_id || '',
          views: e.view_count || 0,
          uploadDate: e.upload_date || '',
        }));
    } else if (/^[a-zA-Z0-9_\-]{11}$/.test(data.id || '')) {
      entries = [{
        id: data.id,
        title: data.title || 'Untitled',
        url: `https://www.youtube.com/watch?v=${data.id}`,
        duration: data.duration || 0,
        thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
        channel: data.channel || data.uploader || '',
        views: data.view_count || 0,
        uploadDate: data.upload_date || '',
      }];
    }

    console.log(`[YT-Search] "${q.trim()}" → ${entries.length} hasil`);
    res.json({ success: true, data: entries });

  } catch (err) {
    console.error(`[YT-Search] Error: ${err.message}`);
    res.status(502).json({ success: false, error: `Search gagal: ${err.message}` });
  }
});


/**
 * GET /api/tiktok-search?q=...&limit=20
 * Mencari video TikTok berdasarkan kata kunci via @tobyg74/tiktok-api-dl + Playwright cookies.
 */
app.get("/api/tiktok-search", async (req, res) => {
  const { q, limit } = req.query;
  if (!q || q.trim().length === 0) return res.status(400).json({ success: false, error: "Parameter 'q' diperlukan" });

  const maxResults = Math.min(Math.max(parseInt(limit) || 30, 1), 200);
  const query = q.trim();

  try {
    const axios = require("axios");
    let items = [];

    // Approach 1: TikWM.com third-party API (multi-page for more results)
    try {
      const seen = new Set();
      for (let cursor = 0; cursor < 120; cursor += 30) {
        const resp = await axios.post('https://www.tikwm.com/api/feed/search',
          `keywords=${encodeURIComponent(query)}&count=30&cursor=${cursor}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 10000,
          }
        );
        const body = resp.data;
        if (body.code === 0 && body.data && body.data.videos) {
          for (const v of body.data.videos) {
            if (!seen.has(v.video_id)) {
              seen.add(v.video_id);
              items.push({
                id: v.video_id || '',
                title: v.title || 'Untitled',
                url: `https://www.tiktok.com/@${v.author?.unique_id || 'user'}/video/${v.video_id}`,
                downloadUrl: v.play || v.wmplay || '',
                thumbnail: v.cover || '',
                author: v.author?.unique_id || '',
                authorName: v.author?.nickname || '',
                views: v.play_count || 0,
                likes: v.digg_count || 0,
                comments: v.comment_count || 0,
                duration: v.duration || 0,
              });
            }
          }
          if (!body.data.cursor || body.data.videos.length < 5) break;
        } else {
          break;
        }
      }
      // Sort by views descending (paling rame dulu)
      items.sort((a, b) => b.views - a.views);
      console.log(`[TikTok-Search] TikWM: ${items.length} hasil`);
    } catch (err1) {
      console.error(`[TikTok-Search] TikWM gagal: ${err1.message}`);
    }

    // Approach 2: Fallback ke Playwright intercept
    if (items.length === 0) {
      try {
        const { chromium: pwChromium } = require("playwright-extra");
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        pwChromium.use(StealthPlugin());
        const browser = await pwChromium.launch({ headless: true, args: ['--no-sandbox'] });
        const ctx = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 720 },
        });
        const pg = await ctx.newPage();

        const searchResult = new Promise((resolve) => {
          pg.on('response', async (r) => {
            try {
              if (r.url().includes('/api/search/item/full') && r.status() === 200) {
                const body = await r.text();
                if (body && body.length > 50) resolve(body);
              }
            } catch (_) {}
          });
        });

        await pg.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`, {
          waitUntil: 'load', timeout: 30000
        });
        await pg.waitForTimeout(8000);

        const raw = await Promise.race([
          searchResult,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000))
        ]);

        const data = JSON.parse(raw);
        if (data.status_code === 0 && data.item_list && data.item_list.length > 0) {
          items = data.item_list.slice(0, maxResults).map(v => ({
            id: v.id || '',
            title: v.desc || 'Untitled',
            url: `https://www.tiktok.com/@${v.author?.uniqueId || 'user'}/video/${v.id}`,
            downloadUrl: v.video?.downloadAddr || v.video?.playAddr || '',
            thumbnail: v.video?.cover || v.video?.originCover || '',
            author: v.author?.uniqueId || '',
            authorName: v.author?.nickname || '',
            views: v.stats?.playCount || 0,
            likes: v.stats?.diggCount || 0,
            comments: v.stats?.commentCount || 0,
            duration: v.video?.duration || 0,
          }));
          console.log(`[TikTok-Search] Playwright: ${items.length} hasil`);
        }
        await browser.close();
      } catch (err2) {
        console.error(`[TikTok-Search] Playwright gagal: ${err2.message}`);
      }
    }

    // Approach 3: Fallback ke YouTube search
    if (items.length === 0) {
      console.log(`[TikTok-Search] Fallback ke YouTube search untuk "${query}"...`);
      try {
        const { spawn } = require('child_process');
        const raw = await new Promise((resolve, reject) => {
          const child = spawn('yt-dlp', [
            "--no-warnings", "--no-check-certificates",
            "--extractor-retries", "2",
            "--dump-single-json", "--flat-playlist",
            `ytsearch${maxResults}:${query}`,
          ], { timeout: 20000 });
          let stdout = '', stderr = '';
          child.stdout.on('data', (d) => { stdout += d.toString(); });
          child.stderr.on('data', (d) => { stderr += d.toString(); });
          child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`yt-dlp exit ${code}`));
          });
          child.on('error', (err) => reject(err));
        });

        const data = JSON.parse(raw);
        if (data.entries && data.entries.length > 0) {
          items = data.entries.filter(e => e.id).map(e => ({
            id: e.id || '',
            title: e.title || 'Untitled',
            url: `https://www.youtube.com/watch?v=${e.id}`,
            downloadUrl: '',
            thumbnail: e.thumbnail || '',
            author: e.channel || e.uploader || '',
            authorName: e.channel || e.uploader || '',
            views: e.view_count || 0,
            likes: 0,
            comments: 0,
            duration: e.duration || 0,
          }));
          console.log(`[TikTok-Search] YouTube fallback: ${items.length} hasil`);
        }
      } catch (err3) {
        console.error(`[TikTok-Search] YouTube fallback gagal: ${err3.message}`);
      }
    }

    console.log(`[TikTok-Search] "${query}" \u2192 ${items.length} hasil`);
    res.json({ success: true, data: items });

  } catch (err) {
    console.error(`[TikTok-Search] Error: ${err.message}`);
    res.status(502).json({ success: false, error: `Search gagal: ${err.message}` });
  }
});

/**
 * POST /api/fetch
 * Body: { url: "https://..." }
 *
 * Mendukung URL dari: Instagram, TikTok, YouTube, Facebook
 *
 * Respon sukses:
 * {
 *   success: true,
 *   data: {
 *     platform: "instagram" | "tiktok" | "youtube" | "facebook",
 *     type: "video" | "image" | "playlist",
 *     author: "username",
 *     caption: "...",
 *     title: "...",
 *     mediaItems: [{ type, url, thumbnail, width, height, duration, ext }],
 *     source: "ytdlp" | "oembed",
 *     warning?: "..."
 *   }
 * }
 */
app.post("/api/fetch", rateLimit, async (req, res) => {
  let { url, urls } = req.body;

  if (url && typeof url === "string") {
    urls = [url];
  }

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, error: "URL diperlukan" });
  }

  if (urls.length > 10) {
    return res.status(400).json({ success: false, error: "Maksimal 10 URL dalam satu permintaan" });
  }

  // Request-level timeout: 110 detik (sedikit kurang dari client timeout 120 detik)
  const REQUEST_TIMEOUT = 110000;
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: "Request timeout — server membutuhkan waktu terlalu lama. " +
               "Coba lagi atau pastikan URL valid dan bisa diakses."
      });
    }
  }, REQUEST_TIMEOUT);

  try {
    const supported = Object.values(PLATFORMS).map((p) => p.name).join(", ");
    const results = [];
    const errors = [];

    // Proses secara sekuensial agar tidak membebani RAM / yt-dlp
    for (const u of urls) {
      if (timedOut) break; // Hentikan loop jika sudah timeout

      if (typeof u !== "string" || !u.trim()) continue;

      const cleanUrl = u.trim();
      if (!isValidMediaUrl(cleanUrl)) {
        errors.push({ url: cleanUrl, error: `URL tidak valid atau tidak didukung.` });
        continue;
      }

      try {
        console.log(`[API] Fetching: ${cleanUrl}`);
        const data = await scrapeMedia(cleanUrl);
        results.push(data);
      } catch (err) {
        console.error(`[API] Error on ${cleanUrl}:`, err.message);
        errors.push({ url: cleanUrl, error: err.message });
      }
    }

    clearTimeout(timeoutTimer);
    if (timedOut || res.headersSent) return; // Jangan kirim respons ganda

    if (results.length === 0 && errors.length > 0) {
      return res.status(500).json({ success: false, error: errors[0].error, details: errors });
    }

    // Selalu mengembalikan array di 'data' agar konsisten
    res.json({ success: true, data: results, errors: errors.length > 0 ? errors : undefined });
  } catch (unexpectedErr) {
    clearTimeout(timeoutTimer);
    console.error('[API] Unexpected error:', unexpectedErr);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Terjadi kesalahan internal server." });
    }
  }
});

/**
 * POST /api/telegram/setup
 * Setup Telegram user session (perlu dilakukan sekali saja)
 * Body: { phone: "+62xxx", apiId: "xxx", apiHash: "xxx" }
 */
app.post("/api/telegram/setup", rateLimit, async (req, res) => {
  try {
    const { phone, apiId, apiHash } = req.body;

    if (!phone || !apiId || !apiHash) {
      return res.status(400).json({ 
        success: false, 
        error: "Phone, API ID, dan API Hash diperlukan" 
      });
    }

    const scraper = require('./scraper');
    const result = await scraper.setupTelegramSession(phone, apiId, apiHash);

    res.json({
      success: result.success,
      message: result.message
    });
  } catch (err) {
    console.error('[API] Telegram setup error:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

/**
 * GET /api/telegram/status
 * Cek status session Telegram
 */
app.get("/api/telegram/status", async (req, res) => {
  try {
    const scraper = require('./scraper');
    const status = scraper.getTelegramSessionStatus();

    res.json({
      success: true,
      data: status
    });
  } catch (err) {
    console.error('[API] Telegram status error:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

/**
 * GET /api/file/:filename
 * Serve downloaded Telegram files
 */
app.get("/api/file/:filename", (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'downloads', filename);

  console.log(`[FileServe] Request: ${filename} -> ${filepath}`);

  if (!fs.existsSync(filepath)) {
    // List what's actually in the downloads folder
    const downloadsDir = path.join(__dirname, 'downloads');
    let files = [];
    try { files = fs.readdirSync(downloadsDir); } catch(e) { files = [`dir not found: ${e.message}`]; }
    console.log(`[FileServe] ❌ File not found. Downloads folder contains: ${files.join(', ')}`);
    return res.status(404).json({ error: 'File not found', available: files });
  }

  // Determine content type
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Get file size for range requests (video streaming)
  const stat = fs.statSync(filepath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Partial content (for video seeking)
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });

    fs.createReadStream(filepath, { start, end }).pipe(res);
  } else {
    // Full file
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    });

    fs.createReadStream(filepath).pipe(res);
  }
});

/**
 * Async Telegram Download - avoid 504 timeout
 * POST /api/telegram/download - Start download, return job ID
 * GET /api/telegram/job/:id - Poll for result
 */
const telegramJobs = new Map();

// Cleanup old jobs every 15 minutes (free memory buffers too)
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of telegramJobs) {
    if (now - job.createdAt > 15 * 60 * 1000) {
      if (job.buffers) job.buffers.length = 0; // free memory
      telegramJobs.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

/**
 * GET /api/telegram/stream/:jobId/:index
 * Serve Telegram file buffers directly from memory (bypasses Railway 403)
 */
app.get("/api/telegram/stream/:jobId/:index", (req, res) => {
  const { jobId, index } = req.params;
  const job = telegramJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job expired or not found' });
  if (!job.buffers || !job.buffers[index]) return res.status(404).json({ error: 'File buffer not found' });

  const buf = job.buffers[index];
  const mimeTypes = {
    'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'mp3': 'audio/mpeg',
    'ogg': 'audio/ogg', 'jpg': 'image/jpeg', 'png': 'image/png', 'file': 'application/octet-stream'
  };
  const contentType = mimeTypes[buf.ext] || 'application/octet-stream';
  const fileSize = buf.buffer.length;
  const range = req.headers.range;

  // Disposition: inline for preview, attachment for download
  const disposition = req.query.dl === '1' ? 'attachment' : 'inline';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename="${buf.filename}"`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(buf.buffer.slice(start, end + 1));
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename="${buf.filename}"`,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    res.end(buf.buffer);
  }
});

app.post("/api/telegram/download", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL diperlukan' });

  const jobId = `tg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const job = { id: jobId, status: 'processing', url, createdAt: Date.now(), result: null, error: null };
  telegramJobs.set(jobId, job);

  // Return immediately (avoid 504)
  res.json({ success: true, jobId, status: 'processing', message: 'Download started' });

  // Process in background
  (async () => {
    try {
      const telegramModule = require('./telegram_client');
      const result = await telegramModule.downloadFromTelegram(url);
      if (result.success) {
        // Extract buffers from mediaItems, store in job.buffers (memory only)
        job.buffers = [];
        const mediaItems = (result.mediaItems || []).map((item, idx) => {
          let streamUrl = null;
          if (item._bufferData) {
            job.buffers.push(item._bufferData);
            streamUrl = `/api/telegram/stream/${jobId}/${idx}`;
          }
          // Generate thumbnail URL from video frame for video items
          const thumbUrl = (streamUrl && (item.type === 'video' || item.type === 'document'))
            ? `/api/video-thumb?url=${encodeURIComponent(streamUrl)}`
            : (item.thumbnail || null);
          return {
            type: item.type || 'video',
            url: streamUrl || item.url,
            thumbnail: thumbUrl,
            ext: item.ext || 'mp4',
            width: item.width || null,
            height: item.height || null,
            duration: item.duration || null,
            formats: item.formats?.length
              ? item.formats.map(f => ({ ...f, url: streamUrl || f.url }))
              : [{ type: item.type || 'video', quality: 'Original', url: streamUrl || item.url, ext: item.ext || 'mp4' }]
          };
        });
        job.status = 'done';
        job.result = {
          platform: 'telegram',
          type: mediaItems[0]?.type || 'video',
          title: 'Telegram Bot Download',
          author: result.botInfo?.botUsername || 'Telegram Bot',
          caption: `Download dari bot @${result.botInfo?.botUsername || 'Telegram'}`,
          timestamp: new Date().toISOString(),
          mediaItems,
          source: 'telegram_bot'
        };
      } else {
        job.status = 'error';
        job.error = result.message || 'Download gagal';
      }
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
    }
  })();
});

app.get("/api/telegram/job/:id", (req, res) => {
  const job = telegramJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan' });
  res.json({ jobId: job.id, status: job.status, result: job.result, error: job.error });
});

/**
 * POST /api/telegram/login
 * Login ke Telegram dengan nomor telepon (interactive OTP)
 * Body: { "phone": "+62xxx" }
 */
app.post("/api/telegram/login", rateLimit, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: "Nomor telepon diperlukan" });
    }

    const telegramModule = require('./telegram_client');
    // setupNewSession membutuhkan input OTP secara interaktif via terminal
    // Untuk API, kita return instruksi
    res.json({
      success: true,
      message: 'Untuk login, jalankan: node -e "require(\'./telegram_client\').setupTelegramSession(\'' + phone + '\')" di terminal server, lalu masukkan kode OTP.',
      note: 'Login hanya perlu dilakukan sekali saja.'
    });
  } catch (err) {
    console.error('[API] Telegram login error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/fetch-private
 * Mengambil media (Instagram/TikTok/dsb) dari source code HTML (Mode Private)
 */
app.post("/api/fetch-private", rateLimit, async (req, res) => {
  const { html } = req.body;
  if (!html || typeof html !== 'string') return res.status(400).json({ success: false, error: "HTML source required" });

  try {
    const mediaItems = [];
    
    // Regex mencari URL mentah yang biasanya berakhiran .mp4 atau terkode di HTML
    const mp4Regex = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/g;
    let match;
    const seen = new Set();
    
    while ((match = mp4Regex.exec(html)) !== null) {
      let url = match[0].replace(/\\u0026/g, '&').replace(/\\/g, '');
      
      // Filter URL sampah, hanya ambil dari CDN sosmed terkenal
      if (!url.includes('cdninstagram') && !url.includes('fbcdn') && !url.includes('tiktokcdn') && !url.includes('twimg')) {
        continue;
      }

      if (!seen.has(url)) {
        seen.add(url);
        mediaItems.push({ type: 'video', url: url, ext: 'mp4' });
      }
    }

    // Jika tidak ada video, coba cari foto (jpg) khusus Instagram
    if (mediaItems.length === 0) {
      const jpgRegex = /https?:\/\/[^\s"'<>]+\.jpg[^\s"'<>]*/g;
      while ((match = jpgRegex.exec(html)) !== null) {
        let url = match[0].replace(/\\u0026/g, '&').replace(/\\/g, '');
        if (!url.includes('cdninstagram') && !url.includes('fbcdn')) continue;
        // Hindari thumbnail kecil
        if (url.includes('150x150') || url.includes('s150x150')) continue;
        
        if (!seen.has(url)) {
          seen.add(url);
          mediaItems.push({ type: 'image', url: url, ext: 'jpg' });
        }
      }
    }

    if (mediaItems.length === 0) {
      return res.status(404).json({ success: false, error: "Tidak ditemukan tautan media dalam HTML tersebut." });
    }

    // Batasi maksimal 10 untuk menghindari spam link
    const results = [{
      platform: "Private",
      title: "Private Media",
      caption: "Diunduh melalui Mode Private. (Format kualitas asli)",
      mediaItems: mediaItems.slice(0, 10)
    }];

    res.json({ success: true, data: results });
  } catch (err) {
    console.error('[API Fetch Private Error]:', err);
    res.status(500).json({ success: false, error: "Gagal memparsing HTML." });
  }
});

/**
 * POST /api/fetch-tiktok-story
 * Mengambil TikTok Stories berdasarkan username.
 * Body: { username: "namauser" }
 */
app.post("/api/fetch-tiktok-story", rateLimit, async (req, res) => {
  const { username } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 2) {
    return res.status(400).json({
      success: false,
      error: "Username TikTok diperlukan (minimal 2 karakter)."
    });
  }

  // Sanitasi username
  const cleanUsername = username.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '');
  if (!cleanUsername) {
    return res.status(400).json({
      success: false,
      error: "Username TikTok tidak valid. Hanya huruf, angka, titik, dan underscore."
    });
  }

  // Timeout 90 detik
  const REQUEST_TIMEOUT = 90000;
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: "Request timeout — server membutuhkan waktu terlalu lama. Coba lagi nanti."
      });
    }
  }, REQUEST_TIMEOUT);

  try {
    console.log(`[API] Fetching TikTok Stories for @${cleanUsername}`);
    const data = await scrapeTikTokStoriesByUsername(cleanUsername);

    clearTimeout(timeoutTimer);
    if (timedOut || res.headersSent) return;

    res.json({ success: true, data: [data] });
  } catch (err) {
    clearTimeout(timeoutTimer);
    console.error(`[API] TikTok Story Error for @${cleanUsername}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

/**
 * POST /api/fetch-username
 * Unified endpoint untuk semua fitur username mode.
 * Body: { source, username, count?, mediaType? }
 *
 * source: "tiktok-story" | "tiktok-post" | "instagram-post" | "youtube-playlist"
 * count: jumlah postingan (default 12, max 30) — hanya untuk tiktok-post & instagram-post
 * mediaType: "image" | "video" | "all" (default "all") — hanya untuk tiktok-post & instagram-post
 */
app.post("/api/fetch-username", rateLimit, async (req, res) => {
  const { source, username, count, mediaType } = req.body;

  if (!source || typeof source !== 'string') {
    return res.status(400).json({ success: false, error: "Parameter 'source' diperlukan." });
  }

  const validSources = ['tiktok-story', 'tiktok-post', 'instagram-post', 'youtube-playlist'];
  if (!validSources.includes(source)) {
    return res.status(400).json({ success: false, error: `Source tidak valid. Pilih: ${validSources.join(', ')}` });
  }

  const REQUEST_TIMEOUT = 120000;
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (!res.headersSent) {
      res.status(504).json({ success: false, error: "Request timeout." });
    }
  }, REQUEST_TIMEOUT);

  try {
    let data;

    switch (source) {
      case 'tiktok-story': {
        const cleanUsername = (username || '').trim().replace(/^@/, '');
        if (!cleanUsername || cleanUsername.length < 2) {
          return res.status(400).json({ success: false, error: "Username TikTok diperlukan." });
        }
        console.log(`[API] Fetching TikTok Stories for @${cleanUsername}`);
        data = await scrapeTikTokStoriesByUsername(cleanUsername);
        break;
      }

      case 'tiktok-post': {
        const cleanUsername = (username || '').trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '');
        if (!cleanUsername || cleanUsername.length < 2) {
          return res.status(400).json({ success: false, error: "Username TikTok diperlukan." });
        }
        console.log(`[API] Fetching TikTok Posts for @${cleanUsername} (count=${count}, mediaType=${mediaType})`);
        data = await scrapeTikTokPostsByUsername(cleanUsername, count || 12, mediaType || 'all');
        break;
      }

      case 'instagram-post': {
        const cleanUsername = (username || '').trim().replace(/^@/, '');
        if (!cleanUsername || cleanUsername.length < 2) {
          return res.status(400).json({ success: false, error: "Username Instagram diperlukan." });
        }
        console.log(`[API] Fetching Instagram Posts for @${cleanUsername} (count=${count}, mediaType=${mediaType})`);
        data = await scrapeInstagramPostsByUsername(cleanUsername, count || 12, mediaType || 'all');
        break;
      }

      case 'youtube-playlist': {
        const playlistUrl = (username || '').trim();
        if (!playlistUrl || !playlistUrl.includes('youtube.com') && !playlistUrl.includes('youtu.be')) {
          return res.status(400).json({ success: false, error: "URL YouTube Playlist diperlukan." });
        }
        console.log(`[API] Fetching YouTube Playlist: ${playlistUrl}`);
        data = await scrapeYouTubePlaylist(playlistUrl);
        break;
      }

      default:
        return res.status(400).json({ success: false, error: "Source tidak dikenal." });
    }

    clearTimeout(timeoutTimer);
    if (timedOut || res.headersSent) return;

    res.json({ success: true, data: [data] });
  } catch (err) {
    clearTimeout(timeoutTimer);
    console.error(`[API] fetch-username Error (${source}):`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

/**
 * GET /api/lyrics?q=...
 * Mencari lirik menggunakan lrclib.net API (gratis)
 */
app.get("/api/lyrics", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ success: false, error: "Query judul diperlukan" });
    
    const response = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { timeout: 10000 });
    if (response.data && response.data.length > 0) {
      return res.json({ 
        success: true, 
        lyrics: response.data[0].plainLyrics || response.data[0].syncedLyrics || "Lirik ditemukan tapi kosong."
      });
    } else {
      return res.json({ success: false, message: "Lirik tidak ditemukan" });
    }
  } catch (err) {
    console.error("Lyrics API error:", err.message);
    res.status(500).json({ success: false, error: "Gagal mengambil lirik" });
  }
});

/**
 * GET /api/trim?url=...&start=...&duration=...
 * Potong video (Smart Video Trimmer) menggunakan ffmpeg
 */
app.get("/api/trim", async (req, res) => {
  const { url, start, duration, filename } = req.query;
  if (!url) return res.status(400).send("URL required");

  const startSec = start || 0;
  const durSec = duration || 15;
  const outName = filename || "trimmed_video.mp4";

  res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
  res.setHeader("Content-Type", "video/mp4");

  const { spawn } = require('child_process');
  
  const ffmpeg = spawn('ffmpeg', [
    '-i', url,
    '-ss', startSec.toString(),
    '-t', durSec.toString(),
    '-c', 'copy', 
    '-movflags', 'frag_keyframe+empty_moov', 
    '-f', 'mp4',
    'pipe:1'
  ]);

  ffmpeg.stdout.pipe(res);
  
  ffmpeg.stderr.on('data', (d) => {
    // abaikan stderr ffmpeg untuk mencegah log yang terlalu berisik
  });

  req.on('close', () => {
    try { ffmpeg.kill('SIGKILL'); } catch (e) {}
  });
});

/**
 * GET /api/convert-live?url=...
 * Konversi video ke format vertical (Live Wallpaper) maks 15 detik
 */
app.get("/api/convert-live", async (req, res) => {
  const { url, filename } = req.query;
  if (!url) return res.status(400).send("URL required");

  const outName = filename ? filename.replace('.mp4', '_live.mp4') : "live_wallpaper.mp4";
  res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
  res.setHeader("Content-Type", "video/mp4");

  const { spawn } = require('child_process');
  
  const ffmpeg = spawn('ffmpeg', [
    '-i', url,
    '-t', '15',
    '-vf', 'crop=ih*(9/16):ih',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4',
    'pipe:1'
  ]);

  ffmpeg.stdout.pipe(res);
  
  req.on('close', () => {
    try { ffmpeg.kill('SIGKILL'); } catch (e) {}
  });
});

/**
 * GET /api/gif?url=...&start=...&duration=...
 * Konversi video ke GIF (maks 5 detik, 10fps, lebar 320px)
 */
app.get("/api/gif", async (req, res) => {
  const { url, start, duration, filename } = req.query;
  if (!url) return res.status(400).send("URL required");

  const startSec = start || 0;
  const durSec = Math.min(parseInt(duration) || 3, 5); // Max 5 detik untuk GIF
  const outName = filename ? filename.replace(/\.(mp4|webm)/, '.gif') : "animated.gif";

  res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
  res.setHeader("Content-Type", "image/gif");

  const { spawn } = require('child_process');
  
  const ffmpeg = spawn('ffmpeg', [
    '-i', url,
    '-ss', startSec.toString(),
    '-t', durSec.toString(),
    '-vf', 'fps=10,scale=320:-1:flags=lanczos',
    '-c:v', 'gif',
    '-f', 'gif',
    'pipe:1'
  ]);

  ffmpeg.stdout.pipe(res);
  
  req.on('close', () => {
    try { ffmpeg.kill('SIGKILL'); } catch (e) {}
  });
});

/**
 * GET /api/video-thumb?url=...
 * Extract satu frame dari video URL dan kirim sebagai JPEG (thumbnail).
 * Berguna untuk video yang thumbnail-nya adalah URL .mp4 (videy, viday, dll).
 */
app.get("/api/video-thumb", async (req, res) => {
  let { url } = req.query;
  if (!url) return res.status(400).send("URL required");

  let isInternalUrl = false;
  // Jika URL adalah path lokal (/api/proxy, /temp/, dll), buat full URL
  if (url.startsWith('/api/') || url.startsWith('/temp/')) {
    isInternalUrl = true;
    const host = req.get('host') || `localhost:${PORT}`;
    const proto = req.protocol || 'http';
    url = `${proto}://${host}${url}`;
  }

  if (!isInternalUrl && !isAllowedCdnUrl(url)) {
    return res.status(403).json({ error: "Domain tidak diizinkan" });
  }

  const referer = getRefererForCdn(url);
  const { spawn } = require('child_process');

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=86400");

  const ffmpeg = spawn('ffmpeg', [
    '-headers', `Referer: ${referer}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n`,
    '-i', url,
    '-vframes', '1',
    '-q:v', '3',
    '-f', 'image2',
    '-y', 'pipe:1'
  ]);

  ffmpeg.stdout.pipe(res);
  ffmpeg.stderr.on('data', () => {}); // silent

  ffmpeg.on('error', (err) => {
    console.error('[Video-Thumb] ffmpeg error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: "Gagal extract thumbnail" });
  });

  req.on('close', () => {
    try { ffmpeg.kill('SIGKILL'); } catch (e) {}
  });
});

/**
 * GET /api/extract-audio?url=...&filename=...
 * Ekstrak audio dari video menggunakan ffmpeg dan kirim sebagai mp3.
 *
 * Untuk URL YouTube playlist (path /api/yt-download...), download audio
 * via pytube Python stream ke temp file dulu, baru ekstrak dengan ffmpeg.
 * Ini menghindari masalah self-referencing URL dan isAllowedCdnUrl di Railway.
 *
 * Untuk URL eksternal (CDN Instagram/TikTok/dll), ffmpeg langsung download dari URL.
 */
app.get("/api/extract-audio", async (req, res) => {
  let { url, filename } = req.query;
  if (!url) return res.status(400).send("URL required");

  const outName = filename ? filename.replace(/\.(mp4|webm|jpg|png)/, '.mp3') : "extracted_audio.mp3";
  const { spawn } = require('child_process');
  const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  // ── Helper: run ffmpeg locally on a temp file ─────────────────────────
  function runFfmpegOnFile(inputPath, deleteAfter) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-vn',
        '-c:a', 'libmp3lame',
        '-b:a', '192k',
        '-f', 'mp3',
        'pipe:1'
      ]);

      let stderr = '';
      let dataSent = false;

      ffmpeg.stdout.on('data', (chunk) => { dataSent = true; res.write(chunk); });
      ffmpeg.stderr.on('data', (d) => { stderr += d.toString(); });

      ffmpeg.on('close', (code) => {
        if (dataSent) {
          res.end();
          resolve();
        } else {
          reject(new Error(`ffmpeg exit ${code}: ${stderr.substring(0, 200)}`));
        }
        if (deleteAfter) fs.unlink(inputPath, () => {});
      });

      ffmpeg.on('error', (err) => {
        reject(err);
        if (deleteAfter) fs.unlink(inputPath, () => {});
      });

      req.on('close', () => {
        try { ffmpeg.kill('SIGKILL'); } catch (e) {}
        if (deleteAfter) fs.unlink(inputPath, () => {});
      });
    });
  }

  // ── Case 1: YouTube playlist download URL (local path) ────────────────
  if (url.startsWith('/api/yt-download')) {
    const videoIdMatch = url.match(/[?&]videoId=([a-zA-Z0-9_\-]+)/);
    if (!videoIdMatch) return res.status(400).send("Invalid YouTube download URL");

    const videoId = videoIdMatch[1];
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`[ExtractAudio] Downloading audio via yt-dlp+ffmpeg for ${videoId}...`);

    // Download audio via yt-dlp → ffmpeg pipe (sama seperti yt-download asAudio=1)
    try {
      res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Access-Control-Allow-Origin", "*");

      const ytdlp = spawn('yt-dlp', [
        "-f", "bestaudio[ext=m4a]/bestaudio",
        "-o", "-",
        "--no-warnings",
        "--no-playlist",
        "--no-check-certificates",
        "--extractor-retries", "3",
        "--extractor-args", "youtube:player_client=tv_embedded;player_skip=webpage",
        videoUrl
      ]);

      const ffmpeg = spawn('ffmpeg', [
        "-i", "pipe:0",
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        "-f", "mp3",
        "pipe:1"
      ]);

      ytdlp.stdout.pipe(ffmpeg.stdin);

      let dataSent = false;
      ffmpeg.stdout.on('data', (chunk) => {
        dataSent = true;
        res.write(chunk);
      });

      let stderr = '';
      ytdlp.stderr.on('data', (d) => { stderr += d.toString(); });
      ffmpeg.stderr.on('data', () => {});

      ytdlp.on('error', (err) => { if (!dataSent && !res.headersSent) res.status(502).end(); });
      ffmpeg.on('error', (err) => { if (!dataSent && !res.headersSent) res.status(502).end(); });

      await new Promise((resolve, reject) => {
        ffmpeg.on('close', (code) => {
          if (dataSent) { res.end(); resolve(); }
          else reject(new Error(`ffmpeg exit ${code}: ${stderr.substring(0, 200)}`));
        });

        req.on('close', () => {
          try { ytdlp.kill('SIGKILL'); } catch (e) {}
          try { ffmpeg.kill('SIGKILL'); } catch (e) {}
          resolve();
        });
      });

    } catch (err) {
      console.warn(`[ExtractAudio] YouTube yt-dlp stream failed: ${err.message}`);
      // Fallback: try with ffmpeg + headers (original approach)
      try {
        const host = req.get('host') || `localhost:${PORT}`;
        const proto = req.protocol || 'http';
        const fullUrl = `${proto}://${host}${url}`;
        console.log(`[ExtractAudio] Fallback: ffmpeg direct download from ${fullUrl}`);

        res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
        res.setHeader("Content-Type", "audio/mpeg");

        const ffmpeg = spawn('ffmpeg', [
          '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n',
          '-i', fullUrl,
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '192k',
          '-f', 'mp3',
          'pipe:1'
        ]);

        let dataSent = false;
        ffmpeg.stdout.on('data', (chunk) => { dataSent = true; res.write(chunk); });
        ffmpeg.stderr.on('data', () => {});
        ffmpeg.on('close', (code) => {
          if (dataSent) res.end();
          else if (!res.headersSent) res.status(502).json({ error: `Gagal ekstrak audio: ${err.message}` });
        });
        ffmpeg.on('error', () => {
          if (!res.headersSent) res.status(502).json({ error: `Gagal ekstrak audio: ${err.message}` });
        });
        req.on('close', () => { try { ffmpeg.kill('SIGKILL'); } catch (e) {} });
      } catch (e2) {
        if (!res.headersSent) res.status(502).json({ error: `Gagal ekstrak audio: ${err.message}` });
      }
    }
    return;
  }

  // ── Case 2: Local temp file path ──────────────────────────────────────
  let isInternalUrl = false;
  if (url.startsWith('/temp/')) {
    isInternalUrl = true;
    const host = req.get('host') || `localhost:${PORT}`;
    const proto = req.protocol || 'http';
    url = `${proto}://${host}${url}`;
  }

  // ── Case 2.5: Internal API URL (ytdl-proxy) — construct full URL ─────
  if (url.startsWith('/api/')) {
    isInternalUrl = true;
    const host = req.get('host') || `localhost:${PORT}`;
    const proto = req.protocol || 'http';
    url = `${proto}://${host}${url}`;
    console.log(`[ExtractAudio] Internal API URL, full: ${url.substring(0, 120)}...`);
  }

  // ── Case 3: External URL (CDN video) ──────────────────────────────────
  if (!isInternalUrl && !isAllowedCdnUrl(url)) {
    return res.status(403).json({ error: "Domain tidak diizinkan" });
  }

  res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
  res.setHeader("Content-Type", "audio/mpeg");

  const referer = getRefererForCdn(url);

  const ffmpeg = spawn('ffmpeg', [
    '-headers', `Referer: ${referer}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n`,
    '-i', url,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-f', 'mp3',
    'pipe:1'
  ]);

  let dataSent = false;
  let ffmpegStderr = '';
  ffmpeg.stdout.on('data', (chunk) => { dataSent = true; res.write(chunk); });
  ffmpeg.stderr.on('data', (d) => { ffmpegStderr += d.toString(); });

  ffmpeg.on('close', (code) => {
    if (dataSent) {
      res.end();
    } else {
      console.warn(`[ExtractAudio] ffmpeg gagal (exit ${code}): ${ffmpegStderr.substring(0, 200)}`);
      if (!res.headersSent) res.status(502).json({ error: `Gagal mengekstrak audio (ffmpeg exit ${code})` });
    }
  });

  ffmpeg.on('error', (err) => {
    console.warn(`[ExtractAudio] ffmpeg spawn error: ${err.message}`);
    if (!res.headersSent) res.status(502).json({ error: `Gagal menjalankan ffmpeg: ${err.message}` });
  });

  req.on('close', () => {
    try { ffmpeg.kill('SIGKILL'); } catch (e) {}
  });
});

/**
 * GET /api/merge-video?videoUrl=...&audioUrl=...
 * Menggabungkan video tanpa suara dengan audio.
 *
 * Download video & audio ke temp dulu, merge lokal, baru kirim hasil.
 * Ini lebih reliable karena CDN URLs bisa expire.
 *
 * Parameter ?stream=1 untuk preview (inline display),
 * tanpa ?stream untuk download (attachment).
 * Keduanya pake +faststart (moov di awal) agar audio dikenali browser.
 */
app.get("/api/merge-video", async (req, res) => {
  const { videoUrl, audioUrl, filename, stream, hdr } = req.query;
  if (!videoUrl || !audioUrl) return res.status(400).send("videoUrl and audioUrl required");

  if (!isAllowedCdnUrl(videoUrl) || !isAllowedCdnUrl(audioUrl)) {
    return res.status(403).json({ error: "Domain tidak diizinkan" });
  }

  const outName = filename || "merged_video.mp4";
  const isStream = stream === "1";

  const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const tempVideo = path.join(tempDir, `merge_video_${id}.mp4`);
  const tempAudio = path.join(tempDir, `merge_audio_${id}.mp4`);
  const tempOutput = path.join(tempDir, `merge_output_${id}.mp4`);

  let cancelled = false;
  let rStream = null;
  const cleanup = () => {
    if (rStream) { try { rStream.destroy(); } catch (e) {} }
    fs.unlink(tempVideo, () => {});
    fs.unlink(tempAudio, () => {});
    fs.unlink(tempOutput, () => {});
  };
  req.on('close', () => { cancelled = true; cleanup(); });

  try {
    // 1. Download video and audio to temp
    const referer = getRefererForCdn(videoUrl);
    const headers = {
      'Referer': referer,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    };

    // Decode shared headers/cookies dari yt-dlp session (VK, etc.)
    let useYtDlp = false;
    let ytDlpSource = null;
    if (hdr) {
      try {
        const decoded = JSON.parse(Buffer.from(decodeURIComponent(hdr), 'base64').toString('utf-8'));
        if (decoded.sourceUrl) {
          useYtDlp = true;
          ytDlpSource = decoded.sourceUrl;
          console.log(`[merge-video] yt-dlp mode active, source: ${ytDlpSource.substring(0, 80)}`);
        } else {
          if (decoded.headers) {
            for (const [k, v] of Object.entries(decoded.headers)) {
              if (k.toLowerCase() !== 'referer') headers[k] = v;
            }
          }
          if (decoded.cookies) {
            const cookieStr = decoded.cookies.split(';')[0].trim();
            if (cookieStr.includes('=')) headers['Cookie'] = cookieStr;
          }
          console.log(`[merge-video] Shared headers/cookies applied`);
        }
      } catch (e) {
        console.warn(`[merge-video] Gagal decode hdr: ${e.message}`);
      }
    }

    // ── Path A: yt-dlp handles everything (VK & other cookie-protected CDNs) ──
    if (useYtDlp) {
      const { spawn } = require('child_process');
      console.log(`[merge-video] yt-dlp downloading: ${ytDlpSource.substring(0, 80)}...`);

      await new Promise((resolve, reject) => {
        const ytdlp = spawn('yt-dlp', [
          "--no-warnings",
          "--no-playlist",
          "--no-check-certificates",
          "--extractor-retries", "3",
          "-f", "best[ext=mp4]/bestvideo+bestaudio",
          "--merge-output-format", "mp4",
          "-o", tempOutput,
          ytDlpSource,
        ], { timeout: 600000 });

        let stderrLog = '';
        ytdlp.stderr.on('data', (d) => { stderrLog += d.toString(); });
        ytdlp.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`yt-dlp exit ${code}: ${stderrLog.substring(0, 300)}`));
        });
        ytdlp.on('error', (err) => reject(err));
      });

      if (cancelled) { cleanup(); return; }
      const outSize = fs.statSync(tempOutput).size;
      if (outSize < 1024) {
        cleanup();
        return res.status(502).json({ error: "yt-dlp produced empty file" });
      }
      console.log(`[merge-video] yt-dlp output: ${(outSize/1024/1024).toFixed(1)} MB`);

      res.setHeader("Content-Disposition", isStream ? `inline; filename="${outName}"` : `attachment; filename="${outName}"`);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", outSize);
      res.setHeader("Accept-Ranges", "bytes");

      rStream = fs.createReadStream(tempOutput);
      rStream.pipe(res);
      rStream.on('end', cleanup);
      rStream.on('error', (err) => {
        console.error('[merge-video] Stream error:', err.message);
        cleanup();
      });
      return;
    }

    // ── Path B: Download video + audio via axios, merge via ffmpeg ──

    if (cancelled) return;
    console.log(`[merge-video] Downloading video: ${videoUrl.substring(0, 80)}...`);
    const videoResp = await axios({ method: 'get', url: videoUrl, responseType: 'stream', headers, timeout: 60000, httpsAgent: laxHttpsAgent });
    if (cancelled) { videoResp.data.destroy(); cleanup(); return; }
    const vStream = fs.createWriteStream(tempVideo);
    await new Promise((resolve, reject) => {
      videoResp.data.pipe(vStream);
      vStream.on('finish', resolve);
      vStream.on('error', reject);
    });
    if (cancelled) { cleanup(); return; }
    const vSize = fs.statSync(tempVideo).size;
    console.log(`[merge-video] Video downloaded: ${vSize} bytes`);

    if (cancelled) { cleanup(); return; }
    console.log(`[merge-video] Downloading audio: ${audioUrl.substring(0, 80)}...`);
    const audioResp = await axios({ method: 'get', url: audioUrl, responseType: 'stream', headers, timeout: 60000, httpsAgent: laxHttpsAgent });
    if (cancelled) { audioResp.data.destroy(); cleanup(); return; }
    const aStream = fs.createWriteStream(tempAudio);
    await new Promise((resolve, reject) => {
      audioResp.data.pipe(aStream);
      aStream.on('finish', resolve);
      aStream.on('error', reject);
    });
    if (cancelled) { cleanup(); return; }
    const aSize = fs.statSync(tempAudio).size;
    console.log(`[merge-video] Audio downloaded: ${aSize} bytes`);

    if (vSize === 0 || aSize === 0) {
      throw new Error(`Downloaded empty file: video=${vSize}, audio=${aSize}`);
    }

    // 2. Merge via ffmpeg
    const { spawn } = require('child_process');
    console.log(`[merge-video] Merging with ffmpeg (+faststart)...`);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', tempVideo,
        '-i', tempAudio,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-strict', 'experimental',
        '-movflags', '+faststart',
        '-y', tempOutput
      ]);

      let stderrLog = '';
      ffmpeg.stderr.on('data', (d) => { stderrLog += d.toString(); });

      ffmpeg.on('error', (err) => reject(err));
      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exit ${code}: ${stderrLog.substring(0, 300)}`));
        } else {
          resolve();
        }
      });
    });

    const outSize = fs.statSync(tempOutput).size;
    console.log(`[merge-video] Output: ${outSize} bytes`);

    if (outSize === 0) {
      throw new Error('ffmpeg produced empty output');
    }

    // 3. Stream the merged file
    res.setHeader("Content-Disposition", isStream ? `inline; filename="${outName}"` : `attachment; filename="${outName}"`);
    res.setHeader("Content-Type", "video/mp4");

    rStream = fs.createReadStream(tempOutput);
    rStream.pipe(res);
    rStream.on('end', cleanup);
    rStream.on('error', (err) => {
      console.error('[merge-video] Stream error:', err.message);
      cleanup();
    });

  } catch (err) {
    console.error('[merge-video] Error:', err.message);
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: 'Merge failed: ' + err.message });
    }
  }
});

/**
 * GET /api/ytdl-proxy?url=...&format=...
 *
 * Download video via yt-dlp ke temp file, apply faststart (moov di awal),
 * lalu serve ke client dengan Content-Length + Range support.
 * yt-dlp handle auth, cookies, merge video+audio otomatis.
 */
app.get("/api/ytdl-proxy", async (req, res) => {
  const { url, format, filename } = req.query;
  if (!url) return res.status(400).json({ error: "Parameter url diperlukan" });

  const targetUrl = decodeURIComponent(url);
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return res.status(400).json({ error: "URL tidak valid" });
  }

  const formatStr = format || "best[ext=mp4]/bestvideo+bestaudio";
  if (/[;&|`$]/.test(formatStr)) {
    return res.status(400).json({ error: "Format tidak valid" });
  }

  const outName = filename || "video.mp4";
  const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const tempOutput = path.join(tempDir, `ytdl_proxy_${id}.mp4`);

  let cancelled = false;
  const cleanup = () => { fs.unlink(tempOutput, () => {}); };
  req.on('close', () => { cancelled = true; });

  try {
    const { spawn } = require('child_process');
    console.log(`[ytdl-proxy] Downloading: ${targetUrl.substring(0, 100)}...`);

    // Download via yt-dlp ke temp, merge + faststart via postprocessor
    await new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', [
        "--no-warnings",
        "--no-playlist",
        "--no-check-certificates",
        "--extractor-retries", "3",
        "-f", formatStr,
        "--merge-output-format", "mp4",
        "--postprocessor-args", "ffmpeg:-movflags +faststart",
        "-o", tempOutput,
        targetUrl,
      ], { timeout: 600000 });

      let stderrLog = '';
      ytdlp.stderr.on('data', (d) => { stderrLog += d.toString(); });

      ytdlp.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exit ${code}: ${stderrLog.substring(0, 300)}`));
      });
      ytdlp.on('error', (err) => reject(err));
    });

    if (cancelled) { cleanup(); return; }

    const stat = fs.statSync(tempOutput);
    if (stat.size < 1024) {
      cleanup();
      return res.status(502).json({ error: "File downloaded too small — likely blocked" });
    }
    console.log(`[ytdl-proxy] Downloaded ${(stat.size/1024/1024).toFixed(1)} MB, serving...`);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const rStream = fs.createReadStream(tempOutput);
    rStream.pipe(res);
    rStream.on('end', cleanup);
    rStream.on('error', () => { cleanup(); if (!res.headersSent) res.status(500).json({error:"Stream error"}); });

  } catch (err) {
    console.error('[ytdl-proxy] Error:', err.message);
    cleanup();
    if (!res.headersSent) res.status(502).json({ error: 'Download video gagal: ' + err.message });
  }
});

/**
 * GET /api/yt-stream?file=filename.mp4
 *
 * Streaming endpoint untuk file YouTube yang sudah didownload server-side oleh yt-dlp.
 * Mendukung Range requests (untuk video seeking) dan proper headers.
 * Lebih reliable daripada serve static /temp/ di Railway/Cloud.
 */
app.get("/api/yt-stream", async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: "Parameter file diperlukan" });

  // Sanitasi filename — hanya izinkan basename tanpa path traversal
  const safeFile = path.basename(file).replace(/[^a-zA-Z0-9_.\-]/g, '_');
  const filePath = path.join(__dirname, 'temp_downloads', safeFile);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File tidak ditemukan. Mungkin sudah dibersihkan atau belum selesai download." });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const filename = req.query.filename || safeFile.replace(/^youtube_/, 'youtube_').replace(/_\d+\.mp4$/, '.mp4');

  // Deteksi tipe file dari ekstensi
  const ext = path.extname(safeFile).toLowerCase();
  const contentType = ext === '.mp4' ? 'video/mp4'
    : ext === '.webm' ? 'video/webm'
    : ext === '.mp3' ? 'audio/mpeg'
    : ext === '.m4a' ? 'audio/mp4'
    : 'application/octet-stream';

  // Support Range requests (penting untuk video seeking di browser)
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': `inline; filename="${filename}"`,
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('[YT-Stream] Read stream error:', err.message);
      if (!res.headersSent) res.status(500).end();
    });
  } else {
    // Full file response
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': `inline; filename="${filename}"`,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('[YT-Stream] Read stream error:', err.message);
      if (!res.headersSent) res.status(500).end();
    });
  }

  req.on('close', () => {
    // Client disconnected
  });
});

/**
 * GET /api/yt-audio?file=filename.mp4
 *
 * Ekstrak audio dari file YouTube yang sudah didownload, kirim sebagai MP3.
 * Menggunakan ffmpeg untuk konversi on-the-fly.
 */
app.get("/api/yt-audio", async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: "Parameter file diperlukan" });

  const safeFile = path.basename(file).replace(/[^a-zA-Z0-9_.\-]/g, '_');
  const filePath = path.join(__dirname, 'temp_downloads', safeFile);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File tidak ditemukan" });
  }

  const outName = safeFile.replace(/\.(mp4|webm|m4a)$/, '.mp3');
  res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { spawn } = require('child_process');
  const ffmpeg = spawn('ffmpeg', [
    '-i', filePath,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-f', 'mp3',
    'pipe:1'
  ]);

  ffmpeg.stdout.pipe(res);
  ffmpeg.stderr.on('data', () => {}); // silent
  ffmpeg.on('error', (err) => {
    console.error('[YT-Audio] ffmpeg error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: "Gagal mengekstrak audio" });
  });

  req.on('close', () => {
    try { ffmpeg.kill('SIGKILL'); } catch (e) {}
  });
});

/**
 * GET /api/yt-download?videoId=...&formatId=...&asAudio=1
 *
 * Streaming endpoint YouTube — jalankan yt-dlp -o - (stdout) dan pipe langsung ke browser.
 * Jika yt-dlp gagal 403 (IP datacenter diblok YouTube), otomatis fallback ke Invidious/Piped.
 * Tidak menyimpan file ke disk sama sekali, aman untuk Railway ephemeral filesystem.
 */
app.get("/api/yt-download", async (req, res) => {
  const { videoId, formatId, asAudio } = req.query;

  if (!videoId || !formatId) {
    return res.status(400).json({ error: "Parameter videoId dan formatId diperlukan" });
  }

  // Sanitasi: hanya izinkan karakter aman untuk videoId (11-char YouTube ID)
  const rawVideoId = (videoId || '').substring(0, 20).replace(/[^a-zA-Z0-9_\-]/g, '');
  // Sanitasi formatId: izinkan [ ] = + . % (untuk format seperti best[ext=mp4])
  const rawFormatId = (formatId || '').replace(/[^a-zA-Z0-9_\-+:.%\[\]=,<>]/g, '');

  if (!rawVideoId || !rawFormatId) {
    return res.status(400).json({ error: "videoId atau formatId tidak valid" });
  }

  const safeVideoId = rawVideoId;
  const safeFormatId = rawFormatId;

  const cleanUrl = `https://www.youtube.com/watch?v=${safeVideoId}`;
  const isAudio = asAudio === '1' || asAudio === 'true';

  // Argumen yt-dlp standar
  const ytdlpBaseArgs = [
    "--no-warnings",
    "--no-playlist",
    "--extractor-args", "youtube:player_client=mediaconnect,tv_embedded,ios,android,mweb;player_skip=webpage",
    "--no-check-certificates",
    "--extractor-retries", "5",
    "--sleep-interval", "2",
    "--max-sleep-interval", "5",
  ];

  // Cookies YouTube otomatis jika ada
  const ytCookiesPath = path.join(__dirname, "cookies", "youtube_cookies.txt");
  if (fs.existsSync(ytCookiesPath)) {
    ytdlpBaseArgs.push("--cookies", ytCookiesPath);
  }

  const { spawn } = require('child_process');

  // ─── Helper: Fallback via @distube/ytdl-core streaming (Node.js native) ──
  async function tryYtdlCoreStream(res, safeVideoId, isAudio) {
    console.log(`[YT-Download] Mencoba @distube/ytdl-core stream untuk ${safeVideoId}...`);
    const videoUrl = `https://www.youtube.com/watch?v=${safeVideoId}`;

    try {
      const ytdl = require('@distube/ytdl-core');

      const streamOptions = {
        quality: isAudio ? 'highestaudio' : 'highest',
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        },
        highWaterMark: 1024 * 1024 * 2,
      };

      const stream = ytdl(videoUrl, streamOptions);

      const ext = isAudio ? 'mp3' : 'mp4';
      const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="youtube_${safeVideoId}.${ext}"`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Accept-Ranges", "none");

      stream.on('response', (httpResponse) => {
        if (httpResponse.headers['content-length']) {
          res.setHeader("Content-Length", httpResponse.headers['content-length']);
        }
      });

      stream.pipe(res);

      return new Promise((resolve) => {
        stream.on('end', () => {
          console.log(`[YT-Download] ✅ ytdl-core stream selesai`);
          resolve(true);
        });
        stream.on('error', (err) => {
          console.warn(`[YT-Download] ytdl-core stream error: ${err.message.substring(0, 80)}`);
          if (!res.headersSent) resolve(false);
          else resolve(true);
        });
      });
    } catch (e) {
      console.warn(`[YT-Download] ytdl-core gagal: ${e.message.substring(0, 80)}`);
      return false;
    }
  }

  // ─── Helper: Fallback via pytubefix Python stream ─────────────────────────
  async function tryPytubeStream(res, safeVideoId, isAudio, quality) {
    console.log(`[YT-Download] Mencoba pytubefix Python stream untuk ${safeVideoId}${quality ? ' ('+quality+')' : ''}...`);
    const videoUrl = `https://www.youtube.com/watch?v=${safeVideoId}`;
    const mode = isAudio ? 'audio' : 'video';

    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

      const streamArgs = [path.join(__dirname, 'pytube_stream.py'), videoUrl, mode];
      if (quality) streamArgs.push(quality);

      const python = spawn(pythonCmd, streamArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300000,
      });

      let headersSet = false;
      let dataStarted = false;

      python.stdout.on('data', (chunk) => {
        dataStarted = true;
        if (!headersSet) {
          headersSet = true;
          const ext = isAudio ? 'mp3' : 'mp4';
          const ct = isAudio ? 'audio/mpeg' : 'video/mp4';
          res.setHeader('Content-Type', ct);
          res.setHeader('Content-Disposition', `attachment; filename="youtube_${safeVideoId}.${ext}"`);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Accept-Ranges', 'none');
        }
        res.write(chunk);
      });

      let stderr = '';
      python.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      python.on('close', (code) => {
        if (!dataStarted) {
          console.warn(`[YT-Download] pytube Python stream gagal (exit ${code}): ${stderr.substring(0, 200)}`);
          if (!res.headersSent) resolve(false);
          else resolve(true);
        } else {
          res.end();
          console.log(`[YT-Download] ✅ pytube Python stream selesai (exit ${code})`);
          resolve(true);
        }
      });

      python.on('error', (err) => {
        console.warn(`[YT-Download] pytube Python spawn error: ${err.message}`);
        if (!res.headersSent) resolve(false);
        else resolve(true);
      });

      req.on('close', () => {
        try { python.kill('SIGKILL'); } catch(e) {}
      });
    });
  }

  // ─── Helper: Fallback via pytubefix download-to-file + stream ────────────
  async function tryPytubeDownloadFile(res, safeVideoId, isAudio, quality) {
    console.log(`[YT-Download] Mencoba pytubefix download-to-file untuk ${safeVideoId}...`);
    const videoUrl = `https://www.youtube.com/watch?v=${safeVideoId}`;
    const mode = isAudio ? 'audio' : 'video';

    try {
      const { spawn } = require('child_process');
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

      // Use pytube_stream.py which already handles download-to-file fallback internally
      // This is a backup if the stream mode failed
      const streamArgs = [path.join(__dirname, 'pytube_stream.py'), videoUrl, mode];
      if (quality) streamArgs.push(quality);

      return new Promise((resolve) => {
        const python = spawn(pythonCmd, streamArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 300000,
        });

        let headersSet = false;
        let dataStarted = false;

        python.stdout.on('data', (chunk) => {
          dataStarted = true;
          if (!headersSet) {
            headersSet = true;
            const ext = isAudio ? 'mp3' : 'mp4';
            const ct = isAudio ? 'audio/mpeg' : 'video/mp4';
            res.setHeader('Content-Type', ct);
            res.setHeader('Content-Disposition', `attachment; filename="youtube_${safeVideoId}.${ext}"`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Accept-Ranges', 'none');
          }
          res.write(chunk);
        });

        let stderr = '';
        python.stderr.on('data', (d) => {
          stderr += d.toString();
        });

        python.on('close', (code) => {
          if (!dataStarted) {
            console.warn(`[YT-Download] pytube download-file gagal (exit ${code}): ${stderr.substring(0, 200)}`);
            if (!res.headersSent) resolve(false);
            else resolve(true);
          } else {
            res.end();
            console.log(`[YT-Download] ✅ pytube download-file selesai (exit ${code})`);
            resolve(true);
          }
        });

        python.on('error', (err) => {
          console.warn(`[YT-Download] pytube download-file spawn error: ${err.message}`);
          if (!res.headersSent) resolve(false);
          else resolve(true);
        });

        req.on('close', () => {
          try { python.kill('SIGKILL'); } catch(e) {}
        });
      });
    } catch (e) {
      console.warn(`[YT-Download] pytube download-file error: ${e.message.substring(0, 80)}`);
      return false;
    }
  }
  async function tryScraperFallback(res, safeVideoId, isAudio) {
    console.log(`[YT-Download] Mencoba full scrape pipeline untuk ${safeVideoId}...`);
    const videoUrl = `https://www.youtube.com/watch?v=${safeVideoId}`;

    try {
      // Skip yt-dlp karena sudah tahu gagal, langsung fallback lain (Cobalt, Siputzx, dll)
      const result = await scrapeYouTube(videoUrl, false);
      const items = result.mediaItems || [];
      if (items.length === 0) throw new Error("Tidak ada media ditemukan");

      // Cari URL terbaik: format combined (video+audio), atau video terpisah
      let bestUrl = null;

      if (isAudio) {
        for (const item of items) {
          if (item.formats) {
            for (const f of item.formats) {
              if (f.type === 'audio' && f.url) {
                bestUrl = f.url;
                break;
              }
            }
          }
          if (bestUrl) break;
        }
      }

      if (!bestUrl) {
        for (const item of items) {
          if (item.url && item.type === 'video') {
            bestUrl = item.url;
            break;
          }
        }
      }

      if (!bestUrl) {
        bestUrl = items[0].url;
      }

      if (!bestUrl) throw new Error("Tidak ada URL media yang valid");

      console.log(`[YT-Download] ✅ Scraper fallback dapat URL, streaming via native https: ${bestUrl.substring(0, 80)}...`);

      // Stream googlevideo URL via native https — header minimal, hindari bot detection
      const https = require('https');
      const parsedUrl = new URL(bestUrl);

      return new Promise((resolve) => {
        const req = https.get({
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          rejectUnauthorized: false,
          timeout: 300000,
        }, (streamResp) => {
          // Jika googlevideo redirect (301/302), ikuti redirect
          if (streamResp.statusCode >= 300 && streamResp.statusCode < 400 && streamResp.headers.location) {
            console.log(`[YT-Download] googlevideo redirect ${streamResp.statusCode} → ${streamResp.headers.location.substring(0, 80)}`);
            streamResp.destroy();
            // Coba ulang dengan URL redirect
            const redirectUrl = streamResp.headers.location.startsWith('http') 
              ? streamResp.headers.location 
              : `https://${parsedUrl.hostname}${streamResp.headers.location}`;
            const rParsed = new URL(redirectUrl);
            const rReq = https.get({
              hostname: rParsed.hostname,
              path: rParsed.pathname + rParsed.search,
              method: 'GET',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
              },
              rejectUnauthorized: false,
              timeout: 300000,
            }, (rResp) => {
              if (rResp.statusCode === 403 || rResp.statusCode === 404) {
                if (!res.headersSent) resolve(false);
                else resolve(true);
                return;
              }
              res.setHeader('Content-Type', rResp.headers['content-type'] || 'video/mp4');
              res.setHeader('Content-Disposition', `attachment; filename="youtube_${safeVideoId}.mp4"`);
              res.setHeader('Access-Control-Allow-Origin', '*');
              if (rResp.headers['content-length']) res.setHeader('Content-Length', rResp.headers['content-length']);
              rResp.pipe(res);
              rResp.on('end', () => resolve(true));
              rResp.on('error', () => { if (!res.headersSent) resolve(false); else resolve(true); });
            });
            rReq.on('error', () => { if (!res.headersSent) resolve(false); else resolve(true); });
            return;
          }

          if (streamResp.statusCode === 403 || streamResp.statusCode === 404) {
            if (!res.headersSent) resolve(false);
            else resolve(true);
            return;
          }

          res.setHeader('Content-Type', streamResp.headers['content-type'] || 'video/mp4');
          res.setHeader('Content-Disposition', `attachment; filename="youtube_${safeVideoId}.mp4"`);
          res.setHeader('Access-Control-Allow-Origin', '*');
          if (streamResp.headers['content-length']) {
            res.setHeader('Content-Length', streamResp.headers['content-length']);
          }
          streamResp.pipe(res);
          streamResp.on('end', () => resolve(true));
          streamResp.on('error', () => { 
            if (!res.headersSent) resolve(false); else resolve(true); 
          });
        });

        req.on('timeout', () => {
          req.destroy();
          if (!res.headersSent) resolve(false);
        });
        req.on('error', () => { 
          if (!res.headersSent) resolve(false); else resolve(true); 
        });
      });
    } catch (e) {
      console.warn(`[YT-Download] Scraper fallback gagal: ${e.message.substring(0, 120)}`);
      return false;
    }
  }

  // ─── Helper: Fallback ke Cobalt API (gratis, open-source) ──────────────────
  async function tryCobaltFallback(res, safeVideoId, isAudio) {
    console.log(`[YT-Download] Mencoba fallback Cobalt untuk ${safeVideoId}...`);
    const videoUrl = `https://www.youtube.com/watch?v=${safeVideoId}`;

    const cobaltInstances = [
      "https://api.cobalt.tools",
    ];

    for (const instance of cobaltInstances) {
      try {
        const resp = await axios.post(`${instance}/api/json`, {
          url: videoUrl,
          vQuality: "720",
          filenamePattern: "basic",
          isAudioOnly: !!isAudio,
          disableMetadata: true,
        }, {
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          timeout: 20000,
          validateStatus: s => s === 200,
        });

        const data = resp.data;
        if (data.url) {
          const streamResp = await axios.get(data.url, {
            responseType: "stream",
            timeout: 300000,
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            maxRedirects: 5,
            httpsAgent: laxHttpsAgent,
          });

          const ext = isAudio ? 'mp3' : 'mp4';
          const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';
          res.setHeader("Content-Type", contentType);
          res.setHeader("Content-Disposition", `attachment; filename="youtube_${safeVideoId}.${ext}"`);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Accept-Ranges", "none");
          if (streamResp.headers["content-length"]) {
            res.setHeader("Content-Length", streamResp.headers["content-length"]);
          }
          streamResp.data.pipe(res);
          console.log(`[YT-Download] ✅ Cobalt fallback sukses via ${instance}`);
          return true;
        }
      } catch (e) {
        console.warn(`[YT-Download] Cobalt ${instance} gagal: ${e.message.substring(0, 80)}`);
      }
    }
    return false;
  }

  // ─── Helper: Fallback ke Invidious/Piped saat yt-dlp 403 ──────────────────
  // Coba ambil stream URL langsung dari Invidious atau Piped, lalu proxy ke browser.
  async function tryInvidiousFallback(res, safeVideoId, isAudio) {
    console.log(`[YT-Download] Mencoba fallback Invidious/Piped untuk ${safeVideoId}...`);

    const invidiousInstances = [
      "https://inv.nadeko.net",
      "https://invidious.privacydev.net",
      "https://invidious.kavin.rocks",
      "https://yewtu.be",
      "https://invidious.nerdvpn.de",
      "https://yt.cdaut.de",
      "https://invidious.fdn.fr",
      "https://iv.datura.network",
    ];

    const pipedInstances = [
      "https://pipedapi.kavin.rocks",
      "https://pipedapi.adminforge.de",
      "https://pipedapi.drgns.space",
      "https://piped-api.garudalinux.org",
      "https://pipedapi.leptons.xyz",
    ];

    // Coba Invidious dulu
    for (const instance of invidiousInstances) {
      try {
        const apiUrl = `${instance}/api/v1/videos/${safeVideoId}`;
        const resp = await axios.get(apiUrl, {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
          timeout: 10000,
        });
        const data = resp.data;
        if (!data) continue;

        let streamUrl = null;

        if (isAudio) {
          // Cari audio-only format terbaik
          const audioFormats = (data.adaptiveFormats || [])
            .filter(f => f.url && f.type && f.type.includes("audio/"))
            .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
          if (audioFormats.length > 0) streamUrl = audioFormats[0].url;
        } else {
          // Cari combined video+audio (formatStreams) dulu, lalu adaptiveFormats
          const combined = (data.formatStreams || [])
            .filter(f => f.url && f.type && f.type.includes("video/mp4"))
            .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));
          if (combined.length > 0) {
            streamUrl = combined[0].url;
          } else {
            const adaptive = (data.adaptiveFormats || [])
              .filter(f => f.url && f.type && f.type.includes("video/mp4"))
              .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));
            if (adaptive.length > 0) streamUrl = adaptive[0].url;
          }
        }

        if (!streamUrl) continue;

        // Resolve URL relatif
        if (!streamUrl.startsWith("http")) streamUrl = `${instance}${streamUrl}`;

        console.log(`[YT-Download] Invidious ${instance} berhasil, streaming...`);
        await proxyStreamUrl(res, streamUrl, safeVideoId, isAudio);
        return true;

      } catch (err) {
        console.warn(`[YT-Download] Invidious ${instance} gagal: ${err.message.substring(0, 80)}`);
      }
    }

    // Coba Piped
    for (const instance of pipedInstances) {
      try {
        const resp = await axios.get(`${instance}/streams/${safeVideoId}`, {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
          timeout: 10000,
        });
        const data = resp.data;
        if (!data) continue;

        let streamUrl = null;

        if (isAudio) {
          const audioStreams = (data.audioStreams || [])
            .filter(s => s.url)
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          if (audioStreams.length > 0) streamUrl = audioStreams[0].url;
        } else {
          const videoStreams = (data.videoStreams || [])
            .filter(s => s.url && s.format === "MPEG_4" && !s.videoOnly)
            .sort((a, b) => (b.quality || 0) - (a.quality || 0));
          if (videoStreams.length > 0) {
            streamUrl = videoStreams[0].url;
          } else {
            const allMp4 = (data.videoStreams || [])
              .filter(s => s.url && s.format === "MPEG_4")
              .sort((a, b) => (b.quality || 0) - (a.quality || 0));
            if (allMp4.length > 0) streamUrl = allMp4[0].url;
          }
        }

        if (!streamUrl) continue;

        console.log(`[YT-Download] Piped ${instance} berhasil, streaming...`);
        await proxyStreamUrl(res, streamUrl, safeVideoId, isAudio);
        return true;

      } catch (err) {
        console.warn(`[YT-Download] Piped ${instance} gagal: ${err.message.substring(0, 80)}`);
      }
    }

    return false;
  }

  // ─── Helper: Proxy stream URL langsung ke browser ─────────────────────────
  async function proxyStreamUrl(res, streamUrl, safeVideoId, isAudio) {
    const streamResp = await axios.get(streamUrl, {
      responseType: "stream",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Range": "bytes=0-",
      },
    });

    if (isAudio) {
      // Pipe audio stream lewat ffmpeg untuk konversi ke MP3
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="youtube_${safeVideoId}.mp3"`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Accept-Ranges", "none");

      const ffmpegProc = spawn("ffmpeg", [
        "-i", "pipe:0",
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        "-f", "mp3",
        "pipe:1"
      ]);

      streamResp.data.pipe(ffmpegProc.stdin);
      ffmpegProc.stdout.pipe(res);
      ffmpegProc.stderr.on('data', () => {});
      ffmpegProc.on('error', (err) => {
        console.error('[YT-Download/fallback-audio] ffmpeg error:', err.message);
      });

    } else {
      // Pipe video stream langsung ke browser
      const contentType = streamResp.headers['content-type'] || 'video/mp4';
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="youtube_${safeVideoId}.mp4"`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Accept-Ranges", "none");
      if (streamResp.headers['content-length']) {
        res.setHeader("Content-Length", streamResp.headers['content-length']);
      }
      streamResp.data.pipe(res);
    }
  }

  // Timeout 5 menit
  const TIMEOUT_MS = 5 * 60 * 1000;
  let ytdlpProc = null;
  let ffmpegProc = null;
  let finished = false;

  const cleanup = (reason) => {
    if (finished) return;
    finished = true;
    console.log(`[YT-Download] Cleanup: ${reason}`);
    try { if (ytdlpProc) ytdlpProc.kill('SIGKILL'); } catch (e) {}
    try { if (ffmpegProc) ffmpegProc.kill('SIGKILL'); } catch (e) {}
  };

  const timer = setTimeout(() => {
    cleanup('timeout 5 menit');
    if (!res.headersSent) res.status(504).json({ error: "Download timeout (5 menit)" });
  }, TIMEOUT_MS);

  req.on('close', () => cleanup('client disconnect'));

  try {
      // ─── Coba PyTube (pytubefix) DULU — tidak kena bot detection yt-dlp ──────────
      // Jika formatId dari pytube (pytube_720p, pytube_1080p, dll), extract quality
      let pytubeQuality = null;
      if (safeFormatId.startsWith('pytube_')) {
        pytubeQuality = safeFormatId.replace('pytube_', '');
      }
      console.log(`[YT-Download] Mencoba PyTube (pytubefix) untuk ${safeVideoId}${pytubeQuality ? ' ('+pytubeQuality+')' : ''}...`);
      const pytubeOk = await tryPytubeStream(res, safeVideoId, isAudio, pytubeQuality);
      if (pytubeOk) {
        console.log(`[YT-Download] \u2705 PyTube sukses`);
        clearTimeout(timer);
        cleanup('selesai-pytube');
        return;
      }
      console.log(`[YT-Download] PyTube gagal, lanjut ke yt-dlp...`);

      // ─── Skip yt-dlp jika formatId dari pytube (pytube_xxx) — pasti gagal ─
      if (safeFormatId.startsWith('pytube_')) {
        console.log(`[YT-Download] Skip yt-dlp (formatId dari pytube), langsung fallback...`);
        const scraperOk = await tryScraperFallback(res, safeVideoId, isAudio);
        if (scraperOk) {
          clearTimeout(timer);
          cleanup('selesai-scraper');
          return;
        }
        // Jika scraper juga gagal, throw error
        cleanup('all-fallbacks-failed');
        if (!res.headersSent) {
          res.status(502).json({ error: `Gagal mendownload ${safeVideoId} — semua metode fallback gagal` });
        }
        return;
      }

      // ─── Fallback: yt-dlp (deteksi 403 dari stderr) ────────────────────────────
      let ytdlpFailed = false;
      let ytdlpStderr = '';

      await new Promise((resolve, reject) => {
        if (isAudio) {
        // ─── Mode Audio MP3 via yt-dlp ──────────────────────────────────────
        ytdlpProc = spawn("yt-dlp", [
          "-f", safeFormatId,
          "-o", "-",
          ...ytdlpBaseArgs,
          cleanUrl
        ]);

        ffmpegProc = spawn("ffmpeg", [
          "-i", "pipe:0",
          "-vn",
          "-c:a", "libmp3lame",
          "-b:a", "192k",
          "-f", "mp3",
          "pipe:1"
        ]);

        ytdlpProc.stdout.pipe(ffmpegProc.stdin);

        let headersSet = false;
        ffmpegProc.stdout.on('data', (chunk) => {
          if (!headersSet) {
            headersSet = true;
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Content-Disposition", `attachment; filename="youtube_${safeVideoId}.mp3"`);
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Accept-Ranges", "none");
          }
          res.write(chunk);
        });

        ytdlpProc.stderr.on('data', (d) => {
          const msg = d.toString();
          ytdlpStderr += msg;
          if (msg.includes('403') || msg.includes('HTTP Error 403') || msg.includes('Forbidden')) {
            ytdlpFailed = true;
            console.warn(`[YT-Download/audio] yt-dlp 403 terdeteksi, akan fallback`);
            try { ytdlpProc.kill('SIGKILL'); } catch (e) {}
            try { ffmpegProc.kill('SIGKILL'); } catch (e) {}
          }
        });

        ffmpegProc.stderr.on('data', () => {});

        ytdlpProc.on('error', (err) => reject(err));
        ffmpegProc.on('error', (err) => reject(err));

        ffmpegProc.on('close', (code) => {
          if (ytdlpFailed) return resolve('fallback');
          if (code === 0) { res.end(); resolve('done'); }
          else reject(new Error(`ffmpeg exit ${code} | stderr: ${ytdlpStderr.substring(0, 200)}`));
        });

        ytdlpProc.on('close', (code) => {
          if (ytdlpFailed) resolve('fallback');
          else if (code !== 0) {
            try { ffmpegProc.stdin.destroy(); } catch (e) {}
          }
        });

      } else {
        // ─── Mode Video via yt-dlp ───────────────────────────────────────────
        const formatSelector = `${safeFormatId}+bestaudio[ext=m4a]/${safeFormatId}+bestaudio/${safeFormatId}`;

        ytdlpProc = spawn("yt-dlp", [
          "-f", formatSelector,
          "--merge-output-format", "mp4",
          "-o", "-",
          ...ytdlpBaseArgs,
          cleanUrl
        ]);

        let headersSet = false;
        ytdlpProc.stdout.on('data', (chunk) => {
          if (!headersSet) {
            headersSet = true;
            res.setHeader("Content-Type", "video/mp4");
            res.setHeader("Content-Disposition", `attachment; filename="youtube_${safeVideoId}.mp4"`);
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Accept-Ranges", "none");
          }
          res.write(chunk);
        });

        ytdlpProc.stderr.on('data', (d) => {
          const msg = d.toString();
          ytdlpStderr += msg;
          if (msg.includes('403') || msg.includes('HTTP Error 403') || msg.includes('Forbidden')) {
            ytdlpFailed = true;
            console.warn(`[YT-Download/video] yt-dlp 403 terdeteksi, akan fallback`);
            try { ytdlpProc.kill('SIGKILL'); } catch (e) {}
          }
        });

        ytdlpProc.on('error', (err) => reject(err));

        ytdlpProc.on('close', (code) => {
          if (ytdlpFailed) return resolve('fallback');
          if (code === 0) { res.end(); resolve('done'); }
          else reject(new Error(`yt-dlp exit ${code} | stderr: ${ytdlpStderr.substring(0, 200)}`));
        });
      }
    }).then(async (result) => {
      if (result === 'fallback') {
        console.log(`[YT-Download] yt-dlp 403, mencoba fallback chain...`);
        if (!res.headersSent) {
          let ok = await tryYtdlCoreStream(res, safeVideoId, isAudio);
          if (!ok && !res.headersSent) ok = await tryPytubeDownloadFile(res, safeVideoId, isAudio, pytubeQuality);
          if (!ok && !res.headersSent) ok = await tryScraperFallback(res, safeVideoId, isAudio);
          if (!ok && !res.headersSent) ok = await tryCobaltFallback(res, safeVideoId, isAudio);
          if (!ok && !res.headersSent) {
            ok = await tryInvidiousFallback(res, safeVideoId, isAudio);
            if (!ok && !res.headersSent) {
              res.status(502).json({ error: "Semua metode download gagal" });
            }
          }
        }
      }
    }).catch(async (err) => {
      console.warn(`[YT-Download] yt-dlp error: ${err.message.substring(0, 150)}`);
      if (!res.headersSent) {
        console.log(`[YT-Download] Mencoba fallback chain...`);
        let ok = await tryYtdlCoreStream(res, safeVideoId, isAudio);
        if (!ok && !res.headersSent) ok = await tryPytubeDownloadFile(res, safeVideoId, isAudio, pytubeQuality);
        if (!ok && !res.headersSent) ok = await tryScraperFallback(res, safeVideoId, isAudio);
        if (!ok && !res.headersSent) ok = await tryCobaltFallback(res, safeVideoId, isAudio);
        if (!ok && !res.headersSent) {
          ok = await tryInvidiousFallback(res, safeVideoId, isAudio);
          if (!ok && !res.headersSent) {
            res.status(502).json({ error: "Download gagal: " + err.message.substring(0, 100) });
          }
        }
      }
    });

    clearTimeout(timer);
    cleanup('selesai');

  } catch (err) {
    clearTimeout(timer);
    cleanup('exception');
    console.error('[YT-Download] Unexpected error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error: " + err.message });
  }
});

/**
 * GET /api/proxy-instagram?url=...
 * 
 * Proxy khusus untuk foto Instagram.
 * Menghandle HEIC → JPEG conversion dan Instagram CDN quirks.
 */
app.get("/api/proxy-instagram", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Parameter url diperlukan" });
  }

  // Validasi domain Instagram CDN
  const allowedHosts = [
    'cdninstagram.com',
    'fbcdn.net',
    'instagram.com'
  ];
  
  try {
    const parsedUrl = new URL(url);
    const isInstagramCdn = allowedHosts.some(host => parsedUrl.hostname.includes(host));
    
    if (!isInstagramCdn) {
      return res.status(403).json({ error: "Hanya Instagram CDN yang diizinkan" });
    }
  } catch (e) {
    return res.status(400).json({ error: "URL tidak valid" });
  }

  try {
    // Instagram CDN headers yang optimal
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.instagram.com/",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site"
    };

    // Forward Range header untuk support download managers
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const response = await axios.get(url, {
      responseType: "stream",
      headers: headers,
      timeout: 60000,
      maxRedirects: 3,
      httpsAgent: laxHttpsAgent,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const contentType = response.headers["content-type"] || "image/jpeg";
    const contentLength = response.headers["content-length"];

    // Set response headers
    res.status(response.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000"); // Cache 1 tahun
    
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }
    
    if (response.headers["accept-ranges"]) {
      res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
    }
    
    if (response.headers["content-range"]) {
      res.setHeader("Content-Range", response.headers["content-range"]);
    }

    // Tentukan filename dari URL atau generate
    let filename = "instagram_photo.jpg";
    try {
      const urlPath = new URL(url).pathname;
      const parts = urlPath.split('/');
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart.length > 5) {
        filename = lastPart.replace(/\?.*$/, '');
        // Force .jpg extension jika HEIC
        if (filename.endsWith('.heic')) {
          filename = filename.replace('.heic', '.jpg');
        }
      }
    } catch (e) {
      filename = `instagram_${Date.now()}.jpg`;
    }

    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    // Stream foto ke client
    response.data.pipe(res);

    // Error handling
    response.data.on('error', (err) => {
      console.error('[Proxy Instagram] Stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Gagal streaming foto" });
      }
    });

    // Cleanup jika client cancel download
    req.on('close', () => {
      response.data.destroy();
    });

  } catch (err) {
    console.error("[Proxy Instagram] Error:", err.message);
    
    // Retry dengan minimal headers jika 403
    if (err.response && err.response.status === 403) {
      try {
        const retryResponse = await axios.get(url, {
          responseType: "stream",
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
          },
          timeout: 60000,
          httpsAgent: laxHttpsAgent,
          validateStatus: (status) => status >= 200 && status < 400
        });

        res.setHeader("Content-Type", retryResponse.headers["content-type"] || "image/jpeg");
        res.setHeader("Access-Control-Allow-Origin", "*");
        retryResponse.data.pipe(res);
        return;
      } catch (retryErr) {
        console.error("[Proxy Instagram] Retry failed:", retryErr.message);
      }
    }
    
    if (!res.headersSent) {
      res.status(err.response?.status || 500).json({ 
        error: "Gagal mengambil foto Instagram",
        details: err.message 
      });
    }
  }
});

/**
 * GET /api/proxy?url=...&filename=...
 *
 * Proxy untuk download media dari CDN platform.
 * Diperlukan karena CDN platform menolak request langsung dari browser
 * (CORS + Referer check). Server kita yang mengambil lalu meneruskan ke client.
 *
 * Parameter opsional:
 *   filename — nama file untuk header Content-Disposition
 */
app.get("/api/proxy", async (req, res) => {
  const { url, filename } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Parameter url diperlukan" });
  }

  // Jika URL adalah file lokal (dari yt-dlp), serve langsung dari filesystem
  // Support: relative URL (/temp/xxx.mp4) dan absolute URL (http://localhost:3000/temp/xxx.mp4)
  const isLocalFile = url.startsWith('/temp/') || (() => {
    try { const u = new URL(url); return u.hostname === 'localhost' || u.hostname === '127.0.0.1'; } catch { return false; }
  })();
  
  if (isLocalFile) {
    const localPath = url.startsWith('/temp/') ? url : (() => { try { return new URL(url).pathname; } catch { return ''; } })();
    if (localPath.startsWith('/temp/')) {
      const filePath = path.join(__dirname, 'temp_downloads', path.basename(localPath));
      if (require('fs').existsSync(filePath)) {
        const fn = filename || path.basename(filePath);
        res.setHeader('Content-Disposition', `attachment; filename="${fn}"`);
        res.setHeader('Content-Type', 'video/mp4');
        return require('fs').createReadStream(filePath).pipe(res);
      } else {
        return res.status(404).json({ error: "File tidak ditemukan" });
      }
    }
  }

  // Validasi domain CDN dengan parsing URL yang aman
  if (!isAllowedCdnUrl(url)) {
    return res.status(403).json({ error: "Domain tidak diizinkan" });
  }

  // Batas ukuran file: 500 MB
  const MAX_FILE_SIZE = 500 * 1024 * 1024;

  // Tentukan Referer yang sesuai berdasarkan CDN
  const referer = getRefererForCdn(url);
  const origin = referer.replace(/\/$/, "");

  try {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,audio/*,*/*;q=0.8",
      Referer: referer,
    };

    // Pinterest & TikTok CDN sering menolak header Origin
    const isPinterest = url.includes('pinimg') || url.includes('pinterest');
    const isTikTok = url.includes('tiktok') || url.includes('tikwm') || url.includes('musical') || url.includes('byteoversea') || url.includes('ibytedtos') || url.includes('muscdn');
    if (!isPinterest && !isTikTok) {
      headers.Origin = origin;
    }

    // Forward Range header to support IDM & multi-threaded downloads
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    // Fungsi helper untuk fetch dengan headers tertentu
    async function fetchFromCdn(fetchHeaders) {
      return axios.get(url, {
        responseType: "stream",
        headers: fetchHeaders,
        timeout: 300000,
        maxRedirects: 5,
        decompress: false,
        httpsAgent: laxHttpsAgent,
        validateStatus: (status) => status >= 200 && status < 400,
        beforeRedirect: (options) => {
          const redirectHost = options.hostname.toLowerCase();
          if (redirectHost.includes('internet-positif') || redirectHost.includes('trustpositif')) {
            console.warn(`[Proxy] Redirect ke halaman blokir ISP: ${redirectHost}`);
          }
          const redirectUrl = `${options.protocol}//${options.hostname}${options.path}`;
          if (!isAllowedCdnUrl(redirectUrl) && !redirectHost.includes('pinterest') && !redirectHost.includes('pinimg')) {
            console.warn(`[Proxy] Redirect ke domain tak dikenal: ${redirectHost}`);
          }
        },
      });
    }

    let response;
    try {
      response = await fetchFromCdn(headers);
    } catch (firstErr) {
      // Jika 403, coba ulang tanpa Referer & Origin (beberapa CDN menolak header tersebut)
      if (firstErr.response && firstErr.response.status === 403) {
        console.warn(`[Proxy] 403 dari CDN, retry tanpa Referer/Origin...`);
        try {
          const minimalHeaders = {
            "User-Agent": headers["User-Agent"],
            "Accept": headers["Accept"],
          };
          if (req.headers.range) minimalHeaders.Range = req.headers.range;
          response = await fetchFromCdn(minimalHeaders);
        } catch (retryErr) {
          // Jika masih gagal, coba satu kali lagi tanpa header sama sekali
          console.warn(`[Proxy] Retry juga gagal (${retryErr.response?.status || retryErr.message}), mencoba tanpa header...`);
          try {
            response = await fetchFromCdn({
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            });
          } catch (finalErr) {
            throw finalErr;
          }
        }
      } else {
        throw firstErr;
      }
    }

    let contentType =
      response.headers["content-type"] || "application/octet-stream";
    const contentLength = response.headers["content-length"];

    // Deteksi halaman blokir ISP: jika CDN merespon HTML, redirect client langsung
    if ((url.includes('videy.co') || url.includes('videy.llc') || url.includes('videy.it') || url.includes('vizey.de') || url.includes('slicidrive.de') || url.includes('bokepbox')) && contentType.includes('text/html')) {
      console.warn(`[Proxy] CDN merespon HTML (blokir ISP), redirect client`);
      response.data.destroy();
      return res.redirect(302, url);
    }

    // Jika CDN tidak mengembalikan Content-Type video yang jelas, tebak dari ekstensi URL
    if (contentType === 'application/octet-stream' || contentType === 'binary/octet-stream') {
      if (url.match(/\.(mp4|webm|mkv|mov|avi)$/i)) contentType = 'video/mp4';
      else if (url.match(/\.(mp3|m4a|aac|ogg|wav)$/i)) contentType = 'audio/mpeg';
      else if (url.match(/\.(jpg|jpeg|png|webp|gif|avif)$/i)) contentType = 'image/jpeg';
    }

    // Tolak file yang terlalu besar (abaikan cek ini untuk request berformat Range)
    if (!req.headers.range && contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) {
      response.data.destroy();
      return res.status(413).json({ error: "File terlalu besar (maks 500 MB)" });
    }

    res.status(response.status); // Teruskan 200 OK atau 206 Partial Content
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

    if (contentLength) res.setHeader("Content-Length", contentLength);
    // Untuk preview (inline), selalu izinkan range requests agar browser bisa seek video
    if (req.query.inline === "true") {
      res.setHeader("Accept-Ranges", "bytes");
    } else if (response.headers["accept-ranges"]) {
      res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
    }
    if (response.headers["content-range"]) res.setHeader("Content-Range", response.headers["content-range"]);

    // Tentukan ekstensi dari content-type
    let ext = "bin";
    if (contentType.includes("video")) ext = "mp4";
    else if (contentType.includes("audio")) ext = "mp3";
    else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
    else if (contentType.includes("png")) ext = "png";
    else if (contentType.includes("webp")) ext = "webp";
    else if (contentType.includes("webm")) ext = "webm";

    if (req.query.inline === "true") {
      res.setHeader("Content-Disposition", "inline");
    } else {
      const safeFilename = filename
        ? filename.replace(/[^a-zA-Z0-9_.-]/g, "_")
        : `media_${Date.now()}.${ext}`;

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename}"`
      );
    }

    // Stream langsung ke client — tidak disimpan di server
    response.data.pipe(res);

    // Mencegah crash jika stream terputus di tengah jalan
    response.data.on('error', (err) => {
      console.error('[Proxy] Stream error:', err.message);
      if (!res.headersSent) res.status(500).end();
    });

    // Batalkan stream jika pengguna membatalkan unduhan
    req.on('close', () => {
      response.data.destroy();
    });
  } catch (err) {
    console.error("[Proxy] Error:", err.message);
    if (!res.headersSent) {
      // CDN terkena blokir ISP (Internet Positif) — redirect client langsung ke CDN
      if (url.includes('videy.co') || url.includes('videy.llc') || url.includes('videy.it') || url.includes('vizey.de') || url.includes('slicidrive.de') || url.includes('bokepbox')) {
        console.warn(`[Proxy] CDN diblokir ISP, redirect client ke ${url}`);
        return res.redirect(302, url);
      }
      res.status(500).json({ error: "Gagal mengambil file media dari CDN" });
    }
  }
});

/**
 * GET /api/health
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ═══════════ BUG REPORT & ADMIN SECURE API ═══════════
const ADMIN_PASSWORD = "admin123";
const FB_API_KEY = "AIzaSyAcNTgthf-5EScESrq8nQz9jgn1m3k3d3Y";
const FB_PROJECT_ID = "hallo-88de1";

app.post('/api/report', async (req, res) => {
  try {
    const { url, description } = req.body;
    if (!url || !description) return res.status(400).json({ error: "Data tidak lengkap" });

    const payload = {
      fields: {
        url: { stringValue: url },
        description: { stringValue: description },
        status: { stringValue: "pending" },
        createdAt: { timestampValue: new Date().toISOString() },
        userAgent: { stringValue: req.headers['user-agent'] || "" }
      }
    };

    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT_ID}/databases/(default)/documents/reports?key=${FB_API_KEY}`;
    await axios.post(firestoreUrl, payload);
    
    res.json({ success: true });
  } catch (err) {
    console.error("[Report] Error:", err.message);
    res.status(500).json({ error: "Gagal menyimpan laporan" });
  }
});

app.post('/api/admin/reports', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });

  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT_ID}/databases/(default)/documents/reports?key=${FB_API_KEY}`;
    const fbRes = await axios.get(firestoreUrl);
    
    let reports = [];
    if (fbRes.data && fbRes.data.documents) {
      reports = fbRes.data.documents.map(doc => {
        const id = doc.name.split('/').pop();
        const fields = doc.fields || {};
        return {
          id,
          url: fields.url?.stringValue || "",
          description: fields.description?.stringValue || "",
          status: fields.status?.stringValue || "",
          createdAt: fields.createdAt?.timestampValue || "",
          userAgent: fields.userAgent?.stringValue || ""
        };
      }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    
    res.json({ success: true, reports });
  } catch (err) {
    console.error("[Admin] Error loading reports:", err.message);
    res.status(500).json({ error: "Gagal memuat laporan" });
  }
});

app.post('/api/admin/reports/resolve/:id', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });

  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT_ID}/databases/(default)/documents/reports/${req.params.id}?updateMask.fieldPaths=status&key=${FB_API_KEY}`;
    const payload = { fields: { status: { stringValue: "resolved" } } };
    await axios.patch(firestoreUrl, payload);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: "Gagal update" });
  }
});

app.delete('/api/admin/reports/:id', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });

  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT_ID}/databases/(default)/documents/reports/${req.params.id}?key=${FB_API_KEY}`;
    await axios.delete(firestoreUrl);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: "Gagal delete" });
  }
});

// Fallback: serve index.html (SPA)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start ───────────────────────────────────────────────────────────────────

function startServer(port, retried = false) {
  const server = app.listen(port, async () => {
    try {
      const ytdlpOk = await checkYtDlp();
      const platformList = Object.values(PLATFORMS).map((p) => `${p.icon} ${p.name}`).join(" | ");
      console.log(`\n✅ Server berjalan di http://localhost:${port}`);
      console.log(`🔧 yt-dlp: ${ytdlpOk ? "✅ Terdeteksi" : "❌ Tidak ditemukan — install dengan: pip install yt-dlp"}`);
      console.log(`🌐 Platform: ${platformList}`);
      console.log(`📥 API: POST http://localhost:${port}/api/fetch`);
      console.log(`🔁 Proxy: GET http://localhost:${port}/api/proxy?url=...\n`);
    } catch (err) {
      console.error("[Startup] Gagal cek yt-dlp:", err.message);
      console.log(`\n✅ Server berjalan di http://localhost:${port}`);
      console.log(`🔧 yt-dlp: ⚠️ Tidak bisa dicek\n`);
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && !retried) {
      console.log(`⚠️  Port ${port} sedang dipakai. Mencoba mematikan proses lama...`);
      const { exec } = require("child_process");
      // Cari PID yang memakai port lalu kill
      exec(`netstat -ano | findstr :${port}`, (e, stdout) => {
        if (stdout) {
          const lines = stdout.trim().split("\n");
          const pids = new Set();
          lines.forEach((line) => {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== "0" && pid !== String(process.pid)) pids.add(pid);
          });
          if (pids.size > 0) {
            const pidList = [...pids].join(" /PID ");
            exec(`taskkill /F /PID ${pidList}`, (killErr) => {
              if (!killErr) {
                console.log(`✅ Proses lama (PID: ${[...pids].join(", ")}) berhasil dimatikan.`);
                setTimeout(() => startServer(port, true), 1000);
              } else {
                console.error(`❌ Gagal mematikan proses: ${killErr.message}`);
                process.exit(1);
              }
            });
          } else {
            console.error("❌ Tidak bisa menemukan PID yang memakai port.");
            process.exit(1);
          }
        } else {
          console.error("❌ Tidak bisa mendeteksi proses di port tersebut.");
          process.exit(1);
        }
      });
    } else {
      console.error(`❌ Server error: ${err.message}`);
      process.exit(1);
    }
  });
}

startServer(PORT);


module.exports = app;
