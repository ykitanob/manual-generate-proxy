# Proxy Server Setup Guide

This guide covers the procedures for building and starting the guide injection proxy server (`proxy-server/server.js`).

---

## 1. Overview

This is a local development server that delivers external sites (such as TogoDX, Nanbyo Data, NBRC, etc.) via an HTTP proxy and injects a Driver.js-based guide UI into the pages.

- Runtime: **Node.js** (minimal additional libraries)
- Dependencies: `ajv`, `ajv-formats` (for guide JSON schema validation)
- Execution Environment: **Assumes execution on WSL (Ubuntu, etc.)**

---

## 2. Prerequisites

| Item | Requirement |
|---|---|
| Node.js | v18 or higher recommended (uses `fetch` / ES2020+ syntax) |
| npm | Version bundled with Node.js is fine |
| OS | WSL2 (Ubuntu) recommended. Can also run on native Windows |

Checking Node.js:
```bash
node -v
npm -v
```

---

## 3. Install Dependencies

```bash
cd /mnt/c/Users/ykita/20260629-navitest/proxy-server
npm install
```

This will install `ajv` and `ajv-formats`.

---

## 4. Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | Optional | `8080` | Server listening port (uses `18080` for production) |
| `GEMINI_API_KEY` | Optional | None | Set this only if using Gemini for AI guide selection |

> If using Ollama, environment variables are not required as `ollamaUri` and `modelName` are passed to the runtime via the API (`/api/ollama-guide`).

---

## 5. Starting the Server

### Basic (Foreground execution - Recommended)

Run the following in the WSL shell:

```bash
cd /mnt/c/Users/ykita/20260629-navitest
PORT=18080 node proxy-server/server.js
```

Upon successful startup, you should see:

```
Guide proxy is running at http://localhost:18080
Using Ollama for guide selection
```

Stop with `Ctrl + C`.

> **Note:** Running in the background with `nohup` or `setsid` via a BFS-based one-shot command might result in the process being killed when the session ends. Foreground execution is the most stable.

### Using a Startup Script

You can use the included [start-proxy.sh](proxy-server/start-proxy.sh) (WSL/bash).

```bash
cd /mnt/c/Users/ykita/20260629-navitest/proxy-server
./start-proxy.sh          # Starts with PORT=18080
PORT=9000 ./start-proxy.sh  # To change the port
```

Make sure to give it execution permissions the first time:
```bash
chmod +x proxy-server/start-proxy.sh
```

---

## 6. Verification

After starting the server, verify using another shell.

### Guide List API

```bash
curl -s http://localhost:18080/api/guides | head -c 400
```

`{"count":N,"guides":[...]}` が返れば OK。

### プロキシ経由のページ取得

```bash
curl -s "http://localhost:18080/proxy?url=https%3A%2F%2Fnanbyodata.jp%2F" | head -c 200
```

### ES module import 書き換えの確認

```bash
curl -s "http://localhost:18080/proxy?url=https%3A%2F%2Fnanbyodata.jp%2Fstatic%2Fjs%2Fmain.js" | grep navigation
```

`from "http://localhost:18080/proxy?url=...navigation.js"` のように
**絶対プロキシ URL に書き換わっていれば成功**です。

### ブラウザでの利用

```
http://localhost:18080/proxy?url=<対象サイトのURL>
```

例:
```
http://localhost:18080/proxy?url=https://nanbyodata.jp/
```

---

## 7. コード変更を反映する手順

Node.js はホットリロードしないため、`server.js` や `static/*.js` を編集したら
**サーバーを再起動**してください。

```
Ctrl + C            # 停止
PORT=18080 node proxy-server/server.js   # 再起動
```

> `static/inject.js` / `static/inject.css` / `static/interceptor.js` は
> 静的配信のため、サーバー再起動後にブラウザをリロードすれば反映されます。

---

## 8. ディレクトリ構成

```
proxy-server/
├── server.js                    # プロキシ本体
├── package.json
├── validate-guide.js            # ガイド JSON のスキーマ検証
├── guide-selection-prompt.json  # Prompt settings for AI guide selection
├── start-proxy.sh               # 起動スクリプト（WSL/bash）
└── static/
    ├── inject.js                # ページ注入スクリプト（ガイド UI 制御）
    ├── inject.css               # 注入スタイル
    └── interceptor.js           # fetch / XHR インターセプター

（リポジトリ直下）
├── guide-patterns.json          # NBRC / NanbyoData 向けガイド定義
└── togodx_guide-patterns.json   # TogoDX 向けガイド定義
```

---

## 9. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| ガイドボタンが表示されない | `/api/guides` が取得できていない / JSON に BOM | JSON の BOM を除去（`server.js` は BOM 除去対応済み）。サーバー再起動 |
| ドロップダウン等が動かない | ES module の相対 import が解決できていない | サーバーを最新コードで再起動（import 書き換え機能が必要） |
| `Uncaught SyntaxError` | 旧バージョンのインラインスクリプト | 最新コードに更新してサーバー再起動 |
| ポートが使用中 | 別プロセスが同ポートを使用 | `PORT` を変更するか、既存プロセスを停止 |
| コード変更が反映されない | サーバー未再起動 | `Ctrl+C` → 再起動 |

稼働中プロセスの確認:
```bash
ps aux | grep server.js | grep -v grep
ss -ltn | grep 18080
```
