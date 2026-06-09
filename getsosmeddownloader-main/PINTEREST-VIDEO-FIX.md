# 🔧 Pinterest Video Corrupt Fix

## Problem: Error 0xC00D36C4

Video Pinterest yang didownload menampilkan error:
```
We can't open pinterest_Pinterest_video_1068127236631602653(1).mp4.
This may be because the file type is unsupported, the file extension
is incorrect or the file is corrupt.
Error code: 0xC00D36C4
```

---

## Root Cause

Pinterest video menggunakan **DASH format** dimana:
- 🎥 **Video stream** (tanpa audio) - terpisah
- 🔊 **Audio stream** (tanpa video) - terpisah

Untuk bisa diputar, kedua stream ini harus **di-merge** jadi 1 file MP4 menggunakan **ffmpeg**.

**Kalau ffmpeg tidak terinstall** = File video corrupt / tidak bisa dibuka!

---

## ✅ Solution: Install ffmpeg

### Windows

#### Option 1: Download Binary (Recommended)

1. **Download ffmpeg**:
   - Buka: https://www.gyan.dev/ffmpeg/builds/
   - Download: `ffmpeg-git-full.7z` (latest version)

2. **Extract**:
   - Extract ke `C:\ffmpeg`
   - Struktur folder: `C:\ffmpeg\bin\ffmpeg.exe`

3. **Add to PATH**:
   ```
   1. Tekan Win + R
   2. Ketik: sysdm.cpl
   3. Tab "Advanced" → "Environment Variables"
   4. Di "System variables" → cari "Path" → Edit
   5. Klik "New" → Tambahkan: C:\ffmpeg\bin
   6. OK → OK → OK
   ```

4. **Verify**:
   ```bash
   # Buka CMD/PowerShell baru
   ffmpeg -version
   ```
   
   Kalau muncul versi ffmpeg = ✅ Berhasil!

#### Option 2: Via Chocolatey

```bash
# Install Chocolatey dulu jika belum:
# https://chocolatey.org/install

choco install ffmpeg
```

#### Option 3: Via Scoop

```bash
# Install Scoop dulu jika belum:
# https://scoop.sh

scoop install ffmpeg
```

### macOS

```bash
# Via Homebrew (recommended)
brew install ffmpeg

# Verify
ffmpeg -version
```

### Linux

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install ffmpeg

# Fedora
sudo dnf install ffmpeg

# Arch
sudo pacman -S ffmpeg

# Verify
ffmpeg -version
```

---

## 🧪 Test After Installing ffmpeg

### Test 1: Check ffmpeg

```bash
ffmpeg -version
```

Should output something like:
```
ffmpeg version N-109868-g6d2f35fdc4-20230207 Copyright (c) 2000-2023 the FFmpeg developers
```

### Test 2: Manual Pinterest Download

```bash
yt-dlp --format "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 "https://www.pinterest.com/pin/YOUR_PIN_ID/"
```

Ganti `YOUR_PIN_ID` dengan PIN ID asli.

### Test 3: Via Script

```bash
# Debug script untuk lihat format yang tersedia
node test-pinterest-debug.js

# Edit file test-pinterest-debug.js dan masukkan URL Pinterest yang bermasalah
```

### Test 4: Via API

```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.pinterest.com/pin/YOUR_PIN_ID/"}'
```

---

## 🔍 Understanding the Fix

### What Happens Now (With ffmpeg)

```
Pinterest Video Pin URL
         │
         ▼
yt-dlp extracts:
  ├─ Video stream: 1920x1080, H.264, no audio
  └─ Audio stream: AAC, 128kbps, no video
         │
         ▼
ffmpeg merges:
  Video + Audio → Combined MP4
         │
         ▼
✅ Valid MP4 file that plays everywhere!
```

### What Happened Before (Without ffmpeg)

```
Pinterest Video Pin URL
         │
         ▼
yt-dlp extracts:
  ├─ Video stream: 1920x1080, H.264, no audio
  └─ Audio stream: AAC, 128kbps, no video
         │
         ▼
❌ Can't merge! (ffmpeg missing)
         │
         ▼
Downloads video-only stream
         │
         ▼
❌ Corrupt MP4 (no audio, broken container)
         │
         ▼
Error: 0xC00D36C4
```

---

## 📊 Updated Script Features

Script `scraper.js` sudah diupdate dengan:

1. **Force MP4 container**: `--merge-output-format mp4`
2. **Smart format selection**: Prefer native MP4 over DASH
3. **Fallback logic**: Try multiple video formats
4. **Better error handling**: Show clear error if no valid format

### Format Priority

```javascript
1. Best video MP4 + Best audio M4A → Merged MP4  // ⭐ BEST
2. Best single MP4 file (video+audio already merged)
3. Best available format (any container)
4. Direct URL from Pinterest (if available)
5. Fallback to thumbnail (image pins)
```

---

## ⚠️ Common Issues

### Issue 1: "ffmpeg not found"

**Symptom**: Video still corrupt after "installing" ffmpeg

**Cause**: ffmpeg tidak ada di PATH atau CMD/PowerShell tidak direstart

**Solution**:
1. Close semua CMD/PowerShell/Terminal windows
2. Buka CMD/PowerShell baru
3. Test: `ffmpeg -version`
4. Kalau masih error, ulangi "Add to PATH" steps

### Issue 2: "Postprocessing: Merger for format"

**Symptom**: yt-dlp error saat merge

**Cause**: ffmpeg corrupted atau versi lama

**Solution**:
```bash
# Uninstall old version
choco uninstall ffmpeg

# Download latest from gyan.dev
# Follow manual installation steps
```

### Issue 3: File size 0 KB

**Symptom**: File ter-download tapi ukuran 0 KB

**Cause**: Pinterest blocking download atau network issue

**Solution**:
1. Check internet connection
2. Try different pin URL
3. Update yt-dlp: `pip install -U yt-dlp`

### Issue 4: Video plays but no audio

**Symptom**: Video bisa dibuka tapi tidak ada suara

**Cause**: ffmpeg merge gagal atau Pinterest pin memang tidak ada audio

**Solution**:
1. Check apakah pin asli di Pinterest ada audio
2. Re-download dengan script updated
3. Check ffmpeg: `ffmpeg -version`

---

## 🎯 Quick Checklist

Before downloading Pinterest videos:

- [ ] yt-dlp installed: `yt-dlp --version`
- [ ] ffmpeg installed: `ffmpeg -version`
- [ ] Updated script (scraper.js with MP4 merge)
- [ ] Restarted terminal after ffmpeg installation

After these 4 items checked, Pinterest video should download perfectly! ✅

---

## 📚 References

- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg Official Site](https://ffmpeg.org/)
- [ffmpeg Windows Builds](https://www.gyan.dev/ffmpeg/builds/)
- [DASH Format Explained](https://en.wikipedia.org/wiki/Dynamic_Adaptive_Streaming_over_HTTP)

---

**Last Updated**: June 8, 2026  
**Status**: Fixed with ffmpeg requirement
