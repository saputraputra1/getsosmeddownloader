/**
 * Quick test untuk Instagram scraper
 */

const { scrapeMedia } = require("./scraper");

const url = process.argv[2] || "https://www.instagram.com/p/C5L8K9RyXGZ/";

console.log("🔍 Testing Instagram Download");
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
      console.log(`    URL: ${media.url.substring(0, 80)}...`);
      console.log(`    Ext: ${media.ext}`);
    });
    
  } catch (error) {
    console.error("❌ GAGAL:", error.message);
  }
})();
