# 開発記録：Web Guide Auto-Generator（BH26-6）

**期間:** 2026-07-02 〜 2026-07-03  
**開発者:** Nakatani & Kitano（+ GitHub Copilot）

---

## 実装内容一覧

| # | 内容 | 主なファイル |
|---|---|---|
| 1 | nbrc ガイドパターン追加・文法チェック | `guides/nbrc/guide-patterns.json` |
| 2 | guide-patterns 読み込みパスを glob スキャンに変更 | `proxy-server/server.js` |
| 3 | 未知サイト自動生成フロー（クロール→LLM→保存） | `server.js`, `crawl_pages.py` |
| 4 | UI を1セクションに統合 | `guide-selection-prompt.json` |
| 5 | Next.js InvariantError 修正 | `server.js` |
| 6 | Driver.js 読み込み失敗修正 | `server.js`, `inject.js` |

---

## デバッグ記録

---

### Bug 1 — `crawl_pages.py` の stderr が 500 文字で切り捨てられていた

**症状**  
`/api/bootstrap-site` から返るエラーが途中で切れており、Python 側の実際の例外が確認できなかった。

**原因**  
`server.js` の `runCrawl()` 内でエラーメッセージを `.slice(0, 500)` していた。

```js
// 修正前
reject(new Error(`crawl_pages.py exited with code ${code}: ${stderr.slice(0, 500)}`));

// 修正後
reject(new Error(`crawl_pages.py exited with code ${code}:\n${stderr}`));
```

**教訓**  
デバッグ用のエラーメッセージに文字数制限を設けると根本原因の特定が困難になる。

---

### Bug 2 — `guide-patterns.json` の読み込みが固定ファイルリスト依存だった

**症状**  
`guides/nbrc/guide-patterns.json` 等を追加しても `/api/generate-guide` が参照しなかった。

**原因**  
`server.js` に `GUIDE_PATTERN_FILES = ['guide-patterns.json', 'togodx_guide-patterns.json']` というハードコードがあり、`guides/` サブディレクトリを走査していなかった。

**修正**  
`loadGuidePatterns()` を `fs.readdirSync(guidesDir)` で動的スキャンに変更。

```js
const subDirs = fs.readdirSync(guidesDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);
subDirs.forEach(sub => {
  const p = path.join(guidesDir, sub, 'guide-patterns.json');
  if (fs.existsSync(p)) loaded.push(...JSON.parse(fs.readFileSync(p, 'utf-8')));
});
```

---

### Bug 3 — `interceptor.js` に `function proxify` 宣言行が欠落していた

**症状**  
ページ遷移後に `fetch` / `XHR` のプロキシインターセプトが一切機能しなくなり、外部リソース取得が CORS エラーで失敗した。ただし JavaScript コンソールにはシンタックスエラーが表示されず、原因の特定が難しかった。

**原因（根本）**  
`interceptor.js` に `patchCurrentScript` ブロックを追加する際、`str_replace` の `oldString` 境界が `function proxify(url) {` の宣言行を含んでいたため、置換後にその行が消失した。

```js
// 欠落状態（バグ）
(function patchCurrentScript() { ... })();

  if (!url) return url;   // ← function 宣言なしで関数本体だけが残った
```

```js
// 修正後
(function patchCurrentScript() { ... })();

function proxify(url) {   // ← 宣言行を復元
  if (!url) return url;
```

**教訓**  
`str_replace` で複数ブロックを一度に置換するとき、境界行の過不足に注意が必要。今後は `multi_replace_string_in_file` で独立した置換を並列実行し、依存関係を明示する。

---

### Bug 4 — `patchCurrentScript` の `Object.defineProperty` 例外が後続処理をクラッシュさせた

**症状**  
`interceptor.js` に Next.js 対策の `document.currentScript` オーバーライドを追加したが、環境によっては `Object.defineProperty(Document.prototype, 'currentScript', ...)` が `TypeError` を投げ、同じ IIFE 内に定義された `proxify` / `fetch` / `XHR` インターセプターがセットアップされなかった。

**原因**  
`Object.defineProperty` を `try-catch` なしで呼び出していたため、例外が外側の IIFE に伝播して残り処理が中断された。

**修正**  
パッチ全体を `try { ... } catch(e) { /* continue */ }` で囲む。

