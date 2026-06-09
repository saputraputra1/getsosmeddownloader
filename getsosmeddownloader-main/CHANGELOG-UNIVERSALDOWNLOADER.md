# Changelog - Integrasi UniversalDownloader

## [1.0.0] - June 8, 2026

### ✨ Added

#### Integrasi UniversalDownloader
- Menambahkan library `universaldownloader` dari [milancodess/universalDownloader](https://github.com/milancodess/universalDownloader)
- Implementasi fungsi `scrapeInstagramViaUniversalDownloader()` di `scraper.js`
- Posisi fallback kedua untuk Instagram (setelah RapidAPI, sebelum Playwright)

#### File Baru
- `test-universal.js` - Script testing standalone untuk UniversalDownloader
- `INTEGRATION-UNIVERSALDOWNLOADER.md` - Dokumentasi lengkap integrasi
- `CHANGELOG-UNIVERSALDOWNLOADER.md` - File changelog ini

### 🔄 Modified

#### `scraper.js`
```diff
+ const universalDownloader = require("universaldownloader");

+ // Fungsi baru
+ async function scrapeInstagramViaUniversalDownloader(url) { ... }

  // Perubahan di scrapeMedia()
  if (platform === "instagram") {
    try {
      const rapidResult = await scrapeViaRapidAPI(url);
      return rapidResult;
    } catch (err) {
+     try {
+       const universalResult = await scrapeInstagramViaUniversalDownloader(url);
+       return universalResult;
+     } catch (uniErr) {
        try {
          const playwrightResult = await scrapeInstagramViaPlaywright(url);
          ...
```

#### `package.json`
```diff
  "dependencies": {
    ...
+   "universaldownloader": "github:milancodess/universalDownloader"
  }
```

#### `README.md`
- Update diagram "Cara Kerja" dengan fallback chain baru
- Update section "Instalasi" dengan prioritas dependencies
- Tambah section "Testing" untuk test-universal.js
- Update tabel "Tipe Konten yang Didukung"

### 📊 Fallback Chain Instagram (Sebelum vs Sesudah)

#### Sebelum:
```
1. RapidAPI
2. Playwright
3. yt-dlp
4. oEmbed
```

#### Sesudah:
```
1. RapidAPI
2. UniversalDownloader [BARU]
3. Playwright
4. yt-dlp
5. oEmbed
```

### 🎯 Fitur UniversalDownloader

- ✅ Download foto Instagram resolusi penuh
- ✅ Download video Instagram
- ✅ Support carousel (multiple photos/videos)
- ✅ Metadata lengkap (author, caption, likes, comments, views)
- ✅ Pure JavaScript (tidak butuh external tools)
- ✅ Lebih cepat dari yt-dlp (no spawn process)

### 🧪 Testing

Test standalone:
```bash
node test-universal.js https://www.instagram.com/p/ABC123/
```

Test via API:
```bash
curl -X POST http://localhost:3000/api/fetch \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.instagram.com/p/ABC123/"}'
```

### 📝 Format Output

UniversalDownloader mengembalikan format yang dipetakan ke:
```javascript
{
  platform: "instagram",
  type: "image" | "video" | "playlist",
  shortcode: "ABC123",
  author: "username",
  caption: "...",
  mediaItems: [{
    type: "image" | "video",
    url: "https://cdninstagram.com/...",
    thumbnail: "https://...",
    width: 1080,
    height: 1080,
    ext: "jpg" | "mp4",
    formats: [...]
  }],
  source: "universaldownloader"
}
```

### ⚠️ Known Issues

1. UniversalDownloader mungkin gagal untuk:
   - Post private/locked
   - Stories yang expired
   - Account yang di-ban/suspend

2. Ketika UniversalDownloader gagal, sistem otomatis fallback ke Playwright atau yt-dlp

### 🔜 Future Improvements

- [ ] Tambah retry mechanism untuk UniversalDownloader
- [ ] Cache hasil download untuk performance
- [ ] Support untuk platform lain via UniversalDownloader (TikTok, Facebook)
- [ ] Rate limiting per-downloader
- [ ] Metrics tracking (success rate per downloader)

### 📚 Dependencies Update

```json
{
  "universaldownloader": "github:milancodess/universalDownloader"
}
```

Install dengan:
```bash
npm install
```

### 🔍 Verification Checklist

Setelah integrasi:
- [x] Syntax check passed (`node -c scraper.js`)
- [x] Syntax check passed (`node -c server.js`)
- [x] Test script created
- [x] Documentation updated
- [ ] Real Instagram URL tested
- [ ] Server integration tested
- [ ] Fallback chain tested
- [ ] Performance benchmarked

---

**Author:** Integration by AI Assistant  
**Date:** June 8, 2026  
**Version:** 1.0.0
