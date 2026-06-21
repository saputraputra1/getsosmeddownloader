/**
 * Export Telegram Session String untuk Railway/Cloud Deployment
 * 
 * Cara pakai:
 * 1. Jalankan: node tg-export-session.js
 * 2. Copy session string yang muncul
 * 3. Paste ke Railway environment variable: TELEGRAM_SESSION
 * 
 * Environment variables yang diperlukan di Railway:
 * - TELEGRAM_API_ID     = (dari my.telegram.org)
 * - TELEGRAM_API_HASH   = (dari my.telegram.org)
 * - TELEGRAM_SESSION    = (session string dari script ini)
 * - TELEGRAM_PHONE      = (opsional, nomor telepon)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'telegram_session.json');

console.log('=== Export Telegram Session untuk Railway ===\n');

// Check if session file exists
if (!fs.existsSync(SESSION_FILE)) {
  console.log('❌ File telegram_session.json tidak ditemukan!');
  console.log('');
  console.log('Login dulu dengan menjalankan:');
  console.log('   node tg-login-fast.js');
  console.log('');
  console.log('Setelah login berhasil, jalankan lagi script ini.');
  process.exit(1);
}

try {
  const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  
  console.log('✅ Session ditemukan!');
  console.log(`   Phone: ${sessionData.phone || 'unknown'}`);
  console.log(`   API ID: ${sessionData.apiId || process.env.TELEGRAM_API_ID || 'unknown'}`);
  console.log(`   Created: ${sessionData.createdAt || 'unknown'}`);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('COPY SESSION STRING INI KE RAILWAY ENV VAR:');
  console.log('Variable name: TELEGRAM_SESSION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(sessionData.stringSession);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('📋 Environment variables yang perlu diset di Railway:');
  console.log('');
  console.log(`   TELEGRAM_API_ID   = ${process.env.TELEGRAM_API_ID || '(isi dari my.telegram.org)'}`);
  console.log(`   TELEGRAM_API_HASH = ${process.env.TELEGRAM_API_HASH || '(isi dari my.telegram.org)'}`);
  console.log(`   TELEGRAM_SESSION  = (paste session string di atas)`);
  console.log(`   TELEGRAM_PHONE    = ${sessionData.phone || '(opsional)'}`);
  console.log('');
  console.log('⚠️  Catatan:');
  console.log('   - Session bisa expired. Jika error, login ulang dan update env var.');
  console.log('   - Railway filesystem ephemeral, jadi session file tidak bisa dipakai.');
  console.log('   - Gunakan env var TELEGRAM_SESSION sebagai gantinya.');
  console.log('');
  console.log('=== Selesai ===');
} catch (err) {
  console.error('❌ Gagal membaca session file:', err.message);
  process.exit(1);
}
