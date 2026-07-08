FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
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

CMD ["node", "src/main.mjs"]
