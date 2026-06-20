/**
 * Media Scraper Module — v3 (Multi-Platform)
 * Mendukung: Instagram, TikTok, YouTube, Facebook
 * Menggunakan yt-dlp sebagai engine utama (andal & selalu diupdate)
 * dengan fallback ke oEmbed untuk Instagram.
 */

const { execFile, exec } = require("child_process");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const Tiktok = require("@tobyg74/tiktok-api-dl");

// Default headers untuk Instagram GraphQL
const IG_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IG_APP_ID = "936619743392459"; // Instagram Web App ID (public)

// ─── Platform Detection ─────────────────────────────────────────────────────

/**
 * Daftar platform yang didukung beserta pola URL-nya.
 */
const PLATFORMS = {
  instagram: {
    name: "Instagram",
    icon: "📸",
    hostPatterns: [/^(www\.)?instagram\.com$/],
    pathPatterns: [
      /\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/,
      /\/stories\/[\w.]+/,  // Instagram Stories
    ],
    requiresPath: true,  // harus punya path valid
  },
  tiktok: {
    name: "TikTok",
    icon: "🎵",
    hostPatterns: [
      /^(www\.)?tiktok\.com$/,
      /^vm\.tiktok\.com$/,           // short link
      /^vt\.tiktok\.com$/,           // short link variant
      /^m\.tiktok\.com$/,
    ],
    pathPatterns: [
      /\/@[\w.]+\/video\/(\d+)/,     // @user/video/1234
      /\/v\/(\d+)/,                  // /v/1234
      /^\/[A-Za-z0-9]+$/,           // short link /ZMxxxxxx
    ],
    requiresPath: false,
  },
  youtube: {
    name: "YouTube",
    icon: "▶️",
    hostPatterns: [
      /^(www\.)?youtube\.com$/,
      /^m\.youtube\.com$/,
      /^youtu\.be$/,
      /^music\.youtube\.com$/,
    ],
    pathPatterns: [
      /\/watch\?/,                   // /watch?v=xxx
      /\/shorts\/[\w-]+/,           // /shorts/xxx
      /^\/[\w-]{11}$/,              // youtu.be/xxx (11 char ID)
    ],
    requiresPath: false,
  },
  facebook: {
    name: "Facebook",
    icon: "👤",
    hostPatterns: [
      /^(www\.)?facebook\.com$/,
      /^m\.facebook\.com$/,
      /^web\.facebook\.com$/,
      /^fb\.watch$/,                 // short video links
      /^(www\.)?fb\.com$/,
    ],
    pathPatterns: [
      /\/(watch|videos|reel|share)\//,
      /\/posts\//,
      /\/photo/,
      /\/story\.php/,
      /^\/[\w.]+\/videos\//,
      /^\/\w+$/,                     // fb.watch/xxx
    ],
    requiresPath: false,
  },
  twitter: {
    name: "Twitter",
    icon: "🐦",
    hostPatterns: [
      /^(www\.)?twitter\.com$/,
      /^(www\.)?x\.com$/,
    ],
    pathPatterns: [/\/status\/\d+/],
    requiresPath: true,
  },
  spotify: {
    name: "Spotify",
    icon: "🎧",
    hostPatterns: [/^open\.spotify\.com$/],
    pathPatterns: [/\/track\/[a-zA-Z0-9]+/],
    requiresPath: true,
  },
  pinterest: {
    name: "Pinterest",
    icon: "📌",
    hostPatterns: [
      /^(www\.)?pinterest\.(com|co\.uk|de|fr|es|it|ca|com\.au|co\.kr|jp|at|ch|com\.mx|pt|se|nz|ph|ie|cl|co\.in)$/,
      /^pin\.it$/,
      /^(www\.)?pinterest\.\w+$/,
    ],
    pathPatterns: [
      /\/pin\/\d+/,
      /^\/[a-zA-Z0-9]+$/, // for pin.it shortlinks
    ],
    requiresPath: false,
  },
  threads: {
    name: "Threads",
    icon: "🧵",
    hostPatterns: [
      /^(www\.)?threads\.net$/,
      /^(www\.)?threads\.com$/,
    ],
    pathPatterns: [
      /\/@[\w.]+\/post\/[\w-]+/,
    ],
    requiresPath: true,
  },
  viday: {
    name: "Viday",
    icon: "🎬",
    hostPatterns: [
      /^(www\.)?viday\.de$/,
    ],
    pathPatterns: [],
    requiresPath: false,
  },
  videy: {
    name: "Videy",
    icon: "🎬",
    hostPatterns: [
      /^(www\.)?videy\.(co|llc|it)$/,
      /^(www\.)?vihey\.(co|llc)$/,
      /^cdn2\.vihey\.co$/,
      /^cdn2\.videy\.it$/,
    ],
    pathPatterns: [],
    requiresPath: false,
  },
  bokepbox: {
    name: "Bokepbox",
    icon: "🎬",
    hostPatterns: [
      /(^|\.)bokepbox\.media$/,
      /(^|\.)bokepbox\.tv$/,
    ],
    pathPatterns: [],
    requiresPath: false,
  },
  vizey: {
    name: "Vizey",
    icon: "🎬",
    hostPatterns: [
      /^cdn2\.vizey\.de$/,
    ],
    pathPatterns: [],
    requiresPath: false,
  },
  slicidrive: {
    name: "Slicidrive",
    icon: "🎬",
    hostPatterns: [
      /^cdn2\.slicidrive\.de$/,
    ],
    pathPatterns: [],
    requiresPath: false,
  },
  ucweb: {
    name: "UC Drive",
    icon: "☁️",
    hostPatterns: [
      /^(www\.)?drive\.ucweb\.com$/,
      /^(www\.)?drive\.uc\.cn$/,
      /^m-intldrive\.ucweb\.com$/,
      /^(www\.)?uc-share\.com$/,
    ],
    pathPatterns: [/\/s\//],
    requiresPath: true,
  },
};

/**
 * Deteksi platform dari URL.
 * @returns {{ platform: string, config: object } | null}
 */
function detectPlatform(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();

    for (const [key, config] of Object.entries(PLATFORMS)) {
      const hostMatch = config.hostPatterns.some((pat) => pat.test(host));
      if (hostMatch) {
        // Kalau platform butuh path validation
        if (config.requiresPath) {
          const fullPath = parsed.pathname + parsed.search;
          const pathMatch = config.pathPatterns.some((pat) => pat.test(fullPath));
          if (!pathMatch) return null;
        }
        return { platform: key, config };
      }
    }
  } catch {
    // URL tidak valid
  }
  return null;
}
// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Memilih satu file .txt secara acak dari folder cookies/
 * Jika folder tidak ada atau tidak ada file .txt, return null
 */
function getRandomCookieFile() {
  const fs = require('fs');
  const path = require('path');
  const cookiesDir = path.join(__dirname, 'cookies');
  
  try {
    if (!fs.existsSync(cookiesDir)) return null;
    
    const files = fs.readdirSync(cookiesDir).filter(f => f.endsWith('.txt'));
    if (files.length === 0) return null;
    
    // Railway: prefer railway_cookie.txt (dibuat dari env var IG_COOKIE/IG_COOKIE_BASE64)
    if (files.includes('railway_cookie.txt')) {
      console.log(`[Scraper] Menggunakan file cookies: railway_cookie.txt`);
      return path.join(cookiesDir, 'railway_cookie.txt');
    }
    
    // Fallback: pilih file .txt lain (untuk development lokal)
    const chosenFile = files[0];
    const fullPath = path.join(cookiesDir, chosenFile);
    console.log(`[Scraper] Menggunakan file cookies: ${chosenFile}`);
    return fullPath;
  } catch (err) {
    console.warn("[Scraper] Gagal membaca folder cookies:", err.message);
    return null;
  }
}

/**
 * Cek apakah URL adalah Instagram Story URL.
 */
function isInstagramStoryUrl(url) {
  return /instagram\.com\/stories\//i.test(url);
}

function extractShortcode(url) {
  const patterns = [
    /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/reels\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/stories\/[\w.]+\/([A-Za-z0-9_-]+)/,  // story ID
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

function runCommand(cmd, args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    // Gabungkan cmd dan args menjadi satu string untuk dijalankan melalui shell.
    // Ini diperlukan di Windows agar Python Scripts (yt-dlp) bisa ditemukan via PATH.
    const fullCmd = [cmd, ...args.map(a => `"${a}"`)].join(' ');
    let settled = false;

    const proc = exec(fullCmd, { timeout, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (settled) return;
      settled = true;
      if (err) {
        if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
          return reject(new Error(`Command timeout setelah ${Math.round(timeout / 1000)} detik`));
        }
        return reject(new Error(stderr || err.message));
      }
      resolve(stdout.trim());
    });

    // Safety net: jika callback tidak terpanggil setelah timeout + 5 detik
    const safetyTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { proc.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`Command timeout (safety) setelah ${Math.round(timeout / 1000)} detik`));
      }
    }, timeout + 5000);

    // Bersihkan timer jika proses selesai normal
    proc.on('exit', () => clearTimeout(safetyTimeout));
  });
}

// ─── Cek apakah yt-dlp tersedia ─────────────────────────────────────────────

async function checkYtDlp() {
  try {
    await runCommand("yt-dlp", ["--version"], 5000);
    return true;
  } catch {
    return false;
  }
}

// ─── yt-dlp scraping (multi-platform) ───────────────────────────────────────

/**
 * Menggunakan yt-dlp --dump-json untuk mengambil semua metadata
 * tanpa mengunduh file. yt-dlp menangani semua seluk-beluk setiap platform
 * (cookie, header, rotasi endpoint) secara otomatis.
 *
 * @param {string} url - URL media
 * @param {string} platform - Nama platform (instagram, tiktok, youtube, facebook)
 */
async function scrapeViaYtDlp(url, platform = "instagram") {
  console.log(`[Scraper] Mencoba yt-dlp untuk ${platform}...`);

  // Spotify Intercept: Fetch title then search on YouTube
  let targetUrl = url;
  if (platform === "spotify") {
    console.log(`[Scraper] Intercepting Spotify URL untuk mendapatkan judul...`);
    try {
      const spRes = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      const titleMatch = spRes.data.match(/<title>(.*?)<\/title>/);
      if (titleMatch && titleMatch[1]) {
        let title = titleMatch[1];
        // Bersihkan title, misal: "Nama Lagu - song and lyrics by Artis | Spotify"
        title = title.replace(/ - song and lyrics by /i, " ");
        title = title.replace(/ \| Spotify/i, "");
        console.log(`[Scraper] Spotify Title ditemukan: ${title}`);
        targetUrl = `ytsearch1:${title}`;
      } else {
        throw new Error("Tidak dapat menemukan judul lagu dari Spotify.");
      }
    } catch (e) {
      throw new Error("Gagal mengambil metadata Spotify: " + e.message);
    }
  }

  const args = [
    "--dump-single-json",
    "--no-warnings",
  ];

  // Deteksi apakah URL mengarah ke Playlist / Profil
  const isPlaylist = url.match(/(\/user\/|\/c\/|\/channel\/|@|list=|playlist\/|\/collection\/)/i) !== null;
  
  if (isPlaylist) {
    console.log(`[Scraper] Mendeteksi URL Playlist/Profil. Mengambil maksimal 10 video...`);
    args.push("--yes-playlist");
    args.push("--playlist-end", "10"); 
  } else {
    args.push("--no-playlist");
  }

  // Argumen spesifik per platform
  switch (platform) {
    case "instagram":
      args.push("--extractor-args", "instagram:direct_video_url=true");
      break;

    case "youtube":
      args.push("--extractor-args", "youtube:player_client=mediaconnect,tv_embedded,ios,android,mweb;player_skip=webpage");
      args.push("--extractor-retries", "5");
      break;

    case "tiktok":
      args.push("--add-header", "User-Agent:Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");
      break;

    case "facebook":
    case "twitter":
    case "pinterest":
      break;
      
    case "spotify":
      args.push("-f", "bestaudio[ext=m4a]/bestaudio/best");
      break;
  }

  args.push(targetUrl);

  // YouTube/Facebook mungkin butuh waktu lebih lama
  const timeout = (platform === "youtube" || platform === "facebook") ? 90000 : 60000;
  const raw = await runCommand("yt-dlp", args, timeout);
  const info = JSON.parse(raw);

  return parseYtDlpOutput(info, platform);
}

/**
 * Konversi output yt-dlp ke format internal yang dipakai server & frontend
 */
function parseYtDlpOutput(info, platform = "instagram") {
  const result = {
    platform,
    type: "unknown",
    shortcode: info.id || "",
    author: info.uploader || info.channel || info.creator || "unknown",
    caption: info.description || info.title || "",
    title: info.title || "",
    timestamp: info.timestamp || null,
    likeCount: info.like_count || 0,
    commentCount: info.comment_count || 0,
    viewCount: info.view_count || 0,
    duration: info.duration || null,
    mediaItems: [],
    source: "ytdlp",
  };

  // Carousel/playlist: yt-dlp mengembalikan field "entries"
  if (info.entries && info.entries.length > 0) {
    result.type = "playlist";
    result.mediaItems = info.entries.map((entry) =>
      extractMediaItem(entry)
    ).filter(item => item.url && item.url.length > 0);
    console.log(`[yt-dlp] ${info.entries.length} entries → ${result.mediaItems.length} valid items (${result.mediaItems.filter(m => m.type === 'video').length} video, ${result.mediaItems.filter(m => m.type === 'image').length} foto)`);
  }
  // Single video/photo
  else {
    const item = extractMediaItem(info);
    result.type = item.type === "video" ? "video" : "image";
    result.mediaItems = [item];
  }

  return result;
}

/**
 * Ekstrak URL terbaik dari satu entry yt-dlp
 * Prioritas: format kualitas tertinggi → url langsung → thumbnail
 */
function extractMediaItem(entry) {
  // ─── Deteksi video vs foto yang lebih akurat ───
  // Instagram story foto sering dikembalikan dengan ext="mp4" oleh yt-dlp,
  // tapi TIDAK memiliki video codec. Gunakan heuristic berlapis:
  const hasRealVideoCodec = entry.formats && entry.formats.some((f) => 
    f.vcodec && f.vcodec !== "none" && f.vcodec !== "null"
  );

  // Cek URL patterns yang menandakan gambar (Instagram CDN)
  const urlStr = (entry.url || '').toLowerCase();
  const thumbStr = (entry.thumbnail || '').toLowerCase();
  const isImageUrl = /\.(jpg|jpeg|png|webp|heic)(\?|$)/i.test(urlStr) ||
    urlStr.includes('39594192945134_n') || urlStr.includes('41594189195273_n') ||
    urlStr.includes('409880325290822_n');

  // Keputusan akhir: hanya anggap video jika ADA codec video asli
  // ATAU ext video + URL bukan gambar
  const isVideo = hasRealVideoCodec ||
    ((entry.ext === "mp4" || entry.ext === "webm") && !isImageUrl);

  // ─── Thumbnail resolusi tertinggi (untuk foto fallback) ───
  let bestThumbnail = entry.thumbnail || null;
  if (entry.thumbnails && entry.thumbnails.length > 0) {
    const sorted = [...entry.thumbnails].sort((a, b) => (b.width || b.preference || 0) - (a.width || a.preference || 0));
    bestThumbnail = sorted[0].url || sorted[0];
  }

  // ─── Penanganan khusus FOTO ───
  if (!isVideo) {
    // Prioritas: entry.url > thumbnail resolusi tinggi > formats image
    let imageUrl = null;

    // 1. Jika URL adalah gambar, gunakan langsung
    if (isImageUrl) {
      imageUrl = entry.url;
    }

    // 2. Fallback ke thumbnail resolusi tinggi (Instagram story photo = thumbnail = foto asli)
    if (!imageUrl && bestThumbnail) {
      imageUrl = bestThumbnail;
    }

    // 3. Jika masih kosong, gunakan entry.url apa adanya
    if (!imageUrl && entry.url) {
      imageUrl = entry.url;
    }

    // 4. Cek formats untuk gambar
    if (!imageUrl && entry.formats && entry.formats.length > 0) {
      const imgFormats = entry.formats.filter(
        (f) => f.url && (
          f.ext === 'jpg' || f.ext === 'jpeg' || f.ext === 'png' || f.ext === 'webp' ||
          (f.vcodec === 'none' && f.acodec === 'none')
        )
      );
      if (imgFormats.length > 0) {
        imgFormats.sort((a, b) => (b.width || 0) - (a.width || 0));
        imageUrl = imgFormats[0].url;
      }
    }

    // Tentukan ekstensi dari URL
    let imgExt = 'jpg';
    if (imageUrl) {
      if (imageUrl.includes('.png')) imgExt = 'png';
      else if (imageUrl.includes('.webp')) imgExt = 'webp';
      else if (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg')) imgExt = 'jpg';
      else imgExt = entry.ext === 'jpg' || entry.ext === 'png' ? entry.ext : 'jpg';
    }

    const finalUrl = imageUrl || bestThumbnail || entry.url || "";
    const thumb = bestThumbnail || finalUrl;

    const availableFormats = [];
    if (finalUrl) {
      availableFormats.push({
        type: 'image',
        quality: 'Original',
        url: finalUrl,
        ext: imgExt
      });
    }

    return {
      type: "image",
      url: finalUrl,
      thumbnail: thumb,
      width: entry.width || null,
      height: entry.height || null,
      duration: null,
      ext: imgExt,
      formats: availableFormats
    };
  }

  // ─── Penanganan VIDEO ───
  let bestUrl = entry.url;
  const availableFormats = [];

  if (entry.formats && entry.formats.length > 0) {
    // Helper: cek protocol http(s)
    const isHttp = (f) => f.protocol && f.protocol.startsWith('http');
    // Helper: cek vcodec valid (bukan none/null/undefined)
    const hasVid = (f) => f.vcodec && f.vcodec !== "none" && f.vcodec !== "null";
    // Helper: cek acodec valid
    const hasAud = (f) => f.acodec && f.acodec !== "none" && f.acodec !== "null";

    // 1. Format dengan video+audio dalam satu file (muxed) - PRIORITAS UTAMA
    const muxedFormats = entry.formats.filter(f => hasVid(f) && hasAud(f) && f.url && isHttp(f));
    if (muxedFormats.length > 0) {
      muxedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
      bestUrl = muxedFormats[0].url;
      console.log(`[Scraper] ✓ Video dengan audio terpilih: ${muxedFormats[0].format_id || 'unknown'} (${muxedFormats[0].height || '?'}p)`);
      const seenRes = new Set();
      muxedFormats.forEach(f => {
        const res = f.height ? `${f.height}p` : 'HD';
        if (!seenRes.has(res)) {
          seenRes.add(res);
          availableFormats.push({ type: 'video', quality: res, url: f.url, ext: f.ext || 'mp4' });
        }
      });
    }

    // 2. Video-only formats (DASH: perlu merge dengan audio)
    const videoOnlyFormats = entry.formats.filter(f => hasVid(f) && !hasAud(f) && f.url && isHttp(f));
    const audioOnlyFormats = entry.formats.filter(f => !hasVid(f) && hasAud(f) && f.url && isHttp(f));

    let bestAudioUrl = null;
    if (audioOnlyFormats.length > 0) {
      audioOnlyFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
      bestAudioUrl = audioOnlyFormats[0].url;
      availableFormats.push({
        type: 'audio', quality: 'Audio', url: audioOnlyFormats[0].url,
        ext: audioOnlyFormats[0].ext === 'm4a' ? 'm4a' : 'mp3'
      });
    }

    // Jika ada video-only formats, tambahkan dengan flag needsMerge
    if (videoOnlyFormats.length > 0) {
      videoOnlyFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
      const seenRes = new Set(availableFormats.filter(f => f.type === 'video').map(f => f.quality));
      videoOnlyFormats.forEach(f => {
        const res = f.height ? `${f.height}p` : 'HD';
        if (!seenRes.has(res)) {
          seenRes.add(res);
          availableFormats.push({
            type: 'video', quality: res, url: f.url, ext: f.ext || 'mp4',
            needsMerge: bestAudioUrl ? true : false,
            audioUrl: bestAudioUrl || null
          });
        }
      });

      // PERBAIKAN: Jika TIDAK ADA format muxed (video tanpa audio), WAJIB gunakan merge
      if (muxedFormats.length === 0 && videoOnlyFormats.length > 0) {
        if (bestAudioUrl) {
          // Ada audio track terpisah, gunakan video tertinggi + merge flag
          bestUrl = videoOnlyFormats[0].url;
          console.log(`[Scraper] ⚠️ Video TANPA audio! Akan di-merge: video=${videoOnlyFormats[0].format_id || 'unknown'} + audio=${audioOnlyFormats[0].format_id || 'unknown'}`);
        } else {
          // Tidak ada audio sama sekali - video memang silent
          bestUrl = videoOnlyFormats[0].url;
          console.log(`[Scraper] ℹ️ Video silent (tanpa audio track)`);
        }
      }
    }

    // 3. Fallback: format apapun yang punya URL (JANGAN GUNAKAN INI untuk video normal)
    if (!bestUrl) {
      const anyWithUrl = entry.formats.filter(f => f.url && isHttp(f));
      if (anyWithUrl.length > 0) {
        anyWithUrl.sort((a, b) => (b.height || b.width || 0) - (a.height || a.width || 0));
        bestUrl = anyWithUrl[0].url;
        console.log(`[Scraper] ⚠️ Fallback ke format apapun: ${anyWithUrl[0].format_id || 'unknown'}`);
        if (availableFormats.length === 0) {
          availableFormats.push({
            type: 'video', quality: 'Default', url: bestUrl, ext: anyWithUrl[0].ext || 'mp4'
          });
        }
      }
    }
  }

  // Jika tidak ada format yang tersaring tapi ada URL, jadikan default
  if (availableFormats.length === 0 && entry.url) {
    availableFormats.push({
      type: 'video', quality: 'Default', url: entry.url, ext: entry.ext || "mp4"
    });
  }

  // Fallback tambahan: jika video, dan yt-dlp tidak memberi audio-only track,
  // beri pseudo-audio option (menggunakan URL video utama)
  if (!availableFormats.some(f => f.type === 'audio')) {
    availableFormats.push({
      type: 'audio', quality: 'Audio', url: bestUrl || entry.url, ext: 'mp3'
    });
  }

  // Ambil thumbnail terbaik
  let thumb = entry.thumbnail || null;
  if (!thumb && entry.thumbnails && entry.thumbnails.length > 0) {
    const sorted = [...entry.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
    thumb = sorted[0].url || sorted[0];
  }
  let finalUrl = bestUrl || entry.url;
  if (!finalUrl && availableFormats.length > 0) {
    finalUrl = availableFormats[0].url;
  }
  if (!thumb) thumb = finalUrl;

  // Deteksi jika format default perlu merge audio
  let needsMerge = false;
  let audioUrl = null;
  let mergedDuration = entry.duration || null;
  
  // Cek apakah URL utama adalah video-only yang perlu audio
  if (entry.formats && entry.formats.length > 0) {
    const mainFormat = entry.formats.find(f => f.url === finalUrl);
    if (mainFormat) {
      const hasVid = mainFormat.vcodec && mainFormat.vcodec !== "none" && mainFormat.vcodec !== "null";
      const hasAud = mainFormat.acodec && mainFormat.acodec !== "none" && mainFormat.acodec !== "null";
      
      if (hasVid && !hasAud) {
        // Video tanpa audio, cari audio track
        const audioFormat = availableFormats.find(f => f.type === 'audio');
        if (audioFormat) {
          needsMerge = true;
          audioUrl = audioFormat.url;
          
          // Ambil duration dari video track atau audio track (bukan entry.duration)
          if (!mergedDuration) {
            mergedDuration = mainFormat.duration || audioFormat.duration || null;
          }
        }
      }
    }
  }

  // Fallback duration: cari dari format yang tersedia
  if (!mergedDuration && availableFormats.length > 0) {
    for (const f of availableFormats) {
      if (f.duration) { mergedDuration = f.duration; break; }
    }
  }

  return {
    type: "video",
    url: finalUrl || "",
    thumbnail: thumb,
    width: entry.width || null,
    height: entry.height || null,
    duration: mergedDuration,
    ext: entry.ext || "mp4",
    formats: availableFormats,
    needsMerge: needsMerge,
    audioUrl: audioUrl
  };
}

// ─── Metode 2: oEmbed (fallback khusus Instagram) ────────────────────────────

/**
 * oEmbed hanya bisa dapat thumbnail (bukan video asli).
 * Dipakai sebagai last-resort kalau yt-dlp tidak terinstall.
 * Hanya mendukung Instagram.
 */
async function scrapeViaOEmbed(url) {
  console.log("[Scraper] Mencoba oEmbed API (data terbatas)...");

  const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}&maxwidth=640`;
  const response = await axios.get(oembedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; MediaGet/3.0)",
    },
    timeout: 10000,
  });

  const d = response.data;
  return {
    platform: "instagram",
    type: "image",
    shortcode: "",
    author: d.author_name || "unknown",
    caption: d.title || "",
    title: d.title || "",
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems: [
      {
        type: "image",
        url: d.thumbnail_url,
        thumbnail: d.thumbnail_url,
        width: d.thumbnail_width,
        height: d.thumbnail_height,
        ext: "jpg",
      },
    ],
    source: "oembed",
    warning:
      "⚠️ yt-dlp tidak terinstall — hanya thumbnail yang tersedia. " +
      "Install yt-dlp untuk mengunduh video resolusi penuh.",
  };
}

// ─── TikTok & Facebook retry dengan cookies browser ──────────────────────────

async function scrapeViaCookiesRetry(url, platform) {
  console.log(`[Scraper] Mencoba yt-dlp ${platform} dengan cookies browser...`);

  // Coba beberapa browser yang umum digunakan
  const browsers = ["chrome", "edge", "firefox", "brave"];
  for (const browser of browsers) {
    try {
      const args = [
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--cookies-from-browser", browser,
        url,
      ];
      
      // Khusus TikTok, gunakan User-Agent mobile
      if (platform === "tiktok") {
        args.push("--add-header", "User-Agent:Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");
      }

      const raw = await runCommand("yt-dlp", args, 60000);
      const info = JSON.parse(raw);
      console.log(`[Scraper] Berhasil dengan cookies dari ${browser}`);
      return parseYtDlpOutput(info, platform);
    } catch (err) {
      console.warn(`[Scraper] Cookies ${browser} gagal: ${err.message.substring(0, 80)}`);
    }
  }
  throw new Error(`Semua metode cookies browser gagal untuk ${platform}`);
}

// ─── SnapInsta API (via sssave.app) ─────────────────────────────────────────────
// API ini sangat stabil untuk foto tunggal dan carousel/slide Instagram

async function scrapeInstagramViaSnapinsta(url) {
  console.log("[Scraper] Mencoba SnapInsta (sssave.app) untuk Instagram...");
  
  try {
    // Step 1: Ambil token dari halaman utama
    const homeResp = await axios.get("https://snapinsta.app/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 10000
    });
    
    const html = homeResp.data;
    const tokenMatch = html.match(/name="token"\s+value="([^"]+)"/);
    const token = tokenMatch ? tokenMatch[1] : null;
    
    // Step 2: Submit URL ke API
    const params = new URLSearchParams();
    params.append("url", url);
    params.append("token", token || "");
    
    const apiResp = await axios.post("https://snapinsta.app/action.php", params, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://snapinsta.app",
        "Referer": "https://snapinsta.app/",
        "X-Requested-With": "XMLHttpRequest"
      },
      timeout: 15000
    });
    
    const data = apiResp.data;
    if (!data || (!data.url && !data.data)) {
      throw new Error("SnapInsta tidak mengembalikan hasil");
    }
    
    const shortcode = extractShortcode(url) || "snapinsta";
    const mediaItems = [];
    
    // Handle single photo
    if (data.url && typeof data.url === 'string') {
      const isVideo = data.url.includes('.mp4') || data.type === 'video';
      mediaItems.push({
        type: isVideo ? "video" : "image",
        url: data.url,
        thumbnail: data.thumbnail || data.url,
        width: null, height: null, duration: null,
        ext: isVideo ? 'mp4' : 'jpg',
        formats: [{ type: isVideo ? "video" : "image", quality: "HD", url: data.url, ext: isVideo ? 'mp4' : 'jpg' }]
      });
    }
    
    // Handle carousel/multiple media
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach((item, i) => {
        const mediaUrl = item.url || item.thumbnail_url || item.display_url;
        if (!mediaUrl) return;
        const isVideo = (item.type === 'video') || mediaUrl.includes('.mp4');
        mediaItems.push({
          type: isVideo ? "video" : "image",
          url: mediaUrl,
          thumbnail: item.thumbnail_url || mediaUrl,
          width: null, height: null, duration: null,
          ext: isVideo ? 'mp4' : 'jpg',
          formats: [{ type: isVideo ? "video" : "image", quality: `HD ${i+1}`, url: mediaUrl, ext: isVideo ? 'mp4' : 'jpg' }]
        });
      });
    }
    
    if (mediaItems.length === 0) throw new Error("Tidak ada media dari SnapInsta");
    
    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
      shortcode,
      author: data.author || "Instagram User",
      caption: data.caption || "",
      title: "",
      timestamp: null,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems,
      source: "snapinsta",
      warning: null
    };
  } catch (err) {
    throw new Error(`SnapInsta gagal: ${err.message}`);
  }
}

// ─── SaveIG API (saveig.app) ────────────────────────────────────────────────────
// API publik stabil, support carousel Instagram

async function scrapeInstagramViaSaveIG(url) {
  console.log("[Scraper] Mencoba SaveIG (saveig.app) untuk Instagram...");
  
  try {
    // Gunakan instagramsave API yang sangat stabil
    const apiUrl = `https://saveig.app/api?url=${encodeURIComponent(url)}`;
    
    const resp = await axios.get(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://saveig.app/"
      },
      timeout: 15000
    });
    
    const data = resp.data;
    if (!data || !data.success || !data.medias || data.medias.length === 0) {
      throw new Error("SaveIG tidak mengembalikan hasil valid");
    }
    
    const shortcode = extractShortcode(url) || "saveig";
    const mediaItems = data.medias.map((item, i) => {
      const isVideo = item.type === 'video' || (item.url && item.url.includes('.mp4'));
      return {
        type: isVideo ? "video" : "image",
        url: item.url,
        thumbnail: item.thumbnail || item.url,
        width: null, height: null, duration: null,
        ext: isVideo ? 'mp4' : 'jpg',
        formats: [{ type: isVideo ? "video" : "image", quality: `HD ${i+1}`, url: item.url, ext: isVideo ? 'mp4' : 'jpg' }]
      };
    });
    
    if (mediaItems.length === 0) throw new Error("Tidak ada media dari SaveIG");
    
    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
      shortcode,
      author: data.author || "Instagram User",
      caption: data.caption || "",
      title: "",
      timestamp: null,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems,
      source: "saveig",
      warning: null
    };
  } catch (err) {
    throw new Error(`SaveIG gagal: ${err.message}`);
  }
}

// ─── SnapInstagram API (snapinst.app) ─────────────────────────────────────────
// API stabil, support carousel dengan JSON response

async function scrapeInstagramViaSnapInst(url) {
  console.log("[Scraper] Mencoba SnapInst (snapinst.app) untuk Instagram...");

  try {
    const resp = await axios.post(
      "https://snapinst.app/action.php",
      new URLSearchParams({ url, lang: "id" }).toString(),
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": "https://snapinst.app",
          "Referer": "https://snapinst.app/",
          "X-Requested-With": "XMLHttpRequest"
        },
        timeout: 15000
      }
    );

    const data = resp.data;
    if (!data) throw new Error("SnapInst tidak mengembalikan data");

    const shortcode = extractShortcode(url) || "snapinst";
    const mediaItems = [];

    // SnapInst mengembalikan JSON array atau objek dengan field media
    let mediaArr = null;
    if (Array.isArray(data)) mediaArr = data;
    else if (data.data && Array.isArray(data.data)) mediaArr = data.data;
    else if (data.medias && Array.isArray(data.medias)) mediaArr = data.medias;
    else if (data.result && Array.isArray(data.result)) mediaArr = data.result;

    if (!mediaArr || mediaArr.length === 0) throw new Error("SnapInst: tidak ada media di response");

    mediaArr.forEach((item, i) => {
      const mediaUrl = item.url || item.download_url || item.src;
      if (!mediaUrl) return;
      const isVideo = item.type === 'video' || (mediaUrl && mediaUrl.includes('.mp4'));
      mediaItems.push({
        type: isVideo ? "video" : "image",
        url: mediaUrl,
        thumbnail: item.thumbnail || item.thumb || mediaUrl,
        width: null, height: null, duration: null,
        ext: isVideo ? 'mp4' : 'jpg',
        formats: [{ type: isVideo ? "video" : "image", quality: `HD ${i+1}`, url: mediaUrl, ext: isVideo ? 'mp4' : 'jpg' }]
      });
    });

    if (mediaItems.length === 0) throw new Error("SnapInst: tidak ada media valid");

    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
      shortcode,
      author: data.username || "Instagram User",
      caption: data.caption || "",
      title: "",
      timestamp: null,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems,
      source: "snapinst",
      warning: null
    };
  } catch (err) {
    throw new Error(`SnapInst gagal: ${err.message}`);
  }
}

// ─── SSSSave API (ssssave.app) ─────────────────────────────────────────────────
// API populer, support carousel Instagram (foto slide)

async function scrapeInstagramViaSSSSave(url) {
  console.log("[Scraper] Mencoba SSSSave untuk Instagram...");
  
  // Coba beberapa domain SSSSave (domain lama sering mati)
  const domains = ["https://ssssave.app", "https://ssssave.com", "https://ssssave.net"];
  let resp = null;
  
  for (const domain of domains) {
    try {
      resp = await axios.post(
        `${domain}/api/ajaxSearch`,
        new URLSearchParams({ q: url, t: "media", lang: "en" }).toString(),
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": domain,
            "Referer": `${domain}/`,
            "X-Requested-With": "XMLHttpRequest"
          },
          timeout: 12000
        }
      );
      if (resp.data && resp.data.status === "ok" && resp.data.data) break;
      resp = null;
    } catch (e) {
      resp = null;
      // Lanjut coba domain berikutnya
    }
  }
  
  if (!resp || !resp.data || resp.data.status !== "ok" || !resp.data.data) {
    throw new Error("SSSSave tidak mengembalikan hasil (semua domain gagal)");
  }
  
  try {
    const shortcode = extractShortcode(url) || "ssssave";
    const htmlData = resp.data.data;
    const mediaItems = [];
    const seenUrls = new Set();

    // Helper: filter URL yang valid (bukan logo/blank/thumbnail kecil)
    function isValidMediaUrl(u) {
      if (!u || u.length < 20) return false;
      // Skip logo Instagram atau foto profil
      if (/profile_pic|\/v\/t51\.2885-19\/|\/v\/t51\.2885-15\//.test(u)) return false;
      // Skip thumbnail kecil
      if (/s150x150|s320x320|s240x240|s44x44|s64x64|150x150|44x44/.test(u)) return false;
      // Skip static assets
      if (/static\.cdninstagram\.com|fbstatic-a\.akamaihd\.net/.test(u)) return false;
      return true;
    }
    
    // Metode 1: Parse link download langsung (prioritas utama)
    const linkRegex = /href="(https?:\/\/[^"]+\.(jpg|jpeg|png|mp4|webp)[^"]*)"[^>]*download/gi;
    let m;
    while ((m = linkRegex.exec(htmlData)) !== null) {
      const cleanUrl = m[1].replace(/&amp;/g, '&');
      if (isValidMediaUrl(cleanUrl) && !seenUrls.has(cleanUrl)) {
        seenUrls.add(cleanUrl);
        mediaItems.push(cleanUrl);
      }
    }

    // Metode 2: Fallback — cari semua href CDN Instagram
    if (mediaItems.length === 0) {
      const fallbackRegex = /href="(https?:\/\/(?:scontent[\w.-]*\.cdninstagram\.com|scontent[\w.-]*\.fbcdn\.net|instagram\.[\w-]+\.fna\.fbcdn\.net)[^"]+)"[^>]*(?:download|class="[^"]*btn)/gi;
      while ((m = fallbackRegex.exec(htmlData)) !== null) {
        const cleanUrl = m[1].replace(/&amp;/g, '&');
        if (isValidMediaUrl(cleanUrl) && !seenUrls.has(cleanUrl)) {
          seenUrls.add(cleanUrl);
          mediaItems.push(cleanUrl);
        }
      }
    }

    // Metode 3: Cari semua src CDN Instagram dari tag <img> yang bukan thumbnail
    if (mediaItems.length === 0) {
      const imgRegex = /src="(https?:\/\/(?:scontent[\w.-]*\.cdninstagram\.com|scontent[\w.-]*\.fbcdn\.net)[^"]+)"/gi;
      while ((m = imgRegex.exec(htmlData)) !== null) {
        const cleanUrl = m[1].replace(/&amp;/g, '&');
        if (isValidMediaUrl(cleanUrl) && !seenUrls.has(cleanUrl)) {
          seenUrls.add(cleanUrl);
          mediaItems.push(cleanUrl);
        }
      }
    }
    
    if (mediaItems.length === 0) throw new Error("Tidak ada media ditemukan dari SSSSave");
    
    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : (mediaItems[0].includes('.mp4') ? "video" : "image"),
      shortcode,
      author: "Instagram User",
      caption: "",
      title: "",
      timestamp: null,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems: mediaItems.map((mediaUrl, i) => {
        const isVideo = mediaUrl.includes('.mp4');
        return {
          type: isVideo ? "video" : "image",
          url: mediaUrl,
          thumbnail: mediaUrl,
          width: null, height: null, duration: null,
          ext: isVideo ? 'mp4' : 'jpg',
          formats: [{ type: isVideo ? "video" : "image", quality: `HD ${i+1}`, url: mediaUrl, ext: isVideo ? 'mp4' : 'jpg' }]
        };
      }),
      source: "ssssave",
      warning: null
    };
  } catch (err) {
    throw new Error(`SSSSave gagal: ${err.message}`);
  }
}

