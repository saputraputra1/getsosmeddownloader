/**
 * Media Scraper Module — v3 (Multi-Platform)
 * Mendukung: Instagram, TikTok, YouTube, Facebook
 * Menggunakan yt-dlp sebagai engine utama (andal & selalu diupdate)
 * dengan fallback ke oEmbed untuk Instagram.
 */

const { execFile, exec } = require("child_process");
const axios = require("axios");
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
    );
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
  const isVideo = entry.ext === "mp4" || entry.ext === "webm" ||
    entry._type === "video" ||
    (entry.formats && entry.formats.some((f) => f.vcodec !== "none"));

  // Pilih format terbaik untuk video
  let bestUrl = entry.url;
  let availableFormats = [];

  // ─── Penanganan khusus FOTO ───
  // Jika bukan video, cari URL gambar dari berbagai field yang mungkin tersedia
  if (!isVideo) {
    // Coba ambil URL gambar dari berbagai sumber
    let imageUrl = entry.url || null;

    // Jika url kosong, gunakan thumbnail sebagai URL gambar utama
    if (!imageUrl && entry.thumbnail) {
      imageUrl = entry.thumbnail;
    }

    // Jika masih kosong, cek array thumbnails (resolusi tertinggi)
    if (!imageUrl && entry.thumbnails && entry.thumbnails.length > 0) {
      const sorted = [...entry.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
      imageUrl = sorted[0].url || sorted[0];
    }

    // Jika ada formats, cek apakah ada format gambar di sana
    if (entry.formats && entry.formats.length > 0) {
      const imgFormats = entry.formats.filter(
        (f) => f.url && (f.ext === 'jpg' || f.ext === 'jpeg' || f.ext === 'png' || f.ext === 'webp' || f.vcodec === 'none')
      );
      if (imgFormats.length > 0) {
        // Pilih resolusi tertinggi
        imgFormats.sort((a, b) => (b.width || 0) - (a.width || 0));
        imageUrl = imgFormats[0].url;
      }
    }

    if (imageUrl) {
      bestUrl = imageUrl;
      // Tentukan ekstensi dari URL
      let imgExt = entry.ext || 'jpg';
      if (imageUrl.includes('.png')) imgExt = 'png';
      else if (imageUrl.includes('.webp')) imgExt = 'webp';
      else if (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg')) imgExt = 'jpg';

      availableFormats.push({
        type: 'image',
        quality: 'Original',
        url: imageUrl,
        ext: imgExt
      });
    }

    // Return early untuk foto, tidak perlu proses video formats
    let thumb = entry.thumbnail || null;
    if (!thumb && entry.thumbnails && entry.thumbnails.length > 0) {
      const sorted = [...entry.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
      thumb = sorted[0].url || sorted[0];
    }
    const finalUrl = bestUrl || imageUrl || thumb || "";
    if (!thumb) thumb = finalUrl;

    // Jika sama sekali kosong, set flag agar bisa di-retry
    if (availableFormats.length === 0 && finalUrl) {
      availableFormats.push({
        type: 'image',
        quality: 'Default',
        url: finalUrl,
        ext: entry.ext || 'jpg'
      });
    }

    return {
      type: "image",
      url: finalUrl,
      thumbnail: thumb || finalUrl,
      width: entry.width || null,
      height: entry.height || null,
      duration: null,
      ext: entry.ext || 'jpg',
      formats: availableFormats
    };
  }

  // ─── Penanganan VIDEO (kode asli) ───
  if (isVideo && entry.formats && entry.formats.length > 0) {
    // Format dengan video codec terbaik yang JUGA memiliki audio dan BUKAN playlist (HLS/DASH)
    const videoFormats = entry.formats.filter(
      (f) => f.vcodec !== "none" && f.acodec !== "none" && f.url && f.ext === "mp4" && f.protocol && f.protocol.startsWith('http')
    );
    if (videoFormats.length > 0) {
      // Sort by height descending, ambil yang terbesar
      videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
      bestUrl = videoFormats[0].url;

      // Kumpulkan resolusi unik
      const seenResolutions = new Set();
      videoFormats.forEach(f => {
        const res = f.height ? `${f.height}p` : 'HD';
        if (!seenResolutions.has(res)) {
          seenResolutions.add(res);
          availableFormats.push({
            type: 'video',
            quality: res,
            url: f.url,
            ext: f.ext
          });
        }
      });
    }

    // Ekstrak audio format jika ada (audio only) dan bukan playlist
    const audioFormats = entry.formats.filter(
      (f) => f.vcodec === "none" && f.url && f.protocol && f.protocol.startsWith('http')
    );
    let bestAudioUrl = null;
    if (audioFormats.length > 0) {
      // Sort by abr (audio bitrate) descending
      audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
      bestAudioUrl = audioFormats[0].url;
      availableFormats.push({
        type: 'audio',
        quality: 'Audio',
        url: audioFormats[0].url,
        ext: audioFormats[0].ext === 'm4a' ? 'm4a' : 'mp3'
      });
    }

    // ─── Format Video-Only 1080p+ (needsMerge) ───
    if (bestAudioUrl) {
      const videoOnlyFormats = entry.formats.filter(
        (f) => f.vcodec !== "none" && f.acodec === "none" && f.url &&
               f.protocol && f.protocol.startsWith('http') &&
               (f.height || 0) >= 1080
      );
      const seenMergeRes = new Set();
      const existingRes = new Set(availableFormats.filter(f => f.type === 'video').map(f => f.quality));
      videoOnlyFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
      videoOnlyFormats.forEach(f => {
        const res = f.height ? `${f.height}p` : 'HD';
        if (!seenMergeRes.has(res) && !existingRes.has(res)) {
          seenMergeRes.add(res);
          availableFormats.push({
            type: 'video',
            quality: `${res} HD`,
            url: f.url,
            ext: 'mp4',
            needsMerge: true,
            audioUrl: bestAudioUrl
          });
        }
      });
    }
  }

  // Jika tidak ada format yang tersaring tapi ada URL, jadikan default
  if (availableFormats.length === 0 && entry.url) {
    availableFormats.push({
      type: 'video',
      quality: 'Default',
      url: entry.url,
      ext: entry.ext || "mp4"
    });
  }

  // Fallback tambahan: jika video, dan yt-dlp tidak memberi audio-only track,
  // beri pseudo-audio option (menggunakan URL video utama)
  if (isVideo && !availableFormats.some(f => f.type === 'audio')) {
    availableFormats.push({
      type: 'audio',
      quality: 'Audio',
      url: bestUrl || entry.url,
      ext: 'mp3'
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

  return {
    type: "video",
    url: finalUrl || "",
    thumbnail: thumb,
    width: entry.width || null,
    height: entry.height || null,
    duration: entry.duration || null,
    ext: entry.ext || "mp4",
    formats: availableFormats
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

// ─── SSSSave API (ssssave.net) ─────────────────────────────────────────────────
// API populer, support carousel Instagram (foto slide)

async function scrapeInstagramViaSSSSave(url) {
  console.log("[Scraper] Mencoba SSSSave untuk Instagram...");
  
  try {
    const resp = await axios.post(
      "https://ssssave.net/api/ajaxSearch",
      new URLSearchParams({ q: url, t: "media", lang: "en" }).toString(),
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Origin": "https://ssssave.net",
          "Referer": "https://ssssave.net/",
          "X-Requested-With": "XMLHttpRequest"
        },
        timeout: 15000
      }
    );
    
    const data = resp.data;
    if (!data || data.status !== "ok" || !data.data) {
      throw new Error("SSSSave tidak mengembalikan hasil");
    }
    
    const shortcode = extractShortcode(url) || "ssssave";
    const htmlData = data.data;
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

// ─── Instagram Story Saver (via RapidAPI, public accounts only) ─────────────

/**
 * Extract username dari story URL: instagram.com/stories/username/storyId
 */
function extractStoryUsername(url) {
  const m = url.match(/instagram\.com\/stories\/([\w.]+)/i);
  return m ? m[1] : null;
}

/**
 * Extract story ID dari story URL
 */
function extractStoryId(url) {
  const m = url.match(/instagram\.com\/stories\/[\w.]+\/(\d+)/i);
  return m ? m[1] : null;
}

/**
 * Download Instagram Story via RapidAPI (public accounts only, no cookies needed)
 */
async function scrapeInstagramStory(url) {
  console.log("[Story] Mencoba download Instagram Story via RapidAPI...");
  
  const username = extractStoryUsername(url);
  const storyId = extractStoryId(url);
  
  if (!username) {
    throw new Error("URL story tidak valid. Format: instagram.com/stories/username/storyId");
  }

  // Gunakan RapidAPI yang sama (support stories)
  const options = {
    method: 'GET',
    url: 'https://instagram-post-reels-stories-downloader-api.p.rapidapi.com/instagram/',
    params: { url: url },
    headers: {
      'x-rapidapi-host': 'instagram-post-reels-stories-downloader-api.p.rapidapi.com',
      'x-rapidapi-key': '29be28c9fbmsh38d097de4f364c3p10b509jsn3a0f41eb7e83',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  };

  const response = await axios.request(options);
  const data = response.data;

  if (!data || data.status !== true || !data.result || !Array.isArray(data.result)) {
    throw new Error(data.message || "Story tidak bisa diakses (mungkin expired atau akun private)");
  }

  const mediaItems = [];
  let hasVideo = false;

  data.result.forEach((item, index) => {
    const isVideo = item.type && item.type.includes('video');
    if (isVideo) hasVideo = true;
    const ext = isVideo ? 'mp4' : 'jpg';

    mediaItems.push({
      type: isVideo ? "video" : "image",
      url: item.url,
      thumbnail: item.url,
      width: null,
      height: null,
      duration: null,
      ext: ext,
      formats: [
        { type: isVideo ? "video" : "image", quality: `Story ${index + 1}`, url: item.url, ext: ext }
      ]
    });
  });

  console.log(`[Story] Berhasil download ${mediaItems.length} story item dari @${username}`);

  return {
    platform: "instagram",
    type: hasVideo ? "video" : "image",
    shortcode: storyId || "story",
    author: username,
    caption: `Story dari @${username}`,
    title: `Story dari @${username}`,
    timestamp: null,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    duration: null,
    mediaItems: mediaItems,
    source: "rapidapi-story",
    warning: "⚠️ Story akan expired setelah 24 jam. Pastikan story masih aktif."
  };
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

    // Ambil SEMUA display_url — carousel bisa punya banyak foto
    const imgRegex = /"display_url":"([^"]+)"/g;
    const photoUrls = [];
    const seen = new Set();
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      const photoUrl = m[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
      if (!seen.has(photoUrl)) { seen.add(photoUrl); photoUrls.push(photoUrl); }
    }

    // Cek video (reel)
    const videoRegex = /"video_url":"([^"]+)"/g;
    const videoUrls = [];
    while ((m = videoRegex.exec(html)) !== null) {
      const vUrl = m[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
      if (!videoUrls.includes(vUrl)) videoUrls.push(vUrl);
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
    // Check if Python and instaloader available
    exec('python --version', (err) => {
      if (err) {
        return reject(new Error("Python tidak ditemukan. Install Python untuk menggunakan Instaloader."));
      }
      
      // Try to download with instaloader
      const shortcode = extractShortcode(url);
      if (!shortcode) {
        return reject(new Error("Shortcode tidak ditemukan"));
      }
      
      // Create unique temp dir
      const tempDirName = `temp_ig_${Date.now()}`;
      
      // Command to download single post without login
      // Use -- shortcode syntax instead of :shortcode
      const cmd = `python -m instaloader --no-videos --no-captions --no-metadata-json --dirname-pattern=${tempDirName} -- -${shortcode}`;
      
      exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
        const fs = require('fs');
        const path = require('path');
        
        // Check if temp dir exists even if there's an error (403 is common but download still works)
        const tempDir = path.join(__dirname, tempDirName);
        
        if (!fs.existsSync(tempDir)) {
          console.warn(`[Scraper] Instaloader error: ${stderr || error?.message || 'Unknown'}`);
          return reject(new Error(`Instaloader gagal: folder tidak dibuat`));
        }
        
        try {
          const files = fs.readdirSync(tempDir);
          const imageFile = files.find(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg'));
          
          if (!imageFile) {
            // Clean up
            fs.rmSync(tempDir, { recursive: true, force: true });
            return reject(new Error("Foto tidak ditemukan dari Instaloader"));
          }
          
          const imagePath = path.join(tempDir, imageFile);
          
          // Check if file exists and has content
          const stats = fs.statSync(imagePath);
          if (stats.size === 0) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            return reject(new Error("File foto kosong"));
          }
          
          console.log(`[Scraper] File downloaded: ${imageFile} (${stats.size} bytes)`);
          
          // Read as buffer then convert to base64
          const imageBuffer = fs.readFileSync(imagePath);
          const imageBase64 = imageBuffer.toString('base64');
          const imageUrl = `data:image/jpeg;base64,${imageBase64}`;
          
          // Extract username from URL or use shortcode
          let username = "Instagram User";
          const urlMatch = url.match(/instagram\.com\/([^/]+)\//);
          if (urlMatch && urlMatch[1] !== 'p' && urlMatch[1] !== 'reel') {
            username = urlMatch[1];
          }
          
          // Clean up temp directory
          fs.rmSync(tempDir, { recursive: true, force: true });
          
          resolve({
            platform: "instagram",
            type: "image",
            shortcode: shortcode,
            author: username,
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
            source: "instaloader",
            warning: "Foto berhasil didownload via Instaloader"
          });
        } catch (fsErr) {
          // Clean up on error
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch (e) {}
          reject(new Error(`File system error: ${fsErr.message}`));
        }
      });
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
 * Lebih agresif daripada scrapeViaYtDlp standar — khusus YouTube.
 */
async function scrapeYouTubeViaYtDlpDirect(url) {
  console.log("[YouTube] Mencoba yt-dlp (mode YouTube direct)...");

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error("Tidak dapat mengekstrak video ID YouTube");

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Opsi yt-dlp khusus YouTube: format terbaik yang bisa langsung diplay
  const args = [
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--extractor-args", "youtube:player_client=android,web",
    "--no-check-certificates",
    cleanUrl
  ];

  const raw = await runCommand("yt-dlp", args, 90000);
  const info = JSON.parse(raw);

  const title = info.title || "YouTube Video";
  const author = info.uploader || info.channel || "YouTube";
  const thumbnail = info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const duration = info.duration || null;

  // Kumpulkan format dari yt-dlp
  const formats = [];
  const seenQ = new Set();
  if (info.formats && Array.isArray(info.formats)) {
    const mp4Formats = info.formats.filter(f =>
      f.url && (f.ext === "mp4" || f.vcodec !== "none") && f.vcodec !== "none"
    ).sort((a, b) => (b.height || 0) - (a.height || 0));

    for (const f of mp4Formats) {
      const q = f.height ? `${f.height}p` : (f.format_note || "SD");
      if (!seenQ.has(q)) {
        seenQ.add(q);
        formats.push({ type: "video", quality: q, url: f.url, ext: "mp4" });
      }
    }
  }

  // Fallback ke URL utama jika tidak ada format
  const mainUrl = info.url || (formats[0] && formats[0].url);
  if (!mainUrl) throw new Error("yt-dlp tidak menghasilkan URL yang valid");

  if (formats.length === 0) {
    formats.push({ type: "video", quality: "Best", url: mainUrl, ext: "mp4" });
  }

  console.log(`[YouTube] ✅ yt-dlp direct berhasil: ${formats.length} format`);
  return buildYouTubeResult(videoId, formats[0].url, title, thumbnail, formats[0].quality, "ytdlp-direct", formats, author, duration);
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
    "https://inv.nadeko.net",
    "https://invidious.privacydev.net",
    "https://yt.cdaut.de",
    "https://invidious.fdn.fr",
    "https://iv.datura.network",
    "https://invidious.perennialte.ch",
    "https://invidious.nerdvpn.de",
    "https://invidious.reallyaweso.me",
    "https://invidious.no-logs.com",
    "https://vid.puffyan.us",
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
    "https://piped.video/api",
    "https://pipedapi.tokhmi.xyz",
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
 * YouTube via Cobalt API v10 (open-source, tidak butuh API key).
 * Cobalt adalah tool download media open-source yang mendukung YouTube.
 * API v10: POST /api dengan Accept: application/json (bukan /api/json lagi)
 */
async function scrapeYouTubeViaCobalt(url) {
  console.log("[YouTube] Mencoba Cobalt API v10...");

  // Daftar instansi Cobalt publik — format API v10
  const cobaltInstances = [
    "https://cobalt.api.lrclib.net",
    "https://cobalt-api.oofe.org",
    "https://co.wuk.sh",
    "https://cobalt.tools",
  ];

  for (const instance of cobaltInstances) {
    try {
      // Coba API v10 dulu (endpoint /api)
      let response;
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
        // Fallback ke endpoint lama /api/json jika v10 tidak tersedia
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
 * Fungsi utama scraping YouTube dengan multiple fallback tanpa yt-dlp.
 * Urutan: yt-dlp → Cobalt → Siputzx → Y2Mate → SaveFrom → SSYouTube
 */
async function scrapeYouTube(url, ytdlpAvailable = false) {
  const errors = [];

  // Method 1: yt-dlp mode YouTube Direct (opsi khusus YouTube, bypass bot detection)
  // Ini paling andal — gunakan android + web player client untuk hindari "Sign in to confirm"
  if (ytdlpAvailable) {
    try {
      const result = await scrapeYouTubeViaYtDlpDirect(url);
      const hasValidMedia = result.mediaItems.some(
        (item) => item.url && item.url.length > 10
      );
      if (hasValidMedia) {
        console.log("[YouTube] ✅ Berhasil via yt-dlp direct");
        return result;
      }
      throw new Error("yt-dlp mengembalikan URL media kosong");
    } catch (err) {
      console.warn(`[YouTube] yt-dlp direct gagal: ${err.message.substring(0, 120)}`);
      errors.push(`yt-dlp-direct: ${err.message.substring(0, 80)}`);
    }
  }

  // Method 2: yt-dlp standar (tanpa opsi khusus) — fallback jika mode direct gagal
  if (ytdlpAvailable) {
    try {
      const result = await scrapeViaYtDlp(url, "youtube");
      const hasValidMedia = result.mediaItems.some(
        (item) => item.url && item.url.length > 10
      );
      if (hasValidMedia) {
        console.log("[YouTube] ✅ Berhasil via yt-dlp standar");
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

// ─── Fungsi utama (multi-platform) ──────────────────────────────────────────

/**
 * Scrape media dari URL yang didukung.
 * Mendukung: Instagram, TikTok, YouTube, Facebook, Twitter, Pinterest.
 *
 * @param {string} url - URL media
 * @returns {Promise<object>} Data media
 */
async function scrapeMedia(url) {
  // Deteksi platform
  const detected = detectPlatform(url);
  if (!detected) {
    throw new Error(
      "URL tidak valid atau platform tidak didukung. " +
      "Platform yang didukung: Instagram, TikTok, YouTube, Facebook."
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
    // ─── STORY HANDLER (prioritas pertama) ───
    if (isInstagramStoryUrl(url)) {
      console.log("[Scraper] URL terdeteksi sebagai Instagram Story");
      
      // Method 1: RapidAPI (paling andal untuk story publik, tanpa cookie)
      try {
        const r = await scrapeInstagramStory(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Story OK via RapidAPI (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] RapidAPI story gagal:", e.message.substring(0, 120)); }

      // Method 2: yt-dlp (fallback)
      try {
        const ytdlpOk = await checkYtDlp();
        if (ytdlpOk) {
          const raw = await runCommand("yt-dlp", [
            "--dump-single-json", "--no-warnings", "--no-playlist",
            url
          ], 60000);
          const info = JSON.parse(raw);
          const r = parseYtDlpOutput(info, "instagram");
          if (r.mediaItems.length > 0) {
            const username = extractStoryUsername(url);
            r.author = username || "Instagram User";
            r.caption = `Story dari @${username}`;
            r.source = "ytdlp-story";
            r.warning = "⚠️ Story akan expired setelah 24 jam.";
            console.log(`[Scraper] Story OK via yt-dlp (${r.mediaItems.length} item)`);
            return r;
          }
        }
      } catch (e) { console.warn("[Scraper] yt-dlp story gagal:", e.message.substring(0, 120)); }

      throw new Error(
        "Story tidak bisa didownload. Kemungkinan:\n" +
        "1. Story sudah expired (>24 jam)\n" +
        "2. Akun private (hanya akun publik yang bisa didownload)\n" +
        "3. URL story tidak valid"
      );
    }

    const isReel = url.includes('/reel/') || url.includes('/reels/');
    const ytdlpAvailable = await checkYtDlp();

    // Helper: coba yt-dlp tanpa cookies (Railway punya yt-dlp dari Dockerfile)
    async function tryYtDlpDirect() {
      if (!ytdlpAvailable) throw new Error("yt-dlp tidak tersedia");
      const raw = await runCommand("yt-dlp", [
        "--dump-single-json", "--no-warnings", "--no-playlist",
        "--extractor-args", "instagram:direct_video_url=true",
        url
      ], 60000);
      const info = JSON.parse(raw);
      return parseYtDlpOutput(info, "instagram");
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

    } else {
      // ── FOTO / CAROUSEL SLIDE ──
      // Strategi: RapidAPI (paling andal) → Direct API → API publik stabil → yt-dlp → embed fallback

      // 1. [PRIORITAS UTAMA] RapidAPI — paling stabil, support carousel, username real, thumbnail lengkap
      let firstResult = null;
      try {
        const r = await scrapeViaRapidAPI(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via RapidAPI (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] RapidAPI gagal:", e.message.substring(0, 120)); }

      // 2. Direct API: EmbedAPI + GraphQL + HTML Scrape + oEmbed (paralel)
      try {
        const r = await scrapeInstagramViaDirectAPI(url);
        if (r.mediaItems.length > 0) {
          // Jika hanya 1 item, simpan tapi lanjutkan coba metode lain (mungkin carousel)
          if (r.mediaItems.length === 1) {
            firstResult = r;
            console.log(`[Scraper] Direct API: 1 item (akan cek carousel via metode lain)`);
          } else {
            console.log(`[Scraper] Foto OK via Direct API (${r.mediaItems.length} item)`);
            return r;
          }
        }
      } catch (e) { console.warn("[Scraper] Direct API gagal:", e.message.substring(0, 120)); }

      // 3. SSSSave — stabil, tidak butuh auth, support carousel
      try {
        const r = await scrapeInstagramViaSSSSave(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via SSSSave (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] SSSSave gagal:", e.message.substring(0, 80)); }

      // 4. igram.world — support carousel JSON response
      try {
        const r = await scrapeInstagramViaIgram(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via igram (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] igram gagal:", e.message.substring(0, 80)); }

      // 5. SnapInsta
      try {
        const r = await scrapeInstagramViaSnapinsta(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via SnapInsta (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] SnapInsta gagal:", e.message.substring(0, 80)); }

      // 6. SaveIG
      try {
        const r = await scrapeInstagramViaSaveIG(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via SaveIG (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] SaveIG gagal:", e.message.substring(0, 80)); }

      // 6b. SnapInst — carousel JSON API
      try {
        const r = await scrapeInstagramViaSnapInst(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via SnapInst (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] SnapInst gagal:", e.message.substring(0, 80)); }

      // 7. yt-dlp foto (bisa handle foto tunggal & carousel via --dump-single-json)
      try {
        const r = await tryYtDlpDirect();
        if (r.mediaItems.length > 0) {
          if (r.mediaItems.length === 1 && !firstResult) {
            firstResult = r;
            console.log(`[Scraper] yt-dlp: 1 item (akan cek carousel via Playwright)`);
          } else if (r.mediaItems.length > 1) {
            console.log(`[Scraper] Foto OK via yt-dlp (${r.mediaItems.length} item)`);
            return r;
          }
        }
      } catch (e) { console.warn("[Scraper] yt-dlp foto gagal:", e.message.substring(0, 100)); }

      // 8. @bochilteam
      try {
        const r = await scrapeInstagramViaBochil(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via @bochilteam (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] @bochilteam gagal:", e.message.substring(0, 80)); }

      // 9. Instagram Embed (carousel-aware)
      try {
        const r = await scrapeInstagramViaEmbed(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via Embed (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] Embed gagal:", e.message.substring(0, 80)); }

      // 10. Simple HTML scraper (carousel-aware, Railway-safe)
      try {
        const r = await scrapeInstagramSimple(url);
        if (r.mediaItems.length > 0) {
          console.log(`[Scraper] Foto OK via Simple (${r.mediaItems.length} item)`);
          return r;
        }
      } catch (e) { console.warn("[Scraper] Simple gagal:", e.message.substring(0, 80)); }

      // 11. Instaloader Python (ada di Dockerfile, Railway support)
      try {
        const r = await scrapeInstagramViaInstaloader(url);
        console.log("[Scraper] Foto OK via Instaloader");
        return r;
      } catch (e) { console.warn("[Scraper] Instaloader gagal:", e.message.substring(0, 80)); }

      // 12. Playwright (carousel-aware, fallback when semua API gagal)
      try {
        const r = await scrapeInstagramViaPlaywright(url);
        if (r.mediaItems.length > 0) {
          // Jika Playwright menemukan lebih banyak item dari firstResult (carousel!)
          if (firstResult && r.mediaItems.length > firstResult.mediaItems.length) {
            console.log(`[Scraper] ✅ Carousel ditemukan via Playwright (${r.mediaItems.length} item, sebelumnya ${firstResult.mediaItems.length})`);
            return r;
          }
          if (!firstResult) {
            console.log(`[Scraper] Foto OK via Playwright (${r.mediaItems.length} item)`);
            return r;
          }
          // Playwright punya same/lower count, gunakan firstResult
          console.log(`[Scraper] Playwright: ${r.mediaItems.length} item (tidak lebih dari Direct API)`);
        }
      } catch (e) { console.warn("[Scraper] Playwright gagal:", e.message.substring(0, 120)); }

      // Fallback: jika firstResult ada (1 item dari Direct API), gunakan itu
      if (firstResult) {
        console.log(`[Scraper] Menggunakan hasil Direct API (1 item - bukan carousel atau carousel tidak bisa diakses)`);
        return firstResult;
      }
    }
    
    // cookies-from-browser DILEWATI di Railway (tidak ada browser)
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
        }
      }
    }
  }

  // Pinterest: Gunakan yt-dlp langsung (work dengan baik untuk Pinterest)
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

  // ─── Metode 1: TikWM API ───
  try {
    console.log(`[Scraper] Mencoba TikWM API untuk stories @${username}...`);
    const apiUrl = `https://www.tikwm.com/api/user/stories?unique_id=${encodeURIComponent(username)}`;
    const response = await axios.get(apiUrl, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });

    const data = response.data;
    if (data && data.code === 0 && data.data && Array.isArray(data.data) && data.data.length > 0) {
      const mediaItems = [];

      data.data.forEach((story, index) => {
        if (story.video_url || story.play) {
          // Video story
          mediaItems.push({
            type: 'video',
            url: story.video_url || story.play,
            thumbnail: story.cover || story.origin_cover || story.video_url,
            width: null,
            height: null,
            duration: story.duration || null,
            ext: 'mp4',
            formats: [
              { type: 'video', quality: `Story ${index + 1}`, url: story.video_url || story.play, ext: 'mp4' },
            ],
          });
        } else if (story.image_url || story.images) {
          // Image story
          const images = story.images || [story.image_url];
          images.forEach((imgUrl, imgIdx) => {
            if (imgUrl) {
              mediaItems.push({
                type: 'image',
                url: imgUrl,
                thumbnail: imgUrl,
                width: null,
                height: null,
                duration: null,
                ext: 'jpg',
                formats: [
                  { type: 'image', quality: `Story ${index + 1}${images.length > 1 ? ` (${imgIdx + 1})` : ''}`, url: imgUrl, ext: 'jpg' },
                ],
              });
            }
          });
        }
      });

      if (mediaItems.length > 0) {
        console.log(`[Scraper] TikWM: Ditemukan ${mediaItems.length} stories untuk @${username}`);
        return {
          platform: 'tiktok',
          type: mediaItems.length > 1 ? 'playlist' : mediaItems[0].type,
          shortcode: '',
          author: username,
          caption: `TikTok Stories dari @${username}`,
          title: `TikTok Stories @${username}`,
          timestamp: null,
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          duration: null,
          mediaItems: mediaItems.slice(0, 20),
          source: 'tikwm_stories',
          warning: null,
        };
      }
    }
    console.warn(`[Scraper] TikWM stories API: tidak ada data untuk @${username}`);
  } catch (err) {
    console.warn(`[Scraper] TikWM stories API gagal: ${err.message}`);
  }

  // ─── Metode 2: yt-dlp dengan URL profil ───
  const ytdlpAvailable = await checkYtDlp();
  if (ytdlpAvailable) {
    try {
      console.log(`[Scraper] Mencoba yt-dlp untuk stories @${username}...`);
      const profileUrl = `https://www.tiktok.com/@${username}`;
      const args = [
        '--dump-single-json',
        '--no-warnings',
        '--playlist-end', '20',
        '--add-header', 'User-Agent:Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        profileUrl,
      ];

      const raw = await runCommand('yt-dlp', args, 60000);
      const info = JSON.parse(raw);
      const result = parseYtDlpOutput(info, 'tiktok');
      result.title = `TikTok @${username}`;
      result.author = username;
      result.caption = `Konten dari @${username}`;

      if (result.mediaItems.length > 0) {
        console.log(`[Scraper] yt-dlp: Ditemukan ${result.mediaItems.length} konten dari @${username}`);
        return result;
      }
    } catch (err) {
      console.warn(`[Scraper] yt-dlp stories gagal: ${err.message}`);
    }

    // ─── Metode 2b: yt-dlp dengan cookies browser ───
    try {
      const browsers = ['chrome', 'edge', 'firefox', 'brave'];
      for (const browser of browsers) {
        try {
          const profileUrl = `https://www.tiktok.com/@${username}`;
          const args = [
            '--dump-single-json',
            '--no-warnings',
            '--playlist-end', '20',
            '--cookies-from-browser', browser,
            '--add-header', 'User-Agent:Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
            profileUrl,
          ];
          const raw = await runCommand('yt-dlp', args, 60000);
          const info = JSON.parse(raw);
          const result = parseYtDlpOutput(info, 'tiktok');
          result.title = `TikTok @${username}`;
          result.author = username;
          result.caption = `Konten dari @${username}`;

          if (result.mediaItems.length > 0) {
            console.log(`[Scraper] yt-dlp (cookies ${browser}): Ditemukan ${result.mediaItems.length} konten`);
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

  // ─── Metode 3: TikWM user posts sebagai alternatif ───
  try {
    console.log(`[Scraper] Mencoba TikWM user posts untuk @${username}...`);
    const apiUrl = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(username)}&count=20`;
    const response = await axios.get(apiUrl, {
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });

    const data = response.data;
    if (data && data.code === 0 && data.data && data.data.videos && data.data.videos.length > 0) {
      const mediaItems = [];

      data.data.videos.forEach((item) => {
        if (item.images && item.images.length > 0) {
          // Photo slide
          item.images.forEach((imgUrl, imgIdx) => {
            mediaItems.push({
              type: 'image',
              url: imgUrl,
              thumbnail: imgUrl,
              width: null,
              height: null,
              duration: null,
              ext: 'jpg',
              formats: [{ type: 'image', quality: `Foto ${imgIdx + 1}`, url: imgUrl, ext: 'jpg' }],
            });
          });
        } else if (item.play) {
          mediaItems.push({
            type: 'video',
            url: item.play,
            thumbnail: item.cover || item.origin_cover || item.play,
            width: null,
            height: null,
            duration: item.duration || null,
            ext: 'mp4',
            formats: [
              { type: 'video', quality: 'No Watermark', url: item.play, ext: 'mp4' },
              ...(item.music ? [{ type: 'audio', quality: 'Audio', url: item.music, ext: 'mp3' }] : []),
            ],
          });
        }
      });

      if (mediaItems.length > 0) {
        console.log(`[Scraper] TikWM posts: Ditemukan ${mediaItems.length} konten dari @${username}`);
        return {
          platform: 'tiktok',
          type: 'playlist',
          shortcode: '',
          author: username,
          caption: `Konten terbaru dari @${username}`,
          title: `TikTok @${username}`,
          timestamp: null,
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          duration: null,
          mediaItems: mediaItems.slice(0, 20),
          source: 'tikwm_posts',
          warning: 'Menampilkan postingan terbaru. Stories mungkin tidak tersedia jika sudah kedaluwarsa atau akun private.',
        };
      }
    }
  } catch (err) {
    console.warn(`[Scraper] TikWM user posts gagal: ${err.message}`);
  }

  throw new Error(
    `Gagal mengambil TikTok Stories/konten dari @${username}. ` +
    `Pastikan username benar, akun bersifat publik, dan memiliki story aktif.`
  );
}

// Backward-compatible alias
const scrapeInstagram = scrapeMedia;

module.exports = {
  scrapeMedia,
  scrapeInstagram,
  scrapeTikTokStoriesByUsername,
  detectPlatform,
  extractShortcode,
  isInstagramStoryUrl,
  checkYtDlp,
  PLATFORMS,
  // YouTube helpers (exported for testing)
  scrapeYouTube,
  extractYouTubeVideoId,
};
