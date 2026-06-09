/**
 * Test berbagai library Instagram downloader yang sudah ter-install
 */

const url = process.argv[2] || "https://www.instagram.com/p/C5L8K9RyXGZ/";

console.log("🔍 Testing Instagram Downloader Libraries");
console.log("📎 URL:", url);
console.log("=".repeat(70));

// Test 1: @mrnima/instagram-downloader
async function test1() {
  console.log("\n1️⃣ Testing @mrnima/instagram-downloader...");
  try {
    const { instagramdl } = require("@mrnima/instagram-downloader");
    const result = await instagramdl(url);
    console.log("✅ Berhasil!");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.log("❌ Gagal:", error.message);
    return null;
  }
}

// Test 2: instagram-url-downloader
async function test2() {
  console.log("\n2️⃣ Testing instagram-url-downloader...");
  try {
    const instagramDownload = require("instagram-url-downloader");
    const result = await instagramDownload(url);
    console.log("✅ Berhasil!");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.log("❌ Gagal:", error.message);
    return null;
  }
}

// Test 3: @bochilteam/scraper
async function test3() {
  console.log("\n3️⃣ Testing @bochilteam/scraper...");
  try {
    const { instagramdl, instagramdlv2, instagramdlv3 } = require("@bochilteam/scraper");
    console.log("  🔸 Trying instagramdl...");
    try {
      const result = await instagramdl(url);
      console.log("✅ Berhasil dengan instagramdl!");
      console.log(JSON.stringify(result, null, 2));
      return result;
    } catch (e1) {
      console.log("  ❌ instagramdl gagal:", e1.message);
    }
    
    console.log("  🔸 Trying instagramdlv2...");
    try {
      const result = await instagramdlv2(url);
      console.log("✅ Berhasil dengan instagramdlv2!");
      console.log(JSON.stringify(result, null, 2));
      return result;
    } catch (e2) {
      console.log("  ❌ instagramdlv2 gagal:", e2.message);
    }
    
    console.log("  🔸 Trying instagramdlv3...");
    try {
      const result = await instagramdlv3(url);
      console.log("✅ Berhasil dengan instagramdlv3!");
      console.log(JSON.stringify(result, null, 2));
      return result;
    } catch (e3) {
      console.log("  ❌ instagramdlv3 gagal:", e3.message);
    }
    
    return null;
  } catch (error) {
    console.log("❌ Gagal:", error.message);
    return null;
  }
}

// Test 4: nayan-media-downloader
async function test4() {
  console.log("\n4️⃣ Testing nayan-media-downloader...");
  try {
    const nayan = require("nayan-media-downloader");
    const result = await nayan.instagram(url);
    console.log("✅ Berhasil!");
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.log("❌ Gagal:", error.message);
    return null;
  }
}

// Jalankan semua test
(async () => {
  const results = {
    mrnima: await test1(),
    urldownloader: await test2(),
    bochilteam: await test3(),
    nayan: await test4()
  };
  
  console.log("\n" + "=".repeat(70));
  console.log("📊 SUMMARY:");
  console.log("=".repeat(70));
  
  let successCount = 0;
  for (const [name, result] of Object.entries(results)) {
    if (result) {
      console.log(`✅ ${name}: BERHASIL`);
      successCount++;
    } else {
      console.log(`❌ ${name}: GAGAL`);
    }
  }
  
  console.log(`\n🎯 Total: ${successCount}/4 library berhasil`);
})();