// ─── InstagramSave API via igram.world ──────────────────────────────────────────
// Support carousel dengan reliable JSON response

async function scrapeInstagramViaIgram(url) {
  console.log("[Scraper] Mencoba igram.world untuk Instagram...");
  
  try {
    const resp = await axios.post(
      "https://igram.world/api/convert",
      JSON.stringify({ url, lang: "id" }),
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Content-Type": "application/json",
          "Origin": "https://igram.world",
          "Referer": "https://igram.world/",
        },
        timeout: 15000
      }
    );
    
    const data = resp.data;
    if (!data || !data.media || data.media.length === 0) {
      throw new Error("igram tidak mengembalikan media");
    }
    
    const shortcode = extractShortcode(url) || "igram";
    const mediaItems = data.media.map((item, i) => {
      const isVideo = item.type === 'video' || (item.url && item.url.includes('.mp4'));
      return {
        type: isVideo ? "video" : "image",
        url: item.url,
        thumbnail: item.thumbnail || item.url,
        width: item.width || null, height: item.height || null, duration: null,
        ext: isVideo ? 'mp4' : 'jpg',
        formats: [{ type: isVideo ? "video" : "image", quality: `HD ${i+1}`, url: item.url, ext: isVideo ? 'mp4' : 'jpg' }]
      };
    });
    
    if (mediaItems.length === 0) throw new Error("Tidak ada media dari igram");
    
    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
      shortcode,
      author: data.author || "Instagram User",
      caption: data.caption || "",
      title: "",
      timestamp: null,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems,
      source: "igram",
      warning: null
    };
  } catch (err) {
    throw new Error(`igram gagal: ${err.message}`);
  }
}

async function scrapeInstagramViaIgramPlaywright(url) {
  console.log("[Scraper] Mencoba igram.world via Playwright...");
  const { chromium } = require('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    // Block heavy resources for speed
    await page.route('**/*.{woff,woff2,ttf,css}', route => route.abort());

    let targetUrl = url;
    const storyMatch = url.match(/stories\/([a-zA-Z0-9_.-]+)/);
    if (storyMatch && storyMatch[1]) {
      // Ubah link spesifik menjadi link profil story agar igram mendownload SEMUA story
      targetUrl = `https://www.instagram.com/stories/${storyMatch[1]}/`;
      await page.goto('https://igram.world/story-saver', { timeout: 30000 });
    } else {
      await page.goto('https://igram.world/', { timeout: 30000 });
    }
    
    // Fill the input
    await page.fill('input[id="search-form-input"]', targetUrl);
    
    // Click submit
    await page.click('button.search-form__button');
    
    // wait for result container or error
    await page.waitForSelector('.output-list__item, .alert-danger', { timeout: 30000 });
    
    // check for error
    const errorMsg = await page.$('.alert-danger');
    if (errorMsg) {
       throw new Error("igram.world menampilkan pesan error untuk URL tersebut");
    }

    // Scroll down dan tunggu semua item story ter-load (lazy loading)
    let prevCount = 0;
    let stableRounds = 0;
    for (let i = 0; i < 10; i++) {
      // Scroll ke bawah untuk trigger lazy loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
      
      const currentCount = await page.$$eval('.output-list__item', els => els.length);
      console.log(`[igram] Scroll round ${i + 1}: found ${currentCount} items`);
      
      if (currentCount === prevCount) {
        stableRounds++;
        if (stableRounds >= 2) break; // Stabil selama 2 round = selesai loading
      } else {
        stableRounds = 0;
      }
      prevCount = currentCount;
    }

    // Extract timestamp (e.g., "7 hours ago")
    const timestampText = await page.$eval('.output-list__info-time', el => el.innerText.trim()).catch(() => null);


    // get all download links and thumbnail URLs
    const rawItems = await page.$$eval('.output-list__item', els => els.map(el => {
      const img = el.querySelector('img');
      const a = el.querySelector('a[download]');
      return {
        url: a ? a.href : null,
        thumbnailUrl: img ? img.src : null
      };
    }).filter(i => i.url));
    
    if (rawItems.length === 0) {
      throw new Error("Tidak ada link download yang ditemukan via Playwright");
    }

    // Fetch each thumbnail as base64 inside the page context (bypasses CORS)
    const items = await page.evaluate(async (rawItems) => {
      const results = [];
      for (const item of rawItems) {
        let thumbnailBase64 = null;
        if (item.thumbnailUrl) {
          try {
            const resp = await fetch(item.thumbnailUrl);
            const blob = await resp.blob();
            thumbnailBase64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } catch (e) {
            // fallback: keep URL
            thumbnailBase64 = item.thumbnailUrl;
          }
        }
        results.push({ url: item.url, thumbnail: thumbnailBase64 });
      }
      return results;
    }, rawItems);

    const shortcode = extractShortcode(url) || "igram_pw";
    
    let author = "Instagram User";
    if (storyMatch && storyMatch[1]) {
      author = storyMatch[1];
    }

    const mediaItems = items.map((item, i) => {
      const isVideo = item.url.includes('.mp4');
      return {
        type: isVideo ? "video" : "image",
        url: item.url,
        thumbnail: item.thumbnail || item.url,
        width: null, height: null, duration: null,
        ext: isVideo ? 'mp4' : 'jpg',
        formats: [{ type: isVideo ? "video" : "image", quality: `HD ${i+1}`, url: item.url, ext: isVideo ? 'mp4' : 'jpg' }]
      };
    });

    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
      shortcode,
      author,
      caption: "",
      title: "",
      timestamp: timestampText,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems,
      source: "igram_pw",
      warning: null
    };

  } catch (err) {
    throw new Error(`igram Playwright gagal: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

// ─── RapidAPI Instagram (Cobalt wrapper) ──────────────────────────────────────

async function scrapeViaRapidAPI(url) {
  console.log("[Scraper] Mencoba RapidAPI untuk Instagram...");

  const options = {
    method: 'GET',
    url: 'https://instagram-post-reels-stories-downloader-api.p.rapidapi.com/instagram/',
    params: { url: url },
    headers: {
      'x-rapidapi-host': 'instagram-post-reels-stories-downloader-api.p.rapidapi.com',
      'x-rapidapi-key': '29be28c9fbmsh38d097de4f364c3p10b509jsn3a0f41eb7e83',
      'Content-Type': 'application/json'
    },
    timeout: 15000
  };

  const response = await axios.request(options);
  const data = response.data;

  if (!data || data.status !== true || !data.result || !Array.isArray(data.result)) {
    throw new Error(data.message || "RapidAPI tidak mengembalikan hasil valid");
  }

  const mediaItems = [];
  let hasVideo = false;

  data.result.forEach((item, index) => {
    const isVideo = item.type && item.type.includes('video');
    const isImage = item.type && item.type.includes('image');
    if (isVideo) hasVideo = true;

    const ext = isVideo ? 'mp4' : 'jpg';
    mediaItems.push({
      type: isVideo ? "video" : "image",
      url: item.url,
      thumbnail: item.url, // Gunakan URL asli Instagram CDN (thumb dari RapidAPI adalah proxy unreliable)
      width: null,
      height: null,
      duration: null,
      ext: ext,
      formats: [
        { type: isVideo ? "video" : "image", quality: `Media ${index + 1}`, url: item.url, ext: ext }
      ]
    });
  });

  // Fetch real username via embed page (works without login)
  let realAuthor = "Instagram User";
  let realCaption = "";
  try {
    const embedResp = await axios.get(
      `https://www.instagram.com/p/${extractShortcode(url)}/embed/`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, timeout: 8000 }
    );
    const html = embedResp.data;
    const usernameMatch = html.match(/class="Username">([^<]+)/);
    if (usernameMatch?.[1]) realAuthor = usernameMatch[1].trim();
    // Try to get caption from embed
    const captionMatch = html.match(/class="Caption"[^>]*>([^<]+)/);
    if (captionMatch?.[1]) realCaption = captionMatch[1].trim();
  } catch (e) {
    // Fallback: try oEmbed API
    try {
      const oembedResp = await axios.get(
        `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}&maxwidth=640`,
        { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 }
      );
      if (oembedResp.data?.author_name) realAuthor = oembedResp.data.author_name;
      if (oembedResp.data?.title) realCaption = oembedResp.data.title;
    } catch (e2) {}
  }

  return {
    platform: "instagram",
    type: hasVideo ? "video" : "playlist",
    shortcode: extractShortcode(url) || "rapidapi",
    author: realAuthor,
    caption: realCaption,
    title: realCaption,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems: mediaItems,
    source: "rapidapi",
    warning: null
  };
}

// ─── Threads.net Playwright Scraper (fallback untuk photo carousel) ─────────

async function scrapeThreadsViaPlaywright(url) {
  let browser;
  console.log("[Threads] Mencoba Playwright untuk Threads post...");

  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();

    // Collect media from network
    const capturedMedia = [];
    page.on('response', async (response) => {
      const respUrl = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Capture video
      if (contentType.includes('video') || respUrl.includes('.mp4')) {
        if (respUrl.includes('cdninstagram.com') || respUrl.includes('fbcdn') || respUrl.includes('scontent')) {
          capturedMedia.push({ type: 'video', url: respUrl });
        }
      }
      // Capture high-res images
      if (contentType.includes('image/jpeg') || contentType.includes('image/png') || contentType.includes('image/webp')) {
        if ((respUrl.includes('cdninstagram.com') || respUrl.includes('fbcdn') || respUrl.includes('scontent'))
            && !respUrl.includes('profile_pic') && !respUrl.includes('s150x150')
            && !respUrl.includes('s320x320') && !respUrl.includes('emoji') && !respUrl.includes('static')) {
          capturedMedia.push({ type: 'image', url: respUrl });
        }
      }
    });

    await page.route('**/*.{woff,woff2,ttf}', route => route.abort());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Dismiss any modals
    try { await page.keyboard.press('Escape'); } catch {}
    await page.waitForTimeout(1000);

    // Extract from DOM: video sources + thumbnails
    const domMedia = await page.evaluate(() => {
      const results = [];
      // Videos - also capture poster/thumbnail
      document.querySelectorAll('video').forEach(vid => {
        const src = vid.src || vid.querySelector('source')?.src;
        const poster = vid.getAttribute('poster') || '';
        if (src && (src.includes('cdninstagram.com') || src.includes('fbcdn') || src.includes('scontent'))
            && !src.includes('t50')) {
          results.push({ type: 'video', url: src, thumbnail: poster || null });
        }
      });
      // Images (filter out small icons) - these serve as potential thumbnails too
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || '';
        if (src && (src.includes('cdninstagram.com') || src.includes('fbcdn') || src.includes('scontent'))
            && !src.includes('profile_pic') && !src.includes('s150x150')
            && !src.includes('s320x320') && !src.includes('emoji') && !src.includes('static')
            && (img.naturalWidth > 300 || img.width > 300)) {
          results.push({ type: 'image', url: src, thumbnail: src });
        }
      });
      return results;
    });

    // Search HTML for embedded media URLs
    const html = await page.content();
    const scriptMedia = [];
    // Collect all thumbnail/cover images from HTML
    const thumbnailMap = {};
    // video_url patterns
    const videoUrlRegex = /"video_url"\s*:\s*"([^"]+)"/gi;
    let match;
    while ((match = videoUrlRegex.exec(html)) !== null) {
      const decoded = match[1].replace(/\\u0026/g, '&').replace(/\\//g, '/');
      if (decoded.includes('cdninstagram.com') || decoded.includes('fbcdn')) {
        scriptMedia.push({ type: 'video', url: decoded });
      }
    }
    // display_url patterns (these are image/thumbnail URLs)
    const displayUrlRegex = /"display_url"\s*:\s*"([^"]+)"/gi;
    while ((match = displayUrlRegex.exec(html)) !== null) {
      const decoded = match[1].replace(/\\u0026/g, '&').replace(/\\//g, '/');
      if ((decoded.includes('cdninstagram.com') || decoded.includes('fbcdn'))
          && !decoded.includes('s150x150') && !decoded.includes('profile_pic')) {
        scriptMedia.push({ type: 'image', url: decoded, thumbnail: decoded });
      }
    }
    // image_url / thumbnail_url patterns
    const thumbUrlRegex = /"(?:thumbnail_url|image_url|cover_image_url)"\s*:\s*"([^"]+)"/gi;
    while ((match = thumbUrlRegex.exec(html)) !== null) {
      const decoded = match[1].replace(/\\u0026/g, '&').replace(/\\//g, '/');
      if ((decoded.includes('cdninstagram.com') || decoded.includes('fbcdn'))
          && !decoded.includes('s150x150') && !decoded.includes('profile_pic')) {
        // Store as thumbnail candidate
        const baseKey = decoded.split('?')[0];
        if (!thumbnailMap[baseKey]) thumbnailMap[baseKey] = decoded;
      }
    }

    // Extract author from page
    const authorName = await page.evaluate(() => {
      // Most reliable: extract from URL path
      const pathMatch = location.pathname.match(/\/@([\w.]+)\//);
      if (pathMatch) return pathMatch[1];
      // Fallback: look for username link
      const link = document.querySelector('a[href^="/@"]');
      if (link) {
        const href = link.getAttribute('href');
        const match = href.match(/\/@([\w.]+)\/?/);
        if (match) return match[1];
      }
      return 'Threads User';
    });

    await browser.close();
    browser = null;

    // Combine all sources
    const allMedia = [...capturedMedia, ...domMedia, ...scriptMedia];
    console.log(`[Threads] Network: ${capturedMedia.length}, DOM: ${domMedia.length}, HTML: ${scriptMedia.length} media found`);

    // Deduplicate
    const seen = new Set();
    const uniqueMedia = [];
    for (const item of allMedia) {
      const baseUrl = item.url.split('?')[0];
      if (!seen.has(baseUrl)) {
        seen.add(baseUrl);
        uniqueMedia.push(item);
      } else if (item.thumbnail) {
        // Update existing entry with thumbnail if current one has none
        const existing = uniqueMedia.find(m => m.url.split('?')[0] === baseUrl);
        if (existing && !existing.thumbnail) {
          existing.thumbnail = item.thumbnail;
        }
      }
    }

    // Prefer videos over images
    const videos = uniqueMedia.filter(m => m.type === 'video');
    const images = uniqueMedia.filter(m => m.type === 'image');
    const finalMedia = videos.length > 0 ? videos : images;

    if (finalMedia.length === 0) {
      throw new Error("Tidak ada media yang ditemukan di Threads post");
    }

    // Build thumbnail list from images (use as fallback for video thumbnails)
    const imageUrls = images.map(m => m.thumbnail || m.url);
    const thumbCandidates = Object.values(thumbnailMap).concat(imageUrls);

    const mediaItems = finalMedia.map((item, index) => {
      // For videos: use poster from DOM, or first available image as thumbnail
      let thumb = item.thumbnail || null;
      if (!thumb && item.type === 'video') {
        // Try to find a matching thumbnail
        thumb = thumbCandidates[index] || thumbCandidates[0] || null;
      }
      if (!thumb && item.type === 'image') {
        thumb = item.url;
      }

      return {
        type: item.type,
        url: item.url,
        thumbnail: thumb || item.url,
        width: null,
        height: null,
        duration: null,
        ext: item.type === 'video' ? 'mp4' : 'jpg',
        formats: [{
          type: item.type,
          quality: finalMedia.length > 1 ? `Item ${index + 1}` : (item.type === 'video' ? 'Video' : 'Foto'),
          url: item.url,
          ext: item.type === 'video' ? 'mp4' : 'jpg'
        }]
      };
    });

    const hasVideo = mediaItems.some(m => m.type === 'video');
    return {
      platform: "threads",
      type: hasVideo ? "video" : (mediaItems.length > 1 ? "playlist" : "image"),
      shortcode: url.match(/\/post\/([\w-]+)/)?.[1] || "threads",
      author: authorName,
      caption: `Threads post dari @${authorName}`,
      title: `Threads post dari @${authorName}`,
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems,
      source: "playwright-threads"
    };

  } catch (err) {
    if (browser) { try { await browser.close(); } catch {} }
    throw new Error(`Threads Playwright gagal: ${err.message}`);
  }
}

// ─── Instagram Embed API (untuk foto) ──────────────────────────────────────────

async function scrapeInstagramViaEmbed(url) {
  console.log("[Scraper] Mencoba Instagram Embed endpoint...");
  
  try {
    const shortcode = extractShortcode(url);
    if (!shortcode) {
      throw new Error("Tidak dapat extract shortcode");
    }
    
    // Instagram embed endpoint (lebih mudah diakses tanpa login)
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    
    const response = await axios.get(embedUrl, {
      headers: {
        "User-Agent": IG_USER_AGENT,
        "Accept": "text/html"
      },
      timeout: 10000
    });
    
    const html = response.data;

    // Extract username
    let username = "Instagram User";
    const usernameMatch = html.match(/"username":"([^"]+)"/);
    if (usernameMatch && usernameMatch[1]) username = usernameMatch[1];

    // Extract caption
    let caption = "";
    const captionMatch = html.match(/"caption":"((?:[^"\\]|\\.)*)"/);
    if (captionMatch && captionMatch[1]) {
      caption = captionMatch[1].replace(/\\n/g, "\n");
    }

    // ── CAROUSEL DETECTION: Parse JSON data dari embed page ──
    // Instagram embed page mengandung JSON dengan data carousel (edge_sidecar_to_children)
    const photoUrls = [];
    const videoUrls = [];
    const seen = new Set();

    // Method 1: Cari edge_sidecar_to_children di JSON embed (carousel!)
    const sidecarPatterns = [
      /"edge_sidecar_to_children"\s*:\s*\{\s*"edges"\s*:\s*(\[[\s\S]*?\])\s*\}/,
      /"sidecar"\s*:\s*(\[[\s\S]*?\])/,
      /"carousel_media"\s*:\s*(\[[\s\S]*?\])/,
    ];
    
    for (const pattern of sidecarPatterns) {
      const sidecarMatch = html.match(pattern);
      if (sidecarMatch) {
        try {
          const sidecarData = JSON.parse(sidecarMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/"));
          for (const item of sidecarData) {
            const node = item.node || item;
            // Video di carousel
            if (node.video_url) {
              const vUrl = node.video_url.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
              if (!seen.has(vUrl)) { seen.add(vUrl); videoUrls.push(vUrl); }
            }
            // Foto di carousel — ambil resolusi tertinggi
            if (node.display_resources?.length > 0) {
              const best = node.display_resources[node.display_resources.length - 1];
              const imgUrl = (best.src || best.url || "").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
              if (imgUrl && !seen.has(imgUrl)) { seen.add(imgUrl); photoUrls.push(imgUrl); }
            } else if (node.display_url) {
              const imgUrl = node.display_url.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
              if (!seen.has(imgUrl)) { seen.add(imgUrl); photoUrls.push(imgUrl); }
            }
          }
          if (photoUrls.length > 1 || videoUrls.length > 0) {
            console.log(`[Scraper] Embed carousel JSON: ${photoUrls.length} foto, ${videoUrls.length} video`);
            break; // Carousel ditemukan!
          }
        } catch (e) {
          // JSON parse gagal, lanjut ke pattern berikutnya
        }
      }
    }

    // Method 2: Kalau carousel JSON tidak ketemu, fallback ke regex display_url
    if (photoUrls.length <= 1 && videoUrls.length === 0) {
      photoUrls.length = 0; // Reset
      const imgRegex = /"display_url":"([^"]+)"/g;
      let m;
      while ((m = imgRegex.exec(html)) !== null) {
        const photoUrl = m[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
        if (!seen.has(photoUrl)) { seen.add(photoUrl); photoUrls.push(photoUrl); }
      }

      const videoRegex = /"video_url":"([^"]+)"/g;
      while ((m = videoRegex.exec(html)) !== null) {
        const vUrl = m[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
        if (!videoUrls.includes(vUrl)) videoUrls.push(vUrl);
      }
    }

    // Method 3: Cari URL gambar dari tag <img> dengan src CDN Instagram
    if (photoUrls.length === 0 && videoUrls.length === 0) {
      const imgTagRegex = /<img[^>]+src="(https?:\/\/[^"]*cdninstagram\.com[^"]+)"/gi;
      let m;
      while ((m = imgTagRegex.exec(html)) !== null) {
        const imgUrl = m[1].replace(/&amp;/g, "&");
        // Skip thumbnail kecil dan foto profil
        if (/s150x150|s320x320|s44x44|s64x64|profile_pic/.test(imgUrl)) continue;
        if (!seen.has(imgUrl)) { seen.add(imgUrl); photoUrls.push(imgUrl); }
      }
    }

    if (photoUrls.length === 0 && videoUrls.length === 0) {
      throw new Error("Foto/video tidak ditemukan di embed page");
    }

    console.log(`[Scraper] Embed: ${photoUrls.length} foto, ${videoUrls.length} video`);

    const mediaItems = [];
    videoUrls.forEach(videoUrl => {
      mediaItems.push({
        type: "video", url: videoUrl,
        thumbnail: photoUrls[0] || videoUrl,
        width: null, height: null, duration: null, ext: "mp4",
        formats: [{ type: "video", quality: "HD", url: videoUrl, ext: "mp4" }]
      });
    });
    photoUrls.forEach((photoUrl, i) => {
      mediaItems.push({
        type: "image", url: photoUrl, thumbnail: photoUrl,
        width: null, height: null, duration: null, ext: "jpg",
        formats: [{ type: "image", quality: i === 0 ? "HD" : `HD Foto ${i + 1}`, url: photoUrl, ext: "jpg" }]
      });
    });

    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
      shortcode: shortcode,
      author: username,
      caption: caption,
      title: caption.substring(0, 100) || "",
      timestamp: null,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems: mediaItems,
      source: "instagram_embed",
      warning: null
    };
  } catch (err) {
    throw new Error("Instagram Embed gagal: " + err.message);
  }
}

// ─── Instagram via @bochilteam/scraper-instagram ────────────────────────────────

async function scrapeInstagramViaBochil(url) {
  console.log("[Scraper] Mencoba @bochilteam/scraper-instagram (igdownloader.app)...");
  
  try {
    const { instagramdl } = require('@bochilteam/scraper-instagram');
    
    const results = await instagramdl(url);
    
    if (!results || !Array.isArray(results) || results.length === 0) {
      throw new Error("Tidak ada media dikembalikan dari @bochilteam/scraper-instagram");
    }
    
    const shortcode = extractShortcode(url) || "bochil";
    
    const mediaItems = results.map((item) => {
      const isVideo = item.type === 'video' || (item.url && item.url.includes('.mp4'));
      return {
        type: isVideo ? "video" : "image",
        url: item.url,
        thumbnail: item.thumbnail || item.url,
        width: null,
        height: null,
        duration: null,
        ext: isVideo ? 'mp4' : 'jpg',
        formats: [{
          type: isVideo ? "video" : "image",
          quality: "HD",
          url: item.url,
          ext: isVideo ? 'mp4' : 'jpg'
        }]
      };
    });

    const firstItem = mediaItems[0];
    
    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : firstItem.type,
      shortcode: shortcode,
      author: "Instagram User",
      caption: "",
      title: "",
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems,
      source: "@bochilteam/scraper-instagram",
      warning: null
    };
  } catch (err) {
    throw new Error(`@bochilteam/scraper-instagram gagal: ${err.message}`);
  }
}

// ─── Instagram via @mrnima/instagram-downloader ──────────────────────────────────

async function scrapeInstagramViaMrnima(url) {
  console.log("[Scraper] Mencoba @mrnima/instagram-downloader...");
  
  try {
    // FIX: Package exports a NAMED export `instagramDownload`, not a default function.
    // The old code did:  const instagramDownloader = require('...');  await instagramDownloader(url);
    // That grabs the module object and tries to call it as a function → "is not a function".
    const { instagramDownload } = require('@mrnima/instagram-downloader');
    
    const result = await instagramDownload(url);
    
    // FIX: The package returns { status: bool, result: [{ type, link }] }
    // NOT { download_url }.  Old check `!result.download_url` always threw.
    if (!result || !result.status || !Array.isArray(result.result) || result.result.length === 0) {
      throw new Error("No media returned from @mrnima/instagram-downloader");
    }
    
    const shortcode = extractShortcode(url) || "mrnima";
    const username = "Instagram User";
    
    // Map every item in result.result → mediaItems
    const mediaItems = result.result.map((item) => {
      const isVideo = item.type === 'video' || (item.link && item.link.includes('.mp4'));
      return {
        type: isVideo ? "video" : "image",
        url: item.link,
        thumbnail: item.link,
        width: null,
        height: null,
        duration: null,
        ext: isVideo ? 'mp4' : 'jpg',
        formats: [{
          type: isVideo ? "video" : "image",
          quality: "HD",
          url: item.link,
          ext: isVideo ? 'mp4' : 'jpg'
        }]
      };
    });

    const firstItem = mediaItems[0];
    
    return {
      platform: "instagram",
      type: firstItem.type,
      shortcode: shortcode,
      author: username,
      caption: "",
      title: "",
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems,
      source: "@mrnima/instagram-downloader",
      warning: null
    };
  } catch (err) {
    throw new Error(`@mrnima/instagram-downloader gagal: ${err.message}`);
  }
}

// ─── Instagram via Instaloader (Python fallback) ────────────────────────────────

async function scrapeInstagramViaInstaloader(url) {
  console.log("[Scraper] Mencoba Instaloader (Python) untuk Instagram...");
  
  return new Promise((resolve, reject) => {
    // Check if Python and instaloader available (try python3 first for Debian/Railway)
    exec('python3 --version', (err3) => {
      const pythonCmd = err3 ? 'python' : 'python3';
      exec(`${pythonCmd} --version`, (err) => {
      if (err) {
        return reject(new Error("Python tidak ditemukan. Install Python untuk menggunakan Instaloader."));
      }
      
      // Try to download with instaloader
      const shortcode = extractShortcode(url);
      if (!shortcode) {
        return reject(new Error("Shortcode tidak ditemukan"));
      }
      
      // Create unique temp dir with profile subfolder for username extraction
      const tempDirName = `temp_ig_${Date.now()}`;
      
      // Download ALL media (foto + video) tanpa login — support carousel!
      // {profile} creates subfolder with username (e.g. temp_ig_xxx/fabrizioromano/)
      const cmd = `${pythonCmd} -m instaloader --no-captions --no-metadata-json --dirname-pattern=${tempDirName}/{profile} -- -${shortcode}`;
      
      exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
        const fs = require('fs');
        const path = require('path');
        
        // Check if temp dir exists even if there's an error (403 is common but download still works)
        const tempBaseDir = path.join(__dirname, tempDirName);
        
        if (!fs.existsSync(tempBaseDir)) {
          console.warn(`[Scraper] Instaloader error: ${stderr || error?.message || 'Unknown'}`);
          return reject(new Error(`Instaloader gagal: folder tidak dibuat`));
        }
        
        try {
          // Find profile subfolder (contains the username)
          const subdirs = fs.readdirSync(tempBaseDir).filter(f => 
            fs.statSync(path.join(tempBaseDir, f)).isDirectory()
          );
          const profileName = subdirs.length > 0 ? subdirs[0] : null;
          const tempDir = profileName ? path.join(tempBaseDir, profileName) : tempBaseDir;
          
          const files = fs.readdirSync(tempDir);
          
          // Ambil SEMUA file media (foto + video) — carousel support!
          const mediaFiles = files.filter(f => 
            f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg') || f.endsWith('.mp4') || f.endsWith('.webp')
          ).sort(); // Sort agar urutan sesuai carousel
          
          if (mediaFiles.length === 0) {
            fs.rmSync(tempBaseDir, { recursive: true, force: true });
            return reject(new Error("Media tidak ditemukan dari Instaloader"));
          }
          
          // Simpan file ke temp_downloads agar bisa diakses via HTTP URL
          const tempDownloadsDir = path.join(__dirname, 'temp_downloads');
          if (!fs.existsSync(tempDownloadsDir)) fs.mkdirSync(tempDownloadsDir, { recursive: true });
          const batchId = `ig_${Date.now()}`;
          const batchDir = path.join(tempDownloadsDir, batchId);
          fs.mkdirSync(batchDir, { recursive: true });

          const mediaItems = [];
          for (const file of mediaFiles) {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            if (stats.size === 0) continue;
            
            const isVideo = file.endsWith('.mp4');
            const ext = isVideo ? 'mp4' : (file.endsWith('.webp') ? 'webp' : 'jpg');
            const mimeType = isVideo ? 'video/mp4' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            
            // Copy file ke temp_downloads dan gunakan HTTP URL
            const destFile = path.join(batchDir, file);
            fs.copyFileSync(filePath, destFile);
            const httpUrl = `/temp/${batchId}/${encodeURIComponent(file)}`;
            
            console.log(`[Scraper] Instaloader: ${file} (${(stats.size / 1024).toFixed(0)}KB) → ${httpUrl}`);
            
            mediaItems.push({
              type: isVideo ? "video" : "image",
              url: httpUrl,
              thumbnail: httpUrl,
              width: null,
              height: null,
              duration: null,
              ext: ext,
              formats: [{
                type: isVideo ? "video" : "image",
                quality: isVideo ? "HD" : `HD Foto ${mediaItems.length + 1}`,
                url: httpUrl,
                ext: ext
              }]
            });
          }
          
          // Clean up temp directory Instaloader
          fs.rmSync(tempBaseDir, { recursive: true, force: true });
          
          // Auto-cleanup batch dir setelah 1 jam
          setTimeout(() => {
            try { fs.rmSync(batchDir, { recursive: true, force: true }); } catch (_) {}
          }, 3600000).unref();
          
          if (mediaItems.length === 0) {
            return reject(new Error("Semua file media kosong dari Instaloader"));
          }
          
          console.log(`[Scraper] ✅ Instaloader: ${mediaItems.length} media, profile: ${profileName || 'unknown'}`);
          
          resolve({
            platform: "instagram",
            type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
            shortcode: shortcode,
            author: profileName || "Instagram User",
            caption: "",
            title: "",
            timestamp: null,
            likeCount: 0,
            commentCount: 0,
            viewCount: 0,
            duration: null,
            mediaItems: mediaItems,
            source: "instaloader",
            warning: null
          });
        } catch (fsErr) {
          try {
            fs.rmSync(tempBaseDir, { recursive: true, force: true });
          } catch (e) {}
          reject(new Error(`File system error: ${fsErr.message}`));
        }
      });
      });  // closes pythonCmd exec
    });
  });
}

// ─── Instagram Direct API (Priority method untuk foto) ────────────────────────────
// Menggunakan 4 metode langsung ke Instagram: EmbedAPI, GraphQL, HTML Scrape, oEmbed
// Ini adalah metode PRIORITAS UTAMA untuk foto Instagram.

