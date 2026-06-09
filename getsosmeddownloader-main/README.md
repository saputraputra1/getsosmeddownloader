---
title: MediaGet v3
emoji: 📥
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 3000
pinned: false
---

# MediaGet v3 — Multi-Platform Media Downloader

Download media dari **Instagram, TikTok, Facebook, YouTube, Pinterest** dan platform lainnya menggunakan **yt-dlp** sebagai engine utama.

## 🎯 Platform Support

| Platform | Photos | Videos | Stories | Status |
|----------|--------|--------|---------|--------|
| **Instagram** | ✅ (dengan fallback) | ✅ | ✅ | Foto butuh multiple methods |
| **TikTok** | ✅ | ✅ | ✅ | Fully supported |
| **Facebook** | ✅ | ✅ | ⚠️ | Limited |
| **YouTube** | ❌ | ✅ | ❌ | Videos only |
| **Pinterest** | ✅ | ✅ | ❌ | **NEW!** |

## Mengapa v3?

Versi sebelumnya mengandalkan reverse-engineering endpoint GraphQL internal Instagram yang sudah tidak aktif. v3 menggunakan **yt-dlp** + multiple fallback methods untuk reliability maksimal.

## Struktur Proyek

```
igdownloader/
├── server.js        ← Express server + proxy download
├── scraper.js       ← Engine scraping (yt-dlp + fallback oEmbed)
├── package.json
└── public/
    └── index.html   ← Frontend UI
```

## Cara Kerja

### Instagram Photos (Prioritas Method)
```
URL Instagram Foto
     │
     ▼
[1] @mrnima/instagram-downloader   ← ⭐ BEST: Most reliable
     │ Gagal?
     ▼
[2] Instagram Embed API            ← Fallback official API
     │ Gagal?
     ▼
[3] yt-dlp + Browser Cookies       ← Jika user sudah login
     │ Gagal?
     ▼
[4] Simple HTML Scraper            ← Fast attempt
     │ Gagal?
     ▼
[5] Playwright Browser Automation  ← Heavy but works sometimes
     │ Gagal?
     ▼
[6] Instaloader (Python)           ← Last resort
```

### Instagram Videos/Reels
```
URL Instagram Video
     │
     ▼
yt-dlp --dump-single-json          ← Works perfectly! ✅
     │
     ▼
URL Video (MP4 resolusi penuh)
```

### TikTok
```
URL TikTok
     │
     ▼
[1] @tobyg74/tiktok-api-dl         ← Handles slides & videos
     │ Gagal?
     ▼
[2] TikWM API                      ← Fallback API
     │ Gagal?
     ▼
[3] yt-dlp                         ← Last resort
```

### Pinterest
```
URL Pinterest
     │
     ▼
yt-dlp --dump-single-json          ← Works great! ✅
     │
     ▼
URL Media (foto/video original)
```

### Other Platforms (YouTube, Facebook)
```
URL Platform
     │
     ▼
yt-dlp --dump-single-json          ← Universal solution
     │
     ▼
URL Media
```
     ▼
[3] yt-dlp                         ← Last resort
     │
     ▼
/api/proxy                          ← bypass CORS CDN → Browser
```

## Instalasi

### 1. Install dependencies Node.js

```bash
npm install
```

Package utama yang digunakan:
- `universaldownloader` - Library dari [milancodess/universalDownloader](https://github.com/milancodess/universalDownloader) untuk multi-platform download
- `playwright` - Browser automation untuk fallback scraping
- `@tobyg74/tiktok-api-dl` - TikTok downloader API
- `axios` - HTTP client
- `express` - Web server

### 2. Install yt-dlp (opsional, untuk fallback)

```bash
# Python pip (direkomendasikan)
pip install yt-dlp

# Atau via package manager
brew install yt-dlp          # macOS
sudo apt install yt-dlp      # Ubuntu/Debian
winget install yt-dlp        # Windows
```

### 3. Install ffmpeg (WAJIB untuk Pinterest & beberapa platform)

**Kenapa?** Pinterest video menggunakan DASH format (video & audio terpisah). ffmpeg dibutuhkan untuk merge keduanya.

```bash
# Windows - Download dari:
# https://www.gyan.dev/ffmpeg/builds/
# Extract dan tambahkan ke PATH

# macOS
brew install ffmpeg

