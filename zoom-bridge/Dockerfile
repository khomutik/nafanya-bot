FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --package-lock=false; fi

COPY --chown=pwuser:pwuser src ./src

USER pwuser
CMD ["node", "src/main.mjs"]