async function scrapeInstagramViaDirectAPI(url) {
  console.log("[Scraper] Mencoba Direct API (EmbedAPI + GraphQL + HTML Scrape + oEmbed)...");

  const shortcode = extractShortcode(url);
  if (!shortcode) throw new Error("Shortcode tidak ditemukan dari URL");

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  // Helper: deduplicate items by URL
  function dedupeItems(items) {
    const seen = new Set();
    return items.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  // Helper: map raw items ke format internal scraper
  function toMediaItems(rawItems) {
    return rawItems.map((item, i) => ({
      type: item.type,
      url: item.url,
      thumbnail: item.url,
      width: null,
      height: null,
      duration: null,
      ext: item.type === "video" ? "mp4" : "jpg",
      formats: [{
        type: item.type,
        quality: item.type === "video" ? "HD" : (i === 0 ? "HD" : `HD Foto ${i + 1}`),
        url: item.url,
        ext: item.type === "video" ? "mp4" : "jpg"
      }]
    }));
  }

  // Helper: parse node media (sama persis dengan server.js lama)
  function extractFromMediaNode(media) {
    const items = [];
    const carousel = media.carousel_media || media.edge_sidecar_to_children?.edges?.map(e => e.node);
    if (carousel && carousel.length > 0) {
      for (const node of carousel) {
        if (node.video_versions?.length > 0) {
          items.push({ type: "video", url: node.video_versions[0].url });
        } else if (node.image_versions2?.candidates?.length > 0) {
          items.push({ type: "image", url: node.image_versions2.candidates[0].url });
        } else if (node.video_url) {
          items.push({ type: "video", url: node.video_url });
        } else if (node.display_url) {
          const best = node.display_resources?.[node.display_resources.length - 1]?.src || node.display_url;
          items.push({ type: "image", url: best });
        }
      }
      return items;
    }
    if (media.video_versions?.length > 0) { items.push({ type: "video", url: media.video_versions[0].url }); return items; }
    if (media.video_url) { items.push({ type: "video", url: media.video_url }); return items; }
    if (media.image_versions2?.candidates?.length > 0) { items.push({ type: "image", url: media.image_versions2.candidates[0].url }); return items; }
    if (media.display_url) {
      const best = media.display_resources?.[media.display_resources.length - 1]?.src || media.display_url;
      items.push({ type: "image", url: best });
      return items;
    }
    return items;
  }

  function cleanUrl(u) {
    return u.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  function isThumbnail(u) {
    // Skip berdasarkan ukuran kecil
    if (/s150x150|s320x320|s640x640|s480x480|s240x240|s44x44|s64x64|s32x32/.test(u)) return true;
    // Skip foto profil
    if (/profile_pic|_nc_sid=f7ccc5/.test(u)) return true;
    // Skip path profil /v/t51.2885-19/
    if (/\/v\/t51\.2885-19\//.test(u)) return true;
    // Skip path logo/UI Instagram /v/t51.2885-15/ (angka 2885 = aset UI/logo)
    if (/\/v\/t51\.2885-15\//.test(u)) return true;
    // Skip static assets
    if (/\/static\/|\/rsrc\.php|\.png.*[?&]_nc_cat=1[^0-9]/.test(u)) return true;
    // Skip aset logo Instagram (dimensi sangat kecil dalam path)
    if (/\/[0-9]+x[0-9]+\//.test(u)) {
      const dimMatch = u.match(/\/(\d+)x(\d+)\//);
      if (dimMatch && parseInt(dimMatch[1]) <= 320 && parseInt(dimMatch[2]) <= 320) return true;
    }
    // Skip URL yang mengandung "logo" atau "icon"
    if (/\/logo[_-]|[_-]logo\/|\/icon[_-]|[_-]icon\//.test(u)) return true;
    return false;
  }

  // Cek apakah URL adalah foto konten post (bukan logo/UI)
  // Foto post pakai path /v/t51.XXXXX-15/ dimana XXXXX != 2885
  // Video pakai path /v/t50.XXXXX-XX/
  function isPostMedia(u) {
    try {
      const path = new URL(u).pathname;
      // Foto post: t51 dengan type number selain 2885
      if (/\/v\/t51\.(?!2885)\d+-15\//.test(path)) return true;
      // Video post: t50
      if (/\/v\/t50\./.test(path)) return true;
      // Format lama tanpa path /v/
      if (/\/(e15|e35)\//.test(u)) return true;
      // Kalau ada efg param dengan CAROUSEL atau IMAGE = pasti foto post
      if (u.includes('CAROUSEL') || u.includes('_nc_cat=')) return true;
      // Format URL CDN Instagram yang punya _nc_ht param (CDN signed URL untuk konten)
      if (u.includes('_nc_ht=') && !u.includes('profile_pic')) return true;
      // Jika URL CDN Instagram tidak cocok pola t51/t50, tetapi mengandung ig_cache_key = konten post
      if (u.includes('ig_cache_key=')) return true;
      return false;
    } catch { return false; }
  }

  // Cek apakah URL adalah CDN Instagram yang valid
  // Format domain CDN Instagram yang diketahui:
  // - scontent*.fbcdn.net  /  scontent*.cdninstagram.com
  // - instagram.f[kode]-[n].fna.fbcdn.net  (regional CDN baru)
  // - *.cdninstagram.com
  function isInstagramCdn(u) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      return (
        /^scontent[\w-]*\.fbcdn\.net$/.test(host) ||
        /^scontent[\w-]*\.cdninstagram\.com$/.test(host) ||
        /^instagram\.[\w]+-\d+\.fna\.fbcdn\.net$/.test(host) ||
        /^[\w-]+\.cdninstagram\.com$/.test(host) ||
        /^video[\w-]*\.fbcdn\.net$/.test(host) ||
        host.endsWith('.fbcdn.net') ||
        host.endsWith('.cdninstagram.com')
      );
    } catch { return false; }
  }

  // ── Metode A: EmbedAPI (?__a=1) ──
  async function tryEmbedAPI() {
    const resp = await axios.get(`https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`, {
      headers: { "User-Agent": UA, "Accept": "application/json, text/html" },
      timeout: 10000
    });
    const media = resp.data?.graphql?.shortcode_media || resp.data?.items?.[0];
    if (!media) return null;
    return extractFromMediaNode(media);
  }

  // ── Metode B: GraphQL API (dengan header lengkap dari DevTools) ──
  async function tryGraphQLAPI() {
    // Ambil lsd token dulu dari halaman HTML (wajib untuk GraphQL)
    let lsd = "LSD_TOKEN";
    let fb_dtsg = null;
    let __rev = "1041135829";
    try {
      const homeResp = await axios.get(`https://www.instagram.com/p/${shortcode}/`, {
        headers: { "User-Agent": UA, "Accept": "text/html" },
        timeout: 10000
      });
      const html = homeResp.data;

      // Extract lsd
      const lsdMatch = html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/) ||
                       html.match(/"lsd":"([^"]+)"/) ||
                       html.match(/lsd[^"]*"[^"]*"[^"]*"([^"]{10,30})"/);
      if (lsdMatch?.[1]) lsd = lsdMatch[1];

      // Extract fb_dtsg
      const dtsgMatch = html.match(/"dtsg":\{"token":"([^"]+)"/) ||
                        html.match(/"token":"([^"]+)","ttl"/) ||
                        html.match(/fb_dtsg[^"]*"[^"]*"([^"]{20,60})"/);
      if (dtsgMatch?.[1]) fb_dtsg = dtsgMatch[1];

      // Extract __rev
      const revMatch = html.match(/"client_revision":(\d+)/);
      if (revMatch?.[1]) __rev = revMatch[1];
    } catch (e) {}

    // Hitung jazoest dari fb_dtsg
    const jazoest = fb_dtsg
      ? "2" + fb_dtsg.split("").reduce((s, c) => s + c.charCodeAt(0), 0)
      : "26347";

    const params = new URLSearchParams({
      // Meta params (dari DevTools capture)
      v:                           "17841416365540553",
      __d:                         "www",
      __user:                      "0",
      __a:                         "1",
      __req:                       "l",
      __ccg:                       "GOOD",
      __rev:                       __rev,
      __comet_req:                 "7",
      // Token keamanan
      ...(fb_dtsg && { fb_dtsg }),
      jazoest:                     jazoest,
      lsd:                         lsd,
      // GraphQL query
      fb_api_caller_class:         "RelayModern",
      fb_api_req_friendly_name:    "PolarisPostPageQuery",
      doc_id:                      "8848219501932392",
      server_timestamps:           "true",
      variables:                   JSON.stringify({ shortcode }),
    });

    const resp = await axios.post(
      "https://www.instagram.com/api/graphql",
      params.toString(),
      {
        headers: {
          "User-Agent":             UA,
          "Content-Type":          "application/x-www-form-urlencoded",
          "Accept":                "*/*",
          "Accept-Language":       "en-US,en;q=0.9",
          "Origin":                "https://www.instagram.com",
          "Referer":               `https://www.instagram.com/p/${shortcode}/`,
          "X-ASBD-ID":             "359341",
          "X-CSRFToken":           lsd,
          "X-FB-Friendly-Name":    "PolarisPostPageQuery",
          "X-FB-LSD":              lsd,
          "X-IG-App-ID":           "936619743392459",
          "X-IG-Max-Touch-Points": "0",
          "Sec-Fetch-Dest":        "empty",
          "Sec-Fetch-Mode":        "cors",
          "Sec-Fetch-Site":        "same-origin",
        },
        timeout: 15000
      }
    );

    const media = resp.data?.data?.xdt_shortcode_media;
    if (!media) return null;
    return extractFromMediaNode(media);
  }

  // ── Metode B2: GraphQL dengan doc_id alternatif (carousel-specific) ──
  async function tryGraphQLCarousel() {
    // doc_id ini khusus untuk PolarisPostPageQuery yang mengembalikan carousel penuh
    const DOC_IDS = [
      "8848219501932392",   // PolarisPostPageQuery (default)
      "9496029880496264",   // versi lain PolarisPostPageQuery
      "17991233890457605",  // versi lama tapi masih aktif
    ];

    for (const doc_id of DOC_IDS) {
      try {
        const params = new URLSearchParams({
          variables:                   JSON.stringify({ shortcode, __relay_internal__pv__PolarisFeedShareMenurelayprovider: false }),
          doc_id,
          fb_api_req_friendly_name:    "PolarisPostPageQuery",
          server_timestamps:           "true",
          __a:                         "1",
          __user:                      "0",
          __comet_req:                 "7",
        });

        const resp = await axios.post(
          "https://www.instagram.com/api/graphql",
          params.toString(),
          {
            headers: {
              "User-Agent":          UA,
              "Content-Type":        "application/x-www-form-urlencoded",
              "Accept":              "*/*",
              "Origin":              "https://www.instagram.com",
              "Referer":             `https://www.instagram.com/p/${shortcode}/`,
              "X-IG-App-ID":         "936619743392459",
              "X-FB-LSD":            "AVqbxe3J_YA",
              "X-ASBD-ID":           "359341",
              "Sec-Fetch-Dest":      "empty",
              "Sec-Fetch-Mode":      "cors",
              "Sec-Fetch-Site":      "same-origin",
            },
            timeout: 12000
          }
        );

        const media = resp.data?.data?.xdt_shortcode_media;
        if (media) {
          const items = extractFromMediaNode(media);
          if (items.length > 0) return items;
        }
      } catch (e) {}
    }
    return null;
  }

  // ── Metode C: HTML Scrape ──
  async function tryHTMLScrape() {
    const resp = await axios.get(`https://www.instagram.com/p/${shortcode}/`, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 15000
    });
    const html = resp.data;
    const items = [];

    // JSON-LD
    const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
    if (ldMatch) {
      try {
        const ld = JSON.parse(ldMatch[1]);
        const arr = Array.isArray(ld) ? ld : [ld];
        for (const obj of arr) {
          if (obj.contentUrl) items.push({ type: "video", url: obj.contentUrl });
          if (obj.url && obj["@type"] === "ImageObject") items.push({ type: "image", url: obj.url });
          if (Array.isArray(obj.image)) obj.image.forEach(img => { if (img.url) items.push({ type: "image", url: img.url }); });
        }
        if (items.length > 0) return items;
      } catch (e) {}
    }

    // Deep-search carousel dari semua blok JSON embedded di HTML
    // Instagram menyimpan data di window.__additionalDataLoaded / require("TimeSliceImpl")
    const jsonBlockRegex = /\{[^{}]*"carousel_media"[^{}]*\[.*?\]\s*\}/gs;
    for (const m of html.matchAll(jsonBlockRegex)) {
      try {
        const obj = JSON.parse(m[0]);
        const found = extractFromMediaNode(obj);
        if (found.length > 1) return found; // carousel berhasil
      } catch (e) {}
    }

    // Cari semua display_url — ini yang paling andal untuk carousel
    // Instagram menyertakan satu display_url per foto dalam array carousel
    // Support dua format: escaped (\/\/) dan normal (//)
    const displayUrls = [];
    const seenDisplay = new Set();
    // Format escaped: "display_url":"https:\/\/..." (JSON di dalam JS string)
    // Format normal:  "display_url":"https://..."
    const displayPatternsStr = [
      '"display_url":"(https?:\\/\\/[^"]+)"',  // escaped \/ \/
      '"display_url":"(https?://[^"]+)"',           // normal //
    ];
    for (const patStr of displayPatternsStr) {
      const re = new RegExp(patStr, 'g');
      for (const m of html.matchAll(re)) {
        const u = cleanUrl(m[1]);
        if (isThumbnail(u)) continue;
        if (u.includes("profile_pic")) continue;
        if (!isInstagramCdn(u)) continue;
        if (!isPostMedia(u)) continue;
        if (seenDisplay.has(u)) continue;
        seenDisplay.add(u);
        displayUrls.push({ type: "image", url: u });
      }
    }
    if (displayUrls.length > 0) return displayUrls;

    // Regex CDN fallback — support semua domain CDN Instagram
    // Termasuk format baru: instagram.f[kode]-[n].fna.fbcdn.net
    const urlSet = new Set();
    // Regex generik: tangkap semua URL dari domain fbcdn.net atau cdninstagram.com
    const cdnRegex = /"(https:\/\/[^"]*\.(?:fbcdn\.net|cdninstagram\.com)[^"]*)"/g;
    for (const m of html.matchAll(cdnRegex)) {
      const u = cleanUrl(m[1]);
      if (!isThumbnail(u) && isInstagramCdn(u) && isPostMedia(u)) urlSet.add(u);
    }
    // Juga tangkap dari key "url" saja
    for (const m of html.matchAll(new RegExp('"url":"(https?://[^"]+)"', 'g'))) {
      const u = cleanUrl(m[1]);
      if (!isThumbnail(u) && isInstagramCdn(u) && isPostMedia(u)) urlSet.add(u);
    }
    for (const u of urlSet) items.push({ type: "image", url: u });
    if (items.length > 0) return items;
    return null;
  }  // ── Metode D: oEmbed redirect ──
  async function tryOEmbed() {
    const resp = await axios.get(`https://www.instagram.com/p/${shortcode}/media/?size=l`, {
      headers: { "User-Agent": UA },
      maxRedirects: 5,
      timeout: 10000,
      validateStatus: s => s < 400
    });
    const finalUrl = resp.request?.res?.responseUrl || resp.request?.responseURL || "";
    if (finalUrl && (finalUrl.includes("fbcdn") || finalUrl.includes("cdninstagram"))) {
      const ct = resp.headers["content-type"] || "";
      return [{ type: ct.includes("video") ? "video" : "image", url: finalUrl }];
    }
    return null;
  }

  // Jalankan semua metode secara paralel
  const results = await Promise.allSettled([
    tryEmbedAPI(),
    tryGraphQLAPI(),
    tryGraphQLCarousel(),
    tryHTMLScrape(),
    tryOEmbed()
  ]);

  // Kumpulkan semua hasil yang valid, lalu gabungkan semua URL unik
  // agar carousel dengan banyak foto tidak kehilangan item
  const allRawItems = [];
  const globalSeen = new Set();

  for (const r of results) {
    if (r.status === "fulfilled" && r.value && r.value.length > 0) {
      for (const item of r.value) {
        if (!globalSeen.has(item.url)) {
          globalSeen.add(item.url);
          allRawItems.push(item);
        }
      }
    }
  }

  // Fallback: jika penggabungan kosong, coba ambil hasil terbanyak dari satu metode
  let rawItems = allRawItems;
  if (rawItems.length === 0) {
    let best = null;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value && r.value.length > 0) {
        if (!best || r.value.length > best.length) best = r.value;
      }
    }
    rawItems = best || [];
  }

  if (!rawItems || rawItems.length === 0) {
    throw new Error("Direct API: semua 4 metode (EmbedAPI, GraphQL, HTML Scrape, oEmbed) gagal");
  }

  const unique = dedupeItems(rawItems);
  const mediaItems = toMediaItems(unique);

  // Fetch real username via embed page (works without login)
  let realAuthor = "Instagram User";
  let realCaption = "";
  try {
    const embedResp = await axios.get(
      `https://www.instagram.com/p/${shortcode}/embed/`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, timeout: 8000 }
    );
    const html = embedResp.data;
    const usernameMatch = html.match(/class="Username">([^<]+)/);
    if (usernameMatch?.[1]) realAuthor = usernameMatch[1].trim();
    const captionMatch = html.match(/class="Caption"[^>]*>([^<]+)/);
    if (captionMatch?.[1]) realCaption = captionMatch[1].trim();
  } catch (e) {}

  return {
    platform: "instagram",
    type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
    shortcode,
    author: realAuthor,
    caption: realCaption,
    title: realCaption,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems,
    source: "direct_api",
    warning: null
  };
}

// ─── Instagram Simple Fallback (Direct CDN) ──────────────────────────────────────

async function scrapeInstagramSimple(url) {
  console.log("[Scraper] Mencoba metode Simple (embed fallback)...");
  
  try {
    // Ambil halaman Instagram langsung
    const response = await axios.get(url, {
      headers: {
        "User-Agent": IG_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml"
      },
      timeout: 10000
    });

    const html = response.data;
    
    // Cek apakah ini reel/video atau foto
    const isReel = url.includes('/reel/') || url.includes('/reels/');
    const isVideo = html.includes('"is_video":true') || html.includes('video_url') || isReel;
    
    if (isVideo) {
      // Untuk VIDEO/REEL: Cari URL video
      const vidRegex1 = /"video_url":"([^"]+)"/;
      const vidRegex2 = /"playback_url":"([^"]+)"/;
      
      let videoUrl = null;
      
      // Extract video URL
      const match1 = html.match(vidRegex1);
      if (match1) {
        videoUrl = match1[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      } else {
        const match2 = html.match(vidRegex2);
        if (match2) {
          videoUrl = match2[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        }
      }
      
      if (!videoUrl) {
        throw new Error("URL video tidak ditemukan");
      }
      
      // Ambil thumbnail untuk video
      const imgRegex = /https:\/\/[^"'\s]*scontent[^"'\s]*\.jpg[^"'\s]*/i;
      const thumbnailMatch = html.match(imgRegex);
      const thumbnail = thumbnailMatch ? thumbnailMatch[0].replace(/\\u0026/g, '&').replace(/\\/g, '') : videoUrl;
      
      // Extract username
      let username = "Instagram User";
      const usernameMatch = html.match(/"username":"([^"]+)"/);
      if (usernameMatch && usernameMatch[1]) {
        username = usernameMatch[1];
      }
      
      return {
        platform: "instagram",
        type: "video",
        shortcode: extractShortcode(url) || "simple",
        author: username,
        caption: "",
        title: "",
        timestamp: null,
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        duration: null,
        mediaItems: [{
          type: "video",
          url: videoUrl,
          thumbnail: thumbnail,
          width: null,
          height: null,
          duration: null,
          ext: 'mp4',
          formats: [{ type: "video", quality: "HD", url: videoUrl, ext: 'mp4' }]
        }],
        source: "simple_scraper",
        warning: null
      };
    } else {
      // Untuk FOTO / CAROUSEL: Ambil SEMUA foto dari JSON di HTML (support slide)
      const photoUrls = [];
      const seenUrls = new Set();
      
      // Metode 1: Ambil SEMUA "display_url" dari JSON (support carousel)
      const displayUrlRegex = /"display_url":"([^"]+)"/g;
      let dm;
      while ((dm = displayUrlRegex.exec(html)) !== null) {
        const photoUrl = dm[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        if (photoUrl.includes('profile_pic')) continue;
        if (photoUrl.includes('/v/t51.2885-19/')) continue;
        if (photoUrl.includes('static.cdninstagram.com')) continue;
        if (!seenUrls.has(photoUrl)) { seenUrls.add(photoUrl); photoUrls.push(photoUrl); }
      }
      
      // Metode 2: Fallback regex scontent CDN jika tidak ada display_url
      if (photoUrls.length === 0) {
        const imgRegex = /https:\/\/[^"'\s]*(?:scontent|cdninstagram)[^"'\s]*\.jpg[^"'\s]*/gi;
        const imgMatches = html.match(imgRegex) || [];
        imgMatches
          .map(img => img.replace(/\\u0026/g, '&').replace(/\\/g, ''))
          .filter(img => {
            if (img.includes('profile_pic')) return false;
            if (img.includes('/v/t51.2885-19/')) return false;
            if (img.includes('150x150') || img.includes('s150x150')) return false;
            if (img.includes('44x44') || img.includes('s320x320')) return false;
            if (img.includes('static.cdninstagram.com')) return false;
            return true;
          })
          .sort((a, b) => b.length - a.length)
          .forEach(img => {
            if (!seenUrls.has(img)) { seenUrls.add(img); photoUrls.push(img); }
          });
      }
      
      console.log(`[Scraper] Simple: Ditemukan ${photoUrls.length} foto (carousel support)`);
      
      if (photoUrls.length === 0) {
        throw new Error("Tidak ditemukan foto post di halaman Instagram");
      }
      
      // Extract username
      let username = "Instagram User";
      const usernameMatch = html.match(/"username":"([^"]+)"/);
      if (usernameMatch && usernameMatch[1]) {
        username = usernameMatch[1];
      }
      
      // Build mediaItems dari SEMUA foto (carousel support)
      const mediaItemsImg = photoUrls.map((photoUrl, i) => ({
        type: "image",
        url: photoUrl,
        thumbnail: photoUrl,
        width: null, height: null, duration: null,
        ext: 'jpg',
        formats: [{ type: "image", quality: i === 0 ? "HD" : `HD Foto ${i + 1}`, url: photoUrl, ext: 'jpg' }]
      }));
      
      return {
        platform: "instagram",
        type: mediaItemsImg.length > 1 ? "playlist" : "image",
        shortcode: extractShortcode(url) || "simple",
        author: username,
        caption: "",
        title: "",
        timestamp: null,
        likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
        mediaItems: mediaItemsImg,
        source: "simple_scraper",
        warning: null
      };
    }
  } catch (err) {
    throw new Error("Simple scraper gagal: " + err.message);
  }
}

// ─── Playwright Instagram Fallback (Download Direct + Carousel Support) ──────────

async function scrapeInstagramViaPlaywright(url) {
  let browser;
  const axios = require('axios');
  
  try {
    const { chromium } = require('playwright');
    console.log("[Scraper] Mencoba Playwright untuk Instagram (carousel-aware)...");
    
    // Launch browser
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();
    
    // Block heavy resources for speed
    await page.route('**/*.{woff,woff2,ttf}', route => route.abort());
    await page.route('**/*.mp4', route => route.abort());

    // Navigate to the post
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for content to render
    await page.waitForTimeout(5000);

    // Dismiss login wall if present (click "Not now" or close button)
    try {
      const notNowBtn = await page.$('text=Not now');
      if (notNowBtn) await notNowBtn.click();
      await page.waitForTimeout(1000);
    } catch (e) {}
    try {
      // Try clicking outside the modal or pressing Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch (e) {}

    // Check if this is a reel/video
    const isReel = url.includes('/reel/') || url.includes('/reels/');

    // Extract ALL carousel images by clicking through the "Next" button
    const result = await page.evaluate((isReelUrl) => {
      // Helper: check if URL is a post image (not profile pic, not tiny thumbnail)
      function isPostImage(src) {
        if (!src) return false;
        if (!src.includes('fbcdn.net') && !src.includes('cdninstagram.com')) return false;
        if (src.includes('profile_pic') || src.includes('/v/t51.2885-19/')) return false;
        if (src.includes('s150x150') || src.includes('s320x320') || src.includes('44x44') || src.includes('s480x480')) return false;
        if (src.includes('/v/t51.2885-15/')) return false; // logo/UI assets
        return true;
      }

      // Collect images from carousel <li> elements or main post area
      function collectCarouselImages() {
        const images = [];
        const seen = new Set();
        
        // Method 1: Get images from <li> elements (Instagram carousel uses <ul><li>)
        const listItems = document.querySelectorAll('main li img, main ul li img');
        listItems.forEach(img => {
          const src = img.src || '';
          if (isPostImage(src) && !seen.has(src)) {
            seen.add(src);
            images.push(src);
          }
        });
        
        // Method 2: If no <li> images, get from all visible post images
        if (images.length === 0) {
          const allImgs = Array.from(document.querySelectorAll('main img'));
          allImgs.forEach(img => {
            const src = img.src || '';
            if (isPostImage(src) && !seen.has(src) && img.naturalWidth > 200) {
              seen.add(src);
              images.push(src);
            }
          });
        }
        
        return images;
      }

      // Get video URLs for reels
      const videos = Array.from(document.querySelectorAll('video'));
      const videoUrls = videos
        .map(vid => vid.src || vid.querySelector('source')?.src)
        .filter(src => src && (src.includes('scontent') || src.includes('cdninstagram') || src.includes('fbcdn')));
      
      // Collect carousel images
      const carouselImages = collectCarouselImages();
      
      // Extract username
      let username = "Instagram User";
      const title = document.title;
      if (title) {
        const titleMatch = title.match(/^([^\s]+)\s+on Instagram/i) || 
                         title.match(/Instagram.*by\s+@?([^\s:]+)/i);
        if (titleMatch && titleMatch[1]) {
          username = titleMatch[1].replace('@', '');
        }
      }
      // Also try from page links
      const profileLink = document.querySelector('main a[href^="/"]');
      if (profileLink) {
        const href = profileLink.getAttribute('href') || '';
        const match = href.match(/^\/([^\/]+)\/?$/);
        if (match && match[1] && !['explore', 'reels', 'direct'].includes(match[1])) {
          username = match[1];
        }
      }
      
      // Check if there's a "Next" button (indicates carousel)
      const hasNextButton = !!document.querySelector('main [aria-label="Next"], main button:has-text("Next")');
      
      return { 
        video: videoUrls[0] || null,
        carouselImages,
        username,
        hasNextButton,
        isCarousel: carouselImages.length > 1 || hasNextButton
      };
    }, isReel);

    // If carousel detected, click through "Next" to load ALL images
    if (result.hasNextButton && result.carouselImages.length <= 1) {
      console.log("[Scraper] Carousel detected, clicking through slides...");
      for (let i = 0; i < 15; i++) { // max 15 slides
        try {
          const nextBtn = await page.$('main [aria-label="Next"], main button:has-text("Next")');
          if (!nextBtn) break;
          await nextBtn.click();
          await page.waitForTimeout(1500);
        } catch (e) { break; }
      }
      // Re-collect images after clicking through all slides
      const updatedImages = await page.evaluate(() => {
        function isPostImage(src) {
          if (!src) return false;
          if (!src.includes('fbcdn.net') && !src.includes('cdninstagram.com')) return false;
          if (src.includes('profile_pic') || src.includes('/v/t51.2885-19/')) return false;
          if (src.includes('s150x150') || src.includes('s320x320') || src.includes('44x44')) return false;
          return true;
        }
        const images = [];
        const seen = new Set();
        const allImgs = Array.from(document.querySelectorAll('main img'));
        allImgs.forEach(img => {
          const src = img.src || '';
          if (isPostImage(src) && !seen.has(src) && img.naturalWidth > 200) {
            seen.add(src);
            images.push(src);
          }
        });
        return images;
      });
      if (updatedImages.length > result.carouselImages.length) {
        result.carouselImages = updatedImages;
      }
    }

    // Build media items
    const mediaItems = [];
    
    if (result.video && isReel) {
      // Video/Reel
      mediaItems.push({
        type: "video",
        url: result.video,
        thumbnail: result.carouselImages[0] || result.video,
        width: null,
        height: null,
        duration: null,
        ext: 'mp4',
        formats: [{ type: "video", quality: "HD", url: result.video, ext: 'mp4' }]
      });
    } else if (result.carouselImages.length > 0) {
      // Foto / Carousel — return ALL images
      console.log(`[Scraper] Playwright: ditemukan ${result.carouselImages.length} foto`);
      for (let i = 0; i < result.carouselImages.length; i++) {
        const imgUrl = result.carouselImages[i];
        mediaItems.push({
          type: "image",
          url: imgUrl,
          thumbnail: imgUrl,
          width: null,
          height: null,
          duration: null,
          ext: 'jpg',
          formats: [{
            type: "image",
            quality: i === 0 ? "HD" : `HD Foto ${i + 1}`,
            url: imgUrl,
            ext: 'jpg'
          }]
        });
      }
    }

    if (mediaItems.length === 0) {
      throw new Error("Media tidak ditemukan via Playwright");
    }

    console.log(`[Scraper] ✅ Playwright berhasil: ${mediaItems.length} media item${mediaItems.length > 1 ? 's (carousel)' : ''}`);

    return {
      platform: "instagram",
      type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
      shortcode: extractShortcode(url) || "playwright",
      author: result.username,
      caption: "",
      title: "",
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems,
      source: "playwright",
      warning: null
    };
  } catch (err) {
    throw new Error("Playwright gagal: " + err.message);
  } finally {
    if (browser) {
      await browser.close().catch(console.error);
    }
  }
}

// ─── TikTok TikWM API fallback ─────────────────────────────────────────────────

async function scrapeViaTikwmAPI(url) {
  console.log("[Scraper] Mencoba TikWM API...");

  // Tambahkan hd=1 agar TikWM mengembalikan URL HD (hdplay) tanpa watermark
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
  const response = await axios.get(apiUrl, { timeout: 15000 });

  const data = response.data;
  if (!data || data.code !== 0 || !data.data) {
    throw new Error("TikWM API tidak mengembalikan data yang valid");
  }

  const item = data.data;
  
  // TikWM API menyediakan beberapa URL video:
  // item.hdplay = HD tanpa watermark (kualitas terbaik, tidak selalu tersedia)
  // item.play   = SD tanpa watermark
  // item.wmplay = dengan watermark TikTok
  // item.music  = audio MP3
  const isVideo = !!(item.play || item.hdplay);
  const isImage = !!item.images; // Photo slide
  
  const mediaItems = [];
  
  if (isVideo) {
    const noWmUrl = item.hdplay || item.play; // Prioritaskan HD, fallback ke SD
    const formats = [];

    // Tambahkan pilihan HD tanpa watermark jika tersedia
    if (item.hdplay) {
      formats.push({ type: "video", quality: "HD No Watermark", url: item.hdplay, ext: "mp4" });
    }

    // Tambahkan SD tanpa watermark jika berbeda dari HD
    if (item.play && item.play !== item.hdplay) {
      formats.push({ type: "video", quality: "No Watermark", url: item.play, ext: "mp4" });
    } else if (!item.hdplay && item.play) {
      formats.push({ type: "video", quality: "No Watermark", url: item.play, ext: "mp4" });
    }

    // Tambahkan versi dengan watermark
    if (item.wmplay) {
      formats.push({ type: "video", quality: "With Watermark", url: item.wmplay, ext: "mp4" });
    }

    // Tambahkan audio jika tersedia
    if (item.music) {
      formats.push({ type: "audio", quality: "Audio", url: item.music, ext: "mp3" });
    }

    mediaItems.push({
      type: "video",
      url: noWmUrl,
      thumbnail: item.cover,
      width: item.width || null,
      height: item.height || null,
      duration: item.duration || null,
      ext: "mp4",
      formats
    });
  } else if (isImage && item.images.length > 0) {
    item.images.forEach((imgUrl, i) => {
      mediaItems.push({
        type: "image",
        url: imgUrl,
        thumbnail: imgUrl,
        width: null,
        height: null,
        duration: null,
        ext: "jpg",
        formats: [
          { type: "image", quality: `Image ${i+1}`, url: imgUrl, ext: "jpg" }
        ]
      });
    });
  } else {
    throw new Error("Tipe media tidak dikenali oleh TikWM API");
  }

  return {
    platform: "tiktok",
    type: isVideo ? "video" : "playlist",
    shortcode: item.id || "",
    author: item.author?.unique_id || "unknown",
    caption: item.title || "",
    title: item.title || "",
    timestamp: item.create_time || null,
    likeCount: item.digg_count || 0,
    commentCount: item.comment_count || 0,
    viewCount: item.play_count || 0,
    duration: item.duration || null,
    mediaItems: mediaItems,
    source: "tikwm",
    warning: null
  };
}

// ─── @tobyg74/tiktok-api-dl (Tiktok Downloader) ──────────────────────────────
async function scrapeViaTikTokApiDl(url) {
  console.log("[Scraper] Mencoba @tobyg74/tiktok-api-dl...");
  
  // Downloader bisa meng-handle video & image slide
  const data = await Tiktok.Downloader(url, { version: "v1" });
  if (!data || data.status !== "success" || !data.result) {
    throw new Error(data?.message || "tiktok-api-dl tidak mengembalikan data yang valid");
  }

  const res = data.result;
  const isVideo = res.type === "video";
  const isImage = res.type === "image";
  const mediaItems = [];

  if (isVideo && res.video) {
    // Video type
    // playAddr = streaming URL tanpa watermark (prioritaskan ini)
    // downloadAddr = URL download resmi TikTok, biasanya mengandung watermark
    const playAddr = res.video.playAddr && res.video.playAddr[0] ? res.video.playAddr[0] : null;
    const downloadAddr = res.video.downloadAddr && res.video.downloadAddr[0] ? res.video.downloadAddr[0] : null;
    const cover = res.video.cover && res.video.cover[0] ? res.video.cover[0] : null;

    // Gunakan playAddr sebagai URL utama (tanpa watermark)
    const noWatermarkUrl = playAddr || downloadAddr;
    const withWatermarkUrl = downloadAddr || playAddr;

    if (noWatermarkUrl) {
      const formats = [
        { type: "video", quality: "No Watermark", url: noWatermarkUrl, ext: "mp4" },
      ];

      // Jika downloadAddr tersedia dan berbeda dari playAddr, tawarkan juga versi dengan watermark
      if (withWatermarkUrl && withWatermarkUrl !== noWatermarkUrl) {
        formats.push({ type: "video", quality: "With Watermark", url: withWatermarkUrl, ext: "mp4" });
      }

      // Tambahkan audio jika tersedia
      if (res.music && res.music.playUrl && res.music.playUrl[0]) {
        formats.push({ type: "audio", quality: "Audio", url: res.music.playUrl[0], ext: "mp3" });
      }

      mediaItems.push({
        type: "video",
        url: noWatermarkUrl,
        thumbnail: cover,
        width: null,
        height: null,
        duration: res.video.duration || null,
        ext: "mp4",
        formats
      });
    }
  } else if (isImage && res.images && res.images.length > 0) {
    // Image slide type
    res.images.forEach((imgUrl, i) => {
      mediaItems.push({
        type: "image",
        url: imgUrl,
        thumbnail: imgUrl,
        width: null,
        height: null,
        duration: null,
        ext: "jpg",
        formats: [
          { type: "image", quality: `Foto Slide ${i+1}`, url: imgUrl, ext: "jpg" }
        ]
      });
    });

    // Tambahkan background music jika ada
    if (res.music && res.music.playUrl && res.music.playUrl[0]) {
      mediaItems[0].formats.push({ type: "audio", quality: "Audio Musik", url: res.music.playUrl[0], ext: "mp3" });
    }
  }

  if (mediaItems.length === 0) {
    throw new Error("Tidak ditemukan media dari link tersebut oleh tiktok-api-dl");
  }

  return {
    platform: "tiktok",
    type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
    shortcode: res.id || "",
    author: res.author?.nickname || "TikTok User",
    caption: res.description || "",
    title: res.description || "TikTok Video",
    timestamp: res.createTime || null,
    likeCount: res.statistics?.likeCount || 0,
    commentCount: res.statistics?.commentCount || 0,
    viewCount: res.statistics?.playCount || 0,
    duration: null,
    mediaItems: mediaItems,
    source: "tiktok-api-dl",
    warning: null
  };
}

// ─── @tobyg74/tiktok-api-dl v3 (MusicalDown) — HD No Watermark ───────────────
async function scrapeViaTikTokApiDlV3(url) {
  console.log("[Scraper] Mencoba @tobyg74/tiktok-api-dl v3 (MusicalDown HD)...");

  const data = await Tiktok.Downloader(url, { version: "v3" });
  if (!data || data.status !== "success" || !data.result) {
    throw new Error(data?.message || "tiktok-api-dl v3 tidak mengembalikan data yang valid");
  }

  const res = data.result;
  const isVideo = res.type === "video";
  const isImage = res.type === "image";
  const mediaItems = [];

  if (isVideo) {
    // v3 mengembalikan: videoHD (HD tanpa watermark), videoWatermark (dengan watermark)
    const hdUrl = res.videoHD || null;
    const wmUrl = res.videoWatermark || null;
    const bestUrl = hdUrl || wmUrl;

    if (!bestUrl) {
      throw new Error("Tidak ada URL video dari tiktok-api-dl v3");
    }

    const formats = [];
    if (hdUrl) {
      formats.push({ type: "video", quality: "HD No Watermark", url: hdUrl, ext: "mp4" });
    }
    if (wmUrl) {
      formats.push({ type: "video", quality: "With Watermark", url: wmUrl, ext: "mp4" });
    }
    if (res.music) {
      formats.push({ type: "audio", quality: "Audio", url: res.music, ext: "mp3" });
    }

    mediaItems.push({
      type: "video",
      url: bestUrl,
      thumbnail: null,
      width: null,
      height: null,
      duration: null,
      ext: "mp4",
      formats
    });
  } else if (isImage && res.images && res.images.length > 0) {
    res.images.forEach((imgUrl, i) => {
      mediaItems.push({
        type: "image",
        url: imgUrl,
        thumbnail: imgUrl,
        width: null,
        height: null,
        duration: null,
        ext: "jpg",
        formats: [
          { type: "image", quality: `Foto Slide ${i + 1}`, url: imgUrl, ext: "jpg" }
        ]
      });
    });

    if (res.music && mediaItems.length > 0) {
      mediaItems[0].formats.push({ type: "audio", quality: "Audio Musik", url: res.music, ext: "mp3" });
    }
  }

  if (mediaItems.length === 0) {
    throw new Error("Tidak ditemukan media dari tiktok-api-dl v3");
  }

  return {
    platform: "tiktok",
    type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
    shortcode: "",
    author: res.author?.nickname || "TikTok User",
    caption: res.desc || "",
    title: res.desc || "TikTok Video",
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems: mediaItems,
    source: "tiktok-api-dl-v3",
    warning: null
  };
}

// ─── Facebook Siputzx API fallback ─────────────────────────────────────────────

async function scrapeViaSiputzxAPI(url) {
  console.log("[Scraper] Mencoba Siputzx API untuk Facebook...");

  const apiUrl = `https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(url)}`;
  const response = await axios.get(apiUrl, { timeout: 15000 });

  const data = response.data;
  if (!data || data.status !== true || !data.data || !data.data.downloads) {
    throw new Error("Siputzx API tidak mengembalikan data yang valid untuk Facebook");
  }

  const item = data.data;
  const formats = [];
  
  item.downloads.forEach(dl => {
    if (dl.url) {
      formats.push({
        type: dl.type === "video" ? "video" : "audio",
        quality: dl.quality || "HD",
        url: dl.url,
        ext: "mp4" // Assuming mp4 for facebook video
      });
    }
  });

  if (formats.length === 0) {
    throw new Error("Tidak ditemukan link unduhan dari Siputzx API");
  }

  // Ambil URL dengan kualitas terbaik sebagai default url
  const bestFormat = formats.find(f => f.quality.toLowerCase().includes('hd')) || formats[0];

  return {
    platform: "facebook",
    type: "video",
    shortcode: "",
    author: "facebook_user",
    caption: item.title || "Facebook Video",
    title: item.title || "Facebook Video",
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: item.duration || null,
    mediaItems: [
      {
        type: "video",
        url: bestFormat.url,
        thumbnail: item.thumbnail || null,
        width: null,
        height: null,
        duration: item.duration || null,
        ext: "mp4",
        formats: formats
      }
    ],
    source: "siputzx",
    warning: null
  };
}

// ─── Pinterest Downloader (Multiple APIs) ────────────────────────────────────

/**
 * Pinterest downloader via API Pindl
 */
async function scrapePinterestViaPindl(url) {
  console.log("[Pinterest] Trying Pindl API...");
  
  try {
    const response = await axios.get(`https://www.pindl.in/api/pin?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
    
    if (response.data && response.data.media_url) {
      const pinId = url.match(/\/pin\/(\d+)/)?.[1] || "unknown";
      const isVideo = response.data.media_url.includes('.mp4') || response.data.type === 'video';
      
      return {
        platform: "pinterest",
        type: isVideo ? "video" : "image",
        shortcode: pinId,
        author: response.data.author || "Pinterest User",
        caption: response.data.description || "",
        title: response.data.title || response.data.description || "",
        timestamp: null,
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        duration: null,
        mediaItems: [{
          type: isVideo ? "video" : "image",
          url: response.data.media_url,
          thumbnail: response.data.thumbnail || response.data.media_url,
          width: null,
          height: null,
          duration: null,
          ext: isVideo ? 'mp4' : 'jpg',
          formats: [{
            type: isVideo ? "video" : "image",
            quality: "Original",
            url: response.data.media_url,
            ext: isVideo ? 'mp4' : 'jpg'
          }]
        }],
        source: "pindl-api",
        warning: null
      };
    }
    
    throw new Error("No media URL returned from Pindl API");
  } catch (err) {
    throw new Error(`Pindl API gagal: ${err.message}`);
  }
}

/**
 * Pinterest downloader via PinDown API
 */
async function scrapePinterestViaPinDown(url) {
  console.log("[Pinterest] Trying PinDown API...");
  
  try {
    // Extract pin ID from URL
    let pinId = url.match(/\/pin\/(\d+)/)?.[1];
    
    // If short link, resolve it first
    if (!pinId && url.includes('pin.it')) {
      try {
        const resolved = await axios.get(url, {
          maxRedirects: 5,
          timeout: 10000
        });
        const finalUrl = resolved.request?.res?.responseUrl || resolved.config.url;
        pinId = finalUrl.match(/\/pin\/(\d+)/)?.[1];
      } catch (resolveErr) {
        // Try to get from redirect header
        try {
          const headReq = await axios.head(url, {
            maxRedirects: 0,
            validateStatus: (status) => status === 301 || status === 302 || status === 200
          });
          const location = headReq.headers.location;
          if (location) {
            pinId = location.match(/\/pin\/(\d+)/)?.[1];
          }
        } catch {}
      }
    }
    
    if (!pinId) {
      throw new Error("Cannot extract pin ID from URL");
    }
    
    console.log(`[Pinterest] Pin ID: ${pinId}`);
    
    // Try Pinterest internal API
    try {
      const apiUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=%2Fpin%2F${pinId}%2F&data=%7B%22options%22%3A%7B%22field_set_key%22%3A%22detailed%22%2C%22id%22%3A%22${pinId}%22%7D%7D`;
      
      const apiResponse = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 15000
      });
      
      const data = apiResponse.data;
      
      if (data && data.resource_response && data.resource_response.data) {
        const pinData = data.resource_response.data;
        
        // Check for video
        if (pinData.videos && pinData.videos.video_list) {
          const videoList = pinData.videos.video_list;
          
          // Priority order: V_720P, V_HLSV4, V_HLS, V_480P, etc
          const videoUrl = videoList.V_720P?.url || 
                          videoList.V_HLSV4?.url || 
                          videoList.V_HLS?.url || 
                          videoList.V_480P?.url ||
                          videoList.V_360P?.url ||
                          Object.values(videoList)[0]?.url;
          
          if (videoUrl) {
            console.log("[Pinterest] ✅ Video found via Pinterest API");
            
            return {
              platform: "pinterest",
              type: "video",
              shortcode: pinId,
              author: pinData.pinner?.username || "Pinterest User",
              caption: pinData.description || "",
              title: pinData.title || pinData.description || "",
              timestamp: null,
              likeCount: pinData.aggregated_pin_data?.aggregated_stats?.saves || 0,
              commentCount: pinData.comment_count || 0,
              viewCount: 0,
              duration: pinData.videos?.video_list?.V_720P?.duration || null,
              mediaItems: [{
                type: "video",
                url: videoUrl,
                thumbnail: pinData.images?.['orig']?.url || null,
                width: pinData.videos?.video_list?.V_720P?.width || null,
                height: pinData.videos?.video_list?.V_720P?.height || null,
                duration: pinData.videos?.video_list?.V_720P?.duration || null,
                ext: 'mp4',
                formats: [{
                  type: "video",
                  quality: "720p",
                  url: videoUrl,
                  ext: 'mp4'
                }]
              }],
              source: "pinterest-api",
              warning: null
            };
          }
        }
        
        // If no video, check for image
        if (pinData.images && pinData.images.orig) {
          console.log("[Pinterest] ℹ️ Image found via Pinterest API (no video)");
          
          return {
            platform: "pinterest",
            type: "image",
            shortcode: pinId,
            author: pinData.pinner?.username || "Pinterest User",
            caption: pinData.description || "",
            title: pinData.title || "",
            timestamp: null,
            likeCount: pinData.aggregated_pin_data?.aggregated_stats?.saves || 0,
            commentCount: pinData.comment_count || 0,
            viewCount: 0,
            duration: null,
            mediaItems: [{
              type: "image",
              url: pinData.images.orig.url,
              thumbnail: pinData.images.orig.url,
              width: pinData.images.orig.width || null,
              height: pinData.images.orig.height || null,
              duration: null,
              ext: 'jpg',
              formats: [{
                type: "image",
                quality: "Original",
                url: pinData.images.orig.url,
                ext: 'jpg'
              }]
            }],
            source: "pinterest-api",
            warning: null
          };
        }
      }
    } catch (apiErr) {
      console.warn(`[Pinterest] API method failed: ${apiErr.message}`);
    }
    
    throw new Error("No media found via Pinterest API");
  } catch (err) {
    throw new Error(`PinDown API gagal: ${err.message}`);
  }
}

/**
 * Pinterest downloader via direct scraping
 */
async function scrapePinterestDirect(url) {
  console.log("[Pinterest] Trying direct scraping...");
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 15000
    });
    
    const html = response.data;
    const pinId = url.match(/\/pin\/(\d+)/)?.[1] || "unknown";
    
    // DEBUG: Save HTML for inspection (uncomment to debug)
    // const fs = require('fs');
    // fs.writeFileSync(`debug_pinterest_${pinId}.html`, html);
    // console.log(`[Pinterest] HTML saved to debug_pinterest_${pinId}.html`);
    
    // PRIORITAS: Cari video dulu sebelum image
    // Improved video detection patterns
    const videoPatterns = [
      // Pattern 1: video_list with various qualities
      /"video_list":\s*\{[^}]*"V_720P":\s*\{[^}]*"url":\s*"([^"]+)"/,
      /"video_list":\s*\{[^}]*"V_HLSV4":\s*\{[^}]*"url":\s*"([^"]+)"/,
      /"video_list":\s*\{[^}]*"V_HLS":\s*\{[^}]*"url":\s*"([^"]+)"/,
      /"video_list":\s*\{[^}]*"V_480P":\s*\{[^}]*"url":\s*"([^"]+)"/,
      /"video_list":\s*\{[^}]*"V_360P":\s*\{[^}]*"url":\s*"([^"]+)"/,
      
      // Pattern 2: videos object
      /"videos":\s*\{[^}]*"video_list":\s*\{[^}]*"url":\s*"([^"]+)"/,
      
      // Pattern 3: Direct video URL
      /"video_url":\s*"([^"]+\.mp4[^"]*)"/,
      
      // Pattern 4: story_pin_data
      /"story_pin_data"[^{]*\{[^}]*"video"[^{]*\{[^}]*"video_list"[^{]*\{[^}]*"url":\s*"([^"]+)"/,
      
      // Pattern 5: __PWS_DATA__ or similar
      /"videos":\s*\{[^}]*"V_720P"[^}]*"url":\s*"([^"]+)"/,
      
      // Pattern 6: Alternative nested structure
      /"video":\s*\{[^}]*"video_list"[^}]*"url":\s*"([^"]+\.mp4[^"]*)"/,
      
      // Pattern 7: Simple mp4 URL in data
      /"url":\s*"(https:\/\/[^"]*\.mp4[^"]*)"/
    ];
    
    let videoUrl = null;
    for (const pattern of videoPatterns) {
      const match = html.match(pattern);
      if (match) {
        videoUrl = match[1]
          .replace(/\\u002F/g, '/')
          .replace(/\\\//g, '/')
          .replace(/\\"/g, '"')
          .replace(/\\/g, '');
        
        // Validate it's a proper video URL
        if (videoUrl.startsWith('http') && (videoUrl.includes('.mp4') || videoUrl.includes('/videos/'))) {
          console.log(`[Pinterest] ✅ Video URL found: ${videoUrl.substring(0, 100)}...`);
          
          return {
            platform: "pinterest",
            type: "video",
            shortcode: pinId,
            author: "Pinterest User",
            caption: "",
            title: "",
            timestamp: null,
            likeCount: 0,
            commentCount: 0,
            viewCount: 0,
            duration: null,
            mediaItems: [{
              type: "video",
              url: videoUrl,
              thumbnail: null,
              width: null,
              height: null,
              duration: null,
              ext: 'mp4',
              formats: [{
                type: "video",
                quality: "720p",
                url: videoUrl,
                ext: 'mp4'
              }]
            }],
            source: "direct-scrape",
            warning: null
          };
        }
      }
    }
    
    // If no video found, DON'T immediately fallback to image
    // Check if there's ANY indication this is a video pin
    const hasVideoIndicator = html.includes('"video_list"') || 
                              html.includes('"videos":{') ||
                              html.includes('video_url') ||
                              html.includes('.mp4');
    
    if (hasVideoIndicator) {
      console.warn("[Pinterest] ⚠️ Video indicators found but couldn't extract URL");
      console.warn("[Pinterest] HTML contains video references but extraction failed");
      throw new Error("Video pin detected but URL extraction failed");
    }
    
    // Only if NO video indicators, then look for image
    console.log("[Pinterest] No video indicators found, checking for image...");
    
    let imageMatch = html.match(/"url":\s*"(https:\/\/i\.pinimg\.com\/originals\/[^"]+)"/);
    if (!imageMatch) {
      imageMatch = html.match(/og:image"\s+content="([^"]+)"/);
    }
    
    if (imageMatch) {
      const imageUrl = imageMatch[1];
      console.log("[Pinterest] ℹ️ Image URL found (confirmed image pin)");
      
      return {
        platform: "pinterest",
        type: "image",
        shortcode: pinId,
        author: "Pinterest User",
        caption: "",
        title: "",
        timestamp: null,
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        duration: null,
        mediaItems: [{
          type: "image",
          url: imageUrl,
          thumbnail: imageUrl,
          width: null,
          height: null,
          duration: null,
          ext: 'jpg',
          formats: [{
            type: "image",
            quality: "Original",
            url: imageUrl,
            ext: 'jpg'
          }]
        }],
        source: "direct-scrape",
        warning: null
      };
    }
    
    throw new Error("No video or image found in HTML");
  } catch (err) {
    throw new Error(`Direct scraping gagal: ${err.message}`);
  }
}

/**
 * Pinterest via Playwright (browser automation for video pins)
 */
async function scrapePinterestViaPlaywright(url) {
  console.log("[Pinterest] Trying Playwright browser automation...");
  
  const playwright = require('playwright');
  let browser = null;
  
  try {
    // Resolve short links first
    let fullUrl = url;
    if (url.includes('pin.it')) {
      try {
        const resolved = await axios.get(url, {
          maxRedirects: 5,
          timeout: 5000
        });
        fullUrl = resolved.request?.res?.responseUrl || url;
        console.log(`[Pinterest] Resolved short link to: ${fullUrl}`);
      } catch {}
    }
    
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    // Navigate with more relaxed waiting strategy
    await page.goto(fullUrl, { 
      waitUntil: 'domcontentloaded',  // Changed from networkidle
      timeout: 20000 
    });
    
    // Wait for either video or image to load
    try {
      await page.waitForSelector('video, img[src*="pinimg.com"]', { timeout: 5000 });
    } catch {
      // Continue even if selector not found
    }
    
    // Extract pin ID
    const pinId = fullUrl.match(/\/pin\/(\d+)/)?.[1] || "unknown";
    
    // Try to find video element
    const videoData = await page.evaluate(() => {
      // Method 1: Find video tag
      const videoElement = document.querySelector('video');
      if (videoElement) {
        // Get all source URLs
        const sources = Array.from(videoElement.querySelectorAll('source'));
        const videoSrc = videoElement.src || 
                       (sources.length > 0 ? sources[0].src : null) ||
                       videoElement.getAttribute('src');
        
        if (videoSrc && videoSrc.startsWith('http')) {
          return {
            type: 'video',
            url: videoSrc,
            thumbnail: videoElement.poster || null,
            width: videoElement.videoWidth || null,
            height: videoElement.videoHeight || null
          };
        }
      }
      
      // Method 2: Search in inline scripts for video data
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const content = script.textContent || '';
        
        // Look for video_list with various qualities
        const patterns = [
          /"video_list":\{[^}]*"V_720P":\{[^}]*"url":"([^"]+)"/,
          /"video_list":\{[^}]*"V_HLSV4":\{[^}]*"url":"([^"]+)"/,
          /"video_list":\{[^}]*"V_HLS":\{[^}]*"url":"([^"]+)"/,
          /"video_list":\{[^}]*"V_480P":\{[^}]*"url":"([^"]+)"/,
          /"videos":\{[^}]*"video_list"[^}]*"V_720P"[^}]*"url":"([^"]+)"/,
          /"video_url":"([^"]+\.mp4[^"]*)"/
        ];
        
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            return {
              type: 'video',
              url: match[1].replace(/\\u002F/g, '/').replace(/\\/g, ''),
              thumbnail: null,
              width: null,
              height: null
            };
          }
        }
      }
      
      // Method 3: Check window.__PWS_DATA__ or similar
      if (window.__PWS_DATA__ || window.__INITIAL_STATE__) {
        const data = window.__PWS_DATA__ || window.__INITIAL_STATE__;
        const dataStr = JSON.stringify(data);
        
        const videoMatch = dataStr.match(/"video_list"[^}]*"url":"([^"]+\.mp4[^"]*)"/);
        if (videoMatch) {
          return {
            type: 'video',
            url: videoMatch[1].replace(/\\u002F/g, '/').replace(/\\/g, ''),
            thumbnail: null,
            width: null,
            height: null
          };
        }
      }
      
      // If no video found, return null (will fallback to other methods)
      return null;
    });
    
    await browser.close();
    
    if (!videoData || !videoData.url) {
      throw new Error("No video found in page (might be image pin)");
    }
    
    console.log(`[Pinterest] ✅ Video found via Playwright`);
    
    return {
      platform: "pinterest",
      type: "video",
      shortcode: pinId,
      author: "Pinterest User",
      caption: "",
      title: "",
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems: [{
        type: "video",
        url: videoData.url,
        thumbnail: videoData.thumbnail,
        width: videoData.width,
        height: videoData.height,
        duration: null,
        ext: 'mp4',
        formats: [{
          type: "video",
          quality: '720p',
          url: videoData.url,
          ext: 'mp4'
        }]
      }],
      source: "playwright",
      warning: null
    };
    
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    throw new Error(`Playwright gagal: ${err.message}`);
  }
}

