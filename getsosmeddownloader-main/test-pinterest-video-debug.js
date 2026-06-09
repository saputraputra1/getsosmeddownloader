/**
 * Debug Pinterest Video - Extract and save HTML
 */

const axios = require('axios');
const fs = require('fs');

const testUrl = "https://pin.it/6p9XIwSNT"; // Ganti dengan URL video pin yang bermasalah

console.log("=".repeat(70));
console.log("🔍 PINTEREST VIDEO DEBUG");
console.log("URL:", testUrl);
console.log("=".repeat(70));

async function debugPinterestVideo() {
  try {
    console.log("\n📥 Fetching HTML...");
    
    const response = await axios.get(testUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      maxRedirects: 5,
      timeout: 15000
    });
    
    const html = response.data;
    const finalUrl = response.request?.res?.responseUrl || testUrl;
    const pinId = finalUrl.match(/\/pin\/(\d+)/)?.[1] || "unknown";
    
    console.log("✅ HTML fetched successfully");
    console.log("Final URL:", finalUrl);
    console.log("Pin ID:", pinId);
    console.log("HTML size:", (html.length / 1024).toFixed(2), "KB");
    
    // Save full HTML
    const htmlFile = `debug_pinterest_${pinId}.html`;
    fs.writeFileSync(htmlFile, html);
    console.log(`\n💾 Full HTML saved to: ${htmlFile}`);
    
    // Check for video indicators
    console.log("\n🔍 Checking for video indicators...");
    
    const indicators = {
      'video_list': html.includes('"video_list"'),
      'videos object': html.includes('"videos":{'),
      'video_url': html.includes('video_url'),
      '.mp4 extension': html.includes('.mp4'),
      'V_720P': html.includes('V_720P'),
      'V_HLS': html.includes('V_HLS'),
      'story_pin_data': html.includes('story_pin_data')
    };
    
    console.log("\nIndicators found:");
    for (const [key, found] of Object.entries(indicators)) {
      console.log(`  ${found ? '✅' : '❌'} ${key}`);
    }
    
    // Try to extract video URLs
    console.log("\n🎥 Attempting to extract video URLs...");
    
    const videoPatterns = [
      { name: 'V_720P', pattern: /"video_list":\s*\{[^}]*"V_720P":\s*\{[^}]*"url":\s*"([^"]+)"/ },
      { name: 'V_HLSV4', pattern: /"video_list":\s*\{[^}]*"V_HLSV4":\s*\{[^}]*"url":\s*"([^"]+)"/ },
      { name: 'V_HLS', pattern: /"video_list":\s*\{[^}]*"V_HLS":\s*\{[^}]*"url":\s*"([^"]+)"/ },
      { name: 'Direct mp4', pattern: /"url":\s*"(https:\/\/[^"]*\.mp4[^"]*)"/g },
      { name: 'video_url', pattern: /"video_url":\s*"([^"]+)"/ },
      { name: 'videos.video_list', pattern: /"videos":\s*\{[^}]*"video_list"[^}]*"url":\s*"([^"]+)"/ }
    ];
    
    const foundUrls = [];
    
    for (const { name, pattern } of videoPatterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          const url = match[1]
            .replace(/\\u002F/g, '/')
            .replace(/\\\//g, '/')
            .replace(/\\"/g, '"')
            .replace(/\\/g, '');
          
          if (url.startsWith('http')) {
            console.log(`\n  ✅ ${name}:`);
            console.log(`     ${url.substring(0, 120)}...`);
            foundUrls.push({ name, url });
          }
        }
      }
    }
    
    if (foundUrls.length === 0) {
      console.log("\n  ❌ No video URLs found with standard patterns");
      console.log("\n  📝 Searching for ANY .mp4 URLs in HTML...");
      
      const allMp4 = html.match(/https:\/\/[^"\s]+\.mp4[^"\s]*/g);
      if (allMp4) {
        console.log(`\n  Found ${allMp4.length} .mp4 URLs:`);
        allMp4.forEach((url, i) => {
          console.log(`  ${i + 1}. ${url.substring(0, 100)}...`);
        });
      } else {
        console.log("  ❌ No .mp4 URLs found at all");
      }
    }
    
    // Extract JSON data blocks
    console.log("\n📦 Extracting JSON data blocks...");
    
    const scriptMatches = html.matchAll(/<script[^>]*>([^<]*__PWS_DATA__[^<]*)<\/script>/g);
    let jsonBlockCount = 0;
    
    for (const match of scriptMatches) {
      jsonBlockCount++;
      const scriptContent = match[1];
      const jsonFile = `debug_pinterest_${pinId}_json${jsonBlockCount}.txt`;
      fs.writeFileSync(jsonFile, scriptContent);
      console.log(`  💾 JSON block ${jsonBlockCount} saved to: ${jsonFile}`);
    }
    
    if (jsonBlockCount === 0) {
      console.log("  ℹ️ No __PWS_DATA__ found, checking for other JSON blocks...");
      
      const allScripts = html.match(/<script[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/g);
      if (allScripts) {
        allScripts.forEach((script, i) => {
          const content = script.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
          if (content.length > 100) {
            const jsonFile = `debug_pinterest_${pinId}_appjson${i + 1}.txt`;
            fs.writeFileSync(jsonFile, content);
            console.log(`  💾 App JSON ${i + 1} saved to: ${jsonFile}`);
          }
        });
      }
    }
    
    console.log("\n" + "=".repeat(70));
    console.log("✅ Debug complete!");
    console.log("\n📋 Summary:");
    console.log(`  - HTML file: ${htmlFile}`);
    console.log(`  - Pin ID: ${pinId}`);
    console.log(`  - Video URLs found: ${foundUrls.length}`);
    console.log(`  - Has video indicators: ${Object.values(indicators).some(v => v) ? 'Yes' : 'No'}`);
    
    if (foundUrls.length > 0) {
      console.log("\n🎯 RECOMMENDED VIDEO URL:");
      console.log(foundUrls[0].url);
    } else {
      console.log("\n⚠️ No video URL extracted automatically.");
      console.log("   Please check the HTML file manually to find video URL.");
    }
    
  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
  }
}

debugPinterestVideo();
