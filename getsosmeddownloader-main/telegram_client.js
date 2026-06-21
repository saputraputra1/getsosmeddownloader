/**
 * Telegram Client Module - GramJS Implementation
 * Berinteraksi dengan Telegram Bot untuk extract download links
 * Menggunakan MTProto (user session) untuk interact langsung dengan bot
 */

require('dotenv').config();
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SESSION_FILE = path.join(__dirname, 'telegram_session.json');

class TelegramBotClient {
  constructor() {
    this.apiId = parseInt(process.env.TELEGRAM_API_ID) || 0;
    this.apiHash = process.env.TELEGRAM_API_HASH || '';
    this.client = null;
    this.sessionData = null;
    this._loadSession();
  }

  _loadSession() {
    try {
      // Priority 1: TELEGRAM_SESSION env var (Railway/cloud deployment)
      if (process.env.TELEGRAM_SESSION) {
        this.sessionData = {
          stringSession: process.env.TELEGRAM_SESSION,
          phone: process.env.TELEGRAM_PHONE || null,
          apiId: this.apiId,
          createdAt: null,
          source: 'env'
        };
        console.log('[Telegram] Session loaded from TELEGRAM_SESSION env var (Railway mode)');
        return;
      }
      // Priority 2: telegram_session.json file (local development)
      if (fs.existsSync(SESSION_FILE)) {
        this.sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        console.log('[Telegram] Session data loaded from file');
      }
    } catch (err) {
      console.warn('[Telegram] Failed to load session:', err.message);
    }
  }

  _saveSession(stringSession, phone) {
    try {
      this.sessionData = { stringSession, phone, apiId: this.apiId, createdAt: new Date().toISOString() };
      // Only save to file if not in env-var mode (Railway)
      if (!process.env.TELEGRAM_SESSION) {
        fs.writeFileSync(SESSION_FILE, JSON.stringify(this.sessionData, null, 2));
        console.log('[Telegram] Session saved to file');
      }
      // Always print session string so user can copy to Railway
      console.log('[Telegram] Session string (copy to Railway TELEGRAM_SESSION env var):');
      console.log(stringSession);
    } catch (err) {
      console.error('[Telegram] Failed to save session:', err.message);
    }
  }

