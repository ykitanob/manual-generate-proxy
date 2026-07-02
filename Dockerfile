FROM node:22-alpine

WORKDIR /app

# 依存インストール（package.json が変わった時だけ再実行される）
COPY proxy-server/package.json proxy-server/package-lock.json ./proxy-server/
RUN cd proxy-server && npm ci --omit=dev

# ソースをコピー
COPY proxy-server/         ./proxy-server/
COPY chrome-kakucyo/       ./chrome-kakucyo/
COPY guide-package.schema.json ./

WORKDIR /app/proxy-server

EXPOSE 8080

ENV PORT=8080

CMD ["node", "server.js"]
