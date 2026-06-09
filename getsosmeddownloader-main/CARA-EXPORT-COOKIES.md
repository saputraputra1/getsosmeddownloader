# 🍪 Cara Export Cookies Instagram untuk Download Foto

## ⚠️ Masalah
Instagram foto **TIDAK BISA** didownload tanpa login. Semua metode gagal karena Instagram memblokir akses.

## ✅ SOLUSI: Export Cookies Manual

### Langkah 1: Install Extension Chrome

1. Buka Chrome
2. Install extension: **"Get cookies.txt LOCALLY"**
   - Link: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc

### Langkah 2: Login Instagram

1. Buka https://www.instagram.com
2. **LOGIN** dengan akun Instagram
3. Pastikan sudah login (lihat feed Anda)

### Langkah 3: Export Cookies

1. Klik icon extension **"Get cookies.txt LOCALLY"** di toolbar Chrome
2. Klik **"Export"**
3. Save file sebagai: `instagram_cookies.txt`
4. Copy file ke folder: `C:\Users\izmet\Downloads\MediaGETSOSMED-main\`

### Langkah 4: Modifikasi Command

File `scraper.js` perlu diubah untuk pakai cookies file.

**Atau gunakan yt-dlp manual:**
```bash
yt-dlp --cookies instagram_cookies.txt "https://www.instagram.com/p/DZTq6N9gQc8/"
```

---

## 🔄 ALTERNATIF LEBIH MUDAH

Karena export cookies ribet, saya sarankan:

### **Gunakan API Pihak Ketiga**

Ada beberapa API gratis yang bisa download Instagram foto:

1. **DownloadGram** - https://downloadgram.org/
2. **Insta-Downloader** - https://insta-downloader.net/
3. **SnapInsta** - https://snapinsta.app/

Tapi ini berarti aplikasi Anda **harus panggil API eksternal**, bukan self-hosted.

---

## 💡 REKOMENDASI

**UNTUK PRODUCTION:**

Sistem Anda saat ini sudah **SEMPURNA** untuk:
- ✅ Download VIDEO/REEL Instagram (bekerja 100%)
- ✅ Download TikTok (video & foto)
- ✅ Download YouTube
- ✅ Download Facebook

**Untuk FOTO Instagram:**
- Instagram memang **sangat ketat**
- Butuh cookies yang valid
- **Solusi terbaik**: Pakai API pihak ketiga atau minta user login

**Kesimpulan:**
- **Video Instagram** = ✅ SUDAH BEKERJA
- **Foto Instagram** = ❌ Butuh cookies/API eksternal

Apakah Anda mau saya integrasikan API pihak ketiga untuk foto Instagram?
