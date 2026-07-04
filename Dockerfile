FROM node:22-alpine

WORKDIR /app

# Install dependencies (only re-runs when package.json changes)
COPY proxy-server/package.json proxy-server/package-lock.json ./proxy-server/
RUN cd proxy-server && npm ci --omit=dev

# Copy source code
COPY proxy-server/         ./proxy-server/
COPY chrome-kakucyo/       ./chrome-kakucyo/
COPY guide-package.schema.json ./

WORKDIR /app/proxy-server

EXPOSE 8080

ENV PORT=8080

CMD ["node", "server.js"]
