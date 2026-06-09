/**
 * Debug Pinterest Video Download
 */

const { execFile } = require("child_process");

// Masukkan URL Pinterest video yang bermasalah di sini
const testUrl = "https://pin.it/5FYNe41Mx"; // URL dari error log

console.log("=".repeat(70));
console.log("🐛 DEBUG PINTEREST VIDEO");
console.log("URL:", testUrl);
console.log("=".repeat(70));

// Test 1: Get raw yt-dlp info
console.log("\n📋 Test 1: Raw yt-dlp output");
console.log("-".repeat(70));

execFile("yt-dlp", [
  "--dump-json",
  "--no-warnings",
  testUrl
], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
  if (error) {
    console.error("❌ Error:", error.message);
    console.error("Stderr:", stderr);
    return;
  }
  
  try {
    const info = JSON.parse(stdout);
    
    console.log("\n✅ Berhasil extract info!");
    console.log("\n📊 Metadata:");
    console.log("  Title:", info.title);
    console.log("  Uploader:", info.uploader);
    console.log("  Duration:", info.duration, "seconds");
    console.log("  Thumbnail:", info.thumbnail?.substring(0, 60) + "...");
    
    console.log("\n📹 Formats Found:", info.formats?.length || 0);
    
    if (info.formats && info.formats.length > 0) {
      console.log("\n🎬 Video Formats:");
      info.formats.forEach((f, i) => {
        if (f.vcodec && f.vcodec !== 'none') {
          console.log(`\n  Format ${i + 1}:`);
          console.log(`    ID: ${f.format_id}`);
          console.log(`    Quality: ${f.format_note || f.height + 'p' || 'unknown'}`);
          console.log(`    Codec: ${f.vcodec}`);
          console.log(`    Container: ${f.ext}`);
          console.log(`    Resolution: ${f.width}x${f.height}`);
          console.log(`    FPS: ${f.fps || 'unknown'}`);
          console.log(`    Size: ${f.filesize ? (f.filesize / 1024 / 1024).toFixed(2) + ' MB' : 'unknown'}`);
          console.log(`    URL: ${f.url.substring(0, 80)}...`);
          console.log(`    URL Length: ${f.url.length} chars`);
        }
      });
    }
    
    console.log("\n🔗 Direct URLs:");
    console.log("  info.url:", info.url ? info.url.substring(0, 80) + "..." : "NOT FOUND");
    
    if (info.requested_formats) {
      console.log("\n🎯 Requested/Merged Formats:");
      info.requested_formats.forEach((f, i) => {
        console.log(`\n  Merged ${i + 1}:`);
        console.log(`    Type: ${f.vcodec && f.vcodec !== 'none' ? 'Video' : 'Audio'}`);
        console.log(`    Codec: ${f.vcodec || f.acodec}`);
        console.log(`    Ext: ${f.ext}`);
        console.log(`    URL: ${f.url.substring(0, 80)}...`);
      });
    }
    
    console.log("\n" + "=".repeat(70));
    console.log("💡 Rekomendasi:");
    
    // Find best video format
    const videoFormats = info.formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.url);
    if (videoFormats.length > 0) {
      // Sort by height
      videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
      const best = videoFormats[0];
      console.log(`✅ Gunakan Format: ${best.format_id} (${best.height}p, ${best.ext})`);
      console.log(`   URL: ${best.url.substring(0, 100)}...`);
    } else if (info.url) {
      console.log(`✅ Gunakan info.url (direct link)`);
      console.log(`   URL: ${info.url.substring(0, 100)}...`);
    } else {
      console.log(`❌ TIDAK ADA FORMAT VIDEO YANG VALID!`);
    }
    
    // Full JSON dump
    console.log("\n" + "=".repeat(70));
    console.log("📄 FULL JSON (untuk debug):");
    console.log(JSON.stringify(info, null, 2));
    
  } catch (parseErr) {
    console.error("❌ Parse error:", parseErr.message);
    console.log("\nRaw output:");
    console.log(stdout);
  }
});

// Test 2: Try downloading with yt-dlp
setTimeout(() => {
  console.log("\n" + "=".repeat(70));
  console.log("📥 Test 2: Actual download test");
  console.log("-".repeat(70));
  
  const testFilename = `test_pinterest_${Date.now()}.mp4`;
  
  execFile("yt-dlp", [
    "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "-o", testFilename,
    testUrl
  ], { timeout: 60000 }, (error, stdout, stderr) => {
    if (error) {
      console.error("❌ Download gagal:", error.message);
      console.error("Stderr:", stderr);
    } else {
      console.log("✅ Download berhasil!");
      console.log("File:", testFilename);
      console.log("\nOutput:", stdout);
      console.log("\n💡 Coba buka file ini dan lihat apakah bisa diputar.");
    }
  });
}, 2000);
