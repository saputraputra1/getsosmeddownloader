/**
 * Test @mrnima/instagram-downloader
 */

const url = "https://www.instagram.com/p/C_8FoBUSOcW/";

console.log("=".repeat(70));
console.log("Testing @mrnima/instagram-downloader");
console.log("URL:", url);
console.log("=".repeat(70));

async function testMrnima() {
  try {
    console.log("\n📦 Loading @mrnima/instagram-downloader...");
    const instagramDownloader = require('@mrnima/instagram-downloader');
    
    console.log("✅ Package loaded successfully");
    console.log("\n🔄 Fetching Instagram data...");
    
    const result = await instagramDownloader(url);
    
    console.log("\n✅ SUCCESS! Result:");
    console.log(JSON.stringify(result, null, 2));
    
    if (result.download_url) {
      console.log("\n🎯 Download URL found:", result.download_url);
    }
    
    if (result.username) {
      console.log("👤 Username:", result.username);
    }
    
    if (result.caption) {
      console.log("📝 Caption:", result.caption.substring(0, 100) + "...");
    }
    
  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    console.error("Stack:", err.stack);
  }
}

testMrnima();
