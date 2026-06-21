/**
 * Test download dari Telegram via API
 * Simulasi request yang sama dengan frontend
 */

const axios = require('axios');

const URL = 'https://t.me/mediaterkinibot?start=Z2V0LTY0MjQzNjQzMTA1NjAw';
const API_BASE = 'http://localhost:5000';

async function test() {
  console.log('=== Test Telegram Download via API ===\n');
  console.log('URL:', URL);
  console.log('API:', API_BASE + '/api/fetch\n');

  try {
    // Check server status first
    console.log('1. Checking server...');
    try {
      await axios.get(API_BASE, { timeout: 3000 });
      console.log('   ✅ Server is running\n');
    } catch (e) {
      console.log('   ❌ Server not running! Start server first: npm start\n');
      return;
    }

    // Check Telegram session status
    console.log('2. Checking Telegram session...');
    try {
      const sessionResp = await axios.get(`${API_BASE}/api/telegram/status`, { timeout: 5000 });
      const session = sessionResp.data.data;
      if (session.hasSession) {
        console.log(`   ✅ Session active: ${session.phone}\n`);
      } else {
        console.log('   ⚠️  No session yet. Download will show setup instructions.\n');
      }
    } catch (e) {
      console.log('   ⚠️  Could not check session status\n');
    }

    // Try download
    console.log('3. Sending download request...');
    console.log('   (This may take a few seconds...)\n');
    
    const resp = await axios.post(
      `${API_BASE}/api/fetch`,
      { url: URL },
      { 
        timeout: 120000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log('   Status:', resp.status);
    console.log('   Response:', JSON.stringify(resp.data, null, 2));

    if (resp.data.success) {
      console.log('\n✅ Download SUCCESS!');
      if (resp.data.data && resp.data.data.length > 0) {
        const item = resp.data.data[0];
        console.log(`   Platform: ${item.platform}`);
        console.log(`   Type: ${item.type}`);
        console.log(`   Source: ${item.source}`);
        if (item.mediaItems && item.mediaItems.length > 0) {
          item.mediaItems.forEach((media, i) => {
            console.log(`   Media ${i+1}: ${media.url?.substring(0, 80)}...`);
          });
        }
      }
    } else {
      console.log('\n⚠️  Download returned error:');
      console.log('   Error:', resp.data.error);
    }

  } catch (err) {
    if (err.response) {
      console.log('\n❌ API Error:', err.response.status);
      console.log('   Response:', JSON.stringify(err.response.data, null, 2));
      
      if (err.response.data.error) {
        console.log('\n   Error Message:', err.response.data.error.substring(0, 300));
      }
    } else if (err.code === 'ECONNREFUSED') {
      console.log('\n❌ Server not running!');
      console.log('   Start server: npm start');
    } else {
      console.log('\n❌ Error:', err.message);
    }
  }

  console.log('\n=== Test Selesai ===');
}

test().catch(console.error);
