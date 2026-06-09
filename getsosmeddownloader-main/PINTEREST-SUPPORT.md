# 📌 Pinterest Support

## Overview

Pinterest downloader sekarang sudah didukung menggunakan **yt-dlp** sebagai engine utama.

## Supported Content Types

✅ **Image Pins** - Single image pins  
✅ **Video Pins** - Video content  
✅ **Carousel Pins** - Multiple images (akan download gambar pertama)  

## URL Formats Supported

```
https://www.pinterest.com/pin/1234567890/
https://pin.it/abc123
https://www.pinterest.co.uk/pin/...
https://www.pinterest.de/pin/...
```

## How It Works

1. **Platform Detection**: URL dikenali otomatis dari domain pinterest.com atau pin.it
2. **yt-dlp Extraction**: Menggunakan yt-dlp untuk extract metadata dan media URL
3. **Type Detection**: Otomatis detect apakah pin berisi video atau foto
4. **Format Selection**: Pilih format terbaik yang tersedia

## API Response Structure

```json
{
  "platform": "pinterest",
  "type": "image",
  "shortcode": "1234567890",
  "author": "Pinterest User",
  "caption": "Pin description...",
  "title": "Pin title",
  "timestamp": 1234567890,
  "likeCount": 0,
  "commentCount": 0,
  "viewCount": 0,
  "duration": null,
  "mediaItems": [
    {
      "type": "image",
      "url": "https://i.pinimg.com/originals/...",
      "thumbnail": "https://i.pinimg.com/originals/...",
      "width": 1080,
      "height": 1350,
      "duration": null,
      "ext": "jpg",
      "formats": [
        {
          "type": "image",
          "quality": "Original",
          "url": "https://i.pinimg.com/originals/...",
          "ext": "jpg"
        }
      ]
    }
  ],
  "source": "yt-dlp",
  "warning": null
}
```

## Example Usage

### Via API

```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.pinterest.com/pin/1234567890/"}'
```

### Via JavaScript

```javascript
const { scrapeMedia } = require('./scraper.js');

const result = await scrapeMedia('https://www.pinterest.com/pin/1234567890/');
console.log(result);
```

## Testing

Run the test script:

```bash
node test-pinterest.js
```

## Requirements

- **yt-dlp** must be installed and available in PATH
- **ffmpeg** must be installed (for merging video+audio)
- Node.js dependencies installed (`npm install`)

### Installing Requirements

**yt-dlp:**
```bash
pip install yt-dlp
```

**ffmpeg (Windows):**
1. Download from: https://www.gyan.dev/ffmpeg/builds/
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to system PATH
4. Verify: `ffmpeg -version`

**ffmpeg (macOS):**
```bash
brew install ffmpeg
```

**ffmpeg (Linux):**
```bash
sudo apt install ffmpeg
```

## Troubleshooting

### Error: "yt-dlp tidak tersedia"

**Solution**: Install yt-dlp

```bash
# Windows (via pip)
pip install yt-dlp

# Or download binary from: https://github.com/yt-dlp/yt-dlp/releases
```

### Error: Video corrupt / "0xC00D36C4"

**Problem**: File MP4 yang didownload tidak bisa dibuka atau corrupt.

**Causes**:
- Pinterest menggunakan DASH format (video & audio terpisah)
- Format video tidak compatible dengan player
- Download incomplete atau interrupted

**Solutions**:

1. **Update yt-dlp** (penting!):
```bash
pip install -U yt-dlp
# atau
yt-dlp -U
```

2. **Debug dengan test script**:
```bash
node test-pinterest-debug.js
```
Edit file `test-pinterest-debug.js` dan masukkan URL Pinterest yang bermasalah, kemudian check output untuk melihat format yang tersedia.

3. **Force MP4 merge**: Script sudah updated untuk otomatis merge video+audio ke MP4. Pastikan yt-dlp versi terbaru.

4. **Manual download test**:
```bash
yt-dlp --format "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 "https://pinterest.com/pin/123/"
```

5. **Cek ffmpeg**: yt-dlp butuh ffmpeg untuk merge video+audio
```bash
# Check ffmpeg installed
ffmpeg -version

# If not installed (Windows):
# Download from: https://www.gyan.dev/ffmpeg/builds/
# Extract and add to PATH
```

### Error: "Tidak ada media yang ditemukan"

**Causes**:
- Pin mungkin private atau deleted
- Geographic restrictions
- Pinterest API changes

**Solutions**:
- Verify URL is accessible in browser
- Try different pin URL
- Check yt-dlp is updated: `yt-dlp -U`

## Notes

- Pinterest doesn't require login for public pins
- yt-dlp handles Pinterest reliably
- Both images and videos are supported
- Metadata (author, title, stats) extracted when available
- **IMPORTANT**: Video pins require **ffmpeg** to merge video+audio streams
- If video files are corrupt (error 0xC00D36C4), update yt-dlp and install ffmpeg

## Performance

- **Image Pins**: ~2-4 seconds
- **Video Pins**: ~3-6 seconds (depending on quality selection)
