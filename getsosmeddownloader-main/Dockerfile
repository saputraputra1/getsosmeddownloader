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
RUN pip3 install --no-cache-dir -U yt-dlp instaloader

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application
COPY . .

# Install Playwright Chromium browser (for Instagram/Pinterest scraping)
RUN npx playwright install chromium --with-deps

# Expose port (Railway/Render/HuggingFace can overwrite this)
EXPOSE 3000

ENV PORT=3000

# Update yt-dlp at startup (Instagram sering ganti format)
CMD ["sh", "-c", "yt-dlp -U --quiet 2>/dev/null || true && node server.js"]
