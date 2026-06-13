/**
 * Server Utama — MediaGet v3 (Multi-Platform Downloader)
 * Mendukung: Instagram, TikTok, YouTube, Facebook
 * Express.js + yt-dlp backend
 */

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { scrapeMedia, scrapeTikTokStoriesByUsername, detectPlatform, isInstagramStoryUrl, checkYtDlp, PLATFORMS } = require("./scraper");

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
      /\.musical\.ly$/,
      /\.tiktokv\.com$/,
      /\.byteoversea\.com$/,
      /\.ibytedtos\.com$/,
      /\.muscdn\.com$/,
      /\.tikwm\.com$/,
      /^v[\d]*[\w-]*\.tiktokcdn\.com$/,
      /^p[\d]*[\w-]*\.tiktokcdn\.com$/,        // p16-xxx.tiktokcdn.com (image CDN)
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
      // Local server (for yt-dlp downloaded files)
      /^localhost$/,
      /^127\.0\.0\.1$/,
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
    if (host.includes("pinimg")) {
      return "https://www.pinterest.com/";
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
 * GET /api/extract-audio?url=...
 * Ekstrak audio dari video menggunakan ffmpeg dan kirim sebagai mp3
 */
app.get("/api/extract-audio", async (req, res) => {
  const { url, filename } = req.query;
  if (!url) return res.status(400).send("URL required");

  // Validasi URL
  if (!isAllowedCdnUrl(url)) {
    return res.status(403).json({ error: "Domain tidak diizinkan" });
  }

  const outName = filename ? filename.replace(/\.(mp4|webm|jpg|png)/, '.mp3') : "extracted_audio.mp3";

  res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
  res.setHeader("Content-Type", "audio/mpeg");

  const referer = getRefererForCdn(url);
  const { spawn } = require('child_process');
  
  const ffmpeg = spawn('ffmpeg', [
    '-headers', `Referer: ${referer}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n`,
    '-i', url,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-f', 'mp3',
    'pipe:1'
  ]);

  ffmpeg.stdout.pipe(res);

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
  const { videoUrl, audioUrl, filename, stream } = req.query;
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

    if (cancelled) return;
    console.log(`[merge-video] Downloading video: ${videoUrl.substring(0, 80)}...`);
    const videoResp = await axios({ method: 'get', url: videoUrl, responseType: 'stream', headers, timeout: 60000 });
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
    const audioResp = await axios({ method: 'get', url: audioUrl, responseType: 'stream', headers, timeout: 60000 });
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

  // Sanitasi: hanya izinkan karakter aman untuk videoId dan formatId
  const safeVideoId = videoId.replace(/[^a-zA-Z0-9_\-]/g, '');
  const safeFormatId = formatId.replace(/[^a-zA-Z0-9_\-+.%]/g, '');

  if (!safeVideoId || !safeFormatId) {
    return res.status(400).json({ error: "videoId atau formatId tidak valid" });
  }

  const cleanUrl = `https://www.youtube.com/watch?v=${safeVideoId}`;
  const isAudio = asAudio === '1' || asAudio === 'true';

  // Argumen yt-dlp standar
  const ytdlpBaseArgs = [
    "--no-warnings",
    "--no-playlist",
    "--extractor-args", "youtube:player_client=tv_embedded;player_skip=webpage",
    "--no-check-certificates",
    "--extractor-retries", "3",
    "--sleep-interval", "2",
    "--max-sleep-interval", "5",
  ];

  const { spawn } = require('child_process');

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
    // ─── Coba yt-dlp dulu, deteksi 403 dari stderr ────────────────────────────
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
        // yt-dlp kena 403 — coba Invidious/Piped
        console.log(`[YT-Download] yt-dlp 403, fallback ke Invidious/Piped...`);
        if (!res.headersSent) {
          const ok = await tryInvidiousFallback(res, safeVideoId, isAudio);
          if (!ok) {
            if (!res.headersSent) res.status(502).json({ error: "Semua metode download gagal (yt-dlp 403, Invidious/Piped tidak tersedia)" });
          }
        }
      }
    }).catch(async (err) => {
      console.warn(`[YT-Download] yt-dlp error: ${err.message.substring(0, 150)}`);
      // Jika error mengandung 403 atau error umum, coba fallback
      if (!res.headersSent) {
        console.log(`[YT-Download] Mencoba fallback Invidious/Piped...`);
        const ok = await tryInvidiousFallback(res, safeVideoId, isAudio);
        if (!ok && !res.headersSent) {
          res.status(502).json({ error: "Download gagal: " + err.message.substring(0, 100) });
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
        validateStatus: (status) => status >= 200 && status < 400,
        beforeRedirect: (options) => {
          const redirectUrl = `${options.protocol}//${options.hostname}${options.path}`;
          const redirectHost = options.hostname.toLowerCase();
          if (!isAllowedCdnUrl(redirectUrl) && !redirectHost.includes('pinterest') && !redirectHost.includes('pinimg')) {
            throw new Error("Redirect ke domain yang tidak diizinkan");
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

    const contentType =
      response.headers["content-type"] || "application/octet-stream";
    const contentLength = response.headers["content-length"];

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
    if (response.headers["accept-ranges"]) res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
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
