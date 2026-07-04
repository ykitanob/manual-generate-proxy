# Development Log: Web Guide Auto-Generator (BH26-6)

**Period:** 2026-07-02 to 2026-07-03  
**Developers:** Nakatani & Kitano (+ GitHub Copilot)

---

## Implementation List

| # | Content | Main Files |
|---|---|---|
| 1 | Added nbrc guide patterns & grammar check | `guides/nbrc/guide-patterns.json` |
| 2 | Changed guide-patterns loading path to glob scan | `proxy-server/server.js` |
| 3 | Auto-generation flow for unknown sites (Crawl → LLM → Save) | `server.js`, `crawl_pages.py` |
| 4 | Integrated UI into a single section | `guide-selection-prompt.json` |
| 5 | Fixed Next.js InvariantError | `server.js` |
| 6 | Fixed Driver.js load failure | `server.js`, `inject.js` |

---

## Debugging Records

---

### Bug 1 — `crawl_pages.py` stderr was truncated at 500 characters

**Symptoms**  
The error returned from `/api/bootstrap-site` was truncated, making it impossible to confirm the actual exception on the Python side.

**Cause**  
In `server.js`, inside `runCrawl()`, the error message was `.slice(0, 500)`.

```js
// Before fix
reject(new Error(`crawl_pages.py exited with code ${code}: ${stderr.slice(0, 500)}`));

// After fix
reject(new Error(`crawl_pages.py exited with code ${code}:\n${stderr}`));
```

**Lesson**  
Limiting character counts for debugging error messages makes it difficult to identify the root cause.

---

### Bug 2 — `guide-patterns.json` loading depended on a fixed file list

**Symptoms**  
Even after adding `guides/nbrc/guide-patterns.json`, `/api/generate-guide` did not reference it.

**Cause**  
There was a hardcoded `GUIDE_PATTERN_FILES = ['guide-patterns.json', 'togodx_guide-patterns.json']` in `server.js`, and it was not scanning the `guides/` subdirectories.

**Fix**  
Changed `loadGuidePatterns()` to dynamically scan using `fs.readdirSync(guidesDir)`.

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

### Bug 3 — `function proxify` declaration line was missing in `interceptor.js`

**Symptoms**  
After page transitions, proxy interception for `fetch` / `XHR` stopped working entirely, and external resource retrieval failed with CORS errors. However, no syntax errors were displayed in the JavaScript console, making the cause hard to identify.

**Cause (Root)**  
When adding the `patchCurrentScript` block to `interceptor.js`, the `oldString` boundary for `str_replace` included the declaration line `function proxify(url) {`, which caused that line to disappear after replacement.

```js
// Missing state (bug)
(function patchCurrentScript() { ... })();

  if (!url) return url;   // ← Function body remains without the declaration
```

```js
// After fix
(function patchCurrentScript() { ... })();

function proxify(url) {   // ← Restored declaration line
  if (!url) return url;
```

**Lesson**  
When replacing multiple blocks at once with `str_replace`, be careful with boundary lines. In the future, use `multi_replace_string_in_file` to run independent replacements in parallel and clarify dependencies.

---

### Bug 4 — `patchCurrentScript`'s `Object.defineProperty` exception crashed subsequent processing

**Symptoms**  
Added a `document.currentScript` override for Next.js in `interceptor.js`, but in some environments, `Object.defineProperty(Document.prototype, 'currentScript', ...)` threw a `TypeError`, preventing the `proxify` / `fetch` / `XHR` interceptors defined in the same IIFE from being set up.

**Cause**  
`Object.defineProperty` was called without a `try-catch`, so the exception propagated to the outer IIFE, interrupting the rest of the processing.

**Fix**  
Wrapped the entire patch in `try { ... } catch(e) { /* continue */ }`.

**Final Solution**  
Discarded the `patchCurrentScript` approach itself and changed `rewriteResourceUrls()` to not wrap framework static files (e.g., `/_next/static/`) in proxy URLs (integrated with Bug 5 below).

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
