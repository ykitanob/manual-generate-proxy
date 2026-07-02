const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = path.join(__dirname, 'static');
const ASSETS_DIR = path.join(__dirname, '..', 'chrome-kakucyo');
const SESSION_COOKIE_NAME = 'GUIDEPROXYSID';
const MAX_REDIRECTS = 5;
const sessions = new Map();

// E coli ガイド JSON定義
const ECOLI_GUIDE = {
  guideId: 'nite-bacteria-ecoli-search',
  version: 1,
  locale: 'ja-JP',
  title: 'E. coli を検索',
  steps: [
    {
      id: 'intro',
      selector: 'body',
      action: 'tooltip',
      title: 'E. coli ガイド',
      description: 'このガイドでは「E. coli」を検索する手順を案内します。'
    },
    {
      id: 'e-button',
      selector: 'a[title="E"]',
      action: 'highlight',
      title: '「E」ボタンをクリック',
      description: '対象の微生物の頭文字をクリックします。「E」をクリックすると E で始まる細菌が表示されます。'
    },
    {
      id: 'search',
      selector: 'input[type="text"]',
      action: 'highlight',
      title: 'Search（絞り込み検索）',
      description: 'ここに菌名を入力すると一覧をリアルタイムで絞り込めます。例：<strong>E coli</strong> と入力してみましょう。'
    },
    {
      id: 'bacteria-list',
      selector: '#tblUList',
      action: 'highlight',
      title: '細菌リスト一覧',
      description: '学名・BSL区分・法規制情報がまとまっています。行をクリックすると詳細ページへ遷移します。'
    },
    {
      id: 'done',
      selector: 'body',
      action: 'complete',
      title: 'ガイド完了',
      description: 'E. coli ガイドの説明は終わりです。'
    }
  ]
};

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, chunk) => {
    const idx = chunk.indexOf('=');
    if (idx < 0) return acc;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    acc[key] = value;
    return acc;
  }, {});
}

function getOrCreateSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const existingId = cookies[SESSION_COOKIE_NAME];
  if (existingId && sessions.has(existingId)) {
    return sessions.get(existingId);
  }

  const sid = crypto.randomBytes(16).toString('hex');
  const session = {
    id: sid,
    cookies: new Map(),
    updatedAt: Date.now()
  };
  sessions.set(sid, session);

  res.setHeader('set-cookie', `${SESSION_COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  return session;
}

function shouldSendCookieFor(urlObj, cookie) {
  if (cookie.secure && urlObj.protocol !== 'https:') return false;

  const host = urlObj.hostname;
  if (cookie.domain) {
    const d = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    if (!(host === d || host.endsWith(`.${d}`))) return false;
  }

  const reqPath = urlObj.pathname || '/';
  const cookiePath = cookie.path || '/';
  if (!reqPath.startsWith(cookiePath)) return false;

  return true;
}

function getCookieHeaderForUrl(session, urlObj) {
  const pairs = [];
  session.cookies.forEach((cookie, name) => {
    if (shouldSendCookieFor(urlObj, cookie)) {
      pairs.push(`${name}=${cookie.value}`);
    }
  });
  return pairs.join('; ');
}

function storeSetCookie(session, setCookieHeaders, urlObj) {
  if (!setCookieHeaders || setCookieHeaders.length === 0) return;

  setCookieHeaders.forEach((line) => {
    const parts = line.split(';').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;

    const nvIdx = parts[0].indexOf('=');
    if (nvIdx < 0) return;
    const name = parts[0].slice(0, nvIdx);
    const value = parts[0].slice(nvIdx + 1);

    const cookie = {
      value,
      domain: urlObj.hostname,
      path: '/',
      secure: false,
      httpOnly: false
    };

    let remove = false;

    for (let i = 1; i < parts.length; i += 1) {
      const attr = parts[i];
      const eq = attr.indexOf('=');
      const key = (eq >= 0 ? attr.slice(0, eq) : attr).toLowerCase();
      const val = eq >= 0 ? attr.slice(eq + 1) : '';

      if (key === 'domain' && val) cookie.domain = val;
      if (key === 'path' && val) cookie.path = val;
      if (key === 'secure') cookie.secure = true;
      if (key === 'httponly') cookie.httpOnly = true;
      if (key === 'max-age' && Number(val) <= 0) remove = true;
      if (key === 'expires') {
        const exp = Date.parse(val);
        if (!Number.isNaN(exp) && exp <= Date.now()) remove = true;
      }
    }

    if (remove || value === '') {
      session.cookies.delete(name);
    } else {
      session.cookies.set(name, cookie);
    }
  });

  session.updatedAt = Date.now();
}

function requestUpstream(targetUrl, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    session = null
  } = options;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
    const transport = urlObj.protocol === 'https:' ? https : http;

    const reqHeaders = {
      'user-agent': 'GuideProxy/0.1 (+local dev)',
      ...headers
    };

    if (session) {
      const cookieHeader = getCookieHeaderForUrl(session, urlObj);
      if (cookieHeader) reqHeaders.cookie = cookieHeader;
    }

    // Content-Length を自動設定
    if (body && !reqHeaders['content-length']) {
      const bodyBuffer = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
      reqHeaders['content-length'] = bodyBuffer.length;
    }

    const req = transport.request(urlObj, {
      method,
      headers: reqHeaders
    }, (upstreamRes) => {
      const chunks = [];
      upstreamRes.on('data', (chunk) => chunks.push(chunk));
      upstreamRes.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        const setCookie = upstreamRes.headers['set-cookie'] || [];
        const setCookieList = Array.isArray(setCookie) ? setCookie : [setCookie];

        if (session) {
          storeSetCookie(session, setCookieList, urlObj);
        }

        resolve({
          status: upstreamRes.statusCode || 500,
          headers: upstreamRes.headers,
          body: rawBody,
          url: targetUrl
        });
      });
    });

    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

function resolveRedirectUrl(currentUrl, locationHeader) {
  if (!locationHeader) return null;
  const first = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
  return new URL(first, currentUrl).toString();
}

async function requestUpstreamFollowing(targetUrl, options = {}) {
  let url = targetUrl;
  let response = null;

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    response = await requestUpstream(url, options);
    const status = response.status;
    if (![301, 302, 303, 307, 308].includes(status)) {
      return response;
    }

    const next = resolveRedirectUrl(url, response.headers.location);
    if (!next) return response;

    url = next;
    // GET のみ追従する
    options.method = 'GET';
    options.body = null;
  }

  return response;
}

function getProxyOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store'
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Origin/Referer ヘッダーが必要なドメイン（NanbyoData / SPARQList 系）
// TogoDX 等 Vite SPA は含めない（Origin ヘッダーが原因でエラーになるため）
const NEEDS_ORIGIN_DOMAINS = [
  'nanbyodata.jp',
  'sparql.dbcls.jp',
  'www.nite.go.jp',
  'togoid.dbcls.jp'
];

function hostNeedsOriginHeader(hostname) {
  return NEEDS_ORIGIN_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith('.' + d)
  );
}

function isHttpUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function stripMetaCsp(html) {
  return html.replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi, '');
}

/**
 * HTML 内の静的リソース URL をプロキシ経由に書き換える。
 * <link href>, <script src>, <img src>, <form action> が対象。
 * <a href> はクライアント側の inject.js が担当する。
 */
function rewriteResourceUrls(html, targetUrl, proxyOrigin) {
  const base = new URL(targetUrl);

  // フレームワークの非内容静的ファイルはプロキシ経由にしない。
  // これにより document.currentScript.src が元 URLのままになり、
  // Next.js の InvariantError (「/_next/ を含むはず」チェック等) が解消される。
  function isFrameworkStatic(absUrl) {
    try {
      const p = new URL(absUrl).pathname;
      return /\/_next\/|\/__nuxt\/|\/static\/chunks\/|\/static\/js\/|\/static\/css\//.test(p);
    } catch {
      return false;
    }
  }

  function toProxyUrl(href, direct) {
    if (!href) return href;
    const h = href.trim();
    if (h.startsWith('data:') || h.startsWith('blob:') ||
        h.startsWith('#')     || h.startsWith('javascript:')) {
      return href;
    }
    try {
      const abs = new URL(h, base).href;
      // フレームワーク静的ファイル（direct=true）は直接 URL
      if (direct && isFrameworkStatic(abs)) return abs;
      return `${proxyOrigin}/proxy?url=${encodeURIComponent(abs)}`;
    } catch {
      return href;
    }
  }

  // <link href="..."> — integrity/crossorigin も除去（プロキシ経由URL変更後のSRI失敗を防ぐ）
  html = html.replace(/(<link\b[^>]*?\bhref=)(["'])([^"']*)\2/gi,
    (_, pre, q, href) => `${pre}${q}${toProxyUrl(href, true)}${q}`);
  html = html.replace(/(<link\b[^>]*)\s+integrity=["'][^"']*["']/gi, '$1');
  html = html.replace(/(<link\b[^>]*)\s+crossorigin=["'][^"']*["']/gi, '$1');

  // <script src="..."> — integrity/crossorigin も除去（SRI + CORS 失敗を防ぐ）
  html = html.replace(/(<script\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi,
    (_, pre, q, src) => `${pre}${q}${toProxyUrl(src, true)}${q}`);
  html = html.replace(/(<script\b[^>]*)\s+integrity=["'][^"']*["']/gi, '$1');
  html = html.replace(/(<script\b[^>]*)\s+crossorigin=["'][^"']*["']/gi, '$1');

  // <img src="...">
  html = html.replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi,
    (_, pre, q, src) => `${pre}${q}${toProxyUrl(src)}${q}`);

  // <form action="..."> ← 重要: ログイン/承認フォームがアップストリーム直指しになるのを防ぐ
  html = html.replace(/(<form\b[^>]*?\baction=)(["'])([^"']*)\2/gi,
    (_, pre, q, action) => `${pre}${q}${toProxyUrl(action)}${q}`);

  return html;
}

function injectIntoHtml(html, targetUrl, proxyOrigin) {
  // まずリソース URL をプロキシ経由に書き換える（<base> タグは使わない）
  html = rewriteResourceUrls(html, targetUrl, proxyOrigin);

  // JSON.stringify でエスケープ（&amp; 等のHTML実体参照にならないため script タグ内で安全）
  const jsProxyOrigin = JSON.stringify(proxyOrigin);
  const jsTargetUrl   = JSON.stringify(targetUrl);
  const safeOrigin    = escapeHtml(proxyOrigin); // href 属性用

  // fetch / XHR インターセプター:
  // インラインスクリプトは変数設定のみに留め、ロジックは外部ファイル(interceptor.js)に分離。
  // defer なしで <head> 先頭に挿入することでサイトの JS より先に実行される。
  const interceptorScript = [
    `<script>window.__GUIDE_PROXY_ORIGIN__=${jsProxyOrigin};window.__GUIDE_PROXY_TARGET_URL__=${jsTargetUrl};</script>`,
    `<script src="${safeOrigin}/static/interceptor.js"></script>`
  ].join('\n');

  // driver.js / driver.css: node_modules があればローカル提供、なければ CDN
  const NM_DRIVER_DIR = path.join(__dirname, 'node_modules', 'driver.js', 'dist');
  const hasLocalDriver = fs.existsSync(path.join(NM_DRIVER_DIR, 'driver.js.iife.js'));
  const DRIVER_JS_SRC  = hasLocalDriver
    ? `${safeOrigin}/assets/driver.js`
    : 'https://cdn.jsdelivr.net/npm/driver.js@1/dist/driver.js.iife.js';
  const DRIVER_CSS_SRC = hasLocalDriver
    ? `${safeOrigin}/assets/driver.css`
    : 'https://cdn.jsdelivr.net/npm/driver.js@1/dist/driver.css';

  const deferredAssets = [
    `<link rel="stylesheet" href="${DRIVER_CSS_SRC}">`,
    `<link rel="stylesheet" href="${safeOrigin}/static/inject.css">`,
    `<script src="${DRIVER_JS_SRC}" defer></script>`,
    `<script src="${safeOrigin}/static/inject.js" defer></script>`
  ].join('\n');

  // インターセプターは <head> の先頭、deferred アセットは </head> の直前に注入
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/(<head[^>]*>)/i, `$1\n${interceptorScript}`);
  } else {
    html = `${interceptorScript}\n${html}`;
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${deferredAssets}\n</head>`);
  }

  return `${html}\n${deferredAssets}`;
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }

    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store'
    });
    res.end(data);
  });
}

