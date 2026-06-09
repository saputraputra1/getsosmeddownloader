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
      thumbnail: item.thumb || item.url,
      width: null,
      height: null,
      duration: null,
      ext: ext,
      formats: [
        { type: isVideo ? "video" : "image", quality: `Media ${index + 1}`, url: item.url, ext: ext }
      ]
    });
  });

  return {
    platform: "instagram",
    type: hasVideo ? "video" : "playlist",
    shortcode: extractShortcode(url) || "rapidapi",
    author: "Instagram User",
    caption: "",
    title: "",
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

// ─── Instagram via @mrnima/instagram-downloader ──────────────────────────────────

async function scrapeInstagramViaMrnima(url) {
  console.log("[Scraper] Mencoba @mrnima/instagram-downloader...");
  
  try {
    const instagramDownloader = require('@mrnima/instagram-downloader');
    
    const result = await instagramDownloader(url);
    
    if (!result || !result.download_url) {
      throw new Error("No download URL returned from @mrnima/instagram-downloader");
    }
    
    const shortcode = extractShortcode(url) || "mrnima";
    let username = "Instagram User";
    
    // Extract username from result if available
    if (result.username) {
      username = result.username;
    }
    
    // Determine if it's video or image
    const isVideo = result.type === 'video' || result.download_url.includes('.mp4');
    
    return {
      platform: "instagram",
      type: isVideo ? "video" : "image",
      shortcode: shortcode,
      author: username,
      caption: result.caption || "",
      title: result.title || "",
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems: [{
        type: isVideo ? "video" : "image",
        url: result.download_url,
        thumbnail: result.thumbnail_url || result.download_url,
        width: null,
        height: null,
        duration: null,
        ext: isVideo ? 'mp4' : 'jpg',
        formats: [{
          type: isVideo ? "video" : "image",
          quality: "HD",
          url: result.download_url,
          ext: isVideo ? 'mp4' : 'jpg'
        }]
      }],
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
      // Untuk FOTO: Cari display_url dari JSON di HTML (lebih reliable)
      let mainImage = null;
      
      // Metode 1: Cari "display_url" dari JSON (paling reliable)
      const displayUrlMatch = html.match(/"display_url":"([^"]+)"/);
      if (displayUrlMatch && displayUrlMatch[1]) {
        mainImage = displayUrlMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        console.log(`[Scraper] Foto dari display_url: ${mainImage.substring(0, 100)}...`);
      }
      
      // Metode 2: Fallback ke regex jika display_url tidak ada
      if (!mainImage) {
        const imgRegex = /https:\/\/[^"'\s]*scontent[^"'\s]*\.jpg[^"'\s]*/gi;
        const imgMatches = html.match(imgRegex) || [];
        
        console.log(`[Scraper] Ditemukan ${imgMatches.length} gambar total via regex`);
        
        // Filter: BUANG foto profil dan thumbnail kecil
        const validImages = imgMatches
          .map(img => img.replace(/\\u0026/g, '&').replace(/\\/g, ''))
          .filter(img => {
            // SKIP foto profil
            if (img.includes('profile_pic')) return false;
            if (img.includes('/v/t51.2885-19/')) return false;
            
            // SKIP thumbnail kecil
            if (img.includes('150x150')) return false;
            if (img.includes('s150x150')) return false;
            if (img.includes('44x44')) return false;
            if (img.includes('s320x320')) return false;
            
            return true;
          })
          .sort((a, b) => b.length - a.length);
        
        console.log(`[Scraper] Setelah filter: ${validImages.length} foto valid`);
        
        if (validImages.length > 0) {
          mainImage = validImages[0];
          console.log(`[Scraper] Foto terpilih: ${mainImage.substring(0, 100)}...`);
        }
      }
      
      if (!mainImage) {
        throw new Error("Tidak ditemukan foto post di halaman Instagram");
      }
      
      // Extract username
      let username = "Instagram User";
      const usernameMatch = html.match(/"username":"([^"]+)"/);
      if (usernameMatch && usernameMatch[1]) {
        username = usernameMatch[1];
      }
      
      return {
        platform: "instagram",
        type: "image",
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
          type: "image",
          url: mainImage,
          thumbnail: mainImage,
          width: null,
          height: null,
          duration: null,
          ext: 'jpg',
          formats: [{ type: "image", quality: "Original", url: mainImage, ext: 'jpg' }]
        }],
        source: "simple_scraper",
        warning: null
      };
    }
  } catch (err) {
    throw new Error("Simple scraper gagal: " + err.message);
  }
}

// ─── Playwright Instagram Fallback (Download Direct) ────────────────────────────

