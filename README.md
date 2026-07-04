# Web Guide Auto-Generator

**BH26-6 (BioHackathon Japan 2026-06) Deliverable**  
Authors: Nakatani & Kitano

---

## Overview

This tool **automatically generates operation guides** for complex Web tools using LLMs and displays them directly on the page.

By browsing the target URL through a proxy server, it injects the guide UI without modifying the original page.  
For unknown websites, it automatically crawls the pages, feeds the results to an LLM (Ollama), and generates the guide.  
**[Driver.js](https://driverjs.com/)** is used to display the guides.

```
Browser → Proxy Server → Target Website
                ↓
        Inject Guide UI into HTML
                ↓
        Display steps with Driver.js
```

---

## Quick Start

### 1. Install Dependencies

```bash
cd proxy-server
npm install
```

Python side (for crawling):

```bash
pip install -r requirements.txt
playwright install chromium
```

### 2. Start the Server

```bash
PORT=18080 node proxy-server/server.js
```

### 3. Access via Browser

```
http://localhost:18080
```

Enter the URL, Ollama endpoint, and prompt, then click "Open" to access the page via the proxy.

---

## Features

| Feature | Description |
|---|---|
| Proxy Delivery | Delivers target URLs via HTTP proxy and injects Driver.js guides into HTML |
| Guide Selection for Known Sites | Passes user prompts to an LLM to automatically select the best existing guide |
| Auto-Generation for Unknown Sites | Crawls → Generates guide JSON with LLM → Saves as `guides/{domain}/guide-patterns.json` |
| Session Management | Maintains session state with cookies on the proxy side, allowing browsing while logged in |

---

## System Architecture

```
20260629-navitest/
├── proxy-server/
│   ├── server.js               # Proxy server core (Node.js)
│   ├── package.json            # Deps: ajv, ajv-formats, driver.js
│   ├── guide-selection-prompt.json   # LLM prompt template & home screen UI
│   ├── validate-guide.js       # Schema validation for guide JSON
│   └── static/
│       ├── inject.js           # Guide UI script injected into pages
│       ├── inject.css          # Styles for the guide menu
│       └── interceptor.js      # Redirects fetch / XHR through the proxy
├── guides/
│   ├── nbrc/
│   │   └── guide-patterns.json # Guide definitions for NBRC Microbe List
│   ├── togodx/
│   │   └── guide-patterns.json # Guide definitions for TogoDX
│   ├── nanbyodata/
│   │   └── guide-patterns.json # Guide definitions for Nanbyo Data
│   └── {domain}/              # Auto-generated when opening unknown sites
│       └── guide-patterns.json
├── crawl_pages.py              # Page crawling script using Playwright
├── GUIDE_AUTHORING.md          # Guide JSON authoring specifications
├── guide-package.schema.json   # Guide JSON schema definition
└── requirements.txt            # Python dependencies
```

---

## Auto-Generation Flow (Unknown Sites)

```
1. ユーザーが未知 URL を入力して「開く」
        ↓
2. POST /api/bootstrap-site
        ↓
3. crawl_pages.py --url {URL} --output-dir guides/{ドメイン}/
   Playwright でトップページ + 1 階層のリンクをクロール
   → selector_info.json（CSS セレクター情報）、Markdown テキストを保存
        ↓
4. LLM（Ollama）へのプロンプト構築
   ・GUIDE_AUTHORING.md（仕様書）
   ・既存 guide-patterns.json の例
   ・クロール結果（selector_info.json + .md）
   ・ユーザーのプロンプト（「やりたいこと」）
        ↓
5. LLM が guide-patterns.json（JSON 配列）を生成
        ↓
6. guides/{ドメイン}/guide-patterns.json として保存
        ↓
7. プロキシ経由で対象 URL へ遷移、ガイドを表示
```

---

## ガイド JSON の形式

```jsonc
[
  {
    "guideId": "example-first-use",   // 一意な識別子（kebab-case）
    "version": 1,
    "locale": "ja-JP",
    "title": "初めて使う",
    "description": "基本操作の概要",
    "steps": [
      {
        "id": "step-1",
        "selector": "#search-input",  // CSS セレクター
        "action": "highlight",        // "highlight" | "tooltip" | "complete"
        "title": "検索ボックス",
        "description": "ここにキーワードを入力します。"
      }
    ]
  }
]
```

詳細は [GUIDE_AUTHORING.md](GUIDE_AUTHORING.md) を参照してください。

---

## API エンドポイント

| エンドポイント | メソッド | 説明 |
|---|---|---|
| `/` | GET | ホーム画面（URL 入力 + LLM 設定） |
| `/proxy?url={URL}` | GET | プロキシ経由でページを表示 |
| `/api/bootstrap-site` | POST | 未知サイトのクロール + ガイド生成 |
| `/api/generate-guide` | POST | プロンプトからガイドを LLM で選択 |
| `/api/guides?url={URL}` | GET | 対象 URL のガイド一覧を返す |
| `/api/guides/{guideId}` | GET | ガイド詳細 JSON を返す |

---

## 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `PORT` | `8080` | サーバーの待受ポート |
| `GEMINI_API_KEY` | なし | Gemini API を使う場合のみ設定 |

Ollama を使う場合はブラウザの UI から URI / モデル名を直接入力します（環境変数不要）。

---

## 動作要件

| 項目 | 要件 |
|---|---|
| Node.js | v18 以上 |
| Python | 3.9 以上 |
| Playwright | `playwright install chromium` 実行済み |
| Ollama | 未知サイトのガイド生成時に必要 |
| OS | WSL2（Ubuntu）推奨。Windows ネイティブでも動作可 |

---

## 既知サイトの追加方法

1. `guides/{サイト名}/guide-patterns.json` を作成（仕様書に従い手動またはLLMで）
2. `proxy-server/server.js` の `SITE_GUIDE_MAP` にホスト名を追加:

```js
const SITE_GUIDE_MAP = {
  'example.com': 'example',   // ← 追加
};
```

または、ブラウザから対象 URL を開くと自動的に登録されます（未知サイト自動生成機能）。

---

## ライセンス

MIT
