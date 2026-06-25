FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --package-lock=false; fi

COPY src ./src

USER node
CMD ["node", "src/main.mjs"]
