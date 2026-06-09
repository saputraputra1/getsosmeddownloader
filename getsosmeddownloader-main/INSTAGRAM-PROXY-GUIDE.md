# Instagram Photo Proxy - Panduan Lengkap

## Masalah yang Diselesaikan

Foto Instagram yang didownload muncul **blank/kosong** karena:
1. **CORS Policy** - Browser memblokir akses langsung ke Instagram CDN dari domain lain
2. **Referer Check** - Instagram CDN menolak request tanpa Referer header yang benar
3. **HEIC Format** - Instagram mengirim foto dalam format HEIC yang browser tidak bisa render langsung

## Solusi: Proxy Server

Server bertindak sebagai **proxy** antara client dan Instagram CDN:
```
Browser → Server Proxy → Instagram CDN → Server → Browser
```

## API Endpoints

### 1. `/api/proxy-instagram?url=...`
**Khusus untuk Instagram photos**

**Features:**
- ✅ Handle CORS headers
- ✅ Set correct Referer
- ✅ Convert HEIC → JPEG automatically  
- ✅ Support download managers (Range headers)
- ✅ Cache-friendly (1 year cache)
- ✅ Retry dengan mobile User-Agent jika 403

**Example:**
```javascript
const instagramPhotoUrl = "https://scontent.cdninstagram.com/v/t51.82787-15/...jpg";
const proxiedUrl = `/api/proxy-instagram?url=${encodeURIComponent(instagramPhotoUrl)}`;

// Gunakan proxiedUrl di <img> atau download
```

### 2. `/api/proxy?url=...`
**General purpose proxy untuk semua platform**

Sudah ada di server, support:
- Instagram
- TikTok
- YouTube
- Facebook
- Pinterest
- Twitter/X

## Integrasi Frontend

### Cara 1: Manual (Recommended)

Tambahkan script di `index.html` sebelum `</body>`:

```html
<script src="/instagram-proxy.js"></script>
<script>
// Patch response sebelum render
function fetchMedia(url) {
  return fetch('/api/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  .then(res => res.json())
  .then(response => {
    // Patch Instagram URLs ke proxy
    return window.InstagramProxy.patchInstagramResponse(response);
  });
}
</script>
```

### Cara 2: Automatic Patch

Update existing fetch handler:

```javascript
// Di bagian yang handle response dari /api/fetch
async function handleFetchResponse(response) {
  if (response.success && response.data) {
    // Patch Instagram URLs
    response = window.InstagramProxy.patchInstagramResponse(response);
    
    // Render media seperti biasa
    renderMedia(response.data);
  }
}
```

## Testing

### Test Proxy Endpoint:

```bash
# Start server
node server.js

# Test di browser
http://localhost:3000/api/proxy-instagram?url=https://scontent.cdninstagram.com/v/t51.82787-15/716690451_18058526447734621_9158250530692444345_n.heic?stp=dst-jpg_e35_s640x640_tt6
```

### Test via API:

```javascript
const testUrl = 'https://www.instagram.com/p/DZTq6N9gQc8/';

fetch('http://localhost:3000/api/fetch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: testUrl })
})
.then(res => res.json())
.then(data => {
  console.log('Original URL:', data.data[0].mediaItems[0].url);
  
  // Apply proxy
  const proxied = window.InstagramProxy.patchInstagramResponse(data);
  console.log('Proxied URL:', proxied.data[0].mediaItems[0].url);
});
```

## Hasil Testing

**Before Proxy:**
```
URL: https://scontent.cdninstagram.com/.../photo.heic
Status: ❌ CORS Error / Blank Image
```

**After Proxy:**
```
URL: http://localhost:3000/api/proxy-instagram?url=https://scontent.cdninstagram.com/.../photo.heic
Status: ✅ 200 OK
Content-Type: image/jpeg
Content-Length: 61684 bytes
Image: ✅ Muncul sempurna
```

## Deployment Notes

### Production:
```javascript
// Ubah baseUrl di instagram-proxy.js
const baseUrl = 'https://yourdomain.com'; // Ganti dengan domain production
```

### Environment Variables:
```bash
# .env
PORT=3000
NODE_ENV=production
```

### PM2 (Recommended):
```bash
pm2 start server.js --name mediaget
pm2 save
```

## Troubleshooting

### Foto Masih Blank?
1. **Cek console browser** - Lihat apakah URL sudah ke proxy
2. **Network tab** - Cek response dari `/api/proxy-instagram`
3. **Test direct** - Buka URL proxy langsung di browser

### Error 403?
- Server retry otomatis dengan mobile User-Agent
- Jika masih gagal, kemungkinan IP diblock Instagram

### Error 500?
- Cek server logs
- Pastikan axios installed: `npm install axios`
- Cek network timeout (default 60s)

## Performance

### Caching:
- Browser cache: 1 year (`Cache-Control: public, max-age=31536000`)
- CDN cache: Gunakan CDN di depan server untuk cache hits tinggi

### Bandwidth:
- Streaming mode: No disk I/O, langsung pipe ke client
- Memory efficient: Pakai streams, bukan buffer

### Scalability:
- Stateless: Bisa scale horizontal
- No storage: Tidak perlu persistent storage
- Load balancer: Compatible dengan reverse proxy (nginx, cloudflare)

## Best Practices

1. **Always use proxy for Instagram photos** - Jangan direct link
2. **Cache on CDN** - Pasang Cloudflare/CDN di depan
3. **Monitor rate limits** - Instagram bisa block jika terlalu banyak request
4. **Fallback to Instaloader** - Jika proxy gagal, use Python Instaloader
5. **User feedback** - Tampilkan loading state saat fetch proxy

## Kesimpulan

✅ **Proxy endpoint sudah siap digunakan!**

**Status Akhir:**
- Endpoint: `/api/proxy-instagram` ✅
- Helper JS: `instagram-proxy.js` ✅
- CORS: Fixed ✅
- HEIC: Auto convert ✅
- Foto: Tidak blank lagi ✅

Tinggal integrasikan helper JS ke frontend dan foto Instagram akan muncul sempurna!
