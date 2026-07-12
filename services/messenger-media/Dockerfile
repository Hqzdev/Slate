FROM node:22.22.0-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg poppler-utils qpdf tini unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
