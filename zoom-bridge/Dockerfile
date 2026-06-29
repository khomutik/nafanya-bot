FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --package-lock=false; fi

COPY --chown=pwuser:pwuser src ./src

CMD ["sh", "-lc", "mkdir -p /home/pwuser/.nafanya-zoom-profile && chown -R pwuser:pwuser /home/pwuser/.nafanya-zoom-profile && su -s /bin/sh pwuser -c 'Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & export DISPLAY=:99; node src/main.mjs'"]
