# プロキシサーバー セットアップガイド

ガイド注入プロキシサーバー（`proxy-server/server.js`）の構築・起動手順をまとめます。

---

## 1. 概要

外部サイト（TogoDX / NanbyoData / NBRC 等）を HTTP プロキシ経由で配信し、
ページに Driver.js ベースのガイド UI を注入するローカル開発用サーバーです。

- ランタイム: **Node.js**（追加ライブラリは最小限）
- 依存: `ajv`, `ajv-formats`（ガイド JSON のスキーマ検証用）
- 実行環境: **WSL（Ubuntu 等）上での実行を想定**

---

## 2. 前提条件

| 項目 | 要件 |
|---|---|
| Node.js | v18 以上推奨（`fetch` / ES2020+ 構文を使用） |
| npm | Node.js 同梱版で可 |
| OS | WSL2（Ubuntu）を推奨。Windows ネイティブでも動作可 |

Node.js の確認:
```bash
node -v
npm -v
```

---

## 3. 依存パッケージのインストール

```bash
cd /mnt/c/Users/ykita/20260629-navitest/proxy-server
npm install
```

`ajv` / `ajv-formats` がインストールされます。

---

## 4. 環境変数

| 変数 | 必須 | デフォルト | 用途 |
|---|---|---|---|
| `PORT` | 任意 | `8080` | サーバーの待受ポート（本番運用では `18080` を使用） |
| `GEMINI_API_KEY` | 任意 | なし | AI ガイド選択に Gemini を使う場合のみ設定 |

> Ollama を使う場合は API 経由（`/api/ollama-guide`）でランタイムに `ollamaUri` / `modelName` を渡すため、環境変数は不要です。

---

## 5. サーバーの起動

### 基本（フォアグラウンド実行・推奨）

WSL のシェルで以下を実行します。

```bash
cd /mnt/c/Users/ykita/20260629-navitest
PORT=18080 node proxy-server/server.js
```

起動に成功すると次のように表示されます:

```
Guide proxy is running at http://localhost:18080
Using Ollama for guide selection
```

停止は `Ctrl + C`。

> **注意:** `nohup` / `setsid` などでバックグラウンド起動すると、WSL のワンショットコマンド経由ではセッション終了時に巻き込まれて停止する場合があります。フォアグラウンド実行が最も安定します。

### 起動スクリプトを使う場合

同梱の [start-proxy.sh](proxy-server/start-proxy.sh)（WSL/bash）を使えます。

```bash
cd /mnt/c/Users/ykita/20260629-navitest/proxy-server
./start-proxy.sh          # PORT=18080 で起動
PORT=9000 ./start-proxy.sh  # ポートを変更する場合
```

初回のみ実行権限を付与してください:
```bash
chmod +x proxy-server/start-proxy.sh
```

---

## 6. 動作確認

サーバー起動後、別のシェルで確認します。

### ガイド一覧 API

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
├── guide-selection-prompt.json  # AI ガイド選択用プロンプト設定
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
