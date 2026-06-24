FROM node:20-bookworm-slim

# Install Python, pip, ffmpeg, curl
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment and install yt-dlp + instaloader
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir -U yt-dlp instaloader pytubefix

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Create downloads directory for Telegram file serving
RUN mkdir -p /app/downloads

# Install Playwright Chromium browser (for Instagram/Pinterest scraping)
RUN npx playwright install chromium --with-deps

# Expose port (Railway/Render/HuggingFace can overwrite this)
EXPOSE 3000

ENV PORT=3000

# Buat folder cookies untuk YouTube cookies
RUN mkdir -p /app/cookies

# Update yt-dlp & pytubefix di startup, lalu jalankan server
CMD ["sh", "-c", "\
  echo '[Startup] Mengupdate yt-dlp...' && \
  yt-dlp -U 2>&1 | tail -1 || true && \
  echo '[Startup] Mengupdate pytubefix...' && \
  pip install -U pytubefix --quiet 2>&1 | tail -1 && \
  echo '[Startup] Versi pytubefix:' && \
  python3 -c 'import pytubefix; print(pytubefix.__version__)' 2>/dev/null || true && \
  echo '[Startup] Versi yt-dlp:' && \
  yt-dlp --version 2>/dev/null || true && \
  echo '[Startup] Server starting...' && \
  node server.js"]
