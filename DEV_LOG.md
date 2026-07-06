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

**Symptoms**

```
Uncaught InvariantError: Invariant: Expected document.currentScript src to contain '/_next/'.
Received http://172.27.184.54:18080/proxy?url=https%3A%2F%2Flmstudio.ai%2F...%2F_next%2F... instead.
```

**Cause**  
Since `rewriteResourceUrls()` wraps all `<script src>` in `/proxy?url=...`, `document.currentScript.src` becomes the proxy URL. Next.js validates `currentScript.src.includes('/_next/')` at startup, but `_next` within the proxy URL is URL-encoded as `%2F_next%2F`, so it doesn't contain the literal `/_next/`.

**Fix**  
Added `isFrameworkStatic()` within `rewriteResourceUrls` to use the direct URL for framework static files without going through the proxy.

```js
function isFrameworkStatic(absUrl) {
  const p = new URL(absUrl).pathname;
  return /\/_next\/|\/__nuxt\/|\/static\/chunks\/|\/static\/js\/|\/static\/css\//.test(p);
}

function toProxyUrl(href, direct) {
  const abs = new URL(href, base).href;
  if (direct && isFrameworkStatic(abs)) return abs;  // ← Return direct URL
  return `${proxyOrigin}/proxy?url=${encodeURIComponent(abs)}`;
}
```

Passed `direct=true` for replacement of `<script src>` and `<link href>`, while keeping `<img>` and `<form action>` via the proxy.

---

### Bug 6 — Driver.js load failure (`window.driver.js.driver` vs `window["driver.js"]`)

**Symptoms**  
Clicking the guide button displays an alert saying "Failed to load Driver.js."

**Cause (Complex)**

1. **File Missing**  
   The `chrome-kakucyo/` directory (source for Driver.js) was deleted in git commit `77524f8`, so the `/assets/driver.js` endpoint was returning 404.

2. **Global Variable Name Confusion**  
   The CDN UMD build (`driver.js.umd.min.js`) exports to `window["driver.js"]` (bracket notation).  
   Meanwhile, the IIFE build (`driver.js.iife.js`) exports to `window.driver.js` (dot notation; the `.js` property of the `window.driver` object).  
   These are completely different property references in JavaScript.

   ```js
   window["driver.js"].driver   // For UMD: Access key "driver.js" via bracket notation
   window.driver.js.driver      // For IIFE: window.driver → .js → .driver
   ```

3. **Incorrect fix in `inject.js`**  
   We changed `window.driver.js.driver` → `window['driver.js'].driver` assuming CDN UMD usage, but the IIFE build was actually used, so the modified code always referred to `undefined`.

**Fix**  
- Added `"driver.js": "^1.0.0"` to `proxy-server/package.json` and ran `npm install`.
- Served the `/assets/driver.js` endpoint from `node_modules/driver.js/dist/driver.js.iife.js`.
- Reverted the reference in `inject.js` back to `window.driver.js.driver`.
- Fixed the CDN fallback URL to use the IIFE build (`driver.js.iife.js`).

**Lesson**  
The global variable configuration depends on the build format (ESM / CJS / UMD / IIFE) provided by the npm package. Checking the header of the CDN-published file (`this.x=this.x||{}, this.x.y=(function...`) reveals the exact global path.

---

## Summary

| Bug | Root Cause Category |
|---|---|
| stderr truncation | Design error in debug helper code |
| guide-patterns glob | Hardcoded configuration values |
| function declaration missing | Mismanagement of `str_replace` boundaries |
| Object.defineProperty crash | Insufficient consideration of exception propagation scope |
| Next.js InvariantError | Side effect of proxy wrapping all resources |
| Driver.js global name confusion | Lack of understanding of UMD vs IIFE build differences |