/**
 * Pinterest main function with multiple fallbacks
 */
async function scrapePinterest(url) {
  console.log("[Scraper] Pinterest: trying multiple methods...");
  
  const errors = [];
  
  // Method 1: yt-dlp (paling andal untuk Pinterest, support HLS & MP4)
  const ytdlpAvailable = await checkYtDlp();
  if (ytdlpAvailable) {
    try {
      const result = await scrapePinterestViaYtDlp(url);
      console.log("[Pinterest] ✅ Success via yt-dlp");
      return result;
    } catch (err) {
      console.warn(`[Pinterest] yt-dlp failed: ${err.message}`);
      errors.push(`yt-dlp: ${err.message}`);
    }
  }
  
  // Method 2: Playwright (for video pins with dynamic content)
  try {
    const result = await scrapePinterestViaPlaywright(url);
    console.log("[Pinterest] ✅ Success via Playwright");
    return result;
  } catch (err) {
    console.warn(`[Pinterest] Playwright failed: ${err.message}`);
    errors.push(`Playwright: ${err.message}`);
  }
  
  // Method 3: Pinterest Internal API
  try {
    const result = await scrapePinterestViaPinDown(url);
    console.log("[Pinterest] ✅ Success via Pinterest API");
    return result;
  } catch (err) {
    console.warn(`[Pinterest] Pinterest API failed: ${err.message}`);
    errors.push(`Pinterest API: ${err.message}`);
  }
  
  // Method 4: Direct Scraping
  try {
    const result = await scrapePinterestDirect(url);
    console.log("[Pinterest] ✅ Success via Direct Scraping");
    return result;
  } catch (err) {
    console.warn(`[Pinterest] Direct scraping failed: ${err.message}`);
    errors.push(`Direct: ${err.message}`);
  }
  
  // Method 5: Pindl API
  try {
    const result = await scrapePinterestViaPindl(url);
    console.log("[Pinterest] ✅ Success via Pindl API");
    return result;
  } catch (err) {
    console.warn(`[Pinterest] Pindl failed: ${err.message}`);
    errors.push(`Pindl: ${err.message}`);
  }
  
  // All methods failed
  throw new Error(`Pinterest download gagal. Semua metode error:\n${errors.join('\n')}`);
}

/**
 * Pinterest via yt-dlp (original method, now as fallback)
 */
async function scrapePinterestViaYtDlp(url) {
  console.log("[Pinterest] Trying yt-dlp...");
  
  return new Promise((resolve, reject) => {
    // First, get video info
    const infoArgs = [
      "--dump-json",
      "--no-warnings",
      "--no-playlist",
      url
    ];
    
    execFile("yt-dlp", infoArgs, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error || stderr) {
        return reject(new Error(`yt-dlp error: ${stderr || error.message}`));
      }
      
      try {
        const info = JSON.parse(stdout);
        const pinId = url.match(/\/pin\/(\d+)/)?.[1] || info.id || "unknown";
        const mediaItems = [];
        
        // Check if this is a video with HLS streams (Pinterest typically uses HLS)
        const hasHLS = info.formats && info.formats.some(f => f.url && f.url.includes('.m3u8'));
        const isVideo = info.ext === 'mp4' || hasHLS || (info.formats && info.formats.length > 0);
        
        if (isVideo && hasHLS) {
          // For HLS videos, download directly using yt-dlp
          const tempDir = require('path').join(__dirname, 'temp_downloads');
          const fs = require('fs');
          
          // Ensure temp directory exists
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          
          const filename = `pinterest_${pinId}_${Date.now()}.mp4`;
          const outputPath = require('path').join(tempDir, filename);
          
          // Download video using yt-dlp
          const dlArgs = [
            "-f", "bestvideo+bestaudio/best",
            "--merge-output-format", "mp4",
            "--no-warnings",
            "--no-playlist",
            "-o", outputPath,
            url
          ];
          
          console.log(`[Pinterest] Downloading video to ${filename}...`);
          
          execFile("yt-dlp", dlArgs, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }, (dlError, dlStdout, dlStderr) => {
            if (dlError) {
              console.warn(`[Pinterest] yt-dlp download failed: ${dlError.message}`);
              // Fallback to returning HLS URL
              const bestFormat = info.formats.filter(f => f.url && f.vcodec && f.vcodec !== 'none')
                .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
              
              if (bestFormat) {
                mediaItems.push({
                  type: "video",
                  url: bestFormat.url,
                  thumbnail: info.thumbnail || null,
                  width: bestFormat.width || null,
                  height: bestFormat.height || null,
                  duration: info.duration || null,
                  ext: 'mp4',
                  formats: [{
                    type: "video",
                    quality: `${bestFormat.height}p`,
                    url: bestFormat.url,
                    ext: 'mp4'
                  }]
                });
              }
              
              if (mediaItems.length === 0) {
                return reject(new Error("No valid media found"));
              }
              
              return resolve({
                platform: "pinterest",
                type: "video",
                shortcode: pinId,
                author: info.uploader || "Pinterest User",
                caption: info.description || "",
                title: info.title || "",
                timestamp: info.timestamp || null,
                likeCount: 0,
                commentCount: 0,
                viewCount: 0,
                duration: info.duration || null,
                mediaItems: mediaItems,
                source: "yt-dlp",
                warning: "HLS stream - may need client-side playback"
              });
            }
            
            // Download successful - return local URL
            const localUrl = `/temp/${filename}`;
            console.log(`[Pinterest] ✅ Video downloaded: ${filename}`);
            
            mediaItems.push({
              type: "video",
              url: localUrl,
              thumbnail: info.thumbnail || null,
              width: info.width || null,
              height: info.height || null,
              duration: info.duration || null,
              ext: 'mp4',
              formats: [{
                type: "video",
                quality: `${info.height || 720}p`,
                url: localUrl,
                ext: 'mp4'
              }]
            });
            
            resolve({
              platform: "pinterest",
              type: "video",
              shortcode: pinId,
              author: info.uploader || "Pinterest User",
              caption: info.description || "",
              title: info.title || "",
              timestamp: info.timestamp || null,
              likeCount: 0,
              commentCount: 0,
              viewCount: 0,
              duration: info.duration || null,
              mediaItems: mediaItems,
              source: "yt-dlp",
              warning: null
            });
          });
          
        } else if (info.url && info.url.length > 10) {
          // Direct URL available (rare for Pinterest)
          mediaItems.push({
            type: isVideo ? "video" : "image",
            url: info.url,
            thumbnail: info.thumbnail || info.url,
            width: info.width || null,
            height: info.height || null,
            duration: info.duration || null,
            ext: isVideo ? 'mp4' : 'jpg',
            formats: [{
              type: isVideo ? "video" : "image",
              quality: "Default",
              url: info.url,
              ext: isVideo ? 'mp4' : 'jpg'
            }]
          });
          
          resolve({
            platform: "pinterest",
            type: mediaItems[0].type,
            shortcode: pinId,
            author: info.uploader || "Pinterest User",
            caption: info.description || "",
            title: info.title || "",
            timestamp: info.timestamp || null,
            likeCount: 0,
            commentCount: 0,
            viewCount: 0,
            duration: info.duration || null,
            mediaItems: mediaItems,
            source: "yt-dlp",
            warning: null
          });
          
        } else if (info.formats && info.formats.length > 0) {
          const videoFormats = info.formats.filter(f => f.url && f.vcodec && f.vcodec !== 'none');
          
          if (videoFormats.length > 0) {
            videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
            const best = videoFormats[0];
            
            mediaItems.push({
              type: "video",
              url: best.url,
              thumbnail: info.thumbnail || null,
              width: best.width || null,
              height: best.height || null,
              duration: info.duration || null,
              ext: best.ext || 'mp4',
              formats: [{
                type: "video",
                quality: `${best.height}p`,
                url: best.url,
                ext: best.ext || 'mp4'
              }]
            });
          }
          
          if (mediaItems.length === 0) {
            return reject(new Error("No valid media found"));
          }
          
          resolve({
            platform: "pinterest",
            type: mediaItems[0].type,
            shortcode: pinId,
            author: info.uploader || "Pinterest User",
            caption: info.description || "",
            title: info.title || "",
            timestamp: info.timestamp || null,
            likeCount: 0,
            commentCount: 0,
            viewCount: 0,
            duration: info.duration || null,
            mediaItems: mediaItems,
            source: "yt-dlp",
            warning: null
          });
          
        } else if (info.thumbnail) {
          mediaItems.push({
            type: "image",
            url: info.thumbnail,
            thumbnail: info.thumbnail,
            width: null,
            height: null,
            duration: null,
            ext: 'jpg',
            formats: [{
              type: "image",
              quality: "Original",
              url: info.thumbnail,
              ext: 'jpg'
            }]
          });
          
          resolve({
            platform: "pinterest",
            type: mediaItems[0].type,
            shortcode: pinId,
            author: info.uploader || "Pinterest User",
            caption: info.description || "",
            title: info.title || "",
            timestamp: info.timestamp || null,
            likeCount: 0,
            commentCount: 0,
            viewCount: 0,
            duration: null,
            mediaItems: mediaItems,
            source: "yt-dlp",
            warning: null
          });
          
        } else {
          return reject(new Error("No valid media found"));
        }
      } catch (parseErr) {
        reject(new Error(`Parse error: ${parseErr.message}`));
      }
    });
  });
}

// ─── Viday & Videy Scraper ─────────────────────────────────────────────────

/**
 * Scraper untuk viday.de dan videy.co/llc.
 * Video URL langsung dari <source> tag di halaman HTML.
 * Untuk videy, fallback ke Playwright jika CDN diblokir.
 */
async function scrapeVidayVidey(url, platform = "viday") {
  console.log(`[Scraper] Mengambil video dari ${platform}...`);

  // ── Videy: construct CDN URL directly (SPA, no server-rendered HTML) ──
  if (platform === "videy") {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    // ── cdn2.videy.it: serves HTML wrapper with real video URL inside ──
    if (hostname.includes('videy.it')) {
      console.log(`[Scraper] Videy.it CDN URL terdeteksi, mengambil HTML untuk extract URL video...`);
      try {
        const htmlResp = await axios.get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": "https://videy.co/",
          },
          timeout: 15000,
          responseType: "text",
        });
        const ct = (htmlResp.headers["content-type"] || "").toLowerCase();

        // If it returns actual video (not HTML), use URL directly
        if (ct.startsWith("video/")) {
          const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
          const filename = pathParts[pathParts.length - 1] || 'video.mp4';
          const dotIdx = filename.lastIndexOf('.');
          const videoId = dotIdx !== -1 ? filename.substring(0, dotIdx) : filename;
          const ext = dotIdx !== -1 ? filename.substring(dotIdx + 1).toLowerCase() : 'mp4';
          return {
            platform, type: "video", shortcode: videoId, author: platform,
            caption: `Videy ${videoId}`, title: `Videy ${videoId}`,
            timestamp: null, likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
            mediaItems: [{ type: "video", url, thumbnail: url, width: null, height: null, duration: null, ext, formats: [{ type: "video", quality: "HD", url, ext }] }],
            source: "cdn-direct", warning: null,
          };
        }

        // HTML response: extract real video URL from JavaScript
        const html = htmlResp.data;
        const videoUrlMatch = html.match(/const\s+videoUrl\s*=\s*["']([^"']+)["']/i)
          || html.match(/videoUrl\s*=\s*["']([^"']+\.m[p4][^"']*)["']/i)
          || html.match(/src\s*=\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/i);

        if (videoUrlMatch && videoUrlMatch[1]) {
          let realVideoUrl = videoUrlMatch[1].replace(/&amp;/g, '&');
          console.log(`[Scraper] Videy.it URL video asli: ${realVideoUrl}`);

          // Normalize to HTTP for ISP-blocked regions
          const normalizedUrl = realVideoUrl.replace(/^https:\/\//i, 'http://');
          const ext = realVideoUrl.includes('.m3u8') ? 'm3u8' : 'mp4';
          const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
          const filename = pathParts[pathParts.length - 1] || 'video.mp4';
          const dotIdx = filename.lastIndexOf('.');
          const videoId = dotIdx !== -1 ? filename.substring(0, dotIdx) : filename;

          return {
            platform, type: "video", shortcode: videoId, author: platform,
            caption: `Videy ${videoId}`, title: `Videy ${videoId}`,
            timestamp: null, likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
            mediaItems: [{
              type: "video", url: normalizedUrl, thumbnail: normalizedUrl,
              width: null, height: null, duration: null, ext,
              formats: [{ type: "video", quality: "HD", url: normalizedUrl, ext }],
            }],
            source: "videy.it-extract",
            warning: "Video diekstrak dari halaman videy.it. Jika tidak bisa diputar, coba gunakan VPN.",
          };
        }

        // Fallback: cari URL mp4 apapun di HTML
        const mp4Match = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
        if (mp4Match) {
          let realVideoUrl = mp4Match[0].replace(/&amp;/g, '&');
          console.log(`[Scraper] Videy.it URL video (fallback): ${realVideoUrl}`);
          const normalizedUrl = realVideoUrl.replace(/^https:\/\//i, 'http://');
          const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
          const filename = pathParts[pathParts.length - 1] || 'video.mp4';
          const dotIdx = filename.lastIndexOf('.');
          const videoId = dotIdx !== -1 ? filename.substring(0, dotIdx) : filename;
          return {
            platform, type: "video", shortcode: videoId, author: platform,
            caption: `Videy ${videoId}`, title: `Videy ${videoId}`,
            timestamp: null, likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
            mediaItems: [{
              type: "video", url: normalizedUrl, thumbnail: normalizedUrl,
              width: null, height: null, duration: null, ext: 'mp4',
              formats: [{ type: "video", quality: "HD", url: normalizedUrl, ext: 'mp4' }],
            }],
            source: "videy.it-extract",
            warning: "Video diekstrak dari halaman videy.it. Jika tidak bisa diputar, coba gunakan VPN.",
          };
        }

        throw new Error("Tidak dapat menemukan URL video di halaman videy.it");
      } catch (err) {
        if (err.message.includes('Tidak dapat menemukan')) throw err;
        console.log(`[Scraper] Videy.it fetch gagal: ${err.message}, mencoba URL langsung`);
        // Fallback: return URL as-is
        const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
        const filename = pathParts[pathParts.length - 1] || 'video.mp4';
        const dotIdx = filename.lastIndexOf('.');
        const videoId = dotIdx !== -1 ? filename.substring(0, dotIdx) : filename;
        const ext = dotIdx !== -1 ? filename.substring(dotIdx + 1).toLowerCase() : 'mp4';
        return {
          platform, type: "video", shortcode: videoId, author: platform,
          caption: `Videy ${videoId}`, title: `Videy ${videoId}`,
          timestamp: null, likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
          mediaItems: [{ type: "video", url, thumbnail: url, width: null, height: null, duration: null, ext, formats: [{ type: "video", quality: "HD", url, ext }] }],
          source: "cdn-direct",
          warning: "Gagal mengekstrak URL dari videy.it. URL dikembalikan apa adanya.",
        };
      }
    }

    // ── videy.co / videy.llc: construct CDN URL from id parameter ──
    let videoId, ext;

    if (parsedUrl.searchParams.get("id")) {
      videoId = parsedUrl.searchParams.get("id");
      ext = (videoId.length === 9 && videoId.endsWith("2")) ? "mov" : "mp4";
    } else {
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      const filename = pathParts[pathParts.length - 1] || '';
      const dotIdx = filename.lastIndexOf('.');
      if (dotIdx !== -1) {
        videoId = filename.substring(0, dotIdx);
        ext = filename.substring(dotIdx + 1).toLowerCase() || 'mp4';
      } else {
        videoId = filename;
        ext = 'mp4';
      }
    }

    if (!videoId) {
      throw new Error("URL videy tidak memiliki video ID");
    }

    const cdnUrl = `http://cdn2.videy.co/${videoId}.${ext}`;
    console.log(`[Scraper] Videy CDN URL (constructed): ${cdnUrl}`);

    try {
      const headResp = await axios.head(cdnUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Referer": "https://videy.co/",
        },
        timeout: 10000,
        validateStatus: (s) => s < 400,
      });
      const ct = (headResp.headers["content-type"] || "").toLowerCase();
      if (!ct.startsWith("video/") && !ct.startsWith("application/octet-stream")) {
        console.log(`[Scraper] Videy CDN returned non-video content-type: ${ct}, URL may be invalid`);
      }
    } catch (headErr) {
      console.log(`[Scraper] Videy CDN HEAD gagal: ${headErr.message}, tetap menggunakan URL`);
    }

    const shortcode = videoId;
    const title = `Videy ${videoId}`;

    return {
      platform,
      type: "video",
      shortcode,
      author: platform,
      caption: title,
      title,
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems: [{
        type: "video",
        url: cdnUrl,
        thumbnail: cdnUrl,
        width: null,
        height: null,
        duration: null,
        ext,
        formats: [{ type: "video", quality: "HD", url: cdnUrl, ext }],
      }],
      source: "cdn-direct",
      warning: "CDN videy menggunakan HTTP karena HTTPS diblokir ISP/SSL expired. Jika gagal, coba gunakan VPN.",
    };
  }

  // ── Viday: scrape HTML for <source> tag ──
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      "Referer": "https://videy.co/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
    timeout: 15000,
    responseType: "text",
  });

  const ct = (response.headers["content-type"] || "").toLowerCase();

  // Jika URL mengarah langsung ke video (content-type video/*), skip HTML scrape
  if (ct.startsWith("video/")) {
    const title = url.split('/').pop().replace(/\.mp4.*/i, '') || platform;
    let finalUrl = url;
    if (platform === "videy") {
      finalUrl = url.replace(/^https:\/\//i, 'http://').replace(/cdn\.videy\.co/i, 'cdn2.videy.co');
    }
    return {
      platform,
      type: "video",
      shortcode: title,
      author: platform,
      caption: title,
      title,
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems: [{
        type: "video",
        url: finalUrl,
        thumbnail: finalUrl,
        width: null,
        height: null,
        duration: null,
        ext: "mp4",
        formats: [{ type: "video", quality: "HD", url: finalUrl, ext: "mp4" }],
      }],
      source: "direct-url",
      warning: platform === "videy" ? "CDN videy.co diblokir ISP (Internet Positif). Video diambil dari cdn2.videy.co via HTTP. Jika gagal, coba gunakan VPN." : null,
    };
  }

  const html = response.data;

  // Cari <source> tags di dalam <video>
  const sourceRegex = /<source[^>]+src\s*=\s*"([^"]+\.mp4[^"]*)"[^>]*>/gi;
  const videoUrls = [];
  let m;
  while ((m = sourceRegex.exec(html)) !== null) {
    let videoUrl = m[1].replace(/&amp;/g, '&');
    const hashIdx = videoUrl.indexOf('#');
    if (hashIdx !== -1) videoUrl = videoUrl.substring(0, hashIdx);
    if (videoUrl.startsWith('http') && !videoUrls.includes(videoUrl)) {
      videoUrls.push(videoUrl);
    }
  }

  // Fallback: cari src langsung di <video> tag
  if (videoUrls.length === 0) {
    const videoDirectRegex = /<video[^>]+src\s*=\s*"([^"]+\.mp4[^"]*)"[^>]*>/i;
    const directMatch = html.match(videoDirectRegex);
    if (directMatch) {
      let videoUrl = directMatch[1].replace(/&amp;/g, '&');
      const hashIdx = videoUrl.indexOf('#');
      if (hashIdx !== -1) videoUrl = videoUrl.substring(0, hashIdx);
      if (videoUrl.startsWith('http')) videoUrls.push(videoUrl);
    }
  }

  // Fallback: cari URL mp4 apapun di halaman (CDN langsung)
  if (videoUrls.length === 0) {
    const cdnRegex = /https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/gi;
    while ((m = cdnRegex.exec(html)) !== null) {
      let videoUrl = m[0].replace(/&amp;/g, '&');
      const hashIdx = videoUrl.indexOf('#');
      if (hashIdx !== -1) videoUrl = videoUrl.substring(0, hashIdx);
      if (!videoUrls.includes(videoUrl)) videoUrls.push(videoUrl);
    }
  }

  if (videoUrls.length === 0) {
    throw new Error(`Tidak dapat menemukan video di halaman ${platform}`);
  }

  // Ambil judul dari <title>
  let title = "";
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  // Ekstrak thumbnail dari poster attribute <video> atau og:image
  let thumbnail = null;
  const posterMatch = html.match(/<video[^>]+poster\s*=\s*"([^"]+)"[^>]*>/i);
  if (posterMatch) thumbnail = posterMatch[1];
  if (!thumbnail) {
    const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (ogImageMatch) thumbnail = ogImageMatch[1];
  }

  const bestUrl = videoUrls[0];

  // Fallback: gunakan video URL sebagai thumbnail jika tidak ada gambar
  if (!thumbnail && bestUrl) {
    thumbnail = bestUrl;
  }

  const finalUrl = bestUrl;
  const formats = videoUrls.map((u, i) => ({
    type: "video",
    quality: i === 0 ? "HD" : `Mirror ${i + 1}`,
    url: u,
    ext: "mp4",
  }));

  const shortcode = new URL(url).searchParams.get('id') || url.split('/').pop().replace(/\.mp4.*/i, '') || "unknown";

  return {
    platform,
    type: "video",
    shortcode,
    author: platform,
    caption: title,
    title,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems: [{
      type: "video",
      url: finalUrl,
      thumbnail,
      width: null,
      height: null,
      duration: null,
      ext: "mp4",
      formats,
    }],
    source: "html-scrape",
    warning: null,
  };
}