**最終的な解決策**  
`patchCurrentScript` アプローチ自体を破棄し、`rewriteResourceUrls()` で `/_next/static/` 等のフレームワーク静的ファイルをプロキシ URL にラップしないよう変更（後述 Bug 5 と統合して解決）。

---

### Bug 5 — Next.js `InvariantError: Expected document.currentScript src to contain '/_next/'`

**症状**

```
Uncaught InvariantError: Invariant: Expected document.currentScript src to contain '/_next/'.
Received http://172.27.184.54:18080/proxy?url=https%3A%2F%2Flmstudio.ai%2F...%2F_next%2F... instead.
```

**原因**  
`rewriteResourceUrls()` が `<script src>` のすべてを `/proxy?url=...` でラップするため、`document.currentScript.src` がプロキシ URL になる。Next.js は起動時に `currentScript.src.includes('/_next/')` を検証するが、プロキシ URL 内の `_next` は `%2F_next%2F`（URL エンコード）になっており、literal `/_next/` を含まない。

**修正**  
`rewriteResourceUrls` 内に `isFrameworkStatic()` を追加し、フレームワーク静的ファイルはプロキシを介さず直接 URL を使用する。

```js
function isFrameworkStatic(absUrl) {
  const p = new URL(absUrl).pathname;
  return /\/_next\/|\/__nuxt\/|\/static\/chunks\/|\/static\/js\/|\/static\/css\//.test(p);
}

function toProxyUrl(href, direct) {
  const abs = new URL(href, base).href;
  if (direct && isFrameworkStatic(abs)) return abs;  // ← 直接 URL を返す
  return `${proxyOrigin}/proxy?url=${encodeURIComponent(abs)}`;
}
```

`<script src>` と `<link href>` の置換に `direct=true` を渡し、`<img>` と `<form action>` はプロキシ経由のまま維持。

---

### Bug 6 — Driver.js の読み込み失敗（`window.driver.js.driver` vs `window["driver.js"]`）

**症状**  
ガイドボタンをクリックすると「Driver.js の読み込みに失敗しました」アラートが表示される。

**原因（複合）**

1. **ファイルが存在しない**  
   `chrome-kakucyo/` ディレクトリ（driver.js の提供元）が git commit `77524f8` で削除されており、`/assets/driver.js` エンドポイントが常に 404 を返していた。

2. **グローバル変数名の混同**  
   CDN の UMD ビルド (`driver.js.umd.min.js`) は `window["driver.js"]`（ブラケット記法）にエクスポートする。  
   一方、IIFE ビルド (`driver.js.iife.js`) は `window.driver.js`（ドット記法、`window.driver` オブジェクトの `.js` プロパティ）にエクスポートする。  
   これらは JavaScript としてまったく異なるプロパティ参照である。

   ```js
   window["driver.js"].driver   // UMD 用：キー "driver.js" をブラケット記法でアクセス
   window.driver.js.driver      // IIFE 用：window.driver → .js → .driver
   ```

3. **inject.js の誤修正**  
   CDN UMD を使う想定で `window.driver.js.driver` → `window['driver.js'].driver` に変更したが、実際に使用すべきは IIFE ビルドであり、修正後のコードは常に `undefined` を参照していた。

**修正**  
- `proxy-server/package.json` に `"driver.js": "^1.0.0"` を追加して `npm install`
- `/assets/driver.js` エンドポイントを `node_modules/driver.js/dist/driver.js.iife.js` から提供
- `inject.js` の参照を元の `window.driver.js.driver` に戻す
- CDN URL のフォールバックも IIFE ビルド用 URL (`driver.js.iife.js`) に修正

**教訓**  
npm パッケージが提供するビルド形式（ESM / CJS / UMD / IIFE）によってグローバル変数の設定方法が異なる。CDN で公開されているファイルのヘッダー（`this.x=this.x||{}, this.x.y=(function...`）を確認することで正確なグローバルパスが分かる。

---

## まとめ

| バグ | 根本原因のカテゴリ |
|---|---|
| stderr truncation | デバッグ補助コードの設計ミス |
| guide-patterns glob | ハードコードされた設定値 |
| function declaration 欠落 | str_replace の境界ミス |
| Object.defineProperty クラッシュ | 例外の伝播範囲の考慮不足 |
| Next.js InvariantError | プロキシが全リソースを URL ラップする副作用 |
| Driver.js グローバル名混同 | UMD vs IIFE ビルドの違いへの無理解 |
