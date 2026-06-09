/**
 * Test Instagram GraphQL Scraper (Ahmed Rangel Method)
 * 
 * Cara pakai:
 * node test-graphql.js <instagram-url>
 * 
 * Contoh:
 * node test-graphql.js https://www.instagram.com/p/ABC123/
 */

const axios = require("axios");

const IG_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IG_APP_ID = "936619743392459";

// Extract shortcode from Instagram URL
function extractShortcode(url) {
  const patterns = [
    /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/reels\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) return m[1];
  }
  return null;
}

async function testInstagramGraphQL(url) {
  console.log("🔍 Testing Instagram GraphQL API...");
  console.log("📎 URL:", url);
  console.log("");

  try {
    const igId = extractShortcode(url);
    if (!igId) {
      throw new Error("Tidak dapat mengekstrak shortcode dari URL");
    }

    console.log("🔑 Shortcode:", igId);

    // Fetch graphql data from instagram post
    const graphql = new URL(`https://www.instagram.com/api/graphql`);
    graphql.searchParams.set("variables", JSON.stringify({ shortcode: igId }));
    graphql.searchParams.set("doc_id", "10015901848480474");
    graphql.searchParams.set("lsd", "AVqbxe3J_YA");

    console.log("🌐 Fetching data...\n");

    const response = await axios.post(graphql.toString(), null, {
      headers: {
        "User-Agent": IG_USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-IG-App-ID": IG_APP_ID,
        "X-FB-LSD": "AVqbxe3J_YA",
        "X-ASBD-ID": "129477",
        "Sec-Fetch-Site": "same-origin"
      },
      timeout: 15000
    });

    const items = response.data?.data?.xdt_shortcode_media;
    
    if (!items) {
      throw new Error("Instagram GraphQL tidak mengembalikan data yang valid");
    }

    console.log("✅ Berhasil!");
    console.log("\n📊 Data yang diterima:");
    console.log(JSON.stringify(items, null, 2));
    
    console.log("\n📸 Media Info:");
    console.log("  Type:", items.__typename);
    console.log("  Shortcode:", items.shortcode);
    console.log("  Is Video:", items.is_video);
    console.log("  Dimensions:", items.dimensions);
    
    if (items.is_video) {
      console.log("\n🎥 Video URL:", items.video_url?.substring(0, 80) + "...");
      console.log("  Duration:", items.video_duration, "seconds");
      console.log("  Views:", items.video_view_count || items.video_play_count);
    } else {
      console.log("\n🖼️ Image URL:", items.display_url?.substring(0, 80) + "...");
    }
    
    // Check carousel
    if (items.edge_sidecar_to_children && items.edge_sidecar_to_children.edges) {
      console.log(`\n📚 Carousel: ${items.edge_sidecar_to_children.edges.length} items`);
      items.edge_sidecar_to_children.edges.forEach((edge, idx) => {
        const node = edge.node;
        console.log(`  [${idx + 1}] ${node.is_video ? 'Video' : 'Image'} - ${node.display_url?.substring(0, 60)}...`);
      });
    }
    
    console.log("\n👤 Owner:");
    console.log("  Username:", items.owner?.username);
    console.log("  Full Name:", items.owner?.full_name);
    console.log("  Verified:", items.owner?.is_verified);
    
    console.log("\n💬 Caption:");
    const caption = items.edge_media_to_caption?.edges[0]?.node?.text || "(no caption)";
    console.log("  ", caption.substring(0, 100) + (caption.length > 100 ? "..." : ""));
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response data:", JSON.stringify(error.response.data, null, 2));
    }
    console.error("\nStack trace:");
    console.error(error.stack);
  }
}

// Ambil URL dari argument
const url = process.argv[2];

if (!url) {
  console.log("❌ URL tidak diberikan!");
  console.log("\nContoh penggunaan:");
  console.log("  node test-graphql.js https://www.instagram.com/p/ABC123/");
  console.log("  node test-graphql.js https://www.instagram.com/reel/XYZ456/");
  process.exit(1);
}

// Jalankan test
testInstagramGraphQL(url);