  parseBotUrl(url) {
    try {
      const parsed = new URL(url);
      const botUsername = parsed.pathname.replace(/^\//, '').replace(/\/$/, '');
      const startParam = parsed.searchParams.get('start');
      let decodedParam = null;
      if (startParam) {
        try { decodedParam = Buffer.from(startParam, 'base64').toString('utf8'); }
        catch (e) { decodedParam = startParam; }
      }
      return { botUsername, startParam, decodedParam, fullUrl: url };
    } catch (err) {
      throw new Error('Invalid Telegram URL');
    }
  }

  async _connect() {
    if (this.client && this.client.connected) return this.client;
    if (!this.apiId || !this.apiHash) {
      throw new Error('TELEGRAM_API_ID dan TELEGRAM_API_HASH belum diset di .env');
    }
    const stringSession = this.sessionData?.stringSession || '';
    this.client = new TelegramClient(new StringSession(stringSession), this.apiId, this.apiHash, { connectionRetries: 3, useWSS: false });
    await this.client.connect();
    console.log('[Telegram] Connected to Telegram servers');
    const me = await this.client.getMe();
    if (!me) throw new Error('Session tidak valid atau expired.');
    console.log(`[Telegram] Logged in as: ${me.firstName || me.username || me.id}`);
    return this.client;
  }

  async setupNewSession(phoneNumber) {
    if (!this.apiId || !this.apiHash) throw new Error('Set TELEGRAM_API_ID dan TELEGRAM_API_HASH di .env');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    const client = new TelegramClient(new StringSession(''), this.apiId, this.apiHash, { connectionRetries: 3, useWSS: false });
    await client.connect();
    try {
      const phone = phoneNumber.startsWith('+') ? phoneNumber : '+' + phoneNumber;
      const sendCodeResult = await client.sendCode({ apiId: this.apiId, apiHash: this.apiHash }, phone);
      console.log(`[Telegram] Kode OTP dikirim ke ${phone}`);
      const code = await ask('[Telegram] Masukkan kode OTP: ');
      rl.close();
      await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash: sendCodeResult.phoneCodeHash, phoneCode: code }));
      const stringSession = client.session.save();
      this._saveSession(stringSession, phone);
      console.log('[Telegram] ✅ Login berhasil! Session disimpan.');
      return { success: true, message: 'Login berhasil! Session tersimpan.' };
    } catch (err) {
      rl.close();
      console.error('[Telegram] Login gagal:', err.message);
      throw err;
    }
  }

  _getSenderId(msg) {
    if (msg.fromId) {
      if (typeof msg.fromId === 'object') {
        return (msg.fromId.userId || msg.fromId.channelId || msg.fromId.chatId || '').toString();
      }
      return msg.fromId.toString();
    }
    if (msg.peerId) {
      if (typeof msg.peerId === 'object') {
        return (msg.peerId.userId || msg.peerId.channelId || msg.peerId.chatId || '').toString();
      }
      return msg.peerId.toString();
    }
    return 'unknown';
  }

  _findCallbackButton(messages, keywords = ['coba', 'try', 'again', 'lanjut', 'get', 'download', 'mulai', 'start']) {
    for (const msg of messages) {
      if (msg.replyMarkup && msg.replyMarkup.rows) {
        for (const row of msg.replyMarkup.rows) {
          if (row.buttons) {
            for (const btn of row.buttons) {
              if (btn.data) {
                const btnText = (btn.text || '').toLowerCase();
                if (keywords.some(kw => btnText.includes(kw))) {
                  return { msg, btn };
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  async downloadViaBot(botInfo) {
    const { botUsername, decodedParam } = botInfo;
    console.log(`[Telegram] Attempting to download via bot: ${botUsername}`);
    console.log(`[Telegram] Decoded parameter: ${decodedParam}`);

    if (!this.sessionData?.stringSession) {
      return {
        success: false, type: 'requires_interaction', message: 'Perlu login ke Telegram untuk download dari bot ini',
        botInfo, instructions: { step1: 'Jalankan: node tg-login-fast.js', step2: 'Masukkan OTP dari HP', step3: 'Setelah login, coba download lagi', note: 'Login cukup sekali saja' }
      };
    }

    try {
      const client = await this._connect();
      let botEntity;
      try { botEntity = await client.getEntity(botUsername); }
      catch (e) { throw new Error(`Bot ${botUsername} tidak ditemukan: ${e.message}`); }

      console.log(`[Telegram] Bot found: ${botEntity.username}`);

      // Helper: send /start and wait for response
      const sendStartAndWait = async () => {
        // Telegram mengirim startParam apa adanya (base64) ke bot, bukan decoded version
        const startMsg = botInfo.startParam ? `/start ${botInfo.startParam}` : '/start';
        console.log(`[Telegram] Sending: ${startMsg}`);
        const sentMsg = await client.sendMessage(botEntity, { message: startMsg });
        const sentMsgId = sentMsg ? sentMsg.id : 0;
        console.log(`[Telegram] Sent message ID: ${sentMsgId}`);
        const msgs = await this._waitForBotMessages(client, botEntity, 25000, sentMsgId);
        return msgs;
      };

      // Step 1: Send /start
      let messages = await sendStartAndWait();
      if (messages.length === 0) throw new Error('Bot tidak merespon dalam 25 detik');

      // Step 2: Check for media
      let mediaItems = await this._extractMediaFromMessages(client, messages);
      if (mediaItems.length > 0) {
        console.log(`[Telegram] ✅ Found ${mediaItems.length} media item(s) from bot`);
        return { success: true, type: 'direct', url: mediaItems[0].url, mediaItems, botInfo, source: 'telegram_bot' };
      }

      // Step 3: Extract channel links from buttons and text
      const lastText = messages.map(m => m.message || '').join('\n');
      console.log(`[Telegram] Bot response: ${lastText.substring(0, 200)}`);

      const channelLinks = [];
      for (const msg of messages) {
        if (msg.replyMarkup && msg.replyMarkup.rows) {
          for (const row of msg.replyMarkup.rows) {
            if (row.buttons) {
              for (const btn of row.buttons) {
                if (btn.url) {
                  const publicMatch = btn.url.match(/t\.me\/([\w]+)$/);
                  if (publicMatch && publicMatch[1] !== botUsername) {
                    channelLinks.push({ type: 'public', username: publicMatch[1] });
                    console.log(`[Telegram] Button public channel: @${publicMatch[1]}`);
                  }
                  const privateMatch = btn.url.match(/t\.me\/\+([\w-]+)/);
                  if (privateMatch) {
                    channelLinks.push({ type: 'invite', url: btn.url, hash: privateMatch[1] });
                    console.log(`[Telegram] Button private invite: ${btn.url}`);
                  }
                }
              }
            }
          }
        }
        if (msg.message) {
          const textLinks = msg.message.match(/t\.me\/[\w]+/g) || [];
          for (const link of textLinks) {
            const m = link.match(/t\.me\/([\w]+)/);
            if (m && m[1] !== botUsername) channelLinks.push({ type: 'public', username: m[1] });
          }
        }
      }

      const uniqueChannels = channelLinks.filter((item, idx, self) =>
        idx === self.findIndex(t => (t.url && t.url === item.url) || (t.username && t.username === item.username))
      );

      // Step 4: Save the "Coba Lagi" button from initial messages BEFORE joining
      let retryButton = this._findCallbackButton(messages);
      if (retryButton) {
        console.log(`[Telegram] Found retry button early: "${retryButton.btn.text}"`);
      }

      // Step 5: Join channels if needed
      if (uniqueChannels.length > 0) {
        console.log(`[Telegram] Found ${uniqueChannels.length} channel(s) to join`);

        for (const ch of uniqueChannels) {
          try {
            if (ch.type === 'public') {
              console.log(`[Telegram] Joining @${ch.username}...`);
              const entity = await client.getEntity(ch.username);
              await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
              console.log(`[Telegram] ✅ Joined @${ch.username}`);
            } else if (ch.type === 'invite') {
              console.log(`[Telegram] Joining via invite: ${ch.url}`);
              await client.invoke(new Api.messages.ImportChatInvite({ hash: ch.hash }));
              console.log(`[Telegram] ✅ Joined via invite link`);
            }
            await new Promise(r => setTimeout(r, 1500));
          } catch (joinErr) {
            const errMsg = joinErr.message || joinErr.errorMessage || '';
            if (errMsg.includes('USER_ALREADY_PARTICIPANT')) {
              console.log(`[Telegram] Already member`);
            } else if (errMsg.includes('INVITE_HASH_EXPIRED')) {
              console.warn(`[Telegram] Invite link expired`);
            } else {
              console.warn(`[Telegram] Failed to join: ${errMsg.substring(0, 100)}`);
            }
          }
        }

        console.log(`[Telegram] Waiting 3s after joining...`);
        await new Promise(r => setTimeout(r, 3000));
      }

      // Step 6: Try clicking "Coba Lagi" button if found
      let retryMessages = [];
      if (retryButton) {
        console.log(`[Telegram] Clicking button: "${retryButton.btn.text}"...`);
        try {
          await client.invoke(
            new Api.messages.GetBotCallbackAnswer({
              peer: botEntity,
              msgId: retryButton.msg.id,
              data: retryButton.btn.data,
            })
          );
          console.log(`[Telegram] ✅ Button clicked! Waiting for response...`);
          const maxMsgId = messages.reduce((max, m) => Math.max(max, m.id), 0);
          retryMessages = await this._waitForBotMessages(client, botEntity, 20000, maxMsgId);
        } catch (cbErr) {
          console.warn(`[Telegram] Button click failed: ${cbErr.message}`);
        }
      }

      // Step 7: If no button or button failed, resend /start
      if (retryMessages.length === 0) {
        console.log(`[Telegram] Resending /start after joining...`);
        messages = await sendStartAndWait();
        retryMessages = messages;

        // Check for "Coba Lagi" button AGAIN in new messages
        retryButton = this._findCallbackButton(retryMessages);
        if (retryButton) {
          console.log(`[Telegram] Found retry button in new messages: "${retryButton.btn.text}"`);
          console.log(`[Telegram] Clicking button: "${retryButton.btn.text}"...`);
          try {
            await client.invoke(
              new Api.messages.GetBotCallbackAnswer({
                peer: botEntity,
                msgId: retryButton.msg.id,
                data: retryButton.btn.data,
              })
            );
            console.log(`[Telegram] ✅ Button clicked! Waiting for response...`);
            const maxMsgId2 = retryMessages.reduce((max, m) => Math.max(max, m.id), 0);
            retryMessages = await this._waitForBotMessages(client, botEntity, 20000, maxMsgId2);
          } catch (cbErr2) {
            console.warn(`[Telegram] Button click failed: ${cbErr2.message}`);
          }
        }
      }

      // Step 8: Extract media from retry messages
      mediaItems = await this._extractMediaFromMessages(client, retryMessages);
      if (mediaItems.length > 0) {
        console.log(`[Telegram] ✅ Found ${mediaItems.length} media item(s) after joining!`);
        return { success: true, type: 'direct', url: mediaItems[0].url, mediaItems, botInfo, source: 'telegram_bot' };
      }

      // Step 9: If still no media, log what we got
      const retryText = retryMessages.map(m => m.message || '').join('\n');
      console.log(`[Telegram] Retry response: ${retryText.substring(0, 200)}`);

      // Check for more channels in retry messages and try one more time
      const moreChannels = [];
      for (const msg of retryMessages) {
        if (msg.replyMarkup && msg.replyMarkup.rows) {
          for (const row of msg.replyMarkup.rows) {
            if (row.buttons) {
              for (const btn of row.buttons) {
                if (btn.url) {
                  const privateMatch = btn.url.match(/t\.me\/\+([\w-]+)/);
                  if (privateMatch) {
                    moreChannels.push({ type: 'invite', url: btn.url, hash: privateMatch[1] });
                    console.log(`[Telegram] New private invite: ${btn.url}`);
                  }
                }
              }
            }
          }
        }
      }

      if (moreChannels.length > 0) {
        for (const ch of moreChannels) {
          try {
            await client.invoke(new Api.messages.ImportChatInvite({ hash: ch.hash }));
            console.log(`[Telegram] ✅ Joined additional channel`);
          } catch (e) {}
          await new Promise(r => setTimeout(r, 1000));
        }
        await new Promise(r => setTimeout(r, 3000));

        // Click button or resend /start one final time
        const finalButton = this._findCallbackButton([...messages, ...retryMessages]);
        let finalMessages = [];
        if (finalButton) {
          try {
            await client.invoke(new Api.messages.GetBotCallbackAnswer({ peer: botEntity, msgId: finalButton.msg.id, data: finalButton.btn.data }));
            console.log(`[Telegram] ✅ Final button clicked!`);
            const maxId = retryMessages.reduce((max, m) => Math.max(max, m.id), 0);
            finalMessages = await this._waitForBotMessages(client, botEntity, 20000, maxId);
          } catch (e) {}
        }
        if (finalMessages.length === 0) {
          finalMessages = await sendStartAndWait();
        }

        mediaItems = await this._extractMediaFromMessages(client, finalMessages);
        if (mediaItems.length > 0) {
          console.log(`[Telegram] ✅ Found ${mediaItems.length} media item(s) on final retry!`);
          return { success: true, type: 'direct', url: mediaItems[0].url, mediaItems, botInfo, source: 'telegram_bot' };
        }
      }

      return { success: false, type: 'no_media', message: `Bot merespon tapi tidak mengirim file.\nRespons: ${retryText.substring(0, 300) || lastText.substring(0, 300)}`, botInfo };
    } catch (err) {
      console.error('[Telegram] Bot interaction error:', err.message);
      throw err;
    }
  }

  _logMediaInfo(msg) {
    const types = [];
    if (msg.video) types.push(`video(${msg.video.w}x${msg.video.h}, ${msg.video.duration}s)`);
    if (msg.document) types.push(`document(${msg.document.mimeType}, ${(msg.document.size || 0) / 1024 / 1024}MB)`);
    if (msg.photo) types.push('photo');
    if (msg.audio) types.push('audio');
    if (msg.webpage) types.push(`webpage(${msg.webpage.url || msg.webpage.displayUrl || ''})`);
    if (msg.replyMarkup && msg.replyMarkup.rows) {
      const btns = [];
      for (const row of msg.replyMarkup.rows) {
        if (row.buttons) {
          for (const btn of row.buttons) {
            if (btn.url) btns.push(`url:${btn.text}`);
            if (btn.data) btns.push(`cb:${btn.text}`);
          }
        }
      }
      if (btns.length) types.push(`buttons[${btns.join(', ')}]`);
    }
    return types.length > 0 ? types.join(', ') : 'text-only';
  }

  async _extractMediaFromMessages(client, messages) {
    const mediaItems = [];
    for (const msg of messages) {
      const mediaType = msg.video ? 'video' : msg.document ? 'document' : msg.photo ? 'photo' : null;
      if (mediaType) {
        console.log(`[Telegram] Downloading media from msg ${msg.id}: ${this._logMediaInfo(msg)}`);
        const fileUrl = await this._getFileUrl(client, msg);
        if (fileUrl) {
          if (msg.video) {
            mediaItems.push({ type: 'video', url: fileUrl, thumbnail: null, width: msg.video.w || null, height: msg.video.h || null, duration: msg.video.duration || null, ext: 'mp4', formats: [{ type: 'video', quality: 'Original', url: fileUrl, ext: 'mp4' }] });
          } else if (msg.document) {
            const mime = msg.document.mimeType || 'video/mp4';
            const ext = mime.includes('video') ? 'mp4' : mime.includes('audio') ? 'mp3' : 'file';
            mediaItems.push({ type: mime.includes('video') ? 'video' : mime.includes('audio') ? 'audio' : 'file', url: fileUrl, thumbnail: null, width: null, height: null, duration: null, ext, formats: [{ type: mime.includes('video') ? 'video' : 'file', quality: 'Original', url: fileUrl, ext }] });
          } else if (msg.photo) {
            mediaItems.push({ type: 'image', url: fileUrl, thumbnail: fileUrl, width: null, height: null, duration: null, ext: 'jpg', formats: [{ type: 'image', quality: 'Original', url: fileUrl, ext: 'jpg' }] });
          }
        }
      }
      // Cek webpage (link preview) yang mungkin berisi link download
      if (msg.webpage && msg.webpage.url) {
        console.log(`[Telegram] Webpage found in msg ${msg.id}: ${msg.webpage.url}`);
        mediaItems.push({ type: 'link', url: msg.webpage.url, thumbnail: null, ext: null, source: 'webpage' });
      }
      // Cek inline buttons dengan URL download
      if (msg.replyMarkup && msg.replyMarkup.rows) {
        for (const row of msg.replyMarkup.rows) {
          if (row.buttons) {
            for (const btn of row.buttons) {
              if (btn.url && !btn.url.includes('t.me/')) {
                console.log(`[Telegram] Button URL in msg ${msg.id}: ${btn.text} -> ${btn.url}`);
                mediaItems.push({ type: 'link', url: btn.url, thumbnail: null, ext: null, source: 'button', label: btn.text });
              }
            }
          }
        }
      }
    }
    return mediaItems;
  }

  async _waitForBotMessages(client, botEntity, timeoutMs, minMsgId = 0) {
    const messages = [];
    const startTime = Date.now();
    const botPeerId = botEntity.id ? botEntity.id.toString() : null;

    console.log(`[Telegram] Waiting for bot response (peerId=${botPeerId}, minMsgId=${minMsgId})`);

    const pollInterval = 1500;
    const maxPolls = Math.ceil(timeoutMs / pollInterval);
    
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, pollInterval));
      
      try {
        const result = await client.invoke(
          new Api.messages.GetHistory({
            peer: botEntity,
            limit: 15,
            offsetId: 0,
            offsetDate: 0,
            addOffset: 0,
            maxId: 0,
            minId: 0,
            hash: BigInt(0),
          })
        );
        
        const msgs = result.messages || [];
        console.log(`[Telegram] Poll ${i+1}: got ${msgs.length} messages`);
        
        for (const msg of msgs) {
          const senderId = this._getSenderId(msg);
          const msgId = msg.id;
          const isNew = minMsgId ? msgId > minMsgId : true;
          const isOut = msg.out === true;
          
          console.log(`[Telegram]   id=${msgId}, fromId=${senderId}, out=${isOut}, isNew=${isNew}`);
          
          if (!isOut && isNew && senderId === botPeerId) {
            messages.push(msg);
            const mediaInfo = this._logMediaInfo(msg);
            console.log(`[Telegram] ✅ Matched NEW bot msg: id=${msgId}, text=${(msg.message || '').substring(0, 80)}, media=[${mediaInfo}]`);
          }
        }
        
        if (messages.length > 0) break;
      } catch (e) {
        console.warn(`[Telegram] GetHistory error: ${e.message}`);
      }
    }

    if (messages.length === 0) {
      console.log(`[Telegram] ❌ No NEW bot messages found after ${Math.round((Date.now() - startTime)/1000)}s`);
    }

    return messages;
  }

  async _getFileUrl(client, msg) {
    const startTime = Date.now();
    try {
      console.log(`[Telegram] Starting download msg ${msg.id}...`);
      let downloaded = 0;
      const buffer = await client.downloadMedia(msg, {
        fileSize: 100 * 1024 * 1024, // 100MB max
        progressCallback: (progress) => {
          downloaded = Number(progress);
          const mb = (downloaded / 1024 / 1024).toFixed(1);
          if (downloaded % (512 * 1024) < 131072) { // Log every ~512KB
            console.log(`[Telegram] Download progress: ${mb} MB`);
          }
        }
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (buffer) {
        const tempDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const mime = msg.document?.mimeType || (msg.video ? 'video/mp4' : 'image/jpeg');
        const extMap = { 'video/mp4': 'mp4', 'video/x-matroska': 'mkv', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'image/jpeg': 'jpg', 'image/png': 'png' };
        const ext = extMap[mime] || 'file';
        const filename = `tg_${Date.now()}_${msg.id}.${ext}`;
        fs.writeFileSync(path.join(tempDir, filename), buffer);
        const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
        console.log(`[Telegram] ✅ Downloaded ${sizeMB} MB in ${elapsed}s -> ${filename}`);
        return `/api/file/${filename}`;
      }
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.warn(`[Telegram] Download failed after ${elapsed}s: ${err.message}`);
    }
    return null;
  }

  getSessionStatus() {
    return {
      hasSession: !!this.sessionData?.stringSession,
      phone: this.sessionData?.phone || null,
      apiId: this.apiId || null,
      hasApiCredentials: !!(this.apiId && this.apiHash),
      createdAt: this.sessionData?.createdAt || null,
      source: this.sessionData?.source || (this.sessionData?.stringSession ? 'file' : null),
      railwayReady: !!(this.apiId && this.apiHash && this.sessionData?.stringSession)
    };
  }
}

const botClient = new TelegramBotClient();

module.exports = {
  TelegramBotClient, telegramClient: botClient,
  parseTelegramUrl: (url) => botClient.parseBotUrl(url),
  downloadFromTelegram: (url, options) => botClient.downloadViaBot(botClient.parseBotUrl(url), options),
  setupTelegramSession: (phone) => botClient.setupNewSession(phone),
  getTelegramSessionStatus: () => botClient.getSessionStatus(),
  connectTelegram: () => botClient._connect()
};