async function scrapeInstagramViaPlaywright(url) {
  let browser;
  const axios = require('axios');
  
  try {
    const { chromium } = require('playwright');
    console.log("[Scraper] Mencoba Playwright untuk Instagram foto...");
    
    // Launch browser
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    
    // Cegah resource berat untuk mempercepat
    await page.route('**/*.{woff,woff2,ttf}', route => route.abort());

    // Pergi ke URL post IG
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Tunggu sebentar untuk pastikan gambar muncul
    await page.waitForTimeout(4000);

    // Cek apakah ini reel/video atau foto
    const isReel = url.includes('/reel/') || url.includes('/reels/');

    // Ambil media dan username
    const result = await page.evaluate((isReelUrl) => {
      // Cari video terlebih dahulu (prioritas untuk reel)
      const videos = Array.from(document.querySelectorAll('video'));
      const videoUrls = videos
        .map(vid => vid.src || vid.querySelector('source')?.src)
        .filter(src => src && (src.includes('scontent') || src.includes('cdninstagram')));
      
      // Cari gambar - SKIP foto profil dan thumbnail kecil saja
      const imgs = Array.from(document.querySelectorAll('img'));
      const images = imgs
        .map(img => ({ src: img.src, width: img.naturalWidth || img.width || 0 }))
        .filter(item => {
          const src = item.src;
          if (!src || !src.includes('scontent')) return false;
          
          // SKIP foto profil
          if (src.includes('profile_pic')) return false;
          if (src.includes('/v/t51.2885-19/')) return false;
          
          // SKIP thumbnail sangat kecil
          if (src.includes('150x150')) return false;
          if (src.includes('s150x150')) return false;
          if (src.includes('44x44')) return false;
          if (src.includes('s320x320')) return false;
          if (item.width > 0 && item.width < 200) return false;
          
          return true;
        })
        .sort((a, b) => b.width - a.width)
        .map(item => item.src);
      
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
      
      return { 
        video: videoUrls[0] || null,
        image: images[0] || null,
        username 
      };
    }, isReel);

    let mediaItem = null;
    
    if (result.video && isReel) {
      // Video/Reel: return URL langsung
      mediaItem = {
        type: "video",
        url: result.video,
        thumbnail: result.image || result.video,
        width: null,
        height: null,
        duration: null,
        ext: 'mp4',
        formats: [{ type: "video", quality: "HD", url: result.video, ext: 'mp4' }]
      };
    } else if (result.image) {
      // Foto: Download dan convert ke base64
      console.log(`[Scraper] Downloading foto dari: ${result.image.substring(0, 80)}...`);
      
      try {
        const imageResponse = await axios.get(result.image, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.instagram.com/',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
          },
          timeout: 15000
        });
        
        const imageBuffer = Buffer.from(imageResponse.data, 'binary');
        const imageBase64 = imageBuffer.toString('base64');
        const imageDataUrl = `data:image/jpeg;base64,${imageBase64}`;
        
        console.log(`[Scraper] Foto berhasil didownload: ${imageBuffer.length} bytes`);
        
        mediaItem = {
          type: "image",
          url: imageDataUrl,  // Base64 data URL
          thumbnail: imageDataUrl,
          width: null,
          height: null,
          duration: null,
          ext: 'jpg',
          formats: [{ type: "image", quality: "Original", url: imageDataUrl, ext: 'jpg' }]
        };
      } catch (dlErr) {
        console.warn(`[Scraper] Gagal download foto: ${dlErr.message}, fallback ke URL`);
        // Fallback: return URL original
        mediaItem = {
          type: "image",
          url: result.image,
          thumbnail: result.image,
          width: null,
          height: null,
          duration: null,
          ext: 'jpg',
          formats: [{ type: "image", quality: "Original", url: result.image, ext: 'jpg' }]
        };
      }
    }

    if (!mediaItem) {
      throw new Error("Media POST tidak ditemukan via Playwright");
    }

    return {
      platform: "instagram",
      type: mediaItem.type,
      shortcode: extractShortcode(url) || "playwright",
      author: result.username,
      caption: "",
      title: "",
      timestamp: null,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      duration: null,
      mediaItems: [mediaItem],
      source: "playwright",
      warning: mediaItem.url.startsWith('data:') ? "Foto dikonversi ke base64" : null
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
  
  // Method 1: Pinterest Internal API
  try {
    const result = await scrapePinterestViaPinDown(url);
    console.log("[Pinterest] ✅ Success via Pinterest API");
    return result;
  } catch (err) {
    console.warn(`[Pinterest] Pinterest API failed: ${err.message}`);
    errors.push(`Pinterest API: ${err.message}`);
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
  
  // Method 3: Direct Scraping
  try {
    const result = await scrapePinterestDirect(url);
    console.log("[Pinterest] ✅ Success via Direct Scraping");
    return result;
  } catch (err) {
    console.warn(`[Pinterest] Direct scraping failed: ${err.message}`);
    errors.push(`Direct: ${err.message}`);
  }
  
  // Method 4: Pindl API
  try {
    const result = await scrapePinterestViaPindl(url);
    console.log("[Pinterest] ✅ Success via Pindl API");
    return result;
  } catch (err) {
    console.warn(`[Pinterest] Pindl failed: ${err.message}`);
    errors.push(`Pindl: ${err.message}`);
  }
  
  // Method 5: yt-dlp (last resort)
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
  
  // All methods failed
  throw new Error(`Pinterest download gagal. Semua metode error:\n${errors.join('\n')}`);
}

/**
 * Pinterest via yt-dlp (original method, now as fallback)
 */
async function scrapePinterestViaYtDlp(url) {
  console.log("[Pinterest] Trying yt-dlp...");
  
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
      "--no-warnings",
      "--no-playlist",
      url
    ];
    
    execFile("yt-dlp", args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error || stderr) {
        return reject(new Error(`yt-dlp error: ${stderr || error.message}`));
      }
      
      try {
        const info = JSON.parse(stdout);
        const pinId = url.match(/\/pin\/(\d+)/)?.[1] || info.id || "unknown";
        const mediaItems = [];
        
        if (info.url && info.url.length > 10) {
          const isVideo = info.url.includes('.mp4') || info.ext === 'mp4';
          
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
 * YouTube via Cobalt API (open-source, tidak butuh API key).
 * Cobalt adalah tool download media open-source yang mendukung YouTube.
 */
async function scrapeYouTubeViaCobalt(url) {
  console.log("[YouTube] Mencoba Cobalt API...");

  // Daftar instansi Cobalt publik yang bisa dipakai
  const cobaltInstances = [
    "https://cobalt.api.lrclib.net",
    "https://co.wuk.sh",
    "https://cobalt-api.oofe.org",
  ];

  for (const instance of cobaltInstances) {
    try {
      const response = await axios.post(
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

  // Method 1: yt-dlp (jika tersedia dan tidak kena bot detection)
  if (ytdlpAvailable) {
    try {
      const result = await scrapeViaYtDlp(url, "youtube");
      const hasValidMedia = result.mediaItems.some(
        (item) => item.url && item.url.length > 10
      );
      if (hasValidMedia) {
        console.log("[YouTube] ✅ Berhasil via yt-dlp");
        return result;
      }
      throw new Error("yt-dlp mengembalikan URL media kosong");
    } catch (err) {
      console.warn(`[YouTube] yt-dlp gagal: ${err.message.substring(0, 120)}`);
      errors.push(`yt-dlp: ${err.message.substring(0, 80)}`);
    }
  }

  // Method 2: @distube/ytdl-core — pure Node.js, langsung ke YouTube, paling reliable di Railway
  try {
    const result = await scrapeYouTubeViaYtdlCore(url);
    console.log("[YouTube] ✅ Berhasil via @distube/ytdl-core");
    return result;
  } catch (err) {
    console.warn(`[YouTube] @distube/ytdl-core gagal: ${err.message}`);
    errors.push(`ytdl-core: ${err.message}`);
  }

  // Method 3: Invidious — YouTube proxy open-source, accessible dari datacenter
  try {
    const result = await scrapeYouTubeViaInvidious(url);
    console.log("[YouTube] ✅ Berhasil via Invidious");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Invidious gagal: ${err.message}`);
    errors.push(`Invidious: ${err.message}`);
  }

  // Method 4: Piped — alternatif YouTube proxy, accessible dari datacenter
  try {
    const result = await scrapeYouTubeViaPiped(url);
    console.log("[YouTube] ✅ Berhasil via Piped");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Piped gagal: ${err.message}`);
    errors.push(`Piped: ${err.message}`);
  }

  // Method 4: RapidAPI — API komersial, bisa diakses dari Railway
  try {
    const result = await scrapeYouTubeViaRapidAPI(url);
    console.log("[YouTube] ✅ Berhasil via RapidAPI");
    return result;
  } catch (err) {
    console.warn(`[YouTube] RapidAPI gagal: ${err.message}`);
    errors.push(`RapidAPI: ${err.message}`);
  }

  // Method 5: Cobalt API (mungkin beberapa instance bisa diakses)
  try {
    const result = await scrapeYouTubeViaCobalt(url);
    console.log("[YouTube] ✅ Berhasil via Cobalt");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Cobalt gagal: ${err.message}`);
    errors.push(`Cobalt: ${err.message}`);
  }

  // Method 6: Siputzx
  try {
    const result = await scrapeYouTubeViaSiputzx(url);
    console.log("[YouTube] ✅ Berhasil via Siputzx");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Siputzx gagal: ${err.message}`);
    errors.push(`Siputzx: ${err.message}`);
  }

  // Method 7: Y2Mate
  try {
    const result = await scrapeYouTubeViaY2Mate(url);
    console.log("[YouTube] ✅ Berhasil via Y2Mate");
    return result;
  } catch (err) {
    console.warn(`[YouTube] Y2Mate gagal: ${err.message}`);
    errors.push(`Y2Mate: ${err.message}`);
  }

  // Method 8: SaveFrom
  try {
    const result = await scrapeYouTubeViaSavefrom(url);
    console.log("[YouTube] ✅ Berhasil via SaveFrom");
    return result;
  } catch (err) {
    console.warn(`[YouTube] SaveFrom gagal: ${err.message}`);
    errors.push(`SaveFrom: ${err.message}`);
  }

  // Method 9: SSYouTube
  try {
    const result = await scrapeYouTubeViaSSYT(url);
    console.log("[YouTube] ✅ Berhasil via SSYouTube");
    return result;
  } catch (err) {
    console.warn(`[YouTube] SSYouTube gagal: ${err.message}`);
    errors.push(`SSYouTube: ${err.message}`);
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

  // Instagram: Strategi berbeda untuk foto vs video
  if (platform === "instagram") {
    const isReel = url.includes('/reel/') || url.includes('/reels/');
    
    if (isReel) {
      // REEL/VIDEO: Prioritaskan yt-dlp (paling reliable)
      const ytdlpAvailable = await checkYtDlp();
      if (ytdlpAvailable) {
        try {
          const result = await scrapeViaYtDlp(url, platform);
          console.log(`[Scraper] Reel berhasil via yt-dlp (${result.mediaItems.length} item)`);
          return result;
        } catch (err) {
          console.warn(`[Scraper] yt-dlp gagal untuk reel: ${err.message}`);
        }
      }
    } else {
      // FOTO: Strategi prioritas untuk foto
      
      // 1. PRIORITAS TERTINGGI: @mrnima/instagram-downloader
      try {
        const mrnimaResult = await scrapeInstagramViaMrnima(url);
        console.log(`[Scraper] Foto berhasil via @mrnima/instagram-downloader`);
        return mrnimaResult;
      } catch (mrnimaErr) {
        console.warn(`[Scraper] @mrnima/instagram-downloader gagal: ${mrnimaErr.message}`);
      }
      
      // 2. Fallback: Instagram Embed endpoint
      try {
        const embedResult = await scrapeInstagramViaEmbed(url);
        console.log(`[Scraper] Foto berhasil via Instagram Embed`);
        return embedResult;
      } catch (embedErr) {
        console.warn(`[Scraper] Instagram Embed gagal: ${embedErr.message}`);
      }
    }
    
    // Fallback untuk semua: yt-dlp dengan cookies
    const ytdlpAvailable = await checkYtDlp();
    if (ytdlpAvailable) {
      try {
        const result = await scrapeViaCookiesRetry(url, platform);
        console.log(`[Scraper] Instagram berhasil via yt-dlp + cookies`);
        return result;
      } catch (cookieErr) {
        console.warn(`[Scraper] yt-dlp + cookies gagal: ${cookieErr.message}`);
      }
    }
    
    // Try Simple Scraper & Playwright
    try {
      const simpleResult = await scrapeInstagramSimple(url);
      console.log(`[Scraper] Berhasil via Simple Scraper`);
      return simpleResult;
    } catch (err) {
      try {
        const playwrightResult = await scrapeInstagramViaPlaywright(url);
        console.log(`[Scraper] Berhasil via Playwright`);
        return playwrightResult;
      } catch (pwErr) {
        console.warn(`[Scraper] Playwright gagal: ${pwErr.message}`);
      }
    }
    
    // Last resort: Instaloader (Python)
    try {
      const instaloaderResult = await scrapeInstagramViaInstaloader(url);
      console.log(`[Scraper] Berhasil via Instaloader (Python)`);
      return instaloaderResult;
    } catch (instaloaderErr) {
      console.warn(`[Scraper] Instaloader gagal: ${instaloaderErr.message}`);
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
