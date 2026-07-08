FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xvfb xauth x11-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev \
  && npx playwright install --with-deps chromium \
  && npm cache clean --force

COPY . .

RUN mkdir -p /app/profile \
  && chown -R node:node /app /ms-playwright

USER node

EXPOSE 3097

CMD ["sh", "-lc", "if [ \"${HEADLESS:-${ZOOM_SENDER_HEADLESS:-true}}\" = \"false\" ]; then Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & export DISPLAY=:99; for i in $(seq 1 30); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.2; done; fi; node src/main.mjs"]
