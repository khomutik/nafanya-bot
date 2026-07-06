FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --package-lock=false; fi

COPY --chown=pwuser:pwuser src ./src
COPY --chown=pwuser:pwuser assets ./assets
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg xvfb xauth x11-utils \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -y -loop 1 -i /app/assets/nafanya-avatar.png \
    -vf "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:color=0x161616,format=yuv420p" \
    -frames:v 30 -r 10 -f yuv4mpegpipe /app/assets/nafanya-avatar.y4m

CMD ["sh", "-lc", "mkdir -p /home/pwuser/.nafanya-zoom-profile && find /home/pwuser/.nafanya-zoom-profile -name 'Singleton*' -delete && chown -R pwuser:pwuser /home/pwuser/.nafanya-zoom-profile && su -s /bin/sh pwuser -c 'Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & export DISPLAY=:99; for i in $(seq 1 30); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.2; done; node src/main.mjs'"]