# Linux
sudo apt install ffmpeg
```

**Verify installation:**
```bash
ffmpeg -version
```

⚠️ **PENTING**: Tanpa ffmpeg, Pinterest video akan **corrupt** (error 0xC00D36C4)!

📖 See: [PINTEREST-VIDEO-FIX.md](./PINTEREST-VIDEO-FIX.md) untuk troubleshooting

### 4. Jalankan server

```bash
node server.js
# atau untuk development:
npm run dev
```

### 5. Buka browser

```
http://localhost:3000
```

Saat server start, terminal akan menampilkan status yt-dlp:
```
✅ Server berjalan di http://localhost:3000
🔧 yt-dlp: ✅ Terdeteksi (atau ⚠️ jika tidak tersedia)
```

## API Endpoints

### POST /api/fetch

Ambil metadata dan URL media dari postingan Instagram.

**Request:**
```json
{ "url": "https://www.instagram.com/reel/ABC123/" }
```

**Response (sukses):**
```json
{
  "success": true,
  "data": {
    "type": "GraphVideo",
    "author": "username",
    "caption": "Teks caption...",
    "mediaItems": [
      {
        "type": "video",
        "url": "https://cdninstagram.com/...",
        "thumbnail": "https://cdninstagram.com/...",
        "width": 1080,
        "height": 1920,
        "duration": 30.5,
        "ext": "mp4"
      }
    ],
    "source": "ytdlp"
  }
}
```

### GET /api/proxy?url=...&filename=...

Proxy download media, bypass CORS CDN Instagram.

### GET /api/status

Cek status server dan ketersediaan yt-dlp.

```json
{ "status": "ok", "ytdlp": true, "timestamp": "..." }
```

## Update yt-dlp

Instagram sering mengubah endpoint-nya. Update yt-dlp secara berkala:

```bash
pip install -U yt-dlp
# atau
yt-dlp -U
```

## Tipe Konten yang Didukung

| Tipe          | Didukung | Keterangan                    |
|---------------|----------|-------------------------------|
| Foto tunggal  | ✅       | Resolusi penuh via UniversalDownloader |
| Video / Reels | ✅       | Kualitas tertinggi tersedia   |
| Carousel      | ✅       | Semua foto & video dalam satu |
| IGTV          | ✅       | Video panjang format lama     |
| Stories       | ⚠️       | Hanya postingan publik        |

## Testing

Untuk test UniversalDownloader secara terpisah:

```bash
node test-universal.js https://www.instagram.com/p/ABC123/
```

Script ini akan menampilkan data mentah yang dikembalikan oleh library UniversalDownloader.

## ⚠️ Disclaimer

Dibuat untuk **keperluan edukasi**. Gunakan hanya untuk mengunduh konten milik sendiri.
Mengunduh konten orang lain tanpa izin dapat melanggar ToS Instagram dan hak cipta kreator.


---

## 📌 Pinterest Support (NEW!)

Pinterest sekarang sudah didukung penuh! Download foto dan video pin dengan mudah.

**Supported URLs:**
- `https://www.pinterest.com/pin/1234567890/`
- `https://pin.it/abc123` (short links)
- All Pinterest domains (.com, .co.uk, .de, etc.)

**Example:**
```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.pinterest.com/pin/1234567890/"}'
```

📖 **Full documentation**: [PINTEREST-SUPPORT.md](./PINTEREST-SUPPORT.md)

---

## 🔐 Why Instagram Photos Are So Hard?

**TL;DR**: Instagram **requires login** for all photos since late 2024, but videos are still public.

### Quick Comparison

| Type | Authentication | CORS | Status |
|------|---------------|------|--------|
| **Instagram Video** | ❌ Not needed | ✅ Relaxed | Easy ✅ |
| **Instagram Photo** | ✅ Required | ❌ Strict | Hard ❌ |

**Why?**
- **Videos**: Heavy bandwidth, need CDN performance → Instagram can't be too strict
- **Photos**: Lighter files, privacy-sensitive → Instagram can validate every request

### Technical Reasons

1. **Login Wall**: All photo URLs return `401 Unauthorized` without valid cookies
2. **Token Protection**: Photo URLs have expiring tokens (`oe`, `_nc_ohc`, etc.)
3. **CORS Policy**: Strict cross-origin blocking for photos
4. **Cookie Requirements**: Need `sessionid`, `csrftoken`, `ds_user_id`, etc.

### Our Solution

We use **6 fallback methods** for Instagram photos:
1. `@mrnima/instagram-downloader` (⭐ most reliable)
2. Instagram Embed API
3. yt-dlp with browser cookies
4. HTML scraping
5. Playwright automation
6. Instaloader (Python)

📖 **Deep dive**: [WHY-INSTAGRAM-PHOTOS-HARD.md](./WHY-INSTAGRAM-PHOTOS-HARD.md)

---

## 📚 Additional Documentation

- [CARA-EXPORT-COOKIES.md](./CARA-EXPORT-COOKIES.md) - Export cookies dari browser untuk yt-dlp
- [INSTAGRAM-PHOTO-FIX.md](./INSTAGRAM-PHOTO-FIX.md) - Troubleshooting Instagram photos
- [INSTAGRAM-PROXY-GUIDE.md](./INSTAGRAM-PROXY-GUIDE.md) - Setup proxy untuk bypass CORS
- [LOGIN-INSTAGRAM-GUIDE.md](./LOGIN-INSTAGRAM-GUIDE.md) - Login Instagram untuk akses foto
- [PINTEREST-SUPPORT.md](./PINTEREST-SUPPORT.md) - Pinterest downloader guide
- [PINTEREST-VIDEO-FIX.md](./PINTEREST-VIDEO-FIX.md) - ⚠️ Fix Pinterest video corrupt (error 0xC00D36C4)
- [WHY-INSTAGRAM-PHOTOS-HARD.md](./WHY-INSTAGRAM-PHOTOS-HARD.md) - Technical deep dive

---
