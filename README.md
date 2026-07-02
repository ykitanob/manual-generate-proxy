# Web Guide Auto-Generator

**BH26-6（国内版バイオハッカソン 2026-06）成果物**  
作者: Nakatani & Kitano

---

## 概要

使い方の分かりづらい Web ツールの操作ガイドを **LLM で自動生成** し、ページ上に表示するツールです。

プロキシサーバーを経由して対象 URL を閲覧することで、ページを改変せずにガイド UI を注入します。  
未知の Web サイトに対しては、ページを自動クロールし、その結果を LLM（Ollama）に読み込ませてガイドを生成します。  
ガイドの表示には **[Driver.js](https://driverjs.com/)** を使用しています。

```
ブラウザ → プロキシサーバー → 対象 Web サイト
                ↓
        HTML にガイド UI を注入
                ↓
        Driver.js でステップ表示
```

---

## クイックスタート

### 1. 依存パッケージのインストール

```bash
cd proxy-server
npm install
```

Python 側（クロール用）:

```bash
pip install -r requirements.txt
playwright install chromium
```

### 2. サーバー起動

```bash
PORT=18080 node proxy-server/server.js
```

### 3. ブラウザでアクセス

```
http://localhost:18080
```

URL・Ollama エンドポイント・プロンプトを入力して「開く」を押すとプロキシ経由でページが開きます。

---

## 機能一覧

| 機能 | 説明 |
|---|---|
| プロキシ配信 | 対象 URL を HTTP プロキシ経由で配信し、HTML に Driver.js ガイドを注入 |
| 既知サイトのガイド選択 | ユーザーのプロンプトを LLM に渡し、既存ガイドから最適なものを自動選択 |
| 未知サイトのガイド自動生成 | クロール → LLM によるガイド JSON 生成 → `guides/{ドメイン}/guide-patterns.json` として保存 |
| セッション管理 | Cookie をプロキシ側でセッション保持し、ログイン状態のまま閲覧可能 |

---

## システム構成

```
20260629-navitest/
├── proxy-server/
│   ├── server.js               # プロキシサーバー本体（Node.js）
│   ├── package.json            # 依存: ajv, ajv-formats, driver.js
│   ├── guide-selection-prompt.json   # LLM プロンプトテンプレート & ホーム画面 UI
│   ├── validate-guide.js       # ガイド JSON のスキーマ検証
│   └── static/
│       ├── inject.js           # ページに注入するガイド UI スクリプト
│       ├── inject.css          # ガイドメニューのスタイル
│       └── interceptor.js      # fetch / XHR をプロキシ経由にリダイレクト
├── guides/
│   ├── nbrc/
│   │   └── guide-patterns.json # NBRC 微生物リスト用ガイド定義
│   ├── togodx/
│   │   └── guide-patterns.json # TogoDX 用ガイド定義
│   ├── nanbyodata/
│   │   └── guide-patterns.json # 難病データベース用ガイド定義
│   └── {ドメイン}/              # 未知サイトを開くと自動生成
│       └── guide-patterns.json
├── crawl_pages.py              # Playwright によるページクロールスクリプト
├── GUIDE_AUTHORING.md          # ガイド JSON 作成仕様書
├── guide-package.schema.json   # ガイド JSON スキーマ定義
└── requirements.txt            # Python 依存パッケージ
```

---

## ガイドの自動生成フロー（未知サイト）

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