function renderHomePage() {
  return loadHomePageHtml();
}

/**
 * ES module の import/export specifier をプロキシ経由の絶対URLに書き換える。
 * クエリ方式のプロキシURL(?url=...)では相対import(./foo.js)が正しく解決されないため、
 * JavaScript レスポンスに対してこの変換を適用する。
 */
function rewriteJsModuleImports(jsCode, moduleUrl, proxyOrigin) {
  function resolveSpec(spec) {
    if (!spec) return spec;
    if (/^(data:|blob:)/i.test(spec)) return spec;
    let abs;
    try {
      // 相対 (./ ../ /) と絶対 http(s) の両方を解決。bare specifier は例外→そのまま。
      abs = new URL(spec, moduleUrl).href;
    } catch {
      return spec;
    }
    if (!/^https?:/i.test(abs)) return spec;
    if (abs.startsWith(proxyOrigin)) return spec;
    return `${proxyOrigin}/proxy?url=${encodeURIComponent(abs)}`;
  }

  // import ... from '...'  /  export ... from '...'
  jsCode = jsCode.replace(
    /(\b(?:import|export)\b[^'"]*?\bfrom\s*)(["'])([^"']+)\2/g,
    (_, pre, q, spec) => `${pre}${q}${resolveSpec(spec)}${q}`
  );

  // 副作用 import '...'（from を伴わない）
  jsCode = jsCode.replace(
    /(\bimport\s*)(["'])([^"']+)\2/g,
    (m, pre, q, spec) => `${pre}${q}${resolveSpec(spec)}${q}`
  );

  // 動的 import('...')
  jsCode = jsCode.replace(
    /(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g,
    (_, pre, q, spec, post) => `${pre}${q}${resolveSpec(spec)}${q}${post}`
  );

  return jsCode;
}

/**
 * CSS 内の url(...) と @import の参照をプロキシ経由の絶対URLに書き換える。
 * クエリ方式プロキシURLでは相対参照(../webfonts/x.ttf)が正しく解決されないため。
 */
function rewriteCssUrls(cssCode, cssUrl, proxyOrigin) {
  function resolveRef(raw) {
    const t = String(raw).trim().replace(/^["']|["']$/g, '');
    if (!t || /^(data:|blob:|#)/i.test(t)) return raw;
    let abs;
    try {
      abs = new URL(t, cssUrl).href;
    } catch {
      return raw;
    }
    if (!/^https?:/i.test(abs)) return raw;
    if (abs.startsWith(proxyOrigin)) return raw;
    return `${proxyOrigin}/proxy?url=${encodeURIComponent(abs)}`;
  }

  // url(...)（引用符あり/なし両対応）
  cssCode = cssCode.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (_, q, inner) => `url(${q}${resolveRef(inner)}${q})`
  );

  // @import "..." / @import '...'
  cssCode = cssCode.replace(
    /@import\s+(['"])([^'"]+)\1/gi,
    (_, q, inner) => `@import ${q}${resolveRef(inner)}${q}`
  );

  return cssCode;
}


async function handleProxy(req, res, reqUrl) {
  const session = getOrCreateSession(req, res);
  const target = reqUrl.searchParams.get('url');
  if (!target || !isHttpUrl(target)) {
    sendText(res, 400, 'Invalid url parameter. Use /proxy?url=https://example.com');
    return;
  }

  // POST ボディを読み込む（フォーム送信対応）
  let upstreamMethod = req.method; // GET or POST or PUT etc
  let upstreamBody = null;
  let upstreamHeaders = {};

  // NanbyoData / SPARQList 等の API は Origin / Referer が必要
  // TogoDX 等 Vite SPA はこれらを付与するとエラーになるため対象外
  const targetHostname = (() => { try { return new URL(target).hostname; } catch { return ''; } })();
  if (hostNeedsOriginHeader(targetHostname)) {
    const targetOrigin = (() => { try { return new URL(target).origin; } catch { return ''; } })();
    if (targetOrigin) {
      upstreamHeaders['origin']  = targetOrigin;
      upstreamHeaders['referer'] = target;
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      upstreamBody = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
    } catch (err) {
      sendText(res, 400, `Failed to read request body: ${err.message}`);
      return;
    }

    // Content-Type はそのまま渡す（フォームデータやJSON）
    if (req.headers['content-type']) {
      upstreamHeaders['content-type'] = req.headers['content-type'];
    }
  }

  let upstream;
  try {
    upstream = await requestUpstreamFollowing(target, {
      method: upstreamMethod,
      body: upstreamBody,
      headers: upstreamHeaders,
      session
    });
  } catch (err) {
    sendText(res, 502, `Upstream request failed: ${err.message}`);
    return;
  }

  const upstreamContentType = upstream.headers['content-type'] || '';
  const status = upstream.status;

  if (upstreamContentType.includes('text/html')) {
    const originalHtml = upstream.body.toString('utf8');
    const strippedHtml = stripMetaCsp(originalHtml);
    const proxyOrigin = getProxyOrigin(req);
    const injectedHtml = injectIntoHtml(strippedHtml, target, proxyOrigin);

    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end(injectedHtml);
    return;
  }

  // JavaScript の場合:
  // - NanbyoData / NBRC 等（NEEDS_ORIGIN_DOMAINS）: ES module の相対 import をプロキシ経由に書き換える
  // - TogoDX 等 Vite SPA: rewriteJsModuleImports が Vite バンドルを破壊するためスキップ
  if (/javascript|ecmascript/i.test(upstreamContentType)) {
    const proxyOrigin = getProxyOrigin(req);
    const jsBody = hostNeedsOriginHeader(targetHostname)
      ? rewriteJsModuleImports(upstream.body.toString('utf8'), target, proxyOrigin)
      : upstream.body.toString('utf8');
    res.writeHead(status, {
      'content-type': upstreamContentType,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff'
    });
    res.end(jsBody);
    return;
  }

  // CSS の場合、url(...) と @import の相対参照をプロキシ経由の絶対URLに書き換える
  // （@font-face のフォント等が proxy ルートに解決されて 404 になるのを防ぐ）
  if (/text\/css/i.test(upstreamContentType)) {
    const proxyOrigin = getProxyOrigin(req);
    const rewrittenCss = rewriteCssUrls(upstream.body.toString('utf8'), target, proxyOrigin);
    res.writeHead(status, {
      'content-type': upstreamContentType,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    res.end(rewrittenCss);
    return;
  }

  res.writeHead(status, {
    'content-type': upstreamContentType || 'application/octet-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(upstream.body);
}

async function handleConsent(req, res) {
  const session = getOrCreateSession(req, res);

  if (req.method !== 'POST') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  let parsedBody;
  try {
    const rawBody = await parseBody(req);
    parsedBody = new URLSearchParams(rawBody);
  } catch (err) {
    sendText(res, 400, `Invalid request body: ${err.message}`);
    return;
  }

  const sourceUrl = parsedBody.get('sourceUrl') || '';
  const csrfToken = parsedBody.get('_csrfToken') || '';
  if (!isHttpUrl(sourceUrl) || !csrfToken) {
    sendText(res, 400, 'sourceUrl and _csrfToken are required');
    return;
  }

  const source = new URL(sourceUrl);
  const basePrefix = source.pathname.includes('/nbrc/mrinda/') ? '/nbrc/mrinda' : '/mrinda';
  const postUrl = `${source.origin}${basePrefix}/list/`;

  const body = new URLSearchParams();
  body.set('_csrfToken', csrfToken);
  body.set('data[agree]', 'ok');

  let upstream;
  try {
    upstream = await requestUpstream(postUrl, {
      method: 'POST',
      session,
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: body.toString()
    });
  } catch (err) {
    sendText(res, 502, `Consent upstream request failed: ${err.message}`);
    return;
  }

  const location = resolveRedirectUrl(postUrl, upstream.headers.location)
    || `${source.origin}${basePrefix}/list/risk/bacteria/E`;
  const proxyUrl = `${getProxyOrigin(req)}/proxy?url=${encodeURIComponent(location)}`;

  sendText(
    res,
    200,
    JSON.stringify({ ok: true, redirectProxyUrl: proxyUrl }),
    'application/json; charset=utf-8'
  );
}

let _cachedGuidePatterns = null;
let _cachedPromptConfig = null;
let _cachedHomePageHtml = null;
let _generatedGuides = new Map(); // 生成ガイドをメモリに保存

// サイト別ガイドディレクトリマッピング（ホスト名 → ディレクトリ名）
const SITE_GUIDE_MAP = {
  'togodx.dbcls.jp': 'togodx',
  'www.nite.go.jp':  'nbrc',
  'nanbyodata.jp':   'nanbyodata'
};

const _siteGuideCache = new Map();

function loadSiteGuides(siteKey) {
  if (_siteGuideCache.has(siteKey)) return _siteGuideCache.get(siteKey);

  const patternPath = path.resolve(__dirname, `../guides/${siteKey}/guide-patterns.json`);
  if (!fs.existsSync(patternPath)) {
    _siteGuideCache.set(siteKey, []);
    return [];
  }

  try {
    const raw = fs.readFileSync(patternPath, 'utf-8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    const guides = normalizeGuidePatternPayload(parsed, `guides/${siteKey}/guide-patterns.json`);
    _siteGuideCache.set(siteKey, guides);
    return guides;
  } catch (err) {
    console.error(`Failed to load guides for site "${siteKey}": ${err.message}`);
    _siteGuideCache.set(siteKey, []);
    return [];
  }
}

// targetUrl のホスト名からサイト別ガイドを返す。マッチしない場合は null を返す
function getGuidesForTargetUrl(targetUrl) {
  if (!targetUrl) return null;
  try {
    const hostname = new URL(targetUrl).hostname;
    const siteKey = SITE_GUIDE_MAP[hostname];
    if (!siteKey) return null;
    return loadSiteGuides(siteKey);
  } catch {
    return null;
  }
}

function normalizeGuidePatternPayload(payload, sourceFile) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return [payload];
  console.warn(`Guide patterns in ${sourceFile} are not an object/array. Ignored.`);
  return [];
}

function loadGuidePatterns() {
  if (_cachedGuidePatterns) return _cachedGuidePatterns;

  try {
    const loaded = [];

    const guidesDir = path.resolve(__dirname, '../guides');
    if (fs.existsSync(guidesDir)) {
      const subDirs = fs.readdirSync(guidesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      subDirs.forEach((sub) => {
        const patternPath = path.join(guidesDir, sub, 'guide-patterns.json');
        if (!fs.existsSync(patternPath)) return;

        const raw = fs.readFileSync(patternPath, 'utf-8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        const normalized = normalizeGuidePatternPayload(parsed, `guides/${sub}/guide-patterns.json`);
        loaded.push(...normalized);
      });
    }

    _cachedGuidePatterns = loaded;
  } catch (err) {
    console.error(`Failed to load guide patterns: ${err.message}`);
    _cachedGuidePatterns = [];
  }

  return _cachedGuidePatterns;
}

function loadPromptConfig() {
  if (_cachedPromptConfig) return _cachedPromptConfig;

  try {
    const promptPath = path.resolve(__dirname, './guide-selection-prompt.json');
    if (!fs.existsSync(promptPath)) {
      console.error('guide-selection-prompt.json not found');
      return null;
    }
    const raw = fs.readFileSync(promptPath, 'utf-8');
    _cachedPromptConfig = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load prompt config: ${err.message}`);
    _cachedPromptConfig = null;
  }

  return _cachedPromptConfig;
}

function loadHomePageHtml() {
  if (_cachedHomePageHtml) return _cachedHomePageHtml;

  try {
    const promptConfig = loadPromptConfig();
    if (!promptConfig || !promptConfig.ui || !promptConfig.ui.html) {
      console.error('guide-selection-prompt.json に ui.html が見つかりません');
      return '<h1>Error</h1><p>UI HTML not found in config</p>';
    }
    _cachedHomePageHtml = promptConfig.ui.html;
  } catch (err) {
    console.error(`Failed to load home page HTML: ${err.message}`);
    _cachedHomePageHtml = '<h1>Error</h1><p>Failed to load UI HTML from config</p>';
  }

  return _cachedHomePageHtml;
}

async function callOllama(ollamaUri, modelName, prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/generate', ollamaUri);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const body = JSON.stringify({
      model: modelName,
      prompt: prompt,
      stream: false
    });

    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body)
    };
    // クラウド版（ollama.com）はAPIキー認証が必要
    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: headers,
      timeout: 120000
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Ollama responded with status ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const result = JSON.parse(data);
          resolve(result.response || '');
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timeout'));
    });

    req.write(body);
    req.end();
  });
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  return new Promise((resolve, reject) => {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
    const urlObj = new URL(url);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Gemini API error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const result = JSON.parse(data);
          const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(responseText);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gemini API request timeout'));
    });

    const body = JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: prompt }] }
      ]
    });

    req.write(body);
    req.end();
  });
}

// ガイド選択用に、ガイドの内容を要約したテキストを作る。
// トップレベルの description に加え、各ステップのタイトル・説明（HTMLタグ除去）を含める。
// これにより LLM が「Nステップ」ではなく実際の内容で判断できる。
function summarizeGuideForSelection(guide) {
  const parts = [];
  if (guide.description) {
    parts.push(String(guide.description).replace(/<[^>]+>/g, ' ').trim());
  }
  if (Array.isArray(guide.steps)) {
    const stepText = guide.steps
      .filter((s) => s.title || s.description)
      .map((s) => {
        const t = s.title ? String(s.title).trim() : '';
        const d = s.description ? String(s.description).replace(/<[^>]+>/g, ' ').trim() : '';
        return d ? `${t}: ${d}` : t;
      })
      .filter(Boolean)
      .join(' / ');
    if (stepText) parts.push(stepText);
  }
  const summary = parts.join(' — ');
  return summary || (guide.title || guide.guideId);
}

// ────────────────────────────────────────────────────
// 未知サイト向けブートストラップ
// ────────────────────────────────────────────────────

function runCrawl(targetUrl, outputDir) {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.resolve(__dirname, '../crawl_pages.py');
    const proc = spawn(pythonCmd, [scriptPath, '--url', targetUrl, '--output-dir', outputDir], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; console.log('[crawl]', d.toString().trimEnd()); });
    proc.stderr.on('data', (d) => { stderr += d; console.error('[crawl err]', d.toString().trimEnd()); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`crawl_pages.py exited with code ${code}:\n${stderr}`));
    });
    proc.on('error', reject);
  });
}

async function handleBootstrapSite(req, res) {
  if (req.method !== 'POST') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  let body;
  try {
    body = JSON.parse(await parseBody(req));
  } catch {
    sendText(res, 400, JSON.stringify({ error: 'Invalid JSON' }), 'application/json; charset=utf-8');
    return;
  }

  const { targetUrl, ollamaUri, modelName, apiKey, prompt } = body;
  if (!targetUrl) {
    sendText(res, 400, JSON.stringify({ error: 'targetUrl is required' }), 'application/json; charset=utf-8');
    return;
  }

  let hostname;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    sendText(res, 400, JSON.stringify({ error: 'Invalid targetUrl' }), 'application/json; charset=utf-8');
    return;
  }

  const proxyUrl = `/proxy?url=${encodeURIComponent(targetUrl)}`;

  // 既知サイトはそのまま転送
  if (SITE_GUIDE_MAP[hostname]) {
    sendText(res, 200, JSON.stringify({ ok: true, bootstrapped: false, proxyUrl }),
      'application/json; charset=utf-8');
    return;
  }

  // guides/{hostname}/guide-patterns.json が既に存在する場合は登録して転送
  const guidesDir = path.resolve(__dirname, '../guides');
  const siteDir   = path.join(guidesDir, hostname);
  const patternPath = path.join(siteDir, 'guide-patterns.json');

  if (fs.existsSync(patternPath)) {
    SITE_GUIDE_MAP[hostname] = hostname;
    sendText(res, 200, JSON.stringify({ ok: true, bootstrapped: false, proxyUrl }),
      'application/json; charset=utf-8');
    return;
  }

  // LLM 設定が必要
  if (!ollamaUri || !modelName) {
    sendText(res, 400, JSON.stringify({ error: 'ollamaUri と modelName は未知サイトのガイド生成に必要です' }),
      'application/json; charset=utf-8');
    return;
  }

  try {
    // 1. 出力ディレクトリ作成
    fs.mkdirSync(siteDir, { recursive: true });

    // 2. クロール実行
    console.log(`[bootstrap] クロール開始: ${targetUrl} -> ${siteDir}`);
    await runCrawl(targetUrl, siteDir);

    // 3. クロール結果読み込み（selector_info + markdown）
    const crawlFiles = fs.readdirSync(siteDir);
    let crawlContext = '';

    const siFile = crawlFiles.find((f) => f.endsWith('_selector_info.json') && !f.startsWith('menu_'));
    if (siFile) {
      const raw = fs.readFileSync(path.join(siteDir, siFile), 'utf-8');
      crawlContext += `\n\n=== ${siFile} ===\n${raw.slice(0, 8000)}`;
    }
    const mdFile = crawlFiles.find((f) => f.endsWith('.md') && !f.startsWith('menu_'));
    if (mdFile) {
      const raw = fs.readFileSync(path.join(siteDir, mdFile), 'utf-8');
      crawlContext += `\n\n=== ${mdFile} (Markdown) ===\n${raw.slice(0, 3000)}`;
    }

    // 4. GUIDE_AUTHORING.md 読み込み
    const authoringPath = path.resolve(__dirname, '../GUIDE_AUTHORING.md');
    const authoringMd = fs.existsSync(authoringPath)
      ? fs.readFileSync(authoringPath, 'utf-8').slice(0, 6000)
      : '';

    // 5. 既存ガイドの例を1件読み込む
    let exampleGuides = '';
    if (fs.existsSync(guidesDir)) {
      const dirs = fs.readdirSync(guidesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== hostname)
        .map((d) => d.name);
      if (dirs.length > 0) {
        const exPath = path.join(guidesDir, dirs[0], 'guide-patterns.json');
        if (fs.existsSync(exPath)) {
          exampleGuides = fs.readFileSync(exPath, 'utf-8').slice(0, 4000);
        }
      }
    }

    // 6. LLM プロンプト構築
    const generatePrompt = [
      '以下は guide-patterns.json の作成仕様書です：',
      authoringMd,
      '',
      '以下は既存の guide-patterns.json の例です（参考）：',
      exampleGuides,
      '',
      '以下は対象サイトのクロール結果です：',
      `対象URL: ${targetUrl}`,
      crawlContext,
      '',
      ...(prompt ? [`ユーザーのリクエスト：「${prompt}」`, ''] : []),
      '【指示】',
      '上記の仕様書の形式と例に従い、このサイト向けの guide-patterns.json を生成してください。',
      '- JSON 配列 [...] のみを返してください',
      '- 各ガイドは guideId, version, locale, title, steps を持つこと',
      '- steps は 3〜6 件程度、selector は上記クロール結果を参考に正確なCSSセレクタを使うこと',
      ...(prompt ? ['- 特に「' + prompt + '」に関連するガイドを優先して含めること'] : []),
      '- 他の説明文は不要です。JSON のみ返してください。',
    ].join('\n');

    // 7. LLM 呼び出し
    console.log('[bootstrap] LLMでガイド生成中...');
    const llmResponse = await callOllama(ollamaUri, modelName, generatePrompt, apiKey);

    // 8. JSON 配列を抽出
    const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('LLMがJSON配列を返しませんでした');
    const guides = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(guides)) throw new Error('LLMのレスポンスがJSON配列ではありません');

    // 9. guides/{hostname}/guide-patterns.json に保存
    fs.writeFileSync(patternPath, JSON.stringify(guides, null, 2), 'utf-8');
    console.log(`[bootstrap] 保存: ${patternPath} (${guides.length}件)`);

    // 10. キャッシュ更新
    SITE_GUIDE_MAP[hostname] = hostname;
    _siteGuideCache.delete(hostname);
    _cachedGuidePatterns = null;

    sendText(res, 200, JSON.stringify({
      ok: true,
      bootstrapped: true,
      guideCount: guides.length,
      proxyUrl
    }), 'application/json; charset=utf-8');

  } catch (err) {
    console.error('[bootstrap] エラー:', err.message);
    sendText(res, 502, JSON.stringify({ error: err.message }), 'application/json; charset=utf-8');
  }
}

async function handleGenerateGuide(req, res) {
  if (req.method !== 'POST') {
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  let body;
  try {
    body = await parseBody(req);
    body = JSON.parse(body);
  } catch (err) {
    sendText(res, 400, JSON.stringify({ error: 'Invalid JSON' }), 'application/json; charset=utf-8');
    return;
  }

  const { ollamaUri, modelName, prompt, apiKey } = body;
  if (!ollamaUri || !modelName || !prompt) {
    sendText(res, 400, JSON.stringify({ error: 'ollamaUri, modelName, and prompt are required' }), 'application/json; charset=utf-8');
    return;
  }

  try {
    // 既存ガイドを取得
    const patterns = loadGuidePatterns();
    const allGuides = [ECOLI_GUIDE, ...patterns];
    const guidesList = allGuides.map(g => ({
      guideId: g.guideId,
      title: g.title || g.guideId,
      description: summarizeGuideForSelection(g)
    }));

    // LLM プロンプト - Phase 1: 既存ガイド選択
    const promptConfig = loadPromptConfig();
    if (!promptConfig || !promptConfig.phase1 || !promptConfig.phase1.template) {
      throw new Error('Prompt config not loaded or phase1 template not found');
    }

    const phase1Prompt = promptConfig.phase1.template
      .split('{GUIDES_LIST}').join(JSON.stringify(guidesList, null, 2))
      .split('{USER_PROMPT}').join(prompt);

    // デバッグ: ユーザープロンプトと候補ガイドを確認
    console.log('=== handleGenerateGuide ===');
    console.log('User prompt:', prompt);
    console.log('Guides for selection:', guidesList.map(g => `${g.guideId}: ${g.title}`).join(', '));

    const ollamaResponse = await callOllama(ollamaUri, modelName, phase1Prompt, apiKey);

    // JSON を抽出
    const jsonMatch = ollamaResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Valid JSON not found in Ollama response');
    }

    const selectionResult = JSON.parse(jsonMatch[0]);
    
    // デバッグ出力
    console.log('LLM Response:', JSON.stringify(selectionResult, null, 2));

    // 既存ガイドが選択された場合
    if (selectionResult.selectedGuideId) {
      const selectedGuideId = selectionResult.selectedGuideId;
      const selectedGuide = allGuides.find(g => g.guideId === selectedGuideId);
      
      if (selectedGuide) {
        // 既存ガイドが見つかった
        sendText(res, 200, JSON.stringify({
          ok: true,
          selectedGuideId: selectedGuideId,
          guideTitle: selectedGuide.title || selectedGuideId,
          keywords: selectionResult.keywords || [],
          reasoning: selectionResult.reasoning || '',
          guideJson: selectedGuide
        }), 'application/json; charset=utf-8');
        return;
      }
    }

    // 新規ガイド生成の場合（fallback）
    // AI が適切なガイドを判断できなかった場合は、基本操作の概要ガイドを表示する。
    const FALLBACK_GUIDE_ID = 'nbrc-basic-overview';
    const fallbackGuide = allGuides.find(g => g.guideId === FALLBACK_GUIDE_ID);
    if (fallbackGuide) {
      console.log(`No guide selected by AI. Falling back to "${FALLBACK_GUIDE_ID}".`);
      sendText(res, 200, JSON.stringify({
        ok: true,
        selectedGuideId: FALLBACK_GUIDE_ID,
        guideTitle: fallbackGuide.title || FALLBACK_GUIDE_ID,
        keywords: selectionResult.keywords || [],
        reasoning: selectionResult.reasoning || 'AIが適切なガイドを判断できなかったため、基本操作の概要を表示します。',
        fallback: true,
        guideJson: fallbackGuide
      }), 'application/json; charset=utf-8');
      return;
    }

    // フォールバックガイドも見つからない場合
    const guideId = `generated-${Date.now()}`;
    const title = 'Generated Guide';
    
    sendText(res, 200, JSON.stringify({
      ok: true,
      guideId: guideId,
      title: title
    }), 'application/json; charset=utf-8');
  } catch (err) {
    sendText(res, 502, JSON.stringify({ error: err.message }), 'application/json; charset=utf-8');
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

  if (reqUrl.pathname === '/') {
    sendText(res, 200, renderHomePage(), 'text/html; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/proxy') {
    await handleProxy(req, res, reqUrl);
    return;
  }

  if (reqUrl.pathname === '/consent') {
    await handleConsent(req, res);
    return;
  }

  if (reqUrl.pathname === '/api/generate-guide') {
    await handleGenerateGuide(req, res);
    return;
  }

  if (reqUrl.pathname === '/api/bootstrap-site') {
    await handleBootstrapSite(req, res);
    return;
  }

  if (reqUrl.pathname === '/api/guides') {
    // ?url= が指定された場合はサイト別ガイドのみ返す
    const targetUrl = reqUrl.searchParams.get('url') || '';
    const siteGuides = getGuidesForTargetUrl(targetUrl);

    let guides;
    if (siteGuides !== null) {
      // サイトが識別できた場合はそのサイトのガイドのみ
      guides = [...siteGuides];
    } else {
      // URL 未指定またはマッチなし: 全ガイド（後方互換）
      const patterns = loadGuidePatterns();
      guides = [ECOLI_GUIDE, ...patterns];
      _generatedGuides.forEach((g) => guides.push(g));
    }

    sendText(res, 200, JSON.stringify({
      count: guides.length,
      guides: guides.map(g => ({
        guideId: g.guideId,
        version: g.version,
        locale: g.locale,
        title: g.title || g.guideId
      }))
    }), 'application/json; charset=utf-8');
    return;
  }

  if (reqUrl.pathname.startsWith('/api/guides/')) {
    const guideId = decodeURIComponent(reqUrl.pathname.replace('/api/guides/', ''));
    const targetUrl = reqUrl.searchParams.get('url') || '';

    // サイト別ガイドから検索
    const siteGuides = getGuidesForTargetUrl(targetUrl);
    if (siteGuides !== null) {
      const guide = siteGuides.find(g => g.guideId === guideId);
      if (guide) {
        sendText(res, 200, JSON.stringify(guide), 'application/json; charset=utf-8');
        return;
      }
      sendText(res, 404, JSON.stringify({ error: 'Guide not found' }), 'application/json; charset=utf-8');
      return;
    }

    // URL 未指定: 後方互換（全ガイドから検索）
    if (guideId === ECOLI_GUIDE.guideId) {
      sendText(res, 200, JSON.stringify(ECOLI_GUIDE), 'application/json; charset=utf-8');
      return;
    }
    const patterns = loadGuidePatterns();
    const guide = patterns.find(p => p.guideId === guideId);
    if (guide) {
      sendText(res, 200, JSON.stringify(guide), 'application/json; charset=utf-8');
      return;
    }
    const generatedGuide = _generatedGuides.get(guideId);
    if (generatedGuide) {
      sendText(res, 200, JSON.stringify(generatedGuide), 'application/json; charset=utf-8');
      return;
    }
    sendText(res, 404, JSON.stringify({ error: 'Guide not found' }), 'application/json; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/static/inject.js') {
    serveFile(res, path.join(STATIC_DIR, 'inject.js'), 'application/javascript; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/static/interceptor.js') {
    serveFile(res, path.join(STATIC_DIR, 'interceptor.js'), 'application/javascript; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/static/inject.css') {
    serveFile(res, path.join(STATIC_DIR, 'inject.css'), 'text/css; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/assets/driver.js') {
    const iife = path.join(__dirname, 'node_modules', 'driver.js', 'dist', 'driver.js.iife.js');
    serveFile(res, iife, 'application/javascript; charset=utf-8');
    return;
  }

  if (reqUrl.pathname === '/assets/driver.css') {
    const css = path.join(__dirname, 'node_modules', 'driver.js', 'dist', 'driver.css');
    serveFile(res, css, 'text/css; charset=utf-8');
    return;
  }

  sendText(res, 404, 'Not found');
});

server.listen(PORT, () => {
  console.log(`Guide proxy is running at http://localhost:${PORT}`);
  console.log('Using Ollama for guide selection');
});
