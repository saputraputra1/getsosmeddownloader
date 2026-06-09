# 📋 Cara Download Foto Instagram

## ⚠️ MASALAH: Foto Instagram Butuh Login

Instagram memblokir download foto tanpa login. Anda **HARUS login di browser** agar yt-dlp bisa pakai cookies.

---

## ✅ SOLUSI: Login Instagram di Chrome

### Langkah 1: Login ke Instagram
1. Buka **Google Chrome**
2. Pergi ke: https://www.instagram.com
3. **LOGIN** dengan akun Instagram Anda
4. Pastikan tetap login (jangan logout)

### Langkah 2: Restart Server
```bash
# Matikan server (Ctrl + C)
# Jalankan lagi
node server.js
```

### Langkah 3: Test Download
Sekarang coba download foto Instagram lagi - seharusnya berhasil!

---

## 🔍 Cara Kerja

- **Video/Reel**: yt-dlp langsung (tidak butuh login) ✅
- **Foto**: yt-dlp + cookies Chrome (butuh login) 🔐

yt-dlp akan otomatis ambil cookies dari Chrome yang sudah login Instagram.

---

## ❌ Jika Masih Gagal

### Error: "Could not copy Chrome cookie database"
**Penyebab:** Chrome masih terbuka

**Solusi:**
1. TUTUP semua window Chrome
2. Restart server
3. Test lagi

### Error: "Instagram sent an empty media response"
**Penyebab:** Belum login Instagram di Chrome

**Solusi:**
1. Buka Chrome
2. Login ke Instagram
3. Jangan logout
4. Test lagi

---

## 🎯 Testing

Test dengan URL ini:
```
https://www.instagram.com/p/DZOzZ9QEl-4/
```

Jika berhasil:
- ✅ Username muncul
- ✅ Foto bisa di-preview
- ✅ Download berhasil

---

## 💡 Tips

1. **Tetap login** di Chrome = download lancar
2. **Logout** = download gagal
3. **Chrome ditutup** saat download = aman, cookies sudah dicopy

---

**Good luck!** 🚀
