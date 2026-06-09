# ⚡ Quick Start Guide

## 1️⃣ Install Dependencies (5 minutes)

### Node.js Packages
```bash
npm install
```

### yt-dlp
```bash
pip install yt-dlp
```

### ffmpeg (IMPORTANT!)
**Windows**: Download from https://www.gyan.dev/ffmpeg/builds/ and add to PATH  
**macOS**: `brew install ffmpeg`  
**Linux**: `sudo apt install ffmpeg`

**Verify:**
```bash
yt-dlp --version
ffmpeg -version
```

---

## 2️⃣ Start Server
```bash
node server.js
```

Open: http://localhost:3000

---

## 3️⃣ Supported Platforms

| Platform | URL Example | Works? |
|----------|------------|--------|
| **Instagram Video** | `instagram.com/reel/ABC/` | ✅ Perfect |
| **Instagram Photo** | `instagram.com/p/ABC/` | ⚠️ Challenging* |
| **TikTok** | `tiktok.com/@user/video/123` | ✅ Perfect |
| **Pinterest** | `pinterest.com/pin/123/` | ✅ Perfect** |
| **YouTube** | `youtube.com/watch?v=ABC` | ✅ Perfect |
| **Facebook** | `facebook.com/watch/?v=123` | ⚠️ Limited |

\* Instagram photos need login (6 fallback methods used)  
\*\* Requires ffmpeg for video pins

---

## 4️⃣ Common Issues

### ❌ Pinterest video corrupt (error 0xC00D36C4)
**Fix**: Install ffmpeg!  
📖 See: [PINTEREST-VIDEO-FIX.md](./PINTEREST-VIDEO-FIX.md)

### ❌ Instagram photo tidak bisa didownload
**Why**: Instagram requires login since late 2024  
📖 See: [WHY-INSTAGRAM-PHOTOS-HARD.md](./WHY-INSTAGRAM-PHOTOS-HARD.md)

### ❌ "yt-dlp not found"
**Fix**: `pip install yt-dlp` and restart terminal

---

## 5️⃣ API Usage

### Via cURL
```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/@user/video/123"}'
```

### Via JavaScript
```javascript
const { scrapeMedia } = require('./scraper.js');

const result = await scrapeMedia('https://www.tiktok.com/@user/video/123');
console.log(result.mediaItems[0].url);
```

---

## 6️⃣ Testing

```bash
# Test specific platform
node test-pinterest.js    # Pinterest
node test-mrnima.js       # Instagram (@mrnima)

# Debug Pinterest video issues
node test-pinterest-debug.js
```

---

## 🎯 Quick Checklist

Before first use:
- [ ] `npm install` ✓
- [ ] `pip install yt-dlp` ✓
- [ ] `ffmpeg -version` works ✓
- [ ] `node server.js` starts ✓
- [ ] Can access http://localhost:3000 ✓

If all checked: **You're ready!** 🚀

---

## 📚 Full Documentation

- [README.md](./README.md) - Complete guide
- [PINTEREST-VIDEO-FIX.md](./PINTEREST-VIDEO-FIX.md) - Fix corrupt videos
- [WHY-INSTAGRAM-PHOTOS-HARD.md](./WHY-INSTAGRAM-PHOTOS-HARD.md) - Instagram challenges
- [CHANGELOG.md](./CHANGELOG.md) - Version history

---

**Need help?** Check the documentation files or create an issue!
