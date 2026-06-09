/**
 * Test MetaDownloader (SnapSave) untuk Instagram
 * 
 * Cara pakai:
 * node test-universal.js <instagram-url>
 * 
 * Contoh:
 * node test-universal.js https://www.instagram.com/p/ABC123/
 */

const snapsave = require("metadownloader");

async function testMetaDownloader(url) {
  console.log("🔍 Testing MetaDownloader (SnapSave)...");
  console.log("📎 URL:", url);
  console.log("");

  try {
    const result = await snapsave(url);
    
    console.log("✅ Berhasil!");
    console.log("\n📊 Data yang diterima:");
    console.log(JSON.stringify(result, null, 2));
    
    if (result.medias && result.medias.length > 0) {
      console.log(`\n📸 Total media: ${result.medias.length}`);
      result.medias.forEach((media, idx) => {
        console.log(`\n[Media ${idx + 1}]`);
        console.log(`  Type: ${media.type || 'N/A'}`);
        console.log(`  Extension: ${media.extension || 'N/A'}`);
        console.log(`  Quality: ${media.quality || 'N/A'}`);
        console.log(`  URL: ${media.url ? media.url.substring(0, 80) + '...' : 'N/A'}`);
        console.log(`  Dimensions: ${media.width || '?'} x ${media.height || '?'}`);
      });
    }
    
    if (result.owner || result.author) {
      console.log(`\n👤 Author: ${result.owner?.username || result.author || 'N/A'}`);
    }
    
    if (result.caption || result.title) {
      console.log(`\n💬 Caption: ${(result.caption || result.title || '').substring(0, 100)}...`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("\nStack trace:");
    console.error(error.stack);
  }
}

// Ambil URL dari argument
const url = process.argv[2];

if (!url) {
  console.log("❌ URL tidak diberikan!");
  console.log("\nContoh penggunaan:");
  console.log("  node test-universal.js https://www.instagram.com/p/ABC123/");
  console.log("  node test-universal.js https://www.instagram.com/reel/XYZ456/");
  process.exit(1);
}

// Jalankan test
testMetaDownloader(url);
