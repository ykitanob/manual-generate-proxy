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

Success if `{"count":N,"guides":[...]}` is returned.

### Fetching Pages via Proxy

```bash
curl -s "http://localhost:18080/proxy?url=https%3A%2F%2Fnanbyodata.jp%2F" | head -c 200
```

### Checking ES Module Import Rewriting

```bash
curl -s "http://localhost:18080/proxy?url=https%3A%2F%2Fnanbyodata.jp%2Fstatic%2Fjs%2Fmain.js" | grep navigation
```

Success if it is **rewritten to an absolute proxy URL** like:
`from "http://localhost:18080/proxy?url=...navigation.js"`

### Using in a Browser

```
http://localhost:18080/proxy?url=<TARGET_URL>
```

Example:
```
http://localhost:18080/proxy?url=https://nanbyodata.jp/
```

---

## 7. Applying Code Changes

Since Node.js does not hot-reload, please **restart the server** after editing `server.js` or `static/*.js`.

```
Ctrl + C                               # Stop
PORT=18080 node proxy-server/server.js # Restart
```

> `static/inject.js`, `static/inject.css`, and `static/interceptor.js` are 
> served as static files, so changes will be reflected after a server restart and browser reload.

---

## 8. Directory Structure

```
proxy-server/
├── server.js                    # Core proxy server
├── package.json
├── validate-guide.js            # Guide JSON schema validation
├── guide-selection-prompt.json  # Prompt settings for AI guide selection
├── start-proxy.sh               # Startup script (WSL/bash)
└── static/
    ├── inject.js                # Injection script (Guide UI control)
    ├── inject.css               # Injection styles
    └── interceptor.js           # fetch / XHR interceptor

(Root directory)
├── guide-patterns.json          # Guide definitions for NBRC / NanbyoData
└── togodx_guide-patterns.json   # Guide definitions for TogoDX
```

---

## 9. Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| Guide button is not displayed | Failed to fetch `/api/guides` / BOM in JSON | Remove BOM from JSON (Note: `server.js` already handles BOM removal). Restart the server. |
| Dropdowns, etc., do not work | ES module relative imports are not resolved | Restart server with the latest code (Import rewriting feature is required). |
| `Uncaught SyntaxError` | Legacy version of inline script | Update to the latest code and restart the server. |
| Port is already in use | Another process is using the same port | Change `PORT` or stop the existing process. |
| Code changes are not reflected | Server not restarted | `Ctrl+C` -> Restart. |

Check running processes:
```bash
ps aux | grep server.js | grep -v grep
ss -ltn | grep 18080
```
