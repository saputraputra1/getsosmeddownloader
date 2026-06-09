/**
 * Test download foto Instagram
 */

const { scrapeMedia } = require("./scraper");

// Ganti dengan URL foto Instagram yang valid dan public
const url = process.argv[2] || "https://www.instagram.com/p/ENTER_VALID_POST_ID/";

console.log("🔍 Testing Instagram FOTO Download");
console.log("📎 URL:", url);
console.log("");

(async () => {
  try {
    const result = await scrapeMedia(url);
    
    console.log("✅ BERHASIL!");
    console.log("");
    console.log("📊 Platform:", result.platform);
    console.log("📊 Type:", result.type);
    console.log("👤 Author:", result.author);
    console.log("🔖 Source:", result.source);
    console.log(`📸 Total Media: ${result.mediaItems.length}`);
    console.log("");
    
    result.mediaItems.forEach((media, idx) => {
      console.log(`[${idx + 1}] ${media.type.toUpperCase()}`);
      console.log(`    URL: ${media.url.substring(0, 100)}...`);
      console.log(`    Ext: ${media.ext}`);
    });
    
    console.log("\n✅ Foto berhasil diambil!");
    
  } catch (error) {
    console.error("\n❌ GAGAL:", error.message);
    console.error("\nDetail error:");
    console.error(error);
  }
})();