// ─── UC Drive Scraper ─────────────────────────────────────────────────

/**
 * Scraper untuk UC Drive (drive.ucweb.com) — menggunakan API publik tanpa login.
 * Flow: token → list files → video_preview (direct OSS URL)
 */
async function scrapeUcwebDrive(url) {
  console.log(`[Scraper] Mengambil file dari UC Drive...`);
  const API_BASE = "https://m-intldrive.ucweb.com";
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const API_HEADERS = {
    "User-Agent": UA,
    "Content-Type": "application/json",
    "Referer": "https://drive.ucweb.com/",
    "X-U-Req-Res-Encoding": "no",  // Bypass wg encoding, return plain JSON
  };

  // Extract pwd_id from URL path: /s/{pwd_id}
  const parsedUrl = new URL(url);
  const pathMatch = parsedUrl.pathname.match(/\/s\/([a-zA-Z0-9]+)/);
  if (!pathMatch) throw new Error("URL UC Drive tidak valid, format: /s/{id}");
  const pwdId = pathMatch[1];
  console.log(`[Scraper] UC Drive share ID: ${pwdId}`);

  // Step 1: Get share token
  let stoken;
  try {
    const tokenResp = await axios.post(
      `${API_BASE}/1/clouddrive/share/sharepage/token`,
      { pwd_id: pwdId, passcode: "" },
      { headers: API_HEADERS, timeout: 15000 }
    );
    stoken = tokenResp.data?.data?.stoken;
    if (!stoken) throw new Error("Token tidak ditemukan");
    console.log(`[Scraper] UC Drive token berhasil`);
  } catch (err) {
    throw new Error(`Gagal mendapatkan token UC Drive: ${err.message}`);
  }

  // Step 2: List files (supports folders)
  async function listFiles(pdirFid = "") {
    const body = { pwd_id: pwdId, stoken, pdir_fid: pdirFid, page: 1, size: 100 };
    const resp = await axios.post(
      `${API_BASE}/1/clouddrive/share/sharepage/v2/detail?pr=UCBrowser&fr=h5`,
      body,
      { headers: API_HEADERS, timeout: 15000 }
    );
    return resp.data?.data?.detail_info?.list || resp.data?.data?.list || [];
  }

  // Step 3: Get video preview URL (no auth required)
  async function getVideoPreview(fid, fidToken) {
    const params = new URLSearchParams({
      pr: "UCBrowser", fr: "h5",
      pwd_id: pwdId, stoken,
      fid, fid_token: fidToken, isH5: "true",
    });
    const resp = await axios.get(
      `${API_BASE}/1/clouddrive/share/sharepage/video_preview?${params}`,
      { headers: API_HEADERS, timeout: 15000 }
    );
    const playInfo = resp.data?.data?.play_info;
    if (playInfo?.url) return playInfo;
    // Fallback: check preview_url
    if (resp.data?.data?.preview_url) return { url: resp.data.data.preview_url, resolution: "original", format: "mp4" };
    return null;
  }

  // Collect all video files (recursively for folders)
  const allFiles = [];
  async function collectFiles(pdirFid = "", depth = 0) {
    if (depth > 3) return; // limit recursion
    const files = await listFiles(pdirFid);
    for (const f of files) {
      if (f.dir === true) {
        // It's a folder, recurse
        await collectFiles(f.fid, depth + 1);
      } else {
        allFiles.push(f);
      }
    }
  }

  await collectFiles();

  if (allFiles.length === 0) {
    throw new Error("Tidak ada file di share UC Drive ini");
  }

  console.log(`[Scraper] UC Drive: ${allFiles.length} file ditemukan`);

  // Filter video files and get preview URLs
  const mediaItems = [];
  for (const f of allFiles) {
    const isVideo = /\.(mp4|mkv|avi|mov|webm|flv)$/i.test(f.file_name || '') ||
                    (f.format_type && f.format_type.includes('video')) ||
                    (f.obj_category && f.obj_category === 'video');
    if (!isVideo) continue;

    let videoUrl = null;
    let resolution = "original";
    try {
      const preview = await getVideoPreview(f.fid, f.share_fid_token);
      if (preview?.url) {
        videoUrl = preview.url;
        resolution = preview.resolution || "original";
      }
    } catch (e) {
      console.log(`[Scraper] UC Drive preview gagal untuk ${f.file_name}: ${e.message}`);
    }

    if (!videoUrl) continue;

    const sizeBytes = f.size || 0;
    const sizeMB = (sizeBytes / 1048576).toFixed(1);
    const ext = (f.file_name || '').split('.').pop().toLowerCase() || 'mp4';

    mediaItems.push({
      type: "video",
      url: videoUrl,
      thumbnail: f.thumbnail || f.big_thumbnail || null,
      width: f.width || null,
      height: f.height || null,
      duration: f.duration ? Math.round(f.duration / 1000) : null,
      ext,
      fileName: f.file_name || `video.${ext}`,
      fileSize: sizeBytes,
      formats: [{ type: "video", quality: resolution, url: videoUrl, ext }],
    });
  }

  if (mediaItems.length === 0) {
    // No videos found, try returning all files as generic downloads
    for (const f of allFiles) {
      const ext = (f.file_name || '').split('.').pop().toLowerCase() || 'bin';
      mediaItems.push({
        type: "file",
        url: `https://drive.ucweb.com/s/${pwdId}`, // fallback URL
        thumbnail: null,
        width: null, height: null, duration: null,
        ext,
        fileName: f.file_name || `file.${ext}`,
        fileSize: f.size || 0,
        formats: [{ type: "file", quality: "original", url: `https://drive.ucweb.com/s/${pwdId}`, ext }],
        warning: "Login UC Drive diperlukan untuk download file non-video.",
      });
    }
  }

  if (mediaItems.length === 0) {
    throw new Error("Tidak ada file yang bisa didownload dari UC Drive");
  }

  const shareTitle = `UC Drive ${pwdId}`;
  return {
    platform: "ucweb",
    type: mediaItems.length > 1 ? "carousel" : "video",
    shortcode: pwdId,
    author: "UC Drive",
    caption: shareTitle,
    title: shareTitle,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems,
    source: "ucweb-api",
    warning: mediaItems.some(m => m.warning) ? "Beberapa file memerlukan login UC Drive." : null,
  };
}

/**
 * Scraper untuk bokepbox (.media / .tv) — direct URL atau HTML page
 */
async function scrapeBokepbox(url) {
  console.log(`[Scraper] Mengambil video dari bokepbox...`);

  // Jika direct video M3U8/MP4, return langsung
  if (/\.(m3u8|mp4)($|\?|#)/i.test(url)) {
    const title = decodeURIComponent(url.split('/').pop().replace(/\.(m3u8|mp4).*/i, '').replace(/[_-]/g, ' ')) || 'bokepbox';
    const shortcode = decodeURIComponent(url.split('/').filter(s => s).slice(-2, -1)[0] || title).substring(0, 30);
    const ext = url.match(/\.(m3u8|mp4)/i)?.[1].toLowerCase() || 'mp4';
    return {
      platform: "bokepbox",
      type: "video",
      shortcode,
      author: "bokepbox",
      caption: title,
      title,
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems: [{
        type: "video", url, thumbnail: null,
        width: null, height: null, duration: null, ext,
        formats: [{ type: "video", quality: "HD", url, ext }],
      }],
      source: "direct-url",
      warning: null,
    };
  }

  // Coba scrape HTML page untuk cari video URL
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,*/*",
        "Referer": "https://bokepbox.tv/",
      },
      timeout: 15000,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    });

    const html = response.data;
    const ct = (response.headers["content-type"] || "").toLowerCase();

    // Jika diblokir ISP (Internet Positif)
    if (ct.includes("text/html") && html.includes("Internet Positif")) {
      return {
        platform: "bokepbox", type: "video",
        shortcode: "blocked", author: "bokepbox",
        caption: "Halaman diblokir ISP (Internet Positif)", title: "Diblokir ISP",
        timestamp: null, likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
        mediaItems: [{
          type: "video", url, thumbnail: null,
          width: null, height: null, duration: null, ext: "mp4",
          formats: [{ type: "video", quality: "HD", url, ext: "mp4" }],
        }],
        source: "blocked",
        warning: "Domain ini diblokir ISP (Internet Positif). Coba gunakan VPN atau deploy ke Railway.",
      };
    }

    // Cari M3U8 / MP4 di halaman
    let videoUrl = null;
    const m3u8Match = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
    const mp4Match = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
    const videoSrc = html.match(/<video[^>]+src\s*=\s*"([^"]+)"/i);

    if (m3u8Match) videoUrl = m3u8Match[0];
    else if (mp4Match) videoUrl = mp4Match[0];
    else if (videoSrc) videoUrl = videoSrc[1];

    const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || 'Bokepbox';
    const shortcode = title.substring(0, 30);

    if (videoUrl) {
      const ext = videoUrl.match(/\.(m3u8|mp4)/i)?.[1]?.toLowerCase() || 'mp4';
      return {
        platform: "bokepbox", type: "video", shortcode, author: "bokepbox",
        caption: title, title,
        timestamp: null, likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
        mediaItems: [{
          type: "video", url: videoUrl, thumbnail: null,
          width: null, height: null, duration: null, ext,
          formats: [{ type: "video", quality: "HD", url: videoUrl, ext }],
        }],
        source: "html-scrape",
        warning: null,
      };
    }

    // Fallback: return URL asli
    throw new Error("Tidak ditemukan video di halaman");
  } catch (err) {
    if (err.message?.includes("blocked")) throw err;
    console.warn(`[Scraper] bokepbox HTML scrape gagal: ${err.message}, fallback URL langsung`);
    const shortcode = url.split('/').filter(s => s).slice(-1)[0]?.substring(0, 20) || 'bokepbox';
    return {
      platform: "bokepbox", type: "video", shortcode, author: "bokepbox",
      caption: shortcode, title: shortcode,
      timestamp: null, likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems: [{
        type: "video", url, thumbnail: null,
        width: null, height: null, duration: null, ext: "mp4",
        formats: [{ type: "video", quality: "HD", url, ext: "mp4" }],
      }],
      source: "direct-url",
      warning: "Gagal mengambil halaman. Mungkin diblokir ISP. Coba gunakan VPN.",
    };
  }
}

/**
 * Download video videy via Playwright untuk bypass ISP block
 */
async function downloadVideyViaPlaywright(pageUrl, cdnUrl) {
  const { chromium } = require('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Block font/css untuk kecepatan
    await page.route('**/*.{woff,woff2,ttf,css}', route => route.abort());

    // Tangkap response video dari CDN
    let videoResponse = null;
    page.on('response', async (response) => {
      const respUrl = response.url();
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('video') || respUrl.includes('.mp4')) {
        if (respUrl.includes('videy') || respUrl.includes('slicedrive')) {
          videoResponse = response;
        }
      }
    });

    console.log(`[Playwright] Navigasi ke ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Tunggu video element dan trigger play
    await page.waitForSelector('video', { timeout: 15000 }).catch(() => {});

    // Trigger play untuk memulai loading video
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) v.play().catch(() => {});
    }).catch(() => {});

    // Tunggu video response tertangkap
    await page.waitForTimeout(3000);

    // Jika video response tertangkap, download body-nya
    if (videoResponse) {
      const body = await videoResponse.body();
      if (body && body.length > 1000) {
        const tempDir = require('path').join(__dirname, 'temp_downloads');
        if (!require('fs').existsSync(tempDir)) {
          require('fs').mkdirSync(tempDir, { recursive: true });
        }
        const shortcode = new URL(pageUrl).searchParams.get('id') || 'videy';
        const filename = `videy_${shortcode}_${Date.now()}.mp4`;
        const filePath = require('path').join(tempDir, filename);
        require('fs').writeFileSync(filePath, body);
        console.log(`[Playwright] Video tersimpan: ${filename} (${(body.length / 1024 / 1024).toFixed(1)}MB)`);
        return `/temp/${filename}`;
      }
    }

    // Fallback: jika response tidak tertangkap, coba ambil dari <video> src
    // dan download via browser evaluate
    const videoUrl = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) return v.src || (v.querySelector('source')?.src) || null;
      return null;
    }).catch(() => null);

    if (videoUrl && videoUrl.startsWith('http')) {
      // Coba download via browser fetch (bypass ISP block)
      const buffer = await page.evaluate(async (url) => {
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          return null;
        }
      }, videoUrl);

      if (buffer && buffer.startsWith('data:')) {
        const base64 = buffer.split(',')[1];
        const buf = Buffer.from(base64, 'base64');
        if (buf.length > 1000) {
          const tempDir = require('path').join(__dirname, 'temp_downloads');
          if (!require('fs').existsSync(tempDir)) {
            require('fs').mkdirSync(tempDir, { recursive: true });
          }
          const shortcode = new URL(pageUrl).searchParams.get('id') || 'videy';
          const filename = `videy_${shortcode}_${Date.now()}.mp4`;
          const filePath = require('path').join(tempDir, filename);
          require('fs').writeFileSync(filePath, buf);
          console.log(`[Playwright] Video tersimpan via fetch: ${filename} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
          return `/temp/${filename}`;
        }
      }
    }

    throw new Error("Gagal menangkap video via Playwright");
  } catch (err) {
    throw new Error(`Playwright download gagal: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ─── YouTube Fallback Functions (tanpa yt-dlp) ──────────────────────────────

/**
 * Ekstrak YouTube video ID dari berbagai format URL.
 */
function extractYouTubeVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?.*&v=([A-Za-z0-9_-]{11})/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

/**
 * YouTube via @distube/ytdl-core — pure Node.js, tidak butuh yt-dlp binary.
 * Langsung query YouTube tanpa proxy eksternal. Paling reliable di Railway.
 */
async function scrapeYouTubeViaYtdlCore(url) {
  console.log("[YouTube] Mencoba @distube/ytdl-core...");

  let ytdl;
  try {
    ytdl = require("@distube/ytdl-core");
  } catch (e) {
    throw new Error("@distube/ytdl-core tidak terinstall: " + e.message);
  }

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Ambil info video tanpa download
  const info = await ytdl.getInfo(cleanUrl, {
    requestOptions: {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
  });

  const videoDetails = info.videoDetails;
  const title = videoDetails.title || "YouTube Video";
  const author = videoDetails.author?.name || "YouTube";
  const thumbnail = videoDetails.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url
    || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const duration = parseInt(videoDetails.lengthSeconds) || null;

  // Filter format: video+audio MP4 (combined) — bisa langsung diplay/download
  const combinedFormats = ytdl.filterFormats(info.formats, "videoandaudio")
    .filter(f => f.container === "mp4")
    .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));

  // Fallback: video-only MP4 kalau tidak ada combined
  const videoOnlyFormats = ytdl.filterFormats(info.formats, "video")
    .filter(f => f.container === "mp4")
    .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));

  // Audio only (mp4/m4a)
  const audioFormats = ytdl.filterFormats(info.formats, "audioonly")
    .filter(f => f.container === "mp4" || f.container === "m4a")
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

  const allVideo = combinedFormats.length > 0 ? combinedFormats : videoOnlyFormats;

  if (allVideo.length === 0) {
    throw new Error("@distube/ytdl-core: tidak ada format video tersedia");
  }

  const formats = [];

  // Tambah format video
  const seenQ = new Set();
  for (const f of allVideo) {
    const q = f.qualityLabel || "SD";
    if (!seenQ.has(q)) {
      seenQ.add(q);
      formats.push({
        type: "video",
        quality: q,
        url: f.url,
        ext: "mp4",
        hasAudio: !f.hasVideo || f.hasAudio,
      });
    }
  }

  // Tambah format audio
  if (audioFormats.length > 0) {
    formats.push({
      type: "audio",
      quality: "Audio",
      url: audioFormats[0].url,
      ext: "m4a",
    });
  }

  console.log(`[YouTube] ✅ @distube/ytdl-core berhasil: ${formats.length} format, title="${title}"`);
  return buildYouTubeResult(videoId, formats[0].url, title, thumbnail, formats[0].quality, "ytdl-core", formats, author, duration);
}

/**
 * YouTube via yt-dlp dengan opsi khusus untuk bypass bot detection.
 * MODE: Metadata-only — hanya jalankan --dump-single-json, TIDAK download file.
 * Format dikembalikan sebagai URL /api/yt-download?videoId=XXX&formatId=YYY
 * agar streaming langsung dari server ke browser tanpa menyimpan file di disk.
 */
async function scrapeYouTubeViaYtDlpDirect(url) {
  console.log("[YouTube] Mencoba yt-dlp (mode metadata-only + streaming)...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Ambil metadata lengkap — gunakan player_client yang bypass bot detection
  const infoArgs = [
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    "--extractor-args", "youtube:player_client=mediaconnect,tv_embedded,ios,android,mweb;player_skip=webpage",
    "--no-check-certificates",
    "--extractor-retries", "5",
    "--sleep-interval", "2",
    "--max-sleep-interval", "5",
    cleanUrl
  ];

  const raw = await runCommand("yt-dlp", infoArgs, 120000);
  const info = JSON.parse(raw);

  const title = info.title || "YouTube Video";
  const author = info.uploader || info.channel || "YouTube";
  const thumbnail = info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const duration = info.duration || null;

  // Build format list dari info.formats — semua URL pakai /api/yt-download
  const formats = [];
  const seenQ = new Set();

  if (info.formats && Array.isArray(info.formats)) {
    // Video+audio combined: vcodec != none DAN acodec != none, sort by height desc
    const combinedFormats = info.formats
      .filter(f => f.format_id && f.vcodec && f.vcodec !== "none" && f.acodec && f.acodec !== "none")
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    for (const f of combinedFormats) {
      const q = f.height ? `${f.height}p` : (f.format_note || f.format_id || "SD");
      if (!seenQ.has(q)) {
        seenQ.add(q);
        formats.push({
          type: "video",
          quality: q,
          url: `/api/yt-download?videoId=${encodeURIComponent(videoId)}&formatId=${encodeURIComponent(f.format_id)}`,
          ext: "mp4",
          format_id: f.format_id
        });
      }
    }

    // Video-only HD (1080p+): vcodec != none DAN acodec == none
    // Di endpoint akan di-merge dengan audio terbaik via ffmpeg
    const videoOnlyFormats = info.formats
      .filter(f => f.format_id && f.vcodec && f.vcodec !== "none" && (!f.acodec || f.acodec === "none") && (f.height || 0) >= 1080)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    for (const f of videoOnlyFormats) {
      const q = f.height ? `${f.height}p` : (f.format_note || f.format_id);
      if (!seenQ.has(q)) {
        seenQ.add(q);
        formats.push({
          type: "video",
          quality: q,
          url: `/api/yt-download?videoId=${encodeURIComponent(videoId)}&formatId=${encodeURIComponent(f.format_id)}`,
          ext: "mp4",
          format_id: f.format_id
        });
      }
    }

    // Audio: vcodec == none — pilih m4a atau webm terbaik
    const audioFormats = info.formats
      .filter(f => f.format_id && (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none")
      .sort((a, b) => {
        // Prioritaskan m4a, lalu webm, lalu lainnya; sort by abr/tbr desc
        const extScore = (f) => f.ext === "m4a" ? 2 : f.ext === "webm" ? 1 : 0;
        if (extScore(b) !== extScore(a)) return extScore(b) - extScore(a);
        return ((b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
      });

    // Ambil satu audio format terbaik saja
    if (audioFormats.length > 0) {
      const bestAudio = audioFormats[0];
      formats.push({
        type: "audio",
        quality: "Audio MP3",
        url: `/api/yt-download?videoId=${encodeURIComponent(videoId)}&formatId=${encodeURIComponent(bestAudio.format_id)}&asAudio=1`,
        ext: "mp3",
        format_id: bestAudio.format_id
      });
    }
  }

  // Jika tidak ada format sama sekali, fallback ke format "best"
  if (formats.length === 0) {
    const mainQuality = info.height ? `${info.height}p` : "720p";
    formats.push({
      type: "video",
      quality: mainQuality,
      url: `/api/yt-download?videoId=${encodeURIComponent(videoId)}&formatId=bv%2Bba%2Fb`,
      ext: "mp4"
    });
    formats.push({
      type: "audio",
      quality: "Audio MP3",
      url: `/api/yt-download?videoId=${encodeURIComponent(videoId)}&formatId=ba%2Fb&asAudio=1`,
      ext: "mp3"
    });
  }

  const mainUrl = formats[0].url;
  const mainQuality = info.height ? `${info.height}p` : (formats[0].quality || "720p");

  console.log(`[YouTube] ✅ Metadata berhasil: ${formats.length} format, title="${title}"`);
  return buildYouTubeResult(videoId, mainUrl, title, thumbnail, mainQuality, "ytdlp-stream", formats, author, duration);
}

/**
 * YouTube via API publik ytsearch / noembed — hanya metadata + link langsung YouTube.
 * Dipakai sebagai fallback terakhir: mengembalikan link YouTube langsung agar user bisa download manual.
 */
async function scrapeYouTubeViaNoEmbed(url) {
  console.log("[YouTube] Mencoba NoEmbed/oEmbed untuk metadata...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const resp = await axios.get(oembedUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 10000
  });

  const data = resp.data;
  if (!data || !data.title) throw new Error("NoEmbed: tidak ada data");

  const title = data.title || "YouTube Video";
  const author = data.author_name || "YouTube";
  const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  // Kembalikan URL YouTube langsung — browser/IDM bisa handle ini
  const directUrl = `https://www.youtube.com/watch?v=${videoId}`;

  console.log(`[YouTube] ✅ NoEmbed berhasil: title="${title}"`);
  return buildYouTubeResult(videoId, directUrl, title, thumbnail, "YouTube Link", "noembed", [
    { type: "video", quality: "Buka di YouTube", url: directUrl, ext: "mp4" }
  ], author, null);
}

/**
 * YouTube via RapidAPI — YouTube MP4 Downloader.
 * RapidAPI bisa diakses dari Railway/datacenter karena merupakan layanan API resmi.
 * Menggunakan API key yang sama dengan RapidAPI Instagram di project ini.
 */
async function scrapeYouTubeViaRapidAPI(url) {
  console.log("[YouTube] Mencoba RapidAPI YouTube downloader...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "29be28c9fbmsh38d097de4f364c3p10b509jsn3a0f41eb7e83";

  // Coba beberapa RapidAPI YouTube endpoint yang berbeda
  const endpoints = [
    {
      name: "youtube-mp4",
      url: "https://youtube-mp4.p.rapidapi.com/",
      host: "youtube-mp4.p.rapidapi.com",
      params: { id: videoId, ext: "mp4" },
      method: "GET",
    },
    {
      name: "youtube-video-download-info",
      url: "https://youtube-video-download-info.p.rapidapi.com/dl",
      host: "youtube-video-download-info.p.rapidapi.com",
      params: { id: videoId },
      method: "GET",
    },
    {
      name: "yt-api",
      url: "https://yt-api.p.rapidapi.com/dl",
      host: "yt-api.p.rapidapi.com",
      params: { id: videoId },
      method: "GET",
    },
  ];

  for (const ep of endpoints) {
    try {
      const response = await axios({
        method: ep.method,
        url: ep.url,
        params: ep.params,
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": ep.host,
        },
        timeout: 20000,
      });

      const data = response.data;
      const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // Parse format response yang berbeda-beda per endpoint
      // Format 1: { link, title, ... }
      if (data.link && typeof data.link === "string" && data.link.startsWith("http")) {
        console.log(`[YouTube] RapidAPI ${ep.name} berhasil (format link)`);
        return buildYouTubeResult(videoId, data.link, data.title || "YouTube Video", thumbnail, "720p", "rapidapi");
      }

      // Format 2: { formats: [...], title, thumbnail }
      if (data.formats && Array.isArray(data.formats) && data.formats.length > 0) {
        const mp4Formats = data.formats.filter(f =>
          f.url && (f.ext === "mp4" || f.mimeType?.includes("video/mp4"))
        );
        if (mp4Formats.length > 0) {
          mp4Formats.sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));
          const best = mp4Formats[0];
          const formats = mp4Formats.map(f => ({
            type: "video",
            quality: f.qualityLabel || f.quality || "SD",
            url: f.url,
            ext: "mp4",
          }));
          console.log(`[YouTube] RapidAPI ${ep.name} berhasil (format formats[])`);
          return buildYouTubeResult(videoId, best.url, data.title || "YouTube Video",
            data.thumbnail || thumbnail, best.qualityLabel || "720p", "rapidapi", formats);
        }
      }

      // Format 3: { status: "ok", links: { mp4: { ... } } }
      if (data.status === "ok" && data.links?.mp4) {
        const mp4Links = data.links.mp4;
        const qualities = Object.keys(mp4Links).sort((a, b) => parseInt(b) - parseInt(a));
        if (qualities.length > 0) {
          const bestQ = qualities[0];
          const bestUrl = mp4Links[bestQ]?.url || mp4Links[bestQ];
          if (bestUrl && typeof bestUrl === "string") {
            const formats = qualities.map(q => ({
              type: "video",
              quality: `${q}p`,
              url: mp4Links[q]?.url || mp4Links[q],
              ext: "mp4",
            })).filter(f => f.url);
            console.log(`[YouTube] RapidAPI ${ep.name} berhasil (format links.mp4)`);
            return buildYouTubeResult(videoId, bestUrl, data.title || "YouTube Video",
              data.thumbnail || thumbnail, `${bestQ}p`, "rapidapi", formats);
          }
        }
      }

      // Format 4: array langsung [{ url, quality, ... }]
      if (Array.isArray(data) && data.length > 0) {
        const mp4Items = data.filter(f => f.url && (f.ext === "mp4" || f.type?.includes("mp4")));
        if (mp4Items.length > 0) {
          mp4Items.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
          const best = mp4Items[0];
          const formats = mp4Items.map(f => ({
            type: "video",
            quality: f.quality || f.qualityLabel || "SD",
            url: f.url,
            ext: "mp4",
          }));
          console.log(`[YouTube] RapidAPI ${ep.name} berhasil (format array)`);
          return buildYouTubeResult(videoId, best.url, "YouTube Video",
            thumbnail, best.quality || "720p", "rapidapi", formats);
        }
      }

      console.warn(`[YouTube] RapidAPI ${ep.name}: response format tidak dikenali`);
    } catch (err) {
      console.warn(`[YouTube] RapidAPI ${ep.name} gagal: ${err.message.substring(0, 100)}`);
    }
  }

  throw new Error("Semua RapidAPI YouTube endpoint gagal");
}

/**
 * YouTube via Invidious — YouTube frontend open-source dengan public API.
 * Invidious instances adalah proxy YouTube yang bisa diakses dari datacenter.
 */
async function scrapeYouTubeViaInvidious(url) {
  console.log("[YouTube] Mencoba Invidious API...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  // Daftar Invidious public instances yang aktif dan support API
  const instances = [
    "https://vid.puffyan.us",
    "https://invidious.nerdvpn.de",
    "https://inv.nadeko.net",
    "https://invidious.privacydev.net",
    "https://yt.cdaut.de",
    "https://invidious.fdn.fr",
    "https://iv.datura.network",
    "https://invidious.perennialte.ch",
    "https://invidious.reallyaweso.me",
    "https://invidious.no-logs.com",
    "https://invidious.kavin.rocks",
    "https://yewtu.be",
  ];

  for (const instance of instances) {
    try {
      const apiUrl = `${instance}/api/v1/videos/${videoId}`;
      const response = await axios.get(apiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        timeout: 15000,
      });

      const data = response.data;
      if (!data || !data.adaptiveFormats) {
        throw new Error("Response tidak mengandung adaptiveFormats");
      }

      const title = data.title || "YouTube Video";
      const author = data.author || "YouTube";
      const thumbnail =
        (data.videoThumbnails && data.videoThumbnails.find(t => t.quality === "high")?.url) ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // Ambil format video yang punya video+audio (formatStreams = combined)
      const combinedFormats = (data.formatStreams || []).filter(
        f => f.url && f.type?.includes("video/mp4")
      );

      // Kalau tidak ada combined, pakai adaptiveFormats (video only, tapi bisa diplay)
      const adaptiveVideo = (data.adaptiveFormats || []).filter(
        f => f.url && f.type?.includes("video/mp4") && f.qualityLabel
      );

      const allVideoFormats = [...combinedFormats, ...adaptiveVideo];
      if (allVideoFormats.length === 0) {
        throw new Error("Tidak ada format video MP4 tersedia dari Invidious");
      }

      // Sort by resolution descending
      allVideoFormats.sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));

      // Resolve URL — Invidious bisa return URL relatif
      const resolveUrl = (u) => {
        if (u.startsWith("http")) return u;
        return `${instance}${u}`;
      };

      const formats = allVideoFormats.map(f => ({
        type: "video",
        quality: f.qualityLabel || f.quality || "SD",
        url: resolveUrl(f.url),
        ext: "mp4",
      }));

      const bestUrl = resolveUrl(allVideoFormats[0].url);
      const bestQuality = allVideoFormats[0].qualityLabel || "720p";

      console.log(`[YouTube] ✅ Invidious ${instance} berhasil: ${formats.length} format`);
      return buildYouTubeResult(videoId, bestUrl, title, thumbnail, bestQuality, "invidious", formats, author, data.lengthSeconds || null);

    } catch (err) {
      console.warn(`[YouTube] Invidious ${instance} gagal: ${err.message.substring(0, 80)}`);
    }
  }

  throw new Error("Semua Invidious instance gagal");
}

/**
 * YouTube via Piped — alternatif YouTube frontend open-source dengan API.
 * Similar ke Invidious tapi backend berbeda.
 */
