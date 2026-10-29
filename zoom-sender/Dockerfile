FROM node:22-bookworm-slim AS browser-base

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev \
  && npx playwright install --with-deps --no-shell chromium \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node src ./src

RUN mkdir -p /app/profile /app/diagnostics \
  && chown -R node:node /app/profile /app/diagnostics

USER node

FROM browser-base AS runtime

EXPOSE 3097

CMD ["sh", "-lc", "rm -f /tmp/.X99-lock /tmp/.X11-unix/X99; Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & export DISPLAY=:99; sleep 1; exec node src/main.mjs"]

FROM browser-base AS auth

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends novnc websockify xvfb xauth x11-utils x11vnc \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /tmp/.X11-unix \
  && chmod 1777 /tmp/.X11-unix

USER node

EXPOSE 6080

CMD ["sh", "-lc", "rm -f /tmp/.X99-lock /tmp/.X11-unix/X99; Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & export DISPLAY=:99; for i in $(seq 1 30); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.2; done; x11vnc -display :99 -forever -shared -localhost -nopw -rfbport 5900 -o /tmp/x11vnc.log >/dev/null 2>&1 & websockify --web=/usr/share/novnc 0.0.0.0:6080 localhost:5900 >/tmp/websockify.log 2>&1 & exec node src/auth-setup.mjs"]
