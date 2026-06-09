# Integrasi UniversalDownloader untuk Instagram

## 📝 Deskripsi

Proyek ini telah diintegrasikan dengan library `universalDownloader` dari [milancodess/universalDownloader](https://github.com/milancodess/universalDownloader) untuk meningkatkan kemampuan download foto dan video Instagram.

## 🎯 Posisi dalam Fallback Chain

UniversalDownloader berada di posisi **kedua** dalam fallback chain Instagram:

1. **RapidAPI Instagram Downloader** - Prioritas utama (bypass login wall)
2. **UniversalDownloader** ← **[POSISI BARU]** - Fallback kedua (multi-platform)
3. **Playwright Scraper** - Fallback ketiga (scrape dari DOM)
4. **yt-dlp** - Engine cadangan (membutuhkan instalasi terpisah)
5. **oEmbed API** - Last resort (hanya thumbnail)

## 🔧 Implementasi

### File yang Dimodifikasi

#### 1. `scraper.js`

**Import library:**
```javascript
const universalDownloader = require("universaldownloader");
```

**Fungsi baru:**
```javascript
async function scrapeInstagramViaUniversalDownloader(url)
```

Fungsi ini:
- Memanggil `universalDownloader(url)` 
- Memetakan hasil ke format internal aplikasi
- Mendukung foto tunggal, video, dan carousel
- Mengembalikan metadata (author, caption, likes, dll)

**Integrasi dalam `scrapeMedia()`:**
```javascript
if (platform === "instagram") {
  try {
    // 1. RapidAPI
    return await scrapeViaRapidAPI(url);
  } catch (err) {
    try {
      // 2. UniversalDownloader [BARU]
      return await scrapeInstagramViaUniversalDownloader(url);
    } catch (uniErr) {
      try {
        // 3. Playwright
        return await scrapeInstagramViaPlaywright(url);
      } catch (pwErr) {
        // 4. yt-dlp...
      }
    }
  }
}
```

#### 2. `package.json`

Dependency sudah ditambahkan:
```json
{
  "dependencies": {
    "universaldownloader": "github:milancodess/universalDownloader"
  }
}
```

## 🧪 Testing

### Test Script Tersedia

File `test-universal.js` disediakan untuk testing terpisah:

```bash
node test-universal.js https://www.instagram.com/p/ABC123/
```

**Output contoh:**
```
🔍 Testing UniversalDownloader...
📎 URL: https://www.instagram.com/p/ABC123/

✅ Berhasil!

📊 Data yang diterima:
{
  "medias": [...],
  "owner": { "username": "..." },
  "caption": "...",
  ...
}

📸 Total media: 3
[Media 1]
  Type: image
  Extension: jpg
  URL: https://cdninstagram.com/...
  Dimensions: 1080 x 1080
```

### Testing via Server

Jalankan server dan test via API:

```bash
# Terminal 1: Jalankan server
node server.js

# Terminal 2: Test dengan curl
curl -X POST http://localhost:3000/api/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/p/ABC123/"}'
```

Cek log server untuk melihat fallback chain:
```
[Scraper] Platform terdeteksi: Instagram
[Scraper] Mencoba RapidAPI untuk Instagram...
[Scraper] RapidAPI gagal, mencoba fallback UniversalDownloader...
[Scraper] Mencoba UniversalDownloader untuk Instagram...
[Scraper] Berhasil via UniversalDownloader (3 item)
```

## 📊 Format Data

### Input
```javascript
const url = "https://www.instagram.com/p/ABC123/";
```

### Output UniversalDownloader (Raw)
```javascript
{
  medias: [
    {
      url: "https://cdninstagram.com/.../photo.jpg",
      type: "image",
      extension: "jpg",
      width: 1080,
      height: 1080,
      thumbnail: "https://..."
    }
  ],
  owner: {
    username: "example_user"
  },
  caption: "Photo caption here...",
  title: "Instagram Post",
  likes: 1234,
  comments: 56,
  views: 9876,
  timestamp: 1234567890
}
```

### Output Format Internal (Setelah Mapping)
```javascript
{
  platform: "instagram",
  type: "playlist", // atau "image" / "video"
  shortcode: "ABC123",
  author: "example_user",
  caption: "Photo caption here...",
  title: "Instagram Post",
  timestamp: 1234567890,
  likeCount: 1234,
  commentCount: 56,
  viewCount: 9876,
  duration: null,
  mediaItems: [
    {
      type: "image",
      url: "https://cdninstagram.com/.../photo.jpg",
      thumbnail: "https://...",
      width: 1080,
      height: 1080,
      duration: null,
      ext: "jpg",
      formats: [
        {
          type: "image",
          quality: "Foto 1",
          url: "https://...",
          ext: "jpg"
        }
      ]
    }
  ],
  source: "universaldownloader",
  warning: null
}
```

## ⚡ Keuntungan

1. **Tidak perlu yt-dlp** - UniversalDownloader bekerja tanpa instalasi external tools
2. **Lebih cepat** - Tidak perlu spawn process eksternal seperti yt-dlp
3. **Pure JavaScript** - Berjalan langsung di Node.js
4. **Multi-platform ready** - Library mendukung platform lain (TikTok, Facebook, dll)
5. **Fallback yang solid** - Jika RapidAPI down, masih ada UniversalDownloader

## 🔍 Troubleshooting

### Error: "UniversalDownloader tidak mengembalikan media yang valid"

**Kemungkinan penyebab:**
- URL Instagram tidak valid
- Post bersifat private
- Instagram mengubah struktur HTML/API

**Solusi:**
1. Pastikan URL valid dan publik
2. Cek log untuk detail error
3. Sistem akan otomatis fallback ke Playwright atau yt-dlp

### Error: "Cannot find module 'universaldownloader'"

**Solusi:**
```bash
npm install
```

Pastikan di `package.json` ada:
```json
"universaldownloader": "github:milancodess/universalDownloader"
```

## 📚 Referensi

- **UniversalDownloader GitHub**: https://github.com/milancodess/universalDownloader
- **Dokumentasi API**: Lihat repository untuk detail lengkap
- **Issue Tracking**: https://github.com/milancodess/universalDownloader/issues

## 🔄 Update Library

Untuk update ke versi terbaru:

```bash
npm update universaldownloader
```

Atau hapus dan install ulang:

```bash
npm uninstall universaldownloader
npm install github:milancodess/universalDownloader
```

## 📝 Catatan Penting

- UniversalDownloader mengambil data dari CDN Instagram secara langsung
- Respek rate limiting dan ToS Instagram
- Gunakan hanya untuk konten yang Anda miliki atau izinkan
- Library ini masih dalam pengembangan, format output bisa berubah

## ✅ Checklist Integrasi

- [x] Import library ke scraper.js
- [x] Buat fungsi `scrapeInstagramViaUniversalDownloader()`
- [x] Integrasikan ke fallback chain di `scrapeMedia()`
- [x] Mapping format output ke format internal
- [x] Buat test script `test-universal.js`
- [x] Update dokumentasi README.md
- [x] Test syntax check (no errors)
- [ ] Test dengan URL Instagram nyata
- [ ] Verifikasi download foto berhasil
- [ ] Verifikasi carousel multi-foto
- [ ] Performance testing

---

**Last Updated:** June 8, 2026
**Integration Version:** 1.0
