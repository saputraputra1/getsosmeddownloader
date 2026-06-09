/**
 * Test Pinterest Downloader
 */

const { scrapeMedia } = require('./scraper.js');

// Test URLs
const testUrls = [
  "https://www.pinterest.com/pin/1234567890/", // Image pin (replace with real URL)
  "https://pin.it/abc123", // Short link (replace with real URL)
];

console.log("=".repeat(70));
console.log("🧪 TESTING PINTEREST DOWNLOADER");
console.log("=".repeat(70));

async function testPinterest() {
  for (const url of testUrls) {
    console.log(`\n📌 Testing URL: ${url}`);
    console.log("-".repeat(70));
    
    try {
      const result = await scrapeMedia(url);
      
      console.log("✅ SUCCESS!");
      console.log("Platform:", result.platform);
      console.log("Type:", result.type);
      console.log("Author:", result.author);
      console.log("Title:", result.title?.substring(0, 80) + "...");
      console.log("Media Items:", result.mediaItems.length);
      
      result.mediaItems.forEach((item, i) => {
        console.log(`\n  Media ${i + 1}:`);
        console.log(`    Type: ${item.type}`);
        console.log(`    URL: ${item.url?.substring(0, 80)}...`);
        console.log(`    Formats: ${item.formats.length}`);
      });
      
    } catch (err) {
      console.error("❌ ERROR:", err.message);
    }
  }
}

testPinterest().then(() => {
  console.log("\n" + "=".repeat(70));
  console.log("Test selesai!");
}).catch(err => {
  console.error("Fatal error:", err);
});