async function scrapeYouTubeViaPiped(url) {
  console.log("[YouTube] Mencoba Piped API...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const pipedInstances = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.drgns.space",
    "https://piped-api.garudalinux.org",
    "https://pipedapi.tokhmi.xyz",
    "https://pipedapi.leptons.xyz",
    "https://piped-api.privacy.com.de",
  ];

  for (const instance of pipedInstances) {
    try {
      const response = await axios.get(`${instance}/streams/${videoId}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        timeout: 15000,
      });

      const data = response.data;
      if (!data || !data.videoStreams) {
        throw new Error("Response tidak mengandung videoStreams");
      }

      const title = data.title || "YouTube Video";
      const author = data.uploader || "YouTube";
      const thumbnail = data.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // Piped gabungkan video+audio di videoStreams kalau format=mp4
      const mp4Streams = data.videoStreams.filter(
        s => s.url && s.format === "MPEG_4" && s.videoOnly === false
      );

      // Fallback: ambil semua MP4 stream meski video-only
      const allMp4 = data.videoStreams.filter(
        s => s.url && s.format === "MPEG_4"
      );

      const streams = mp4Streams.length > 0 ? mp4Streams : allMp4;
      if (streams.length === 0) {
        throw new Error("Tidak ada stream MP4 tersedia dari Piped");
      }

      streams.sort((a, b) => (b.quality || 0) - (a.quality || 0));

      const formats = streams.map(s => ({
        type: "video",
        quality: s.qualityLabel || `${s.quality}p` || "SD",
        url: s.url,
        ext: "mp4",
      }));

      console.log(`[YouTube] ✅ Piped ${instance} berhasil: ${formats.length} format`);
      return buildYouTubeResult(videoId, formats[0].url, title, thumbnail,
        formats[0].quality, "piped", formats, author, data.duration || null);

    } catch (err) {
      console.warn(`[YouTube] Piped ${instance} gagal: ${err.message.substring(0, 80)}`);
    }
  }

  throw new Error("Semua Piped instance gagal");
}

/**
 * Helper: bangun object result YouTube standar.
 */
function buildYouTubeResult(videoId, url, title, thumbnail, quality, source, formats = null, author = "YouTube", duration = null) {
  const height = parseInt(quality) || null;
  const finalFormats = formats || [{ type: "video", quality, url, ext: "mp4" }];

  return {
    platform: "youtube",
    type: "video",
    shortcode: videoId,
    author,
    caption: title,
    title,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration,
    mediaItems: [{
      type: "video",
      url,
      thumbnail,
      width: null,
      height,
      duration,
      ext: "mp4",
      formats: finalFormats,
    }],
    source,
    warning: null,
  };
}

/**
 * YouTube via PyTube (pytubefix) Python script.
 * Menggunakan script lokal pytube_scraper.py.
 */
async function scrapeYouTubeViaPytube(url) {
  console.log("[YouTube] Mencoba PyTube (pytubefix)...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const scriptPath = require("path").join(__dirname, "pytube_scraper.py");

  // Coba beberapa varian perintah python
  const pythonCandidates = process.platform === "win32"
    ? ["python", "python3"]
    : ["python3", "python"];

  for (const pythonCmd of pythonCandidates) {
    try {
      return await runPytubeScript(pythonCmd, scriptPath, url, videoId);
    } catch (err) {
      // Jika python tidak ditemukan (ENOENT), coba kandidat berikutnya
      if (err.message.includes("ENOENT") || err.message.includes("not found")) {
        console.warn(`[YouTube] ${pythonCmd} tidak tersedia, coba ${pythonCandidates[pythonCandidates.indexOf(pythonCmd) + 1] || 'yang lain'}...`);
        continue;
      }
      // Selain ENOENT, lempar error
      throw err;
    }
  }
  throw new Error("Tidak ada Python yang tersedia di sistem");
}

async function runPytubeScript(pythonCmd, scriptPath, url, videoId) {
  const { execFile } = require("child_process");

  return new Promise((resolve, reject) => {
    execFile(pythonCmd, [scriptPath, url], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        // stderr sangat penting untuk debugging: tunjukkan output Python error
        const stderrMsg = stderr ? ` | stderr: ${stderr.trim().substring(0, 500)}` : '';
        return reject(new Error(`PyTube error (${pythonCmd}): ${error.message}${stderrMsg}`));
      }

      // Log stderr walau sukses (mungkin ada warning)
      if (stderr) {
        console.warn(`[YouTube] PyTube stderr: ${stderr.trim().substring(0, 200)}`);
      }

      try {
        const data = JSON.parse(stdout);
        if (data.error) {
          return reject(new Error(`PyTube script error: ${data.error}`));
        }

        if (!data.formats || data.formats.length === 0) {
          return reject(new Error("PyTube: tidak ada format tersedia"));
        }

        const thumbnail = data.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        const title = data.title || "YouTube Video";
        const author = data.author || "YouTube";
        const duration = data.duration || null;

        const validFormats = data.formats.filter(f => f.url && f.url.length > 10);
        if (validFormats.length === 0) {
          return reject(new Error("PyTube: format URL tidak valid"));
        }

        // Route semua video URL melalui /api/yt-download (server-side proxy, hindari signed URL expire)
        for (const f of validFormats) {
          if (f.type === "video") {
            f.url = `/api/yt-download?videoId=${encodeURIComponent(videoId)}&formatId=${encodeURIComponent('pytube_' + (f.quality || 'best'))}`;
            f.ext = f.ext || "mp4";
          } else if (f.type === "audio") {
            f.url = `/api/extract-audio?url=${encodeURIComponent(f.url)}&filename=${encodeURIComponent('youtube_' + videoId + '.mp3')}`;
            f.ext = "mp3";
            f.quality = "Audio MP3";
          }
        }

        const bestVideo = validFormats.find(f => f.type === "video") || validFormats[0];
        const mainQuality = bestVideo.quality || "SD";
        const mainExt = bestVideo.ext || "mp4";

        resolve({
          platform: "youtube",
          type: "video",
          shortcode: videoId,
          author: author,
          caption: title,
          title: title,
          timestamp: null,
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          duration: duration,
          mediaItems: [{
            type: "video",
            url: bestVideo.url,
            thumbnail: thumbnail,
            width: null,
            height: parseInt(mainQuality) || null,
            duration: duration,
            ext: mainExt,
            formats: validFormats
          }],
          source: "pytube",
          warning: bestVideo.hasAudio === false ? "Video only, no audio" : null
        });

      } catch (parseErr) {
        console.warn("[YouTube] PyTube parse error stdout:", stdout.substring(0, 200));
        reject(new Error(`PyTube parse error: ${parseErr.message}`));
      }
    });
  });
}

/**
 * YouTube via Cobalt API v10 (open-source, tidak butuh API key).
 * Cobalt adalah tool download media open-source yang mendukung YouTube.
 * API v10: POST /api dengan Accept: application/json (bukan /api/json lagi)
 */
async function scrapeYouTubeViaCobalt(url) {
  console.log("[YouTube] Mencoba Cobalt API v10...");

  // Daftar instansi Cobalt publik — format API v10
  const cobaltInstances = [
    "https://api.cobalt.tools",
    "https://cobalt.api.lrclib.net",
    "https://cobalt-api.oofe.org",
    "https://co.wuk.sh",
  ];

  for (const instance of cobaltInstances) {
    try {
      // Coba API terbaru dulu (POST / dengan Accept: application/json)
      let response;
      try {
        response = await axios.post(
          `${instance}/`,
          {
            url: url,
            videoQuality: "720",
            filenameStyle: "basic",
            downloadMode: "auto",
          },
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            timeout: 20000,
          }
        );
      } catch (latestErr) {
        // Fallback ke API v10 (POST /api)
        try {
          response = await axios.post(
            `${instance}/api`,
            {
              url: url,
              videoQuality: "720",
              filenameStyle: "basic",
              downloadMode: "auto",
            },
            {
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              timeout: 20000,
            }
          );
        } catch (v10Err) {
          // Fallback ke endpoint lama /api/json
          response = await axios.post(
            `${instance}/api/json`,
            {
              url: url,
              vQuality: "720",
              filenamePattern: "basic",
              isAudioOnly: false,
              disableMetadata: true,
            },
            {
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              timeout: 20000,
            }
          );
        }
      }

      const data = response.data;

      // Status: "redirect" = URL langsung, "tunnel" = via cobalt proxy, "picker" = multiple items
      if (data.status === "redirect" || data.status === "tunnel") {
        const videoUrl = data.url;
        const videoId = extractYouTubeVideoId(url);
        const thumbnail = videoId
          ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          : null;

        return {
          platform: "youtube",
          type: "video",
          shortcode: videoId || "",
          author: "YouTube",
          caption: data.filename || "",
          title: data.filename
            ? data.filename.replace(/\.[^/.]+$/, "")
            : "YouTube Video",
          timestamp: null,
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          duration: null,
          mediaItems: [
            {
              type: "video",
              url: videoUrl,
              thumbnail: thumbnail,
              width: null,
              height: 720,
              duration: null,
              ext: "mp4",
              formats: [
                {
                  type: "video",
                  quality: "720p",
                  url: videoUrl,
                  ext: "mp4",
                },
              ],
            },
          ],
          source: "cobalt",
          warning: null,
        };
      }

      // Status picker: bisa memilih resolusi
      if (data.status === "picker" && data.picker && data.picker.length > 0) {
        const videoId = extractYouTubeVideoId(url);
        const thumbnail = videoId
          ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          : null;

        const formats = data.picker.map((item, i) => ({
          type: "video",
          quality: item.quality || `${i + 1}`,
          url: item.url,
          ext: "mp4",
        }));

        const bestItem = data.picker[0];
        return {
          platform: "youtube",
          type: "video",
          shortcode: videoId || "",
          author: "YouTube",
          caption: "",
          title: "YouTube Video",
          timestamp: null,
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          duration: null,
          mediaItems: [
            {
              type: "video",
              url: bestItem.url,
              thumbnail: thumbnail,
              width: null,
              height: null,
              duration: null,
              ext: "mp4",
              formats,
            },
          ],
          source: "cobalt",
          warning: null,
        };
      }

      console.warn(
        `[YouTube] Cobalt instance ${instance} status: ${data.status} — ${data.text || ""}`
      );
    } catch (err) {
      console.warn(
        `[YouTube] Cobalt instance ${instance} gagal: ${err.message}`
      );
    }
  }

  throw new Error("Semua instansi Cobalt gagal untuk YouTube");
}

/**
 * YouTube via Y2Mate API (populer untuk download video YouTube).
 * Menggunakan endpoint publik yang tidak memerlukan autentikasi.
 */
async function scrapeYouTubeViaY2Mate(url) {
  console.log("[YouTube] Mencoba Y2Mate API...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  // Step 1: Analisis video
  const analyzeRes = await axios.post(
    "https://www.y2mate.com/mates/analyzeV2/ajax",
    new URLSearchParams({
      k_query: `https://www.youtube.com/watch?v=${videoId}`,
      k_page: "home",
      hl: "en",
      q_auto: "1",
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.y2mate.com/",
        Origin: "https://www.y2mate.com",
      },
      timeout: 20000,
    }
  );

  const analyzeData = analyzeRes.data;
  if (!analyzeData || analyzeData.status !== "ok") {
    throw new Error("Y2Mate analyze gagal: " + (analyzeData?.mess || "unknown error"));
  }

  // Extract info dari response
  const title = analyzeData.title || "YouTube Video";
  const thumbnail =
    analyzeData.thumbnail ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const duration = analyzeData.t || null;

  // Cari format video mp4 terbaik (720p atau 480p)
  const videoLinks = analyzeData.links?.mp4 || {};
  const preferredQualities = ["720p", "480p", "360p", "240p"];
  let bestKey = null;
  let bestQuality = null;

  for (const q of preferredQualities) {
    if (videoLinks[q] && videoLinks[q].k) {
      bestKey = videoLinks[q].k;
      bestQuality = q;
      break;
    }
  }

  // Jika tidak ada preferredQualities, ambil yang pertama tersedia
  if (!bestKey) {
    const allKeys = Object.keys(videoLinks);
    if (allKeys.length > 0) {
      bestKey = videoLinks[allKeys[0]].k;
      bestQuality = allKeys[0];
    }
  }

  if (!bestKey) {
    throw new Error("Y2Mate: tidak ada format video yang tersedia");
  }

  // Step 2: Convert (dapatkan URL download)
  const convertRes = await axios.post(
    "https://www.y2mate.com/mates/convertV2/index",
    new URLSearchParams({
      vid: videoId,
      k: bestKey,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.y2mate.com/",
        Origin: "https://www.y2mate.com",
      },
      timeout: 25000,
    }
  );

  const convertData = convertRes.data;
  if (!convertData || convertData.status !== "ok" || !convertData.dlink) {
    throw new Error("Y2Mate convert gagal: " + (convertData?.mess || "unknown error"));
  }

  // Kumpulkan semua format yang tersedia
  const formats = [];
  for (const [q, info] of Object.entries(videoLinks)) {
    if (info.k) {
      formats.push({
        type: "video",
        quality: q,
        url: "", // URL didapat saat convert
        ext: "mp4",
        _key: info.k,
        _vid: videoId,
      });
    }
  }

  // Update best format dengan URL yang sudah di-convert
  const bestFormat = formats.find((f) => f.quality === bestQuality);
  if (bestFormat) bestFormat.url = convertData.dlink;

  return {
    platform: "youtube",
    type: "video",
    shortcode: videoId,
    author: analyzeData.a || "YouTube",
    caption: title,
    title: title,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: duration,
    mediaItems: [
      {
        type: "video",
        url: convertData.dlink,
        thumbnail: thumbnail,
        width: null,
        height: parseInt(bestQuality) || null,
        duration: duration,
        ext: "mp4",
        formats: formats.filter((f) => f.url).length > 0
          ? formats.filter((f) => f.url)
          : [
              {
                type: "video",
                quality: bestQuality,
                url: convertData.dlink,
                ext: "mp4",
              },
            ],
      },
    ],
    source: "y2mate",
    warning: null,
  };
}

/**
 * YouTube via SaveFrom (alternatif download YouTube tanpa yt-dlp).
 */
async function scrapeYouTubeViaSavefrom(url) {
  console.log("[YouTube] Mencoba SaveFrom API...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const response = await axios.get(
    `https://worker.sf-tools.com/savefrom.php?sf_url=${encodeURIComponent(cleanUrl)}&lang=en`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://en.savefrom.net/",
        Accept: "application/json",
      },
      timeout: 20000,
    }
  );

  const data = response.data;
  if (!data || !data.url || data.url.length === 0) {
    throw new Error("SaveFrom tidak mengembalikan URL download yang valid");
  }

  const title = data.meta?.title || "YouTube Video";
  const thumbnail =
    data.meta?.og?.image ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  // Filter format yang memiliki URL valid
  const validFormats = data.url.filter(
    (f) => f.url && (f.type === "mp4" || f.ext === "mp4")
  );

  if (validFormats.length === 0) {
    throw new Error("SaveFrom: tidak ada format MP4 yang tersedia");
  }

  // Sort by quality descending
  validFormats.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

  const formats = validFormats.map((f) => ({
    type: "video",
    quality: f.quality || "SD",
    url: Array.isArray(f.url) ? f.url[0] : f.url,
    ext: "mp4",
  }));

  const bestUrl = formats[0].url;

  return {
    platform: "youtube",
    type: "video",
    shortcode: videoId,
    author: data.meta?.og?.["video:tag"] || "YouTube",
    caption: title,
    title: title,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems: [
      {
        type: "video",
        url: bestUrl,
        thumbnail: thumbnail,
        width: null,
        height: parseInt(formats[0].quality) || null,
        duration: null,
        ext: "mp4",
        formats: formats,
      },
    ],
    source: "savefrom",
    warning: null,
  };
}

/**
 * YouTube via SnapSave/SSYouTube API.
 */
async function scrapeYouTubeViaSSYT(url) {
  console.log("[YouTube] Mencoba SSYouTube/SnapSave API...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  // API SnapSave (sering dipakai untuk download YouTube)
  const apiUrl = `https://ssyoutube.com/api/json`;
  const response = await axios.post(
    apiUrl,
    { url: `https://www.youtube.com/watch?v=${videoId}` },
    {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://ssyoutube.com/",
      },
      timeout: 20000,
    }
  );

  const data = response.data;
  if (!data || !data.url || data.url.length === 0) {
    throw new Error("SSYouTube tidak mengembalikan URL yang valid");
  }

  const title = data.title || "YouTube Video";
  const thumbnail =
    data.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const mp4Formats = (data.url || []).filter(
    (f) => f.ext === "mp4" && f.url
  );
  if (mp4Formats.length === 0) {
    throw new Error("SSYouTube: tidak ada format MP4 yang tersedia");
  }

  mp4Formats.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));
  const formats = mp4Formats.map((f) => ({
    type: "video",
    quality: f.quality || "SD",
    url: f.url,
    ext: "mp4",
  }));

  return {
    platform: "youtube",
    type: "video",
    shortcode: videoId,
    author: data.author || "YouTube",
    caption: title,
    title: title,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: data.duration || null,
    mediaItems: [
      {
        type: "video",
        url: formats[0].url,
        thumbnail: thumbnail,
        width: null,
        height: parseInt(formats[0].quality) || null,
        duration: data.duration || null,
        ext: "mp4",
        formats: formats,
      },
    ],
    source: "ssyoutube",
    warning: null,
  };
}

/**
 * YouTube via Siputzx API (sudah ada di projek, extend untuk YouTube).
 */
async function scrapeYouTubeViaSiputzx(url) {
  console.log("[YouTube] Mencoba Siputzx API untuk YouTube...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Coba endpoint berbeda dari siputzx untuk YouTube
  const endpoints = [
    `https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(cleanUrl)}`,
    `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(cleanUrl)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(endpoint, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 20000,
      });

      const data = response.data;
      if (data && data.status === true && data.data) {
        const isAudio = endpoint.includes("ytmp3");
        const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        return {
          platform: "youtube",
          type: "video",
          shortcode: videoId,
          author: data.data.author || "YouTube",
          caption: data.data.title || "YouTube Video",
          title: data.data.title || "YouTube Video",
          timestamp: null,
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          duration: data.data.seconds || null,
          mediaItems: [
            {
              type: isAudio ? "audio" : "video",
              url: data.data.url,
              thumbnail: thumbnail,
              width: null,
              height: null,
              duration: data.data.seconds || null,
              ext: isAudio ? "mp3" : "mp4",
              formats: [
                {
                  type: "video",
                  quality: "720p",
                  url: data.data.url,
                  ext: "mp4",
                },
                ...(isAudio
                  ? []
                  : [
                      {
                        type: "audio",
                        quality: "Audio",
                        url: data.data.url,
                        ext: "mp3",
                      },
                    ]),
              ],
            },
          ],
          source: "siputzx-yt",
          warning: null,
        };
      }
    } catch (err) {
      console.warn(`[YouTube] Siputzx endpoint gagal: ${err.message}`);
    }
  }

  throw new Error("Siputzx API tidak mengembalikan data YouTube yang valid");
}

/**
 * YouTube metadata via oEmbed (hanya untuk title/thumbnail, tidak ada download URL).
 * Digunakan sebagai informasi saja jika semua download method gagal.
 */
async function getYouTubeMetadata(url) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const res = await axios.get(oembedUrl, { timeout: 8000 });
    return {
      title: res.data.title || "YouTube Video",
      author: res.data.author_name || "YouTube",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch {
    return {
      title: "YouTube Video",
      author: "YouTube",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
  }
}

/**
 * Fungsi utama scraping YouTube dengan multiple fallback.
 * Urutan: PyTube (pytubefix) → yt-dlp → Cobalt → Siputzx → Y2Mate → SaveFrom → SSYouTube
 */
async function scrapeYouTube(url, ytdlpAvailable = false) {
  const errors = [];

  // Method 1: PyTube (pytubefix) — gunakan link langsung, paling andal karena tidak kena bot detection yt-dlp
  try {
    const result = await scrapeYouTubeViaPytube(url);
    console.log("[YouTube] \u2705 Berhasil via PyTube");
    return result;
  } catch (err) {
    console.warn(`[YouTube] PyTube gagal: ${err.message}`);
    errors.push(`PyTube: ${err.message}`);
  }

  // Method 2: yt-dlp mode YouTube Direct (opsi khusus YouTube, bypass bot detection)
  // Fallback jika PyTube gagal — gunakan player_client khusus untuk hindari "Sign in to confirm"
  if (ytdlpAvailable) {
    try {
      const result = await scrapeYouTubeViaYtDlpDirect(url);
      const hasValidMedia = result.mediaItems.some(
        (item) => item.url && item.url.length > 10
      );
      if (hasValidMedia) {
        console.log("[YouTube] \u2705 Berhasil via yt-dlp direct");
        return result;
      }
      throw new Error("yt-dlp mengembalikan URL media kosong");
    } catch (err) {
      console.warn(`[YouTube] yt-dlp direct gagal: ${err.message.substring(0, 120)}`);
      errors.push(`yt-dlp-direct: ${err.message.substring(0, 80)}`);
    }
  }

  // Method 3: yt-dlp standar (tanpa opsi khusus) — fallback jika mode direct gagal
  if (ytdlpAvailable) {
    try {
      const result = await scrapeViaYtDlp(url, "youtube");
      const hasValidMedia = result.mediaItems.some(
        (item) => item.url && item.url.length > 10
      );
      if (hasValidMedia) {
        console.log("[YouTube] \u2705 Berhasil via yt-dlp standar");
        return result;
      }
      throw new Error("yt-dlp mengembalikan URL media kosong");
    } catch (err) {
      console.warn(`[YouTube] yt-dlp standar gagal: ${err.message.substring(0, 120)}`);
      errors.push(`yt-dlp: ${err.message.substring(0, 80)}`);
    }
  }

  // Method 3: Cobalt API v10 (open-source, public instances, tidak butuh key)
  try {
    const result = await scrapeYouTubeViaCobalt(url);
    console.log("[YouTube] ✅ Berhasil via Cobalt");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Cobalt gagal: ${err.message}`);
    errors.push(`Cobalt: ${err.message}`);
  }

  // Method 4: Invidious — YouTube proxy open-source
  try {
    const result = await scrapeYouTubeViaInvidious(url);
    console.log("[YouTube] ✅ Berhasil via Invidious");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Invidious gagal: ${err.message}`);
    errors.push(`Invidious: ${err.message}`);
  }

  // Method 5: Piped — alternatif YouTube proxy
  try {
    const result = await scrapeYouTubeViaPiped(url);
    console.log("[YouTube] ✅ Berhasil via Piped");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Piped gagal: ${err.message}`);
    errors.push(`Piped: ${err.message}`);
  }

  // Method 6: @distube/ytdl-core — pure Node.js (sering kena bot-check tapi dicoba)
  try {
    const result = await scrapeYouTubeViaYtdlCore(url);
    console.log("[YouTube] ✅ Berhasil via @distube/ytdl-core");
    return result;
  } catch (err) {
    console.warn(`[YouTube] @distube/ytdl-core gagal: ${err.message}`);
    errors.push(`ytdl-core: ${err.message}`);
  }

  // Method 7: Siputzx API
  try {
    const result = await scrapeYouTubeViaSiputzx(url);
    console.log("[YouTube] ✅ Berhasil via Siputzx");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Siputzx gagal: ${err.message}`);
    errors.push(`Siputzx: ${err.message}`);
  }

  // Method 8: Y2Mate
  try {
    const result = await scrapeYouTubeViaY2Mate(url);
    console.log("[YouTube] ✅ Berhasil via Y2Mate");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Y2Mate gagal: ${err.message}`);
    errors.push(`Y2Mate: ${err.message}`);
  }

  // Method 9: SaveFrom
  try {
    const result = await scrapeYouTubeViaSavefrom(url);
    console.log("[YouTube] ✅ Berhasil via SaveFrom");
    return result;
  } catch (err) {
    console.warn(`[YouTube] SaveFrom gagal: ${err.message}`);
    errors.push(`SaveFrom: ${err.message}`);
  }

  // Method 10: SSYouTube
  try {
    const result = await scrapeYouTubeViaSSYT(url);
    console.log("[YouTube] ✅ Berhasil via SSYouTube");
    return result;
  } catch (err) {
    console.warn(`[YouTube] SSYouTube gagal: ${err.message}`);
    errors.push(`SSYouTube: ${err.message}`);
  }

  // Method 11: RapidAPI
  try {
    const result = await scrapeYouTubeViaRapidAPI(url);
    console.log("[YouTube] ✅ Berhasil via RapidAPI");
    return result;
  } catch (err) {
    console.warn(`[YouTube] RapidAPI gagal: ${err.message}`);
    errors.push(`RapidAPI: ${err.message}`);
  }

  // Method 12: NoEmbed — last resort, kembalikan link YouTube langsung
  try {
    const result = await scrapeYouTubeViaNoEmbed(url);
    console.log("[YouTube] ✅ Berhasil via NoEmbed (metadata only)");
    return result;
  } catch (err) {
    console.warn(`[YouTube] NoEmbed gagal: ${err.message}`);
    errors.push(`NoEmbed: ${err.message}`);
  }

  // Semua gagal
  throw new Error(
    `YouTube download gagal. Semua metode error:\n${errors.join("\n")}\n\n` +
    `Solusi: Install yt-dlp dengan "pip install yt-dlp" untuk hasil terbaik, ` +
    `atau coba lagi beberapa saat kemudian.`
  );
}

// ─── Scrape Foto via HTML Page (og:image) ───────────────────────────────────

/**
 * Fallback untuk mengambil foto dari halaman web manapun.
 * Mengekstrak og:image, twitter:image, dan URL gambar dari meta tags.
 * Bekerja untuk semua platform: Instagram, Twitter/X, Pinterest, Facebook, dll.
 */
async function scrapePhotoViaPage(url) {
  console.log(`[Scraper] Mencoba scrape foto via HTML page...`);

  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    timeout: 15000,
    maxRedirects: 5,
  });

  const html = response.data;
  const imageUrls = [];
  const seen = new Set();

  // 1. og:image (digunakan Instagram, Facebook, Pinterest, dll)
  const ogImageRegex = /<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/gi;
  let match;
  while ((match = ogImageRegex.exec(html)) !== null) {
    const u = match[1].replace(/&amp;/g, '&');
    if (!seen.has(u)) { seen.add(u); imageUrls.push(u); }
  }
  // Juga cek format terbalik: content dulu, property setelahnya
  const ogImageRegex2 = /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/gi;
  while ((match = ogImageRegex2.exec(html)) !== null) {
    const u = match[1].replace(/&amp;/g, '&');
    if (!seen.has(u)) { seen.add(u); imageUrls.push(u); }
  }

  // 2. twitter:image
  const twImageRegex = /<meta\s+(?:property|name)=["']twitter:image(?::src)?["']\s+content=["']([^"']+)["']/gi;
  while ((match = twImageRegex.exec(html)) !== null) {
    const u = match[1].replace(/&amp;/g, '&');
    if (!seen.has(u)) { seen.add(u); imageUrls.push(u); }
  }
  const twImageRegex2 = /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']twitter:image(?::src)?["']/gi;
  while ((match = twImageRegex2.exec(html)) !== null) {
    const u = match[1].replace(/&amp;/g, '&');
    if (!seen.has(u)) { seen.add(u); imageUrls.push(u); }
  }

  // 3. Instagram: cari URL CDN gambar dari embedded JSON data
  const cdnRegex = /https?:\/\/[^\s"'<>]*(?:cdninstagram\.com|fbcdn\.net)[^\s"'<>]*\.(?:jpg|jpeg|png|webp)[^\s"'<>]*/gi;
  while ((match = cdnRegex.exec(html)) !== null) {
    let u = match[0].replace(/\\u0026/g, '&').replace(/\\/g, '');
    // Hindari thumbnail kecil
    if (u.includes('s150x150') || u.includes('150x150')) continue;
    if (!seen.has(u)) { seen.add(u); imageUrls.push(u); }
  }

  // 4. Pinterest: cari URL pinimg
  const pinRegex = /https?:\/\/i\.pinimg\.com\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/gi;
  while ((match = pinRegex.exec(html)) !== null) {
    let u = match[0];
    // Ganti ukuran kecil ke original
    u = u.replace(/\/[0-9]+x[0-9]*\//, '/originals/');
    if (!seen.has(u)) { seen.add(u); imageUrls.push(u); }
  }

  // 5. Twitter/X: cari URL twimg
  const twimgRegex = /https?:\/\/pbs\.twimg\.com\/media\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)[^\s"'<>]*/gi;
  while ((match = twimgRegex.exec(html)) !== null) {
    let u = match[0].replace(/&amp;/g, '&');
    // Ambil kualitas terbaik
    if (!u.includes('name=') && !u.includes('format=')) {
      u = u + '?format=jpg&name=orig';
    } else if (u.includes('name=')) {
      u = u.replace(/name=[a-z]+/i, 'name=orig');
    }
    if (!seen.has(u)) { seen.add(u); imageUrls.push(u); }
  }

  // Ambil title dan author dari meta tags
  let title = '';
  const titleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i)
    || html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1];

  let author = '';
  const authorMatch = html.match(/<meta\s+(?:property|name)=["'](?:og:site_name|author|twitter:creator)["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:site_name|author|twitter:creator)["']/i);
  if (authorMatch) author = authorMatch[1];

  if (imageUrls.length === 0) {
    throw new Error("Tidak ditemukan foto dalam halaman ini.");
  }

  // Deduplikasi: buang URL yang mirip (hanya beda parameter query)
  const uniqueUrls = [];
  const seenBase = new Set();
  for (const u of imageUrls) {
    // Abaikan logo Instagram/UI statis yang muncul karena login wall
    if (u.includes('static.cdninstagram.com') || u.includes('rsrc.php')) continue;

    const base = u.split('?')[0];
    if (!seenBase.has(base)) {
      seenBase.add(base);
      uniqueUrls.push(u);
    }
  }

  if (uniqueUrls.length === 0) {
    throw new Error("Hanya ditemukan logo/UI, tidak ditemukan foto konten asli.");
  }

  console.log(`[Scraper] Ditemukan ${uniqueUrls.length} foto via HTML page.`);

  const mediaItems = uniqueUrls.slice(0, 10).map((imgUrl, i) => {
    let ext = 'jpg';
    if (imgUrl.includes('.png')) ext = 'png';
    else if (imgUrl.includes('.webp')) ext = 'webp';

    return {
      type: 'image',
      url: imgUrl,
      thumbnail: imgUrl,
      width: null,
      height: null,
      duration: null,
      ext: ext,
      formats: [
        { type: 'image', quality: `Foto ${i + 1}`, url: imgUrl, ext: ext }
      ]
    };
  });

  return {
    platform: "unknown", // Akan di-overwrite oleh caller
    type: mediaItems.length > 1 ? "playlist" : "image",
    shortcode: "",
    author: author || "unknown",
    caption: title || "",
    title: title || "",
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems: mediaItems,
    source: "page_scrape",
    warning: null
  };
}

// ─── Helper: Gabungkan hasil story dari beberapa API (Collect & Merge) ───────
/**
 * Menggabungkan hasil story dari beberapa API, dengan deduplikasi berbasis URL.
 * Ini memungkinkan mengatasi batas 6 story dari API gratis,
 * karena setiap API mungkin mengembalikan story yang berbeda.
 *
 * @param {Array} results - Array dari objek hasil scraper (masing-masing punya .mediaItems)
 * @param {string} author - Username/author dari story
 * @returns {object|null} - Objek hasil gabungan, atau null jika kosong
 */
function mergeStoryResults(results, author) {
  if (!results || results.length === 0) return null;

  const seen = new Set();
  const allMediaItems = [];

  for (const result of results) {
    if (!result || !result.mediaItems) continue;
    for (const item of result.mediaItems) {
      if (!item.url) continue;

      // Buat fingerprint untuk deduplikasi.
      // CDN Instagram: pathname sudah unik (misal /v/t51.29350-15/HASH_UNIK.jpg)
      // URL proxy (igram.world, dll): pathname sering generik (/api/download), jadi pakai full URL
      let fingerprint;
      try {
        const parsed = new URL(item.url);
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const lastSegment = pathParts[pathParts.length - 1] || '';

        // Jika segment terakhir cukup panjang (hash CDN Instagram), gunakan itu
        // Contoh: "449912345_789abc_n.jpg" dari scontent-xxx.cdninstagram.com
        if (lastSegment.length > 10) {
          fingerprint = lastSegment;
        } else {
          // Segment pendek = URL proxy/generik, gunakan full URL agar tidak kolaps
          fingerprint = item.url;
        }
      } catch {
        // Fallback: gunakan full URL
        fingerprint = item.url;
      }

      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        allMediaItems.push(item);
      }
    }
  }

  if (allMediaItems.length === 0) return null;

  // Gunakan metadata dari hasil pertama yang berhasil
  const firstResult = results.find(r => r && r.mediaItems && r.mediaItems.length > 0) || results[0];
  const sources = results
    .filter(r => r && r.source)
    .map(r => r.source)
    .filter((v, i, a) => a.indexOf(v) === i); // unique sources

  return {
    platform: "instagram",
    type: allMediaItems.length > 1 ? "playlist" : allMediaItems[0].type,
    shortcode: firstResult.shortcode || "story_merged",
    author: author || firstResult.author || "Instagram User",
    caption: firstResult.caption || "",
    title: firstResult.title || "",
    timestamp: firstResult.timestamp || null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems: allMediaItems,
    source: `merged(${sources.join('+')})`,
    warning: null
  };
}

// ─── Fungsi utama (multi-platform) ──────────────────────────────────────────

/**
 * Scrape media dari URL yang didukung.
 * Mendukung: Instagram, TikTok, YouTube, Facebook, Twitter, Pinterest.
 *
 * @param {string} url - URL media
 * @returns {Promise<object>} Data media
 */
// ─── Instagram Story via Instagram API (GraphQL/Private API) ──────────────────
// Menggunakan cookies untuk mengakses Instagram API langsung.
// Mendapatkan SEMUA story items termasuk FOTO yang tidak muncul di yt-dlp.

async function scrapeInstagramStoryViaAPI(url) {
  const usernameMatch = url.match(/instagram\.com\/stories\/([^/]+)/i);
  if (!usernameMatch || !usernameMatch[1]) throw new Error("Username tidak ditemukan dari URL story");
  const username = usernameMatch[1];
  console.log(`[IG-API] Mencoba Instagram API untuk @${username}...`);

  const fs = require('fs');

  // Parse cookies — dari file (lokal) atau env var (Railway)
  let cookiesContent = null;
  const cookiesFile = getRandomCookieFile();
  if (cookiesFile) {
    cookiesContent = fs.readFileSync(cookiesFile, 'utf-8');
  } else if (process.env.IG_COOKIE_BASE64) {
    cookiesContent = Buffer.from(process.env.IG_COOKIE_BASE64, 'base64').toString('utf-8');
    console.log('[IG-API] Menggunakan cookies dari env var IG_COOKIE_BASE64');
  } else {
    throw new Error("Cookies tidak ditemukan (file atau env var IG_COOKIE_BASE64)");
  }

  const cookies = {};
  const trimmed = cookiesContent.trim();

  // Format 1: Netscape (tab-separated)
  let parsedOk = false;
  trimmed.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split('\t');
    if (parts.length >= 7 && parts[0] && parts[0].includes('instagram.com') && parts[5] && parts[6]) {
      try { cookies[parts[5]] = decodeURIComponent(parts[6]); } catch (_) { cookies[parts[5]] = parts[6]; }
      parsedOk = true;
    }
  });

  // Format 2: JSON (cookies array) — fallback jika Netscape gagal
  if (!parsedOk && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
    try {
      const jsonCookies = JSON.parse(trimmed);
      const arr = Array.isArray(jsonCookies) ? jsonCookies : [jsonCookies];
      for (const c of arr) {
        if (c.name && c.value && c.domain && c.domain.includes('instagram.com')) {
          cookies[c.name] = c.value;
        }
      }
      if (Object.keys(cookies).length > 0) {
        parsedOk = true;
        console.log('[IG-API] Cookies parsed dari format JSON');
      }
    } catch (_) {}
  }

  // Format 3: Query string (name=value; name=value) — fallback terakhir
  if (!parsedOk && trimmed.includes('sessionid=')) {
    const parts = trimmed.split(/[;&]/);
    for (const p of parts) {
      const eq = p.indexOf('=');
      if (eq > 0) {
        const name = p.substring(0, eq).trim();
        const value = p.substring(eq + 1).trim();
        if (name && value) cookies[name] = decodeURIComponent(value);
      }
    }
    if (cookies.sessionid) {
      parsedOk = true;
      console.log('[IG-API] Cookies parsed dari format query string');
    }
  }

  const sessionId = cookies.sessionid || process.env.IG_SESSIONID;
  const dsUserId = cookies.ds_user_id || process.env.IG_DS_USER_ID;
  const csrfToken = cookies.csrftoken || process.env.IG_CSRFTOKEN;
  const igDid = cookies.ig_did || process.env.IG_DID;

  if (!sessionId) {
    console.error('[IG-API] Gagal parse cookies. Isi cookie (200 chars):', cookiesContent.substring(0, 200));
    throw new Error("sessionid tidak ada di cookies file");
  }

  const cookieStr = `sessionid=${encodeURIComponent(sessionId)}; ds_user_id=${dsUserId || ''}; csrftoken=${csrfToken || ''}; ig_did=${igDid || ''}`;

  // Headers — gunakan desktop UA agar cocok dengan cookies dari browser
  const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const headers = {
    'User-Agent': desktopUA,
    'X-IG-App-ID': '936619743392459',
    'X-ASBD-ID': '129477',
    'X-IG-WWW-Claim': '0',
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cookieStr,
    'Accept': '*/*',
    'Referer': `https://www.instagram.com/stories/${username}/`,
  };

  // Step 1: Get user ID — try URL params first, then API fallback
  let userId = null;

  // Method A: Extract from URL query params (reel_owner_id=xxx or reel_id=xxx)
  try {
    const urlObj = new URL(url);
    let maybeId = urlObj.searchParams.get('reel_owner_id') || urlObj.searchParams.get('reel_id');
    if (maybeId && /^\d+$/.test(maybeId)) {
      userId = maybeId;
      console.log(`[IG-API] User ID dari URL param: ${userId}`);
    }
  } catch (_) {}

  // Method B: Extract user ID and reel_owner_id from story page embedded JSON
  if (!userId) {
    try {
      const pageHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Cookie': cookieStr,
        'Accept': 'text/html,application/xhtml+xml',
      };
      // Scrape the story page directly (not profile) — contains __INITIAL_STATE__ JSON
      const storyPage = await axios.get(`https://www.instagram.com/stories/${username}/`, { headers: pageHeaders, timeout: 15000 });
      const html = storyPage.data || '';

      // Try to extract user ID from embedded data with brace-counting (handles nested JSON)
      const initStateStart = html.indexOf('window.__INITIAL_STATE__');
      if (initStateStart !== -1) {
        const jsonStart = html.indexOf('{', initStateStart);
        if (jsonStart !== -1) {
          let depth = 0;
          let jsonEnd = jsonStart;
          for (let i = jsonStart; i < html.length; i++) {
            if (html[i] === '{') depth++;
            else if (html[i] === '}') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
          }
          if (jsonEnd > jsonStart) {
            try {
              const initState = JSON.parse(html.substring(jsonStart, jsonEnd));
              userId = initState?.reel?.owner?.id || initState?.reel?.user?.id || null;
              if (userId) console.log(`[IG-API] User ID dari __INITIAL_STATE__: ${userId}`);
            } catch (_) {}
          }
        }
      }

      // Try to extract reel_owner_id or user id from various patterns
      if (!userId) {
        const escUser = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
          /"reel_owner_id"\s*:\s*"(\d+)"/,
          new RegExp('"id"\\s*:\\s*"(\\d+)"[\\s\\S]{0,100}"username"\\s*:\\s*"' + escUser + '"'),
          new RegExp('"owner"\\s*:\\s*\\{[^}]*"id"\\s*:\\s*"(\\d+)"[^}]*"username"\\s*:\\s*"' + escUser + '"'),
        ];
        for (const pat of patterns) {
          const m = html.match(pat);
          if (m && m[1]) { userId = m[1]; console.log(`[IG-API] User ID dari HTML pattern: ${userId}`); break; }
        }
      }
    } catch (e) {
      console.log(`[IG-API] Story page scraping gagal: ${e.message.substring(0, 60)}`);
    }
  }

  // Method C: Scrape profile page for user ID (fallback)
  if (!userId) {
    try {
      const pageHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Cookie': cookieStr,
        'Accept': 'text/html,application/xhtml+xml',
      };
      const profilePage = await axios.get(`https://www.instagram.com/${username}/`, { headers: pageHeaders, timeout: 15000 });
      const html = profilePage.data || '';
      // Try multiple patterns to find user ID
      const patterns = [
        /"profilePage_(\d+)"/,
        /"owner"\s*:\s*\{[^}]*"id"\s*:\s*"(\d+)"/,
        /"user"\s*:\s*\{[^}]*"id"\s*:\s*"(\d+)"/,
        /"logging_page_id"\s*:\s*"profilePage_(\d+)"/,
      ];
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m && m[1]) { userId = m[1]; console.log(`[IG-API] User ID dari profile page: ${userId}`); break; }
      }
    } catch (e) {
      console.log(`[IG-API] Profile page scraping gagal: ${e.message.substring(0, 60)}`);
    }
  }

  // Method D: API fallback (only if previous methods didn't give us the ID)
  if (!userId) {
    try {
      const profileResp = await axios.get(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
        { headers, timeout: 15000 }
      );
      userId = profileResp.data?.data?.user?.id;
    } catch (e1) {
      console.log(`[IG-API] web_profile_info gagal: ${e1.message.substring(0, 60)}, coba usernameinfo...`);
      try {
        const userResp = await axios.get(
          `https://i.instagram.com/api/v1/users/${username}/usernameinfo/`,
          { ...headers, timeout: 15000 }
        );
        userId = userResp.data?.user?.pk;
      } catch (e2) {
        console.log(`[IG-API] usernameinfo juga gagal: ${e2.message.substring(0, 60)}`);
      }
    }
  }

  // Method E: Extract user ID from story media ID using media info API
  if (!userId) {
    const storyMediaMatch = url.match(/instagram\.com\/stories\/[\w.]+\/(\d+)/i);
    if (storyMediaMatch && storyMediaMatch[1]) {
      const mediaId = storyMediaMatch[1];
      console.log(`[IG-API] Mencoba media info API untuk media ID: ${mediaId}`);
      try {
        const mediaResp = await axios.get(
          `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
          { headers, timeout: 15000 }
        );
        userId = mediaResp.data?.items?.[0]?.user?.pk ||
                 mediaResp.data?.item?.user?.pk ||
                 mediaResp.data?.media?.user?.id ||
                 null;
        if (userId) console.log(`[IG-API] User ID dari media info API: ${userId}`);
      } catch (e) {
        console.log(`[IG-API] Media info API gagal: ${e.message.substring(0, 60)}`);
      }
    }
  }

  // Method F: Try oEmbed + GraphQL as final fallback (no auth needed for public)
  if (!userId) {
    try {
      const oembedResp = await axios.get(
        `https://api.instagram.com/oembed/?url=https://www.instagram.com/stories/${username}/&maxwidth=640`,
        { headers: { "User-Agent": IG_USER_AGENT }, timeout: 10000 }
      );
      const authorName = oembedResp.data?.author_name;
      const authorUrl = oembedResp.data?.author_url;
      if (authorName) {
        console.log(`[IG-API] oEmbed: author @${authorName}`);
        // Use author_name as username for the story
        if (authorUrl) {
          const idMatch = authorUrl.match(/instagram\.com\/([^/]+)/);
          if (idMatch && idMatch[1]) {
            // Try looking up this user via public API
            try {
              const userResp = await axios.get(
                `https://www.instagram.com/api/v1/users/web_profile_info/?username=${authorName}`,
                { headers: { ...headers, 'Cookie': '' }, timeout: 10000 }
              );
              userId = userResp.data?.data?.user?.id;
              if (userId) console.log(`[IG-API] User ID dari oEmbed+public API: ${userId}`);
            } catch (_) {}
          }
        }
      }
    } catch (e) {
      console.log(`[IG-API] oEmbed gagal: ${e.message.substring(0, 60)}`);
    }
  }

  if (!userId) throw new Error("User ID tidak ditemukan dari URL maupun API");

  console.log(`[IG-API] User ID @${username} = ${userId}`);

  // Step 2: Fetch reel_media (stories) via web API
  let storyResp;
  try {
    storyResp = await axios.get(
      `https://www.instagram.com/api/v1/feed/user/${userId}/reel_media/`,
      { headers, timeout: 30000 }
    );
  } catch (e) {
    // Fallback ke mobile API jika web API gagal
    try {
      const mobileUA = 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; Google; Pixel 6; oriole; oriole; en_US; 458229258)';
      const mobileHeaders = { ...headers, 'User-Agent': mobileUA, 'Referer': undefined, 'X-Requested-With': undefined };
      storyResp = await axios.get(
        `https://i.instagram.com/api/v1/feed/user/${userId}/reel_media/`,
        { headers: mobileHeaders, timeout: 30000 }
      );
    } catch (e2) {
      throw new Error(`Gagal fetch stories: web=${e.response?.status || 'err'}, mobile=${e2.response?.status || 'err'}`);
    }
  }

  const items = storyResp.data?.reel?.items || storyResp.data?.items || [];
  if (!items.length) throw new Error("Tidak ada story items dari API");

  console.log(`[IG-API] ${items.length} story items ditemukan`);

  // Step 3: Parse each story item
  const mediaItems = [];
  for (const item of items) {
    const isVideo = item.media_type === 2; // 1=photo, 2=video
    let mediaUrl = null;
    let thumbUrl = null;

    if (isVideo) {
      const versions = item.video_versions || [];
      versions.sort((a, b) => (b.height || 0) - (a.height || 0));
      mediaUrl = versions[0]?.url || null;
      const imgVersions = item.image_versions2?.candidates || [];
      imgVersions.sort((a, b) => (b.width || 0) - (a.width || 0));
      thumbUrl = imgVersions[0]?.url || null;
    } else {
      const imgVersions = item.image_versions2?.candidates || [];
      imgVersions.sort((a, b) => (b.width || 0) - (a.width || 0));
      mediaUrl = imgVersions[0]?.url || null;
      thumbUrl = mediaUrl;
    }

    if (!mediaUrl) continue;

    mediaUrl = mediaUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    if (thumbUrl) thumbUrl = thumbUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');

    const ext = isVideo ? 'mp4' : 'jpg';
    const width = item.original_width || null;
    const height = item.original_height || null;

    mediaItems.push({
      type: isVideo ? 'video' : 'image',
      url: mediaUrl,
      thumbnail: thumbUrl || mediaUrl,
      width, height,
      duration: item.video_duration || null,
      ext,
      formats: [{
        type: isVideo ? 'video' : 'image',
        quality: isVideo ? `${height || 0}p` : 'Original',
        url: mediaUrl,
        ext
      }]
    });
  }

  if (!mediaItems.length) throw new Error("Tidak ada media yang bisa di-extract dari API");

  const videoCount = mediaItems.filter(m => m.type === 'video').length;
  const photoCount = mediaItems.filter(m => m.type === 'image').length;
  console.log(`[IG-API] OK: ${mediaItems.length} items (${videoCount} video, ${photoCount} foto)`);

  return {
    platform: "instagram",
    type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
    shortcode: "",
    author: username,
    caption: "",
    title: `Story @${username}`,
    timestamp: null,
    likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
    mediaItems,
    source: "ig_api",
    warning: null
  };
}

// ─── Instagram Story via yt-dlp ─────────────────────────────────────────────
// Mendukung download story dengan cookies file (untuk akun private) atau tanpa cookies (publik)

async function scrapeInstagramStoryViaYtDlp(url, withCookies = false) {
  const cookiesFile = getRandomCookieFile();
  const hasCookies = withCookies && cookiesFile !== null;

  if (withCookies && !hasCookies) {
    throw new Error("Cookies file tidak ditemukan");
  }

  const label = withCookies ? "yt-dlp + cookies" : "yt-dlp (no cookies)";

  // Ubah URL spesifik (dengan story ID) ke URL username saja agar yt-dlp download SEMUA story
  let ytUrl = url;
  const storyParts = url.match(/instagram\.com\/stories\/([^/?#]+)(?:\/(\d+))?/i);
  const hasSpecificStory = storyParts && storyParts[2];
  if (hasSpecificStory) {
    ytUrl = `https://www.instagram.com/stories/${storyParts[1]}/`;
    console.log(`[Scraper] URL story spesifik -> coba username all-stories: ${ytUrl}`);
  }

  async function tryYtDlp(targetUrl) {
    const args = [
      "--dump-single-json",
      "--no-warnings",
      "--yes-playlist",
      "--extractor-args", "instagram:api_version=v1",
      "--no-skip-unavailable-fragments",
      "--write-all-thumbnails",
      "--no-check-formats"
    ];
    if (hasCookies) args.push("--cookies", cookiesFile);
    args.push(targetUrl);

    console.log(`[Scraper] Mencoba ${label}...`);
    const raw = await runCommand("yt-dlp", args, 90000);
    const info = JSON.parse(raw);
    const res = parseYtDlpOutput(info, "instagram");
    const usernameMatch = url.match(/instagram\.com\/stories\/([^/]+)/i);
    if (usernameMatch && usernameMatch[1]) res.author = usernameMatch[1];
    return res;
  }

  // Langkah 1: coba all-stories URL (username saja)
  let result = null;
  if (hasSpecificStory) {
    result = await tryYtDlp(ytUrl);
    if (result.mediaItems.length > 0) {
      console.log(`[Scraper] Story OK via all-stories: ${result.mediaItems.length} items`);
      return result;
    }
    console.log(`[Scraper] All-stories kosong (0 item), fallback ke URL story spesifik`);
  }

  // Langkah 2: coba URL spesifik (fallback untuk story expired yg masih bisa diakses via direct link)
  result = await tryYtDlp(url);
  if (result.mediaItems.length > 0) {
    console.log(`[Scraper] Story OK via URL spesifik: ${result.mediaItems.length} items`);
    return result;
  }

  throw new Error("Tidak ada story items dari yt-dlp");
}

// ─── Instagram Story via Instaloader (Python) ─────────────────────────────────
// Download stories menggunakan instaloader --stories <username>

async function scrapeInstagramStoryViaInstaloader(url) {
  // Extract username dari URL: instagram.com/stories/<username>/...
  const usernameMatch = url.match(/instagram\.com\/stories\/([^/]+)/i);
  if (!usernameMatch || !usernameMatch[1]) {
    throw new Error("Username tidak ditemukan dari URL story");
  }
  const username = usernameMatch[1];
  console.log(`[Scraper] Mencoba Instaloader --stories untuk @${username}...`);

  return new Promise((resolve, reject) => {
    const { exec } = require("child_process");
    const fs = require("fs");
    const path = require("path");

    // Check if Python available
    exec('python3 --version', (err3) => {
      const pythonCmd = err3 ? 'python' : 'python3';
      exec(`${pythonCmd} --version`, (err) => {
        if (err) {
          return reject(new Error("Python tidak ditemukan untuk Instaloader."));
        }

        const tempDirName = `temp_ig_story_${Date.now()}`;
        const cmd = `${pythonCmd} -m instaloader --no-captions --no-metadata-json --stories --dirname-pattern=${tempDirName}/{profile} -- ${username}`;

        exec(cmd, { timeout: 90000 }, (error, stdout, stderr) => {
          const tempBaseDir = path.join(__dirname, tempDirName);

          if (!fs.existsSync(tempBaseDir)) {
            console.warn(`[Scraper] Instaloader story error: ${stderr || error?.message || 'Unknown'}`);
            return reject(new Error("Instaloader gagal: folder tidak dibuat"));
          }

          try {
            // Find profile subfolder
            const subdirs = fs.readdirSync(tempBaseDir).filter(f =>
              fs.statSync(path.join(tempBaseDir, f)).isDirectory()
            );
            const profileName = subdirs.length > 0 ? subdirs[0] : null;
            const tempDir = profileName ? path.join(tempBaseDir, profileName) : tempBaseDir;

            const files = fs.readdirSync(tempDir);
            const mediaFiles = files.filter(f =>
              f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg') || f.endsWith('.mp4') || f.endsWith('.webp')
            ).sort();

            if (mediaFiles.length === 0) {
              fs.rmSync(tempBaseDir, { recursive: true, force: true });
              return reject(new Error("Media story tidak ditemukan dari Instaloader"));
            }

            // Process files ke base64 data URL
            const mediaItems = [];
            for (const file of mediaFiles) {
              const filePath = path.join(tempDir, file);
              const stats = fs.statSync(filePath);
              if (stats.size === 0) continue;

              const isVideo = file.endsWith('.mp4');
              const ext = isVideo ? 'mp4' : (file.endsWith('.webp') ? 'webp' : 'jpg');
              const mimeType = isVideo ? 'video/mp4' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;

              const buffer = fs.readFileSync(filePath);
              const base64 = buffer.toString('base64');
              const dataUrl = `data:${mimeType};base64,${base64}`;

              console.log(`[Scraper] Instaloader story: ${file} (${(stats.size / 1024).toFixed(0)}KB)`);

              mediaItems.push({
                type: isVideo ? "video" : "image",
                url: dataUrl,
                thumbnail: dataUrl,
                width: null,
                height: null,
                duration: null,
                ext: ext,
                formats: [{
                  type: isVideo ? "video" : "image",
                  quality: isVideo ? "HD" : `Story ${mediaItems.length + 1}`,
                  url: dataUrl,
                  ext: ext
                }]
              });
            }

            // Clean up
            fs.rmSync(tempBaseDir, { recursive: true, force: true });

            if (mediaItems.length === 0) {
              return reject(new Error("Semua file story kosong dari Instaloader"));
            }

            console.log(`[Scraper] ✅ Instaloader story: ${mediaItems.length} media dari @${username}`);

            resolve({
              platform: "instagram",
              type: mediaItems.length > 1 ? "playlist" : mediaItems[0].type,
              shortcode: "",
              author: username,
              caption: "",
              title: `Story @${username}`,
              timestamp: null,
              likeCount: 0,
              commentCount: 0,
              viewCount: 0,
              duration: null,
              mediaItems: mediaItems,
              source: "instaloader",
              warning: null
            });
          } catch (fsErr) {
            try { fs.rmSync(tempBaseDir, { recursive: true, force: true }); } catch (e) {}
            reject(new Error(`File system error: ${fsErr.message}`));
          }
        });
      });
    });
  });
}

async function scrapeMedia(url) {
  // Bersihkan URL: hapus trailing ? tanpa query params
  url = url.replace(/\?$/, '').replace(/&$/, '');

  // Deteksi platform
  const detected = detectPlatform(url);
  if (!detected) {
    throw new Error(
      "URL tidak valid atau platform tidak didukung. " +
      "Platform yang didukung: Instagram, TikTok, YouTube, Facebook, Pinterest, Threads, Viday, Videy, UC Drive, Vizey, Slicidrive, Bokepbox, Bokepbox TV."
    );
  }

  const { platform, config } = detected;
  console.log(`[Scraper] Platform terdeteksi: ${config.name}`);

  // Untuk Instagram, validasi tambahan shortcode (kecuali Story URL)
  if (platform === "instagram" && !isInstagramStoryUrl(url)) {
    const shortcode = extractShortcode(url);
    if (!shortcode) {
      throw new Error(
        "URL Instagram tidak valid. Gunakan link postingan, reel, story, atau IGTV."
      );
    }
  }

  // ─── INSTAGRAM ── Railway-safe strategy (no browser, no cookies-from-browser) ──
  if (platform === "instagram") {
    const isReel = url.includes('/reel/') || url.includes('/reels/');
    const isStory = isInstagramStoryUrl(url);
    const ytdlpAvailable = await checkYtDlp();

    // Helper: coba yt-dlp tanpa cookies (Railway punya yt-dlp dari Dockerfile)
    // Untuk carousel: gunakan --yes-playlist agar semua slide ter-extract sebagai entries
    async function tryYtDlpDirect() {
      if (!ytdlpAvailable) throw new Error("yt-dlp tidak tersedia");
      
      // Reels: tanpa direct_video_url=true untuk dapat format muxed (video+audio 1 file)
      // Foto/Carousel: pakai direct_video_url=true
      const isReel = url.includes('/reel/') || url.includes('/reels/');
      const args = [
        "--dump-single-json", "--no-warnings",
        "--yes-playlist"
      ];
      
      if (!isReel) {
        args.push("--extractor-args", "instagram:direct_video_url=true");
      }
      
      const cookiesFile = getRandomCookieFile();
      if (cookiesFile) {
        args.push("--cookies", cookiesFile);
      }
      
      args.push(url);
      
      const raw = await runCommand("yt-dlp", args, 60000);
      const info = JSON.parse(raw);
      const result = parseYtDlpOutput(info, "instagram");
      
      // Enrich dengan oEmbed untuk username & caption yang lebih akurat
      try {
        const oembedResp = await axios.get(
          `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}&maxwidth=640`,
          { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 }
        );
        if (oembedResp.data?.author_name) result.author = oembedResp.data.author_name;
        if (oembedResp.data?.title) {
          result.caption = oembedResp.data.title;
          result.title = oembedResp.data.title;
        }
      } catch (e) { /* oEmbed enrichment optional */ }
      
      return result;
    }

    if (isReel) {
      // ── REEL/VIDEO ──
      // 1. yt-dlp langsung (paling andal di Railway, sudah di-install via Dockerfile)
      try {
        const r = await tryYtDlpDirect();
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Reel OK via yt-dlp (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] yt-dlp reel gagal:", e.message.substring(0, 100)); }

      // 2. SSSSave
      try {
        const r = await scrapeInstagramViaSSSSave(url);
        if (r.mediaItems.length > 0) { console.log("[Scraper] Reel OK via SSSSave"); return r; }
      } catch (e) { console.warn("[Scraper] SSSSave reel gagal:", e.message.substring(0, 80)); }

      // 3. igram.world
      try {
        const r = await scrapeInstagramViaIgram(url);
        if (r.mediaItems.length > 0) { console.log("[Scraper] Reel OK via igram"); return r; }
      } catch (e) { console.warn("[Scraper] igram reel gagal:", e.message.substring(0, 80)); }

      // 4. SnapInsta
      try {
        const r = await scrapeInstagramViaSnapinsta(url);
        if (r.mediaItems.length > 0) { console.log("[Scraper] Reel OK via SnapInsta"); return r; }
      } catch (e) { console.warn("[Scraper] SnapInsta reel gagal:", e.message.substring(0, 80)); }

    } else if (isStory) {
      // ── STORY ── (Strategi: Kumpulkan & Gabungkan / Collect & Merge)
      // API gratis sering membatasi maks 6 story per request.
      // Strategi baru: coba BANYAK API, kumpulkan semua hasilnya, gabungkan & deduplikasi.
      // Jika yt-dlp+cookies sukses (biasanya mengembalikan SEMUA story), langsung return.
      const collectedResults = [];

      // === FASE 0: Instagram API (BEST: mengembalikan SEMUA story termasuk FOTO) ===
      try {
        const r = await scrapeInstagramStoryViaAPI(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Story OK via Instagram API (${r.mediaItems.length} items, termasuk foto)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] Instagram API story gagal:", e.message.substring(0, 80)); }

      // === FASE 1: yt-dlp (tidak ada limit story jika pakai cookies) ===
      // 1a. yt-dlp dengan cookies file (BEST: mengembalikan SEMUA story)
      try {
        const r = await scrapeInstagramStoryViaYtDlp(url, true);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Story OK via yt-dlp+cookies (${r.mediaItems.length} items, no limit)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] yt-dlp+cookies story gagal:", e.message.substring(0, 80)); }

      // 1b. yt-dlp tanpa cookies (untuk akun publik, tapi sering terbatas)
      try {
        const r = await scrapeInstagramStoryViaYtDlp(url, false);
        if (r.mediaItems.length > 6) {
          // Jika yt-dlp tanpa cookies berhasil dapat >6, langsung return (sudah lengkap)
          console.log(`[Scraper] Story OK via yt-dlp no-cookies (${r.mediaItems.length} items)`);
          return r;
        }
        // Jika dapat ≤6, simpan dulu dan lanjut kumpulkan dari API lain
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] yt-dlp no-cookies: ${r.mediaItems.length} items (akan digabung)`);
          collectedResults.push(r);
        }
      } catch (e) { console.warn("[Scraper] yt-dlp story gagal:", e.message.substring(0, 80)); }

      // === FASE 2: Kumpulkan dari banyak API gratis secara paralel ===
      // Kita jalankan beberapa API secara bersamaan (paralel) untuk kecepatan
      const storyUsername = url.match(/stories\/([a-zA-Z0-9_.-]+)/)?.[1] || "Instagram User";

      // Helper: Coba satu API, simpan hasilnya jika berhasil
      async function tryStoryAPI(name, fn) {
        try {
          const r = await fn();
          if (r && r.mediaItems && r.mediaItems.length > 0) {
            console.log(`[Scraper] Story ${name}: ${r.mediaItems.length} items dikumpulkan`);
            return r;
          }
        } catch (e) { console.warn(`[Scraper] ${name} story gagal:`, e.message.substring(0, 80)); }
        return null;
      }

      // Batch 1: API tercepat (REST API tanpa Playwright)
      const batch1 = await Promise.allSettled([
        tryStoryAPI("RapidAPI", () => scrapeViaRapidAPI(url)),
        tryStoryAPI("SSSSave", () => scrapeInstagramViaSSSSave(url)),
        tryStoryAPI("igram", () => scrapeInstagramViaIgram(url)),
        tryStoryAPI("SnapInsta", () => scrapeInstagramViaSnapinsta(url)),
      ]);

      for (const result of batch1) {
        if (result.status === "fulfilled" && result.value) {
          collectedResults.push(result.value);
        }
      }

      // Jika sudah dapat banyak dari batch 1, cek apakah gabungan sudah >6
      const mergedCount1 = mergeStoryResults(collectedResults, storyUsername);
      if (mergedCount1 && mergedCount1.mediaItems.length > 6) {
        console.log(`[Scraper] ✅ Story MERGED dari ${collectedResults.length} API: ${mergedCount1.mediaItems.length} items total`);
        return mergedCount1;
      }

      // Batch 2: API lebih lambat (npm packages + Playwright)
      const batch2 = await Promise.allSettled([
        tryStoryAPI("Bochil", () => scrapeInstagramViaBochil(url)),
        tryStoryAPI("Mrnima", () => scrapeInstagramViaMrnima(url)),
        tryStoryAPI("Playwright", () => scrapeInstagramViaIgramPlaywright(url)),
      ]);

      for (const result of batch2) {
        if (result.status === "fulfilled" && result.value) {
          collectedResults.push(result.value);
        }
      }

      // Batch 3: Instaloader (paling lambat, Python)
      const instaloaderResult = await tryStoryAPI("Instaloader", () => scrapeInstagramStoryViaInstaloader(url));
      if (instaloaderResult) collectedResults.push(instaloaderResult);

      // === FASE 3: Gabungkan & deduplikasi semua hasil ===
      if (collectedResults.length > 0) {
        const merged = mergeStoryResults(collectedResults, storyUsername);
        if (merged && merged.mediaItems.length > 0) {
          console.log(`[Scraper] ✅ Story MERGED dari ${collectedResults.length} API: ${merged.mediaItems.length} items total`);
          return merged;
        }
      }

      // Semua gagal
      throw new Error("Story tidak tersedia, private, atau sudah expired");

    } else {
      // ── FOTO / CAROUSEL SLIDE ──
      // Strategi: Instaloader (paling reliable) → yt-dlp → RapidAPI → API publik gratis → Direct API → Embed

      // 1. [PRIORITAS UTAMA] Instaloader (Python) — PALING RELIABLE untuk carousel, support semua tipe foto
      // Metode ini download file ke disk lalu convert ke base64
      try {
        const r = await scrapeInstagramViaInstaloader(url);
        if (r.mediaItems.length > 0) {
          // Enrich username & caption via oEmbed
          try {
            const oembedResp = await axios.get(
              `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}&maxwidth=640`,
              { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 }
            );
            if (oembedResp.data?.author_name) r.author = oembedResp.data.author_name;
            if (oembedResp.data?.title) { r.caption = oembedResp.data.title; r.title = oembedResp.data.title; }
          } catch (e) { /* oEmbed optional */ }
          
          console.log(`[Scraper] ✅ Foto/Carousel OK via Instaloader (${r.mediaItems.length} item, author: ${r.author})`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] Instaloader gagal:", e.message.substring(0, 80)); }

      // 2. yt-dlp — support carousel via entries, tanpa API key (kadang gagal untuk foto)
      try {
        const r = await tryYtDlpDirect();
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] ✅ Foto OK via yt-dlp (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] yt-dlp foto gagal:", e.message.substring(0, 100)); }

      // 3. RapidAPI — stabil, support carousel, username real (tapi ada rate limit)
      try {
        const r = await scrapeViaRapidAPI(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] ✅ Foto OK via RapidAPI (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] RapidAPI gagal:", e.message.substring(0, 120)); }

      // 4. API Publik Gratis (Paralel) — SSSSave, igram, SnapInsta, SaveIG (CEPAT)
      const publicApis = await Promise.allSettled([
        (async () => {
          try {
            const r = await scrapeInstagramViaSSSSave(url);
            if (r.mediaItems.length > 0) {
              console.log(`[Scraper] ✅ Foto OK via SSSSave (${r.mediaItems.length} item)`);
              return r;
            }
          } catch (e) { console.warn("[Scraper] SSSSave gagal:", e.message.substring(0, 80)); }
          return null;
        })(),
        (async () => {
          try {
            const r = await scrapeInstagramViaIgram(url);
            if (r.mediaItems.length > 0) {
              console.log(`[Scraper] ✅ Foto OK via igram (${r.mediaItems.length} item)`);
              return r;
            }
          } catch (e) { console.warn("[Scraper] igram gagal:", e.message.substring(0, 80)); }
          return null;
        })(),
        (async () => {
          try {
            const r = await scrapeInstagramViaSnapinsta(url);
            if (r.mediaItems.length > 0) {
              console.log(`[Scraper] ✅ Foto OK via SnapInsta (${r.mediaItems.length} item)`);
              return r;
            }
          } catch (e) { console.warn("[Scraper] SnapInsta gagal:", e.message.substring(0, 80)); }
          return null;
        })(),
        (async () => {
          try {
            const r = await scrapeInstagramViaSaveIG(url);
            if (r.mediaItems.length > 0) {
              console.log(`[Scraper] ✅ Foto OK via SaveIG (${r.mediaItems.length} item)`);
              return r;
            }
          } catch (e) { console.warn("[Scraper] SaveIG gagal:", e.message.substring(0, 80)); }
          return null;
        })()
      ]);

      // Gunakan hasil pertama yang berhasil
      for (const result of publicApis) {
        if (result.status === "fulfilled" && result.value) {
          return result.value;
        }
      }

      // 5. Direct API: EmbedAPI + GraphQL + HTML Scrape (CEPAT & NO DOWNLOAD)
      try {
        const r = await scrapeInstagramViaDirectAPI(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] ✅ Foto OK via Direct API (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] Direct API gagal:", e.message.substring(0, 120)); }

      // 6. Embed Page — carousel detection via JSON sidecar data (CEPAT, tanpa API key)
      try {
        const r = await scrapeInstagramViaEmbed(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] ✅ Foto/Carousel OK via Embed (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] Embed gagal:", e.message.substring(0, 80)); }

      // Semua metode gagal
      throw new Error("Instagram foto/carousel tidak bisa didownload. Coba lagi nanti.");
    }
  }

  // Prioritaskan @tobyg74/tiktok-api-dl untuk TikTok agar foto slide & story ditangani dengan baik
  if (platform === "tiktok") {
    try {
      const apiDlResult = await scrapeViaTikTokApiDl(url);
      console.log(`[Scraper] Berhasil via tiktok-api-dl v1 (${apiDlResult.mediaItems.length} item)`);
      return apiDlResult;
    } catch (err) {
      console.warn(`[Scraper] tiktok-api-dl v1 gagal, mencoba fallback TikWM API... ${err.message}`);
      try {
        const tikwmResult = await scrapeViaTikwmAPI(url);
        console.log(`[Scraper] Berhasil via TikWM (${tikwmResult.mediaItems.length} item)`);
        return tikwmResult;
      } catch (err2) {
        console.warn(`[Scraper] TikWM gagal, mencoba tiktok-api-dl v3 (MusicalDown HD)... ${err2.message}`);
        try {
          const apiDlV3Result = await scrapeViaTikTokApiDlV3(url);
          console.log(`[Scraper] Berhasil via tiktok-api-dl v3 (${apiDlV3Result.mediaItems.length} item)`);
          return apiDlV3Result;
        } catch (err3) {
          console.warn(`[Scraper] tiktok-api-dl v3 gagal, mencoba fallback yt-dlp... ${err3.message}`);
          // Fallback akan dilanjutkan ke yt-dlp di bawah
        }
      }
    }
  }

  // Pinterest: Gunakan yt-dlp langsung (work dengan baik untuk Pinterest)
  // Viday & Videy: Scrape HTML untuk video URL
  if (platform === "viday" || platform === "videy") {
    try {
      const result = await scrapeVidayVidey(url, platform);
      console.log(`[Scraper] ${platform} berhasil (${result.mediaItems.length} video)`);
      return result;
    } catch (err) {
      console.warn(`[Scraper] ${platform} gagal: ${err.message}`);
      // Fallback ke Playwright untuk videy jika kena 403 (WAF/ISP block)
      if (platform === "videy" && (String(err.message).includes("403") || String(err.message).includes("401"))) {
        try {
          console.log(`[Scraper] Mencoba fallback Playwright untuk ${platform}...`);
          const tempPath = await downloadVideyViaPlaywright(url);
          const shortcode = new URL(url).searchParams.get('id') || url.split('/').pop().replace(/\?.*/, '') || "videy";
          return {
            platform,
            type: "video",
            shortcode,
            author: platform,
            caption: `Videy ${shortcode}`,
            title: `Videy ${shortcode}`,
            timestamp: null,
            likeCount: 0,
            commentCount: 0,
            viewCount: 0,
            duration: null,
            mediaItems: [{
              type: "video",
              url: tempPath,
              thumbnail: null,
              width: null,
              height: null,
              duration: null,
              ext: "mp4",
              formats: [{ type: "video", quality: "HD", url: tempPath, ext: "mp4" }],
            }],
            source: "playwright-fallback",
            warning: "Video diambil via Playwright (fallback). Mungkin lebih lambat.",
          };
        } catch (pwErr) {
          console.warn(`[Scraper] Fallback Playwright juga gagal: ${pwErr.message}`);
          throw new Error(`${platform} download gagal: ${err.message}`);
        }
      }
      throw new Error(`${platform} download gagal: ${err.message}`);
    }
  }

  if (platform === "bokepbox") {
    try {
      const result = await scrapeBokepbox(url);
      console.log(`[Scraper] bokepbox berhasil`);
      return result;
    } catch (err) {
      console.warn(`[Scraper] bokepbox gagal: ${err.message}`);
      throw new Error(`bokepbox download gagal: ${err.message}`);
    }
  }

  // Vizey & Slicidrive: URL video langsung dari CDN, tanpa scraping HTML
  if (platform === "vizey" || platform === "slicidrive") {
    const filename = url.split('/').pop().replace(/\.mp4.*/i, '') || "video";
    return {
      platform,
      type: "video",
      shortcode: filename,
      author: platform === "vizey" ? "Vizey" : "Slicidrive",
      caption: filename,
      title: filename,
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems: [{
        type: "video",
        url: url,
        thumbnail: url,
        width: null,
        height: null,
        duration: null,
        ext: "mp4",
        formats: [{ type: "video", quality: "HD", url: url, ext: "mp4" }],
      }],
      source: "direct-cdn",
      warning: null,
    };
  }

  // UC Drive: API-based scraper (no login required for video preview)
  if (platform === "ucweb") {
    try {
      const result = await scrapeUcwebDrive(url);
      console.log(`[Scraper] UC Drive berhasil (${result.mediaItems.length} file)`);
      return result;
    } catch (err) {
      console.warn(`[Scraper] UC Drive gagal: ${err.message}`);
      throw new Error(`UC Drive download gagal: ${err.message}`);
    }
  }

  if (platform === "pinterest") {
    try {
      const pinterestResult = await scrapePinterest(url);
      console.log(`[Scraper] Pinterest berhasil (${pinterestResult.mediaItems.length} item)`);
      return pinterestResult;
    } catch (err) {
      console.warn(`[Scraper] Pinterest gagal: ${err.message}`);
      throw new Error(`Pinterest download gagal: ${err.message}`);
    }
  }

  // YouTube: Gunakan scrapeYouTube dengan multiple fallback (tidak bergantung hanya pada yt-dlp)
  if (platform === "youtube") {
    const ytdlpAvail = await checkYtDlp();
    try {
      const youtubeResult = await scrapeYouTube(url, ytdlpAvail);
      console.log(`[Scraper] YouTube berhasil via ${youtubeResult.source} (${youtubeResult.mediaItems.length} item)`);
      return youtubeResult;
    } catch (err) {
      console.warn(`[Scraper] Semua metode YouTube gagal: ${err.message}`);
      throw new Error(err.message);
    }
  }

  // Threads: Gunakan yt-dlp (native support) + Playwright fallback untuk carousel
  if (platform === "threads") {
    const ytdlpAvail = await checkYtDlp();
    
    // Method 1: yt-dlp (best for video, supports resolution selection)
    if (ytdlpAvail) {
      try {
        const threadsResult = await scrapeViaYtDlp(url, 'threads');
        const hasValidMedia = threadsResult.mediaItems.some(item => item.url && item.url.length > 10);
        if (hasValidMedia) {
          console.log(`[Scraper] Threads berhasil via yt-dlp (${threadsResult.mediaItems.length} item)`);
          return threadsResult;
        }
      } catch (e) {
        console.warn(`[Scraper] Threads yt-dlp gagal: ${e.message.substring(0, 100)}`);
      }
    }

    // Method 2: Playwright (for photo carousel yang yt-dlp tidak bisa extract)
    try {
      const playwrightResult = await scrapeThreadsViaPlaywright(url);
      if (playwrightResult.mediaItems.length > 0) {
        console.log(`[Scraper] Threads berhasil via Playwright (${playwrightResult.mediaItems.length} item)`);
        return playwrightResult;
      }
    } catch (e) {
      console.warn(`[Scraper] Threads Playwright gagal: ${e.message.substring(0, 100)}`);
    }

    throw new Error("Tidak bisa download Threads post. Mungkin post dihapus atau private.");
  }

  // Cek yt-dlp tersedia
  const ytdlpAvailable = await checkYtDlp();

  if (ytdlpAvailable) {
    try {
      const result = await scrapeViaYtDlp(url, platform);

      // Validasi: cek apakah semua media items memiliki URL yang valid
      const hasValidMedia = result.mediaItems.some(item => item.url && item.url.length > 10);
      if (!hasValidMedia) {
        console.warn(`[Scraper] yt-dlp mengembalikan data tapi URL media kosong. Mencoba fallback foto...`);
        throw new Error("URL media kosong dari yt-dlp");
      }

      console.log(
        `[Scraper] Berhasil via yt-dlp (${result.mediaItems.length} item dari ${config.name})`
      );
      return result;
    } catch (err) {
      console.warn(`[Scraper] yt-dlp gagal untuk ${config.name}: ${err.message}`);

      // TikTok & Instagram: coba retry dengan cookies browser
      if (platform === "tiktok" || platform === "instagram") {
        try {
          const result = await scrapeViaCookiesRetry(url, platform);
          console.log(`[Scraper] ${platform} berhasil via cookies browser`);
          return result;
        } catch (retryErr) {
          console.warn(`[Scraper] ${platform} cookies retry gagal: ${retryErr.message}`);
        }
      }
      
      // Facebook: gunakan Siputzx fallback
      if (platform === "facebook") {
        try {
          return await scrapeViaSiputzxAPI(url);
        } catch (fbErr) {
          console.warn(`[Scraper] Facebook fallback gagal: ${fbErr.message}`);
        }
      }
    }
  } else {
    console.warn("[Scraper] yt-dlp tidak ditemukan!");
  }



  // ─── Fallback foto via HTML page scraping (semua platform) ───
  try {
    const photoResult = await scrapePhotoViaPage(url);
    photoResult.platform = platform;
    console.log(`[Scraper] Berhasil via page scrape (${photoResult.mediaItems.length} foto)`);
    return photoResult;
  } catch (photoErr) {
    console.warn(`[Scraper] Page scrape gagal: ${photoErr.message}`);
  }

  if (platform === "tiktok") {
    try {
      return await scrapeViaTikwmAPI(url);
    } catch (err) {
      throw new Error(
        `Semua metode scraping gagal untuk TikTok.\n` +
        `Detail: ${err.message}`
      );
    }
  }

  if (platform === "instagram") {
    throw new Error(
      `Semua metode scraping gagal untuk Instagram. ` +
      `URL mungkin private atau sistem sedang down.`
    );
  }

  // Platform lain tanpa yt-dlp = tidak bisa
  throw new Error(
    `yt-dlp diperlukan untuk mengunduh dari ${config.name}. ` +
    `Install dengan: pip install yt-dlp`
  );
}

// ─── TikTok Stories by Username ─────────────────────────────────────────────

/**
 * Mengambil TikTok Stories dari username.
 * Stories di TikTok berbeda dari video biasa — muncul di bagian atas profil
 * dan menghilang setelah 24 jam.
 *
 * @param {string} username - Username TikTok (tanpa @)
 * @returns {Promise<object>} Data stories
 */
async function scrapeTikTokStoriesByUsername(username) {
  username = username.replace(/^@/, '').trim();
  if (!username || username.length < 2) {
    throw new Error("Username TikTok tidak valid. Masukkan username tanpa @.");
  }

  console.log(`[Scraper] Mengambil TikTok Stories untuk @${username}...`);

  // ─── Helper: proses item story TikWM ───
  function parseTikWMItem(item) {
    if (item.images && item.images.length > 0) {
      return item.images.map((imgUrl, imgIdx) => ({
        type: 'image', url: imgUrl, thumbnail: imgUrl, width: null, height: null, duration: null, ext: 'jpg',
        formats: [{ type: 'image', quality: `Foto ${imgIdx + 1}`, url: imgUrl, ext: 'jpg' }],
      }));
    }
    if (item.play) {
      return [{
        type: 'video', url: item.play, thumbnail: item.cover || item.origin_cover || item.play,
        width: null, height: null, duration: item.duration || null, ext: 'mp4',
        formats: [
          { type: 'video', quality: 'No Watermark', url: item.play, ext: 'mp4' },
          { type: 'video', quality: 'Watermark', url: item.wmplay || item.play, ext: 'mp4' },
          ...(item.music ? [{ type: 'audio', quality: 'Audio', url: item.music, ext: 'mp3' }] : []),
        ],
      }];
    }
    return [];
  }

  function buildResult(mediaItems, source, warning) {
    return {
      platform: 'tiktok', type: 'playlist', shortcode: '',
      author: username, caption: `TikTok Stories dari @${username}`,
      title: `TikTok Stories @${username}`, timestamp: null,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems: mediaItems.slice(0, 20), source,
      warning,
    };
  }

  // ─── Metode 1: TikWM user/story API (stories ASLI, terbukti hidup) ───
  try {
    console.log(`[Scraper] Mencoba TikWM story API untuk @${username}...`);
    const allMedia = [];
    let cursor = '0';
    let hasMore = false;
    do {
      const resp = await axios.get(`https://www.tikwm.com/api/user/story?unique_id=${encodeURIComponent(username)}&count=30&cursor=${cursor}`, {
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (resp.data?.code !== 0) break;
      const items = resp.data.data?.videos;
      if (!items?.length) break;
      allMedia.push(...items.flatMap(parseTikWMItem));
      cursor = resp.data.data?.cursor || '0';
      hasMore = !!resp.data.data?.hasMore;
    } while (hasMore && cursor && cursor !== '0' && allMedia.length < 50);
    if (allMedia.length > 0) {
      console.log(`[Scraper] ✅ TikTok stories: ${allMedia.length} item untuk @${username}`);
      return buildResult(allMedia, 'tikwm_story', null);
    }
    console.warn(`[Scraper] TikWM story: tidak ada story aktif untuk @${username}`);
  } catch (err) {
    console.warn(`[Scraper] TikWM story API gagal: ${err.message}`);
  }

  // ─── Metode 2: TikWM user/posts (postingan biasa, fallback) ───
  try {
    console.log(`[Scraper] Mencoba TikWM user posts (fallback) untuk @${username}...`);
    const resp = await axios.get(`https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(username)}&count=20`, {
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (resp.data?.code === 0 && resp.data?.data?.videos?.length > 0) {
      const mediaItems = resp.data.data.videos.flatMap(parseTikWMItem);
      if (mediaItems.length > 0) {
        console.log(`[Scraper] ✅ TikWM posts: ${mediaItems.length} konten dari @${username}`);
        return buildResult(mediaItems, 'tikwm_posts', 'Tidak ada story aktif. Menampilkan postingan terbaru.');
      }
    }
  } catch (err) {
    console.warn(`[Scraper] TikWM user posts gagal: ${err.message}`);
  }

  // ─── Metode 3: yt-dlp profil ───
  const ytdlpAvailable = await checkYtDlp();
  if (ytdlpAvailable) {
    try {
      console.log(`[Scraper] Mencoba yt-dlp untuk @${username}...`);
      const raw = await runCommand('yt-dlp', [
        '--dump-single-json', '--no-warnings', '--playlist-end', '20',
        '--add-header', 'User-Agent:Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        `https://www.tiktok.com/@${username}`,
      ], 60000);
      const info = JSON.parse(raw);
      const result = parseYtDlpOutput(info, 'tiktok');
      result.title = `TikTok @${username}`;
      result.author = username;
      result.caption = `Konten dari @${username}`;
      if (result.mediaItems.length > 0) {
        console.log(`[Scraper] ✅ yt-dlp: ${result.mediaItems.length} konten dari @${username}`);
        result.warning = 'Tidak ada story aktif. Menampilkan postingan terbaru.';
        return result;
      }
    } catch (err) {
      console.warn(`[Scraper] yt-dlp gagal: ${err.message}`);
    }

    try {
      const browsers = ['chrome', 'edge', 'firefox', 'brave'];
      for (const browser of browsers) {
        try {
          const raw = await runCommand('yt-dlp', [
            '--dump-single-json', '--no-warnings', '--playlist-end', '20',
            '--cookies-from-browser', browser,
            '--add-header', 'User-Agent:Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
            `https://www.tiktok.com/@${username}`,
          ], 60000);
          const info = JSON.parse(raw);
          const result = parseYtDlpOutput(info, 'tiktok');
          result.title = `TikTok @${username}`;
          result.author = username;
          result.caption = `Konten dari @${username}`;
          if (result.mediaItems.length > 0) {
            console.log(`[Scraper] ✅ yt-dlp (cookies ${browser}): ${result.mediaItems.length} konten`);
            result.warning = 'Tidak ada story aktif. Menampilkan postingan terbaru.';
            return result;
          }
        } catch (e) {
          console.warn(`[Scraper] yt-dlp cookies ${browser} gagal: ${e.message.substring(0, 80)}`);
        }
      }
    } catch (err) {
      console.warn(`[Scraper] yt-dlp cookies retry gagal: ${err.message}`);
    }
  }

  throw new Error(
    `Gagal mengambil konten TikTok dari @${username}. ` +
    `Pastikan username benar, akun publik, dan memiliki konten aktif.`
  );
}

/**
 * Mengambil semua video dalam YouTube Playlist menggunakan yt-dlp.
 *
 * @param {string} url - URL playlist YouTube
 * @returns {Promise<object>} Data playlist
 */
async function scrapeYouTubePlaylist(url) {
  console.log(`[Scraper] Mengambil YouTube Playlist: ${url}`);

  const videoId = extractYouTubeVideoId(url);
  const listMatch = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  const listId = listMatch ? listMatch[1] : null;

  if (!listMatch) {
    throw new Error("URL bukan playlist YouTube yang valid. Pastikan mengandung parameter ?list=...");
  }

  try {
    const raw = await runCommand('yt-dlp', [
      '--flat-playlist',
      '--dump-single-json',
      '--no-warnings',
      '--playlist-end', '100',
      '--extractor-args', 'youtube:player_client=mediaconnect,tv_embedded,ios,android,mweb;player_skip=webpage',
      '--extractor-retries', '5',
      url,
    ], 120000);

    const info = JSON.parse(raw);
    const entries = info.entries || [];
    if (entries.length === 0) {
      throw new Error("Playlist kosong atau tidak dapat diakses.");
    }

    const mediaItems = [];
    for (const entry of entries) {
      if (entry.url || entry.id) {
        const vidId = entry.id || extractYouTubeVideoId(entry.url);
        const vidUrl = entry.url || `https://www.youtube.com/watch?v=${vidId}`;
        const downloadUrl = `/api/yt-download?videoId=${encodeURIComponent(vidId)}&formatId=best`;
        const thumbnailUrl = entry.thumbnails?.[0]?.url || entry.thumbnail || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`;
        mediaItems.push({
          type: 'video',
          url: downloadUrl,
          thumbnail: thumbnailUrl,
          width: null,
          height: null,
          duration: entry.duration || null,
          ext: 'mp4',
          title: entry.title || `Video ${mediaItems.length + 1}`,
          pageUrl: vidUrl,
          formats: [
            { type: 'video', quality: 'Best', url: downloadUrl, ext: 'mp4' },
          ],
        });
      }
    }

    console.log(`[Scraper] ✅ YouTube Playlist: ${mediaItems.length} video`);
    return {
      platform: 'youtube',
      type: 'playlist',
      shortcode: '',
      author: info.uploader || info.channel || 'YouTube',
      caption: `Playlist: ${info.title || ''}`,
      title: info.title || 'YouTube Playlist',
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems,
      source: 'ytdlp_playlist',
      warning: mediaItems.length >= 100 ? 'Maksimal 100 video diambil. Playlist mungkin memiliki lebih banyak video.' : null,
    };
  } catch (err) {
    console.warn(`[Scraper] yt-dlp playlist gagal: ${err.message}`);
    throw new Error(`Gagal mengambil playlist YouTube: ${err.message}`);
  }
}

/**
 * Mengambil postingan Instagram berdasarkan username.
 * Menggunakan yt-dlp untuk scraping profil Instagram.
 *
 * @param {string} username - Username Instagram (tanpa @)
 * @param {number} count - Jumlah postingan yang diambil (default 12, max 30)
 * @param {string} mediaType - "image", "video", atau "all" (default "all")
 * @returns {Promise<object>} Data postingan
 */
async function scrapeInstagramPostsByUsername(username, count = 12, mediaType = 'all') {
  username = username.replace(/^@/, '').trim();
  if (!username || username.length < 2) {
    throw new Error("Username Instagram tidak valid.");
  }

  count = Math.min(Math.max(parseInt(count) || 12, 1), 30);
  console.log(`[Scraper] Mengambil ${count} postingan Instagram dari @${username} (filter: ${mediaType})...`);

  // Helper: cari file cookies yang tersedia
  function findCookieFiles() {
    const cookiesDir = path.join(__dirname, 'cookies');
    if (fs.existsSync(cookiesDir)) {
      const files = fs.readdirSync(cookiesDir).filter(f => f.endsWith('.txt') || f.endsWith('.json'));
      return files.map(f => path.join(cookiesDir, f));
    }
    return [];
  }

  function applyFilter(result) {
    if (mediaType === 'image') {
      result.mediaItems = result.mediaItems.filter(item => item.type === 'image');
    } else if (mediaType === 'video') {
      result.mediaItems = result.mediaItems.filter(item => item.type === 'video');
    }
    return result;
  }

  const profileUrl = `https://www.instagram.com/${username}/`;

  // Method 1: yt-dlp dengan cookies (jika tersedia)
  const cookieFiles = findCookieFiles();
  if (cookieFiles.length > 0) {
    for (const cookieFile of cookieFiles) {
      try {
        console.log(`[Scraper] Mencoba yt-dlp Instagram profile dengan cookies: ${path.basename(cookieFile)}...`);
        const raw = await runCommand('yt-dlp', [
          '--dump-single-json', '--no-warnings',
          '--playlist-end', String(count),
          '--cookies', cookieFile,
          '--extractor-args', 'instagram:direct_video_url=true',
          '--add-header', `User-Agent:${IG_USER_AGENT}`,
          profileUrl,
        ], 90000);
        const info = JSON.parse(raw);
        const result = parseYtDlpOutput(info, 'instagram');
        if (result.mediaItems.length > 0) {
          result.title = `Instagram @${username}`;
          result.author = username;
          result.caption = `${count} postingan terbaru dari @${username}`;
          applyFilter(result);
          if (result.mediaItems.length > 0) {
            console.log(`[Scraper] ✅ Instagram posts (yt-dlp+cookies): ${result.mediaItems.length} item`);
            return result;
          }
        }
      } catch (err) {
        console.warn(`[Scraper] yt-dlp+cookies gagal (${path.basename(cookieFile)}): ${err.message.substring(0, 80)}`);
      }
    }
  }

  // Method 2: yt-dlp tanpa cookies
  try {
    console.log(`[Scraper] Mencoba yt-dlp Instagram profile tanpa cookies...`);
    const raw = await runCommand('yt-dlp', [
      '--dump-single-json', '--no-warnings',
      '--playlist-end', String(count),
      '--extractor-args', 'instagram:direct_video_url=true',
      '--add-header', `User-Agent:${IG_USER_AGENT}`,
      profileUrl,
    ], 90000);
    const info = JSON.parse(raw);
    const result = parseYtDlpOutput(info, 'instagram');
    if (result.mediaItems.length > 0) {
      result.title = `Instagram @${username}`;
      result.author = username;
      result.caption = `${count} postingan terbaru dari @${username}`;
      applyFilter(result);
      if (result.mediaItems.length > 0) {
        console.log(`[Scraper] ✅ Instagram posts (yt-dlp): ${result.mediaItems.length} item`);
        return result;
      }
    }
  } catch (err) {
    console.warn(`[Scraper] yt-dlp Instagram profile gagal: ${err.message.substring(0, 80)}`);
  }

  // Method 3: Instagram public web_profile_info API (mobile endpoint)
  try {
    console.log(`[Scraper] Mencoba Instagram mobile API untuk @${username}...`);
    const wpResp = await axios.get(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          'User-Agent': 'Instagram 219.0.0.12.117 Android',
          'Accept': 'application/json',
        },
        timeout: 15000,
        validateStatus: s => s === 200,
      }
    );
    const userData = wpResp.data?.data?.user;
    if (userData && userData.id) {
      const userId = userData.id;
      console.log(`[Scraper] Mobile API OK, user ID: ${userId}, media_count: ${userData.media_count}`);

      // Dapatkan postingan via graphql
      const queryHash = '69cba40317214236af40e7efa697781d';
      const variables = JSON.stringify({
        id: userId,
        first: Math.min(count, 12),
      });

      const gqlResp = await axios.get(
        `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(variables)}`,
        {
          headers: {
            'User-Agent': IG_USER_AGENT,
            'Accept': 'application/json',
            'X-IG-App-ID': IG_APP_ID,
          },
          timeout: 20000,
          validateStatus: s => s === 200,
        }
      );

      const edges = gqlResp.data?.data?.user?.edge_owner_to_timeline_media?.edges || [];
      if (edges.length > 0) {
        const items = [];
        for (const edge of edges) {
          const node = edge.node;
          const isVideo = node.is_video;
          if (node.edge_sidecar_to_children) {
            for (const child of node.edge_sidecar_to_children.edges) {
              const cn = child.node;
              items.push({
                type: cn.is_video ? 'video' : 'image',
                url: cn.is_video ? (cn.video_url || cn.display_url) : cn.display_url,
                thumbnail: cn.display_url,
                width: cn.dimensions?.width, height: cn.dimensions?.height,
                duration: cn.video_duration || null,
                ext: cn.is_video ? 'mp4' : 'jpg',
                formats: [{ type: cn.is_video ? 'video' : 'image', quality: 'HD', url: cn.is_video ? (cn.video_url || cn.display_url) : cn.display_url, ext: cn.is_video ? 'mp4' : 'jpg' }],
              });
            }
          } else {
            items.push({
              type: isVideo ? 'video' : 'image',
              url: isVideo ? (node.video_url || node.display_url) : node.display_url,
              thumbnail: node.display_url,
              width: node.dimensions?.width, height: node.dimensions?.height,
              duration: node.video_duration || null,
              ext: isVideo ? 'mp4' : 'jpg',
              formats: [{ type: isVideo ? 'video' : 'image', quality: 'HD', url: isVideo ? (node.video_url || node.display_url) : node.display_url, ext: isVideo ? 'mp4' : 'jpg' }],
            });
          }
        }

        if (items.length > 0) {
          const result = {
            platform: 'instagram', type: 'playlist', shortcode: '',
            author: username,
            caption: `${count} postingan terbaru dari @${username}`,
            title: `Instagram @${username}`, timestamp: null,
            likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
            mediaItems: items, source: 'instagram_graphql',
          };
          applyFilter(result);
          if (result.mediaItems.length > 0) {
            console.log(`[Scraper] ✅ Instagram posts (GraphQL): ${result.mediaItems.length} item`);
            return result;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Scraper] Instagram mobile API gagal: ${err.message.substring(0, 80)}`);
  }

  // Method 4: Instagram __a=1 public JSON endpoint
  try {
    console.log(`[Scraper] Mencoba Instagram __a=1 endpoint untuk @${username}...`);
    const a1Resp = await axios.get(
      `https://www.instagram.com/${encodeURIComponent(username)}/?__a=1&__d=1`,
      {
        headers: {
          'User-Agent': IG_USER_AGENT,
          'Accept': 'application/json',
          'X-IG-App-ID': IG_APP_ID,
        },
        timeout: 15000,
        validateStatus: s => s === 200,
      }
    );

    const prof = a1Resp.data?.graphql?.user;
    if (prof) {
      const edges = prof.edge_owner_to_timeline_media?.edges || [];
      if (edges.length > 0) {
        const parseEdge = (node) => {
          const isV = node.is_video;
          const items = [];
          if (node.edge_sidecar_to_children) {
            for (const child of node.edge_sidecar_to_children.edges) {
              const cn = child.node;
              items.push({
                type: cn.is_video ? 'video' : 'image',
                url: cn.is_video ? (cn.video_url || cn.display_url) : cn.display_url,
                thumbnail: cn.display_url,
                width: cn.dimensions?.width, height: cn.dimensions?.height,
                duration: cn.video_duration || null,
                ext: cn.is_video ? 'mp4' : 'jpg',
                formats: [{ type: cn.is_video ? 'video' : 'image', quality: 'HD', url: cn.is_video ? (cn.video_url || cn.display_url) : cn.display_url, ext: cn.is_video ? 'mp4' : 'jpg' }],
              });
            }
          } else {
            items.push({
              type: isV ? 'video' : 'image',
              url: isV ? (node.video_url || node.display_url) : node.display_url,
              thumbnail: node.display_url,
              width: node.dimensions?.width, height: node.dimensions?.height,
              duration: node.video_duration || null,
              ext: isV ? 'mp4' : 'jpg',
              formats: [{ type: isV ? 'video' : 'image', quality: 'HD', url: isV ? (node.video_url || node.display_url) : node.display_url, ext: isV ? 'mp4' : 'jpg' }],
            });
          }
          return items;
        };

        const items = [];
        for (const edge of edges) {
          items.push(...parseEdge(edge.node));
          if (items.length >= count) break;
        }

        if (items.length > 0) {
          const result = {
            platform: 'instagram', type: 'playlist', shortcode: '',
            author: username, caption: `${count} postingan terbaru dari @${username}`,
            title: `Instagram @${username}`, timestamp: null,
            likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
            mediaItems: items, source: 'instagram_a1',
          };
          applyFilter(result);
          if (result.mediaItems.length > 0) {
            console.log(`[Scraper] ✅ Instagram posts (__a=1): ${result.mediaItems.length} item`);
            return result;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Scraper] Instagram __a=1 gagal: ${err.message.substring(0, 80)}`);
  }

  // Method 6: igram.world profile scraping
  try {
    console.log(`[Scraper] Mencoba igram.world untuk profil @${username}...`);
    const iResp = await axios.post(
      "https://igram.world/api/convert",
      JSON.stringify({ url: profileUrl, lang: "id" }),
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Content-Type": "application/json",
          "Origin": "https://igram.world",
          "Referer": "https://igram.world/",
        },
        timeout: 15000,
      }
    );
    const data = iResp.data;
    if (data?.media && Array.isArray(data.media) && data.media.length > 0) {
      const items = data.media.map((item, i) => ({
        type: (item.type === 'video' || (item.url || '').includes('.mp4')) ? 'video' : 'image',
        url: item.url,
        thumbnail: item.thumbnail || item.url,
        width: null, height: null, duration: null,
        ext: (item.type === 'video' || (item.url || '').includes('.mp4')) ? 'mp4' : 'jpg',
        formats: [{ type: (item.type === 'video' || (item.url || '').includes('.mp4')) ? 'video' : 'image', quality: `Media ${i + 1}`, url: item.url, ext: (item.type === 'video' || (item.url || '').includes('.mp4')) ? 'mp4' : 'jpg' }],
      }));
      const result = {
        platform: 'instagram', type: 'playlist', shortcode: '',
        author: username, caption: `${count} postingan terbaru dari @${username}`,
        title: `Instagram @${username}`, timestamp: null,
        likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
        mediaItems: items, source: 'igram_profile',
      };
      applyFilter(result);
      if (result.mediaItems.length > 0) {
        console.log(`[Scraper] ✅ Instagram posts (igram): ${result.mediaItems.length} item`);
        return result;
      }
    }
  } catch (err) {
    console.warn(`[Scraper] igram profile gagal: ${err.message.substring(0, 80)}`);
  }

  // Method 7: RapidAPI Instagram scraper
  try {
    console.log(`[Scraper] Mencoba RapidAPI untuk profil @${username}...`);
    const rapidResp = await axios.get(
      `https://instagram-post-reels-stories-downloader-api.p.rapidapi.com/instagram/`,
      {
        params: { url: profileUrl },
        headers: {
          'x-rapidapi-host': 'instagram-post-reels-stories-downloader-api.p.rapidapi.com',
          'x-rapidapi-key': '29be28c9fbmsh38d097de4f364c3p10b509jsn3a0f41eb7e83',
        },
        timeout: 20000,
        validateStatus: s => s === 200,
      }
    );
    const data = rapidResp.data;
    if (data?.result && Array.isArray(data.result)) {
      const items = data.result.map((item, i) => ({
        type: (item.type || '').includes('video') ? 'video' : 'image',
        url: item.url,
        thumbnail: item.url,
        width: null, height: null, duration: null,
        ext: (item.type || '').includes('video') ? 'mp4' : 'jpg',
        formats: [{ type: (item.type || '').includes('video') ? 'video' : 'image', quality: `Media ${i + 1}`, url: item.url, ext: (item.type || '').includes('video') ? 'mp4' : 'jpg' }],
      }));
      if (items.length > 0) {
        const result = {
          platform: 'instagram', type: 'playlist', shortcode: '',
          author: username, caption: `${count} postingan terbaru dari @${username}`,
          title: `Instagram @${username}`, timestamp: null,
          likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
          mediaItems: items, source: 'rapidapi',
        };
        applyFilter(result);
        if (result.mediaItems.length > 0) {
          console.log(`[Scraper] ✅ Instagram posts (RapidAPI): ${result.mediaItems.length} item`);
          return result;
        }
      }
    }
  } catch (err) {
    console.warn(`[Scraper] RapidAPI profile gagal: ${err.message.substring(0, 80)}`);
  }

  // Method 8: Instaloader Python
  try {
    console.log(`[Scraper] Mencoba Instaloader Python untuk @${username}...`);
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, 'instaloader_scraper.py');

    // Tulis script temporary
    const scriptContent = `import sys, json
try:
    from instaloader import Instaloader, Profile
except:
    print(json.dumps({"error": "instaloader tidak terinstall"}), file=sys.stderr)
    sys.exit(1)

username = sys.argv[1]
count = int(sys.argv[2])
L = Instaloader(quiet=True, download_comments=False, save_metadata=False)

try:
    profile = Profile.from_username(L.context, username)
    posts = []
    for post in profile.get_posts():
        if len(posts) >= count:
            break
        item = {
            "shortcode": post.shortcode,
            "type": "video" if post.is_video else "image",
            "url": post.video_url if post.is_video else post.url,
            "thumbnail": post.url,
            "caption": (post.caption or "")[:200],
            "timestamp": str(post.date_local) if post.date_local else None,
        }
        if post.typename == "GraphSidecar":
            sidecar_items = []
            try:
                for node in post.get_sidecar_nodes():
                    sidecar_items.append({
                        "type": "video" if node.is_video else "image",
                        "url": node.video_url if node.is_video else node.display_url,
                        "thumbnail": node.display_url,
                    })
            except:
                pass
            if sidecar_items:
                item["sidecar"] = sidecar_items
        posts.append(item)
    
    print(json.dumps({"username": username, "count": len(posts), "posts": posts}))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;
    fs.writeFileSync(scriptPath, scriptContent);

    const raw = await runCommand(pythonCmd, [scriptPath, username, String(count)], 120000);
    const result = JSON.parse(raw);

    // Cleanup script
    try { fs.unlinkSync(scriptPath); } catch(_) {}

    if (result.error) throw new Error(result.error);

    const mediaItems = [];
    for (const post of result.posts) {
      if (post.sidecar && post.sidecar.length > 0) {
        for (const s of post.sidecar) {
          mediaItems.push({
            type: s.type, url: s.url, thumbnail: s.thumbnail,
            width: null, height: null, duration: null,
            ext: s.type === 'video' ? 'mp4' : 'jpg',
            formats: [{ type: s.type, quality: 'HD', url: s.url, ext: s.type === 'video' ? 'mp4' : 'jpg' }],
          });
        }
      } else {
        mediaItems.push({
          type: post.type, url: post.url, thumbnail: post.thumbnail,
          width: null, height: null, duration: null,
          ext: post.type === 'video' ? 'mp4' : 'jpg',
          formats: [{ type: post.type, quality: 'HD', url: post.url, ext: post.type === 'video' ? 'mp4' : 'jpg' }],
        });
      }
    }

    if (mediaItems.length === 0) throw new Error("Tidak ada postingan ditemukan");

    const instaResult = {
      platform: 'instagram',
      type: mediaItems.length > 1 ? 'playlist' : mediaItems[0].type,
      shortcode: '',
      author: username,
      caption: `${count} postingan terbaru dari @${username}`,
      title: `Instagram @${username}`,
      timestamp: null,
      likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
      mediaItems,
      source: 'instaloader',
    };

    applyFilter(instaResult);
    if (instaResult.mediaItems.length > 0) {
      console.log(`[Scraper] ✅ Instagram posts (Instaloader): ${instaResult.mediaItems.length} item`);
      return instaResult;
    }
    throw new Error(`Tidak ada postingan "${mediaType}" dari @${username}`);
  } catch (err) {
    console.warn(`[Scraper] Instaloader gagal: ${err.message.substring(0, 100)}`);
  }

  throw new Error(
    `Gagal mengambil postingan Instagram dari @${username}. ` +
    `Instagram memblokir akses dari IP server (datacenter). ` +
    (cookieFiles.length === 0
      ? `Solusi: tambahkan cookies Instagram valid ke folder cookies/ atau set env IG_COOKIE.`
      : `Cookies terdeteksi tapi mungkin expired. Coba perbarui cookies di folder cookies/.`)
  );
}

/**
 * Mengambil postingan TikTok berdasarkan username.
 * Menggunakan TikWM API dan yt-dlp sebagai fallback.
 *
 * @param {string} username - Username TikTok (tanpa @)
 * @param {number} count - Jumlah postingan yang diambil (default 12, max 30)
 * @param {string} mediaType - "image", "video", atau "all" (default "all")
 * @returns {Promise<object>} Data postingan
 */
async function scrapeTikTokPostsByUsername(username, count = 12, mediaType = 'all') {
  username = username.replace(/^@/, '').trim();
  if (!username || username.length < 2) {
    throw new Error("Username TikTok tidak valid.");
  }

  count = Math.min(Math.max(parseInt(count) || 12, 1), 30);
  console.log(`[Scraper] Mengambil ${count} postingan TikTok dari @${username} (filter: ${mediaType})...`);

  function parseTikWMItemFull(item) {
    const videoId = item.video_id || item.id || '';
    const tiktokUrl = videoId ? `https://www.tiktok.com/@${username}/video/${videoId}` : '';
    // Thumbnail: selalu pakai cover image, jangan fallback ke video URL
    const thumbnailUrl = item.cover || item.origin_cover || null;
    // HD URL jika tersedia
    const bestVideoUrl = item.hdplay || item.play;

    if (item.images && item.images.length > 0) {
      return item.images.map((imgUrl, imgIdx) => ({
        type: 'image', url: imgUrl, thumbnail: imgUrl, width: null, height: null, duration: null, ext: 'jpg',
        formats: [{ type: 'image', quality: `Foto ${imgIdx + 1}`, url: imgUrl, ext: 'jpg' }],
      }));
    }
    if (item.play) {
      const fmtList = [];
      if (item.hdplay) {
        fmtList.push({ type: 'video', quality: 'HD No Watermark', url: item.hdplay, ext: 'mp4' });
      }
      fmtList.push({ type: 'video', quality: 'No Watermark', url: item.play, ext: 'mp4' });
      if (item.wmplay && item.wmplay !== item.play) {
        fmtList.push({ type: 'video', quality: 'Watermark', url: item.wmplay, ext: 'mp4' });
      }
      if (item.music) {
        fmtList.push({ type: 'audio', quality: 'Audio', url: item.music, ext: 'mp3' });
      }
      return [{
        type: 'video',
        url: bestVideoUrl,
        thumbnail: thumbnailUrl,
        width: null, height: null,
        duration: item.duration || null,
        ext: 'mp4',
        pageUrl: tiktokUrl,
        formats: fmtList,
      }];
    }
    return [];
  }

  // Method 1: TikWM user/posts API (cepat, thumbnail proper)
  try {
    console.log(`[Scraper] Mencoba TikWM user/posts API untuk @${username}...`);
    const resp = await axios.get(`https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(username)}&count=${count}`, {
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });

    if (resp.data?.code === 0 && resp.data?.data?.videos?.length > 0) {
      const rawItems = resp.data.data.videos.flatMap(parseTikWMItemFull);
      let mediaItems = rawItems;

      if (mediaType === 'image') {
        mediaItems = mediaItems.filter(item => item.type === 'image');
      } else if (mediaType === 'video') {
        mediaItems = mediaItems.filter(item => item.type === 'video');
      }

      if (mediaItems.length > 0) {
        console.log(`[Scraper] ✅ TikTok posts (TikWM): ${mediaItems.length} item untuk @${username}`);
        return {
          platform: 'tiktok',
          type: 'playlist',
          shortcode: '',
          author: username,
          caption: `${count} postingan terbaru dari @${username}`,
          title: `TikTok @${username}`,
          timestamp: null,
          likeCount: 0, commentCount: 0, viewCount: 0, duration: null,
          mediaItems: mediaItems.slice(0, count * 3),
          source: 'tikwm_posts',
          warning: null,
        };
      }

      // TikWM dapat konten, tapi semuanya ke-filter — jangan fallback ke yt-dlp
      if (rawItems.length > 0) {
        const availableTypes = [...new Set(rawItems.map(i => i.type))].join(' dan ');
        throw new Error(
          `Tidak ada postingan "${mediaType}" dari @${username}. ` +
          `Akun ini hanya memiliki konten ${availableTypes}. ` +
          `Coba ubah filter ke "Semua".`
        );
      }
    }
  } catch (err) {
    console.warn(`[Scraper] TikWM user/posts gagal: ${err.message}`);
  }

  // Method 2: yt-dlp profile (URL fresh, fallback)
  const ytdlpAvailable = await checkYtDlp();
  if (ytdlpAvailable) {
    try {
      console.log(`[Scraper] Mencoba yt-dlp fallback untuk @${username}...`);
      const raw = await runCommand('yt-dlp', [
        '--dump-single-json', '--no-warnings', '--playlist-end', String(count),
        '--extractor-args', 'tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com;app_version=26.1.3',
        '--add-header', 'User-Agent:Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        `https://www.tiktok.com/@${username}`,
      ], 90000);

      const info = JSON.parse(raw);
      const result = parseYtDlpOutput(info, 'tiktok');
      result.title = `TikTok @${username}`;
      result.author = username;
      result.caption = `${count} postingan terbaru dari @${username}`;

      // Pastikan setiap item punya thumbnail, fallback ke placeholder
      for (const item of result.mediaItems) {
        if (!item.thumbnail || item.thumbnail.length < 5) {
          item.thumbnail = item.url || '';
        }
      }

      if (result.mediaItems.length > 0) {
        if (mediaType === 'image') {
          result.mediaItems = result.mediaItems.filter(item => item.type === 'image');
        } else if (mediaType === 'video') {
          result.mediaItems = result.mediaItems.filter(item => item.type === 'video');
        }

        if (result.mediaItems.length > 0) {
          console.log(`[Scraper] ✅ TikTok posts (yt-dlp fallback): ${result.mediaItems.length} item untuk @${username}`);
          return result;
        }
      }
    } catch (err) {
      console.warn(`[Scraper] yt-dlp TikTok posts gagal: ${err.message.substring(0, 120)}`);
    }
  }

  throw new Error(
    `Gagal mengambil postingan TikTok dari @${username}. ` +
    `Pastikan username benar, akun publik, dan memiliki konten aktif.`
  );
}

// Backward-compatible alias
const scrapeInstagram = scrapeMedia;

module.exports = {
  scrapeMedia,
  scrapeInstagram,
  scrapeTikTokStoriesByUsername,
  scrapeYouTubePlaylist,
  scrapeInstagramPostsByUsername,
  scrapeTikTokPostsByUsername,
  detectPlatform,
  extractShortcode,
  isInstagramStoryUrl,
  checkYtDlp,
  PLATFORMS,
  // YouTube helpers (exported for testing)
  scrapeYouTube,
  extractYouTubeVideoId,
};
