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

// E. coli Guide JSON definition
const ECOLI_GUIDE = {
  guideId: 'nite-bacteria-ecoli-search',
  version: 1,
  locale: 'en-US',
  title: 'Search for E. coli',
  steps: [
    {
      id: 'intro',
      selector: 'body',
      action: 'tooltip',
      title: 'E. coli Guide',
      description: 'This guide provides instructions on how to search for "E. coli".'
    },
    {
      id: 'e-button',
      selector: 'a[title="E"]',
      action: 'highlight',
      title: 'Click the "E" Button',
      description: 'Click the initial letter of the target microorganism. Clicking "E" will display bacteria starting with E.'
    },
    {
      id: 'search',
      selector: 'input[type="text"]',
      action: 'highlight',
      title: 'Search (Filtering)',
      description: 'Enter the bacteria name here to filter the list in real-time. Example: Try typing <strong>E coli</strong>.'
    },
    {
      id: 'bacteria-list',
      selector: '#tblUList',
      action: 'highlight',
      title: 'Bacteria List',
      description: 'Scientific names, BSL classifications, and regulatory information are summarized here. Click a row to go to the details page.'
    },
    {
      id: 'done',
      selector: 'body',
      action: 'complete',
      title: 'Guide Completed',
      description: 'The E. coli guide overview is finished.'
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

    // Set Content-Length automatically
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
    // Follow redirect with GET only
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

// Domains requiring Origin/Referer headers (NanbyoData / SPARQList etc.)
// TogoDX and other Vite SPAs are excluded (as the Origin header can cause errors)
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
 * Rewrites static resource URLs in HTML to go via the proxy.
 * Targets <link href>, <script src>, <img src>, and <form action>.
 * <a href> is handled by inject.js on the client side.
 */
function rewriteResourceUrls(html, targetUrl, proxyOrigin) {
  const base = new URL(targetUrl);

  // Do not proxy framework-specific non-content static files.
  // This keeps document.currentScript.src as the original URL,
  // resolving Next.js InvariantErrors (like checks for "/_next/").
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
      // Framework static files (direct=true) use the direct URL
      if (direct && isFrameworkStatic(abs)) return abs;
      return `${proxyOrigin}/proxy?url=${encodeURIComponent(abs)}`;
    } catch {
      return href;
    }
  }

  // <link href="..."> — Also remove integrity/crossorigin to prevent SRI failure after URL change
  html = html.replace(/(<link\b[^>]*?\bhref=)(["'])([^"']*)\2/gi,
    (_, pre, q, href) => `${pre}${q}${toProxyUrl(href, true)}${q}`);
  html = html.replace(/(<link\b[^>]*)\s+integrity=["'][^"']*["']/gi, '$1');
  html = html.replace(/(<link\b[^>]*)\s+crossorigin=["'][^"']*["']/gi, '$1');

  // <script src="..."> — Also remove integrity/crossorigin to prevent SRI + CORS failure
  html = html.replace(/(<script\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi,
    (_, pre, q, src) => `${pre}${q}${toProxyUrl(src, true)}${q}`);
  html = html.replace(/(<script\b[^>]*)\s+integrity=["'][^"']*["']/gi, '$1');
  html = html.replace(/(<script\b[^>]*)\s+crossorigin=["'][^"']*["']/gi, '$1');

  // <img src="...">
  html = html.replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi,
    (_, pre, q, src) => `${pre}${q}${toProxyUrl(src)}${q}`);

  // <form action="..."> ← Important: prevents login/auth forms from pointing directly to upstream
  html = html.replace(/(<form\b[^>]*?\baction=)(["'])([^"']*)\2/gi,
    (_, pre, q, action) => `${pre}${q}${toProxyUrl(action)}${q}`);

  return html;
}

function injectIntoHtml(html, targetUrl, proxyOrigin) {
  // First, rewrite resource URLs to go through the proxy (do not use <base> tag)
  html = rewriteResourceUrls(html, targetUrl, proxyOrigin);

  // Escaping with JSON.stringify is safe within script tags as it avoids HTML entities like &amp;
  const jsProxyOrigin = JSON.stringify(proxyOrigin);
  const jsTargetUrl   = JSON.stringify(targetUrl);
  const safeOrigin    = escapeHtml(proxyOrigin); // for href attribute

  // Fetch / XHR interceptor:
  // Inline script only sets variables; logic is separated into an external file (interceptor.js).
  // Inserting at the start of <head> without "defer" ensures it runs before the site's own JS.
  const interceptorScript = [
    `<script>window.__GUIDE_PROXY_ORIGIN__=${jsProxyOrigin};window.__GUIDE_PROXY_TARGET_URL__=${jsTargetUrl};</script>`,
    `<script src="${safeOrigin}/static/interceptor.js"></script>`
  ].join('\n');

  // driver.js / driver.css: use local from node_modules if available, otherwise use CDN
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

  // Inject interceptor at the start of <head> and deferred assets just before </head>
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
 * Rewrites ES module import/export specifiers to absolute URLs via the proxy.
 * Since relative imports (./foo.js) aren't correctly resolved in query-based
 * proxy URLs (?url=...), we apply this transformation to JavaScript responses.
 */
function rewriteJsModuleImports(jsCode, moduleUrl, proxyOrigin) {
  function resolveSpec(spec) {
    if (!spec) return spec;
    if (/^(data:|blob:)/i.test(spec)) return spec;
    let abs;
    try {
      // Resolve both relative (./ ../ /) and absolute http(s). Bare specifiers remain unchanged as exceptions.
      abs = new URL(spec, moduleUrl).href;
    } catch {
      return spec;
    }
    if (!/^https?:/i.test(abs)) return spec;
    if (abs.startsWith(proxyOrigin)) return spec;
    return `${proxyOrigin}/proxy?url=${encodeURIComponent(abs)}`;
  }

  // import ... from '...' / export ... from '...'
  jsCode = jsCode.replace(
    /(\b(?:import|export)\b[^'"]*?\bfrom\s*)(["'])([^"']+)\2/g,
    (_, pre, q, spec) => `${pre}${q}${resolveSpec(spec)}${q}`
  );

  // Side-effect import '...' (without from)
  jsCode = jsCode.replace(
    /(\bimport\s*)(["'])([^"']+)\2/g,
    (m, pre, q, spec) => `${pre}${q}${resolveSpec(spec)}${q}`
  );

  // Dynamic import('...')
  jsCode = jsCode.replace(
    /(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g,
    (_, pre, q, spec, post) => `${pre}${q}${resolveSpec(spec)}${q}${post}`
  );

  return jsCode;
}

/**
 * Rewrites url(...) and @import references in CSS to absolute URLs via the proxy.
 * Necessary because relative references (../webfonts/x.ttf) don't resolve correctly
 * with query-based proxy URLs.
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

  // url(...) (handles both quoted/unquoted)
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

  // Read POST body (form submission support)
  let upstreamMethod = req.method; // GET or POST or PUT etc
  let upstreamBody = null;
  let upstreamHeaders = {};

  // For APIs like NanbyoData / SPARQList, Origin / Referer are required.
  // Vite SPAs like TogoDX are excluded as adding these headers causes errors.
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

    // Pass Content-Type as is (for form-data or JSON)
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

  // For JavaScript:
  // - NanbyoData / NBRC etc. (NEEDS_ORIGIN_DOMAINS): Rewrite relative ES module imports to go through the proxy.
  // - TogoDX etc. Vite SPA: Skip because rewriteJsModuleImports breaks the Vite bundle.
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

  // For CSS, rewrite relative references in url(...) and @import to absolute URLs via the proxy.
  // (Prevents @font-face fonts etc. from resolving to proxy root and causing a 404)
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
let _generatedGuides = new Map(); // Store generated guides in memory

// Mapping of site-specific guide directories (hostname -> directory name)
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

// Returns site-specific guides based on the targetUrl hostname. Returns null if no match.
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
  // Re-read home page UI from file on every request (allows immediate updates to 
  // guide-selection-prompt.json without server restart).
  try {
    const promptPath = path.resolve(__dirname, './guide-selection-prompt.json');
    const raw = fs.readFileSync(promptPath, 'utf-8').replace(/^\uFEFF/, '');
    const promptConfig = JSON.parse(raw);
    if (!promptConfig || !promptConfig.ui || !promptConfig.ui.html) {
      console.error('ui.html not found in guide-selection-prompt.json');
      return '<h1>Error</h1><p>UI HTML not found in config</p>';
    }
    return promptConfig.ui.html;
  } catch (err) {
    console.error(`Failed to load home page HTML: ${err.message}`);
    return '<h1>Error</h1><p>Failed to load UI HTML from config</p>';
  }
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
    // Cloud version (ollama.com) requires API key authentication
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

async function callGemini(modelName, prompt, apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('Gemini API key is required (apiKey parameter or GEMINI_API_KEY environment variable)');
  }
  const model = modelName || 'gemini-2.0-flash';

  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini API request timeout')); });
    req.write(JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }));
    req.end();
  });
}

async function callOpenAI(modelName, prompt, apiKey) {
  if (!apiKey) {
    throw new Error('OpenAI API key is required (apiKey parameter)');
  }
  const model = modelName || 'gpt-4o-mini';

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`OpenAI API error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const result = JSON.parse(data);
          resolve(result.choices?.[0]?.message?.content || '');
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI API request timeout')); });
    req.write(JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false
    }));
    req.end();
  });
}

async function callClaude(modelName, prompt, apiKey) {
  if (!apiKey) {
    throw new Error('Claude API key is required (apiKey parameter)');
  }
  const model = modelName || 'claude-3-5-haiku-20241022';

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Claude API error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const result = JSON.parse(data);
          resolve(result.content?.[0]?.text || '');
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude API request timeout')); });
    req.write(JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    }));
    req.end();
  });
}

/**
 * Dispatcher for calling LLMs based on the provider.
 * provider: 'ollama' | 'openai' | 'claude' | 'gemini'
 */
async function callLLM(provider, { ollamaUri, modelName, prompt, apiKey }) {
  switch ((provider || 'ollama').toLowerCase()) {
    case 'ollama':  return callOllama(ollamaUri, modelName, prompt, apiKey);
    case 'openai':  return callOpenAI(modelName, prompt, apiKey);
    case 'claude':  return callClaude(modelName, prompt, apiKey);
    case 'gemini':  return callGemini(modelName, prompt, apiKey);
    default: throw new Error(`Unsupported provider: ${provider} (ollama / openai / claude / gemini)`);
  }
}

// Generates a summary text of the guide content for guide selection.
// Includes top-level description and step titles/descriptions (HTML tags removed).
// This allows the LLM to make decisions based on actual content rather than just step count.
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
// Bootstrap for unknown sites
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

  const { targetUrl, provider = 'ollama', ollamaUri, modelName, apiKey, prompt } = body;
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

  // Redirect known sites directly
  if (SITE_GUIDE_MAP[hostname]) {
    sendText(res, 200, JSON.stringify({ ok: true, bootstrapped: false, proxyUrl }),
      'application/json; charset=utf-8');
    return;
  }

  // If guides/{hostname}/guide-patterns.json already exists, register and redirect
  const guidesDir = path.resolve(__dirname, '../guides');
  const siteDir   = path.join(guidesDir, hostname);
  const patternPath = path.join(siteDir, 'guide-patterns.json');

  if (fs.existsSync(patternPath)) {
    SITE_GUIDE_MAP[hostname] = hostname;
    sendText(res, 200, JSON.stringify({ ok: true, bootstrapped: false, proxyUrl }),
      'application/json; charset=utf-8');
    return;
  }

  // LLM settings are required
  if (!modelName) {
    sendText(res, 400, JSON.stringify({ error: 'modelName is required for generating guides for unknown sites' }),
      'application/json; charset=utf-8');
    return;
  }
  if (provider === 'ollama' && !ollamaUri) {
    sendText(res, 400, JSON.stringify({ error: 'ollamaUri is required for Ollama' }),
      'application/json; charset=utf-8');
    return;
  }

  try {
    // 1. Create output directory
    fs.mkdirSync(siteDir, { recursive: true });

    // 2. Execute crawl
    console.log(`[bootstrap] Starting crawl: ${targetUrl} -> ${siteDir}`);
    await runCrawl(targetUrl, siteDir);

    // 3. Load crawl results (selector_info + markdown)
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

    // 4. Load GUIDE_AUTHORING.md
    const authoringPath = path.resolve(__dirname, '../GUIDE_AUTHORING.md');
    const authoringMd = fs.existsSync(authoringPath)
      ? fs.readFileSync(authoringPath, 'utf-8').slice(0, 6000)
      : '';

    // 5. Load one example of an existing guide
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

    // 6. Build LLM prompt
    const generatePrompt = [
      'Below is the creation specification for guide-patterns.json:',
      authoringMd,
      '',
      'Below are examples of existing guide-patterns.json files (for reference):',
      exampleGuides,
      '',
      'Below are the crawl results for the target site:',
      `Target URL: ${targetUrl}`,
      crawlContext,
      '',
      ...(prompt ? [`User request: "${prompt}"`, ''] : []),
      '【Instructions】',
      'Follow the format and examples in the specification above to generate a guide-patterns.json file for this site.',
      '- Return ONLY a JSON array [...]',
      '- Each guide MUST have guideId, version, locale, title, and steps',
      '- Include approximately 3-6 steps, using accurate CSS selectors based on the crawl results provided above',
      ...(prompt ? ['- Prioritize including guides related to "' + prompt + '"'] : []),
      '- No other explanatory text is required. Return ONLY the JSON.',
    ].join('\n');

    // 7. Call LLM
    console.log(`[bootstrap] Generating guide with LLM... (provider=${provider}, model=${modelName})`);
    const llmResponse = await callLLM(provider, { ollamaUri, modelName, prompt: generatePrompt, apiKey });

    // 8. Extract JSON array
    const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('LLM did not return a JSON array');
    const guides = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(guides)) throw new Error('LLM response is not a JSON array');

    // 9. Save to guides/{hostname}/guide-patterns.json
    fs.writeFileSync(patternPath, JSON.stringify(guides, null, 2), 'utf-8');
    console.log(`[bootstrap] Saved: ${patternPath} (${guides.length} guides)`);

    // 10. Update cache
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
    console.error('[bootstrap] Error:', err.message);
    sendText(res, 502, JSON.stringify({ error: err.message }), 'application/json; charset=utf-8');
  }
}

    // 8. Extract JSON array
    const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('LLM did not return a JSON array');
    const guides = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(guides)) throw new Error('LLM response is not a JSON array');

    // 9. Save to guides/{hostname}/guide-patterns.json
    fs.writeFileSync(patternPath, JSON.stringify(guides, null, 2), 'utf-8');
    console.log(`[bootstrap] Saved: ${patternPath} (${guides.length} guides)`);

    // 10. Cache update
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
    console.error('[bootstrap] Error:', err.message);
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

  const { provider = 'ollama', ollamaUri, modelName, prompt, apiKey, targetUrl } = body;
  if (!modelName || !prompt) {
    sendText(res, 400, JSON.stringify({ error: 'modelName and prompt are required' }), 'application/json; charset=utf-8');
    return;
  }
  if (provider === 'ollama' && !ollamaUri) {
    sendText(res, 400, JSON.stringify({ error: 'ollamaUri is required for Ollama' }), 'application/json; charset=utf-8');
    return;
  }

  try {
    // Only use guides for the target site (avoid mixing in guides from other sites)
    const siteGuides = targetUrl ? getGuidesForTargetUrl(targetUrl) : null;
    if (!siteGuides || siteGuides.length === 0) {
      // Skip guide selection if no guides exist for the target site
      sendText(res, 200, JSON.stringify({ ok: true, selectedGuideId: null }),
        'application/json; charset=utf-8');
      return;
    }
    const allGuides = siteGuides;
    const guidesList = allGuides.map(g => ({
      guideId: g.guideId,
      title: g.title || g.guideId,
      description: summarizeGuideForSelection(g)
    }));

    // LLM Prompt - Phase 1: Existing Guide Selection
    const promptConfig = loadPromptConfig();
    if (!promptConfig || !promptConfig.phase1 || !promptConfig.phase1.template) {
      throw new Error('Prompt config not loaded or phase1 template not found');
    }

    const phase1Prompt = promptConfig.phase1.template
      .split('{GUIDES_LIST}').join(JSON.stringify(guidesList, null, 2))
      .split('{USER_PROMPT}').join(prompt);

    // Debug: Check user prompt and candidate guides
    console.log('=== handleGenerateGuide ===');
    console.log('User prompt:', prompt);
    console.log('Guides for selection:', guidesList.map(g => `${g.guideId}: ${g.title}`).join(', '));

    const ollamaResponse = await callLLM(provider, { ollamaUri, modelName, prompt: phase1Prompt, apiKey });

    // Extract JSON
    const jsonMatch = ollamaResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Valid JSON not found in Ollama response');
    }

    const selectionResult = JSON.parse(jsonMatch[0]);
    
    // Debug output
    console.log('LLM Response:', JSON.stringify(selectionResult, null, 2));

    // If an existing guide is selected
    if (selectionResult.selectedGuideId) {
      const selectedGuideId = selectionResult.selectedGuideId;
      const selectedGuide = allGuides.find(g => g.guideId === selectedGuideId);
      
      if (selectedGuide) {
        // Existing guide found
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

    // If the LLM determines a new guide is needed: Generate and save a new guide using existing crawl results
    if (selectionResult.needsNewGuide && targetUrl) {
      console.log('[generate-guide] New pattern detected -> Generating new guide:', selectionResult.reasoning);
      try {
        const newGuideHostname = (() => { try { return new URL(targetUrl).hostname; } catch { return ''; } })();
        const newGuideSiteKey = SITE_GUIDE_MAP[newGuideHostname];
        if (!newGuideSiteKey) throw new Error(`Site not registered in SITE_GUIDE_MAP: ${newGuideHostname}`);

        const guidesBaseDir = path.resolve(__dirname, '../guides');
        const newGuideSiteDir = path.join(guidesBaseDir, newGuideSiteKey);
        const newGuidePatternPath = path.join(newGuideSiteDir, 'guide-patterns.json');

        // Load crawl results (existing selector_info.json / .md)
        let newGuideCrawlContext = '';
        if (fs.existsSync(newGuideSiteDir)) {
          const siteFiles = fs.readdirSync(newGuideSiteDir);
          const siFile = siteFiles.find(f => f.endsWith('_selector_info.json') && !f.startsWith('menu_'));
          if (siFile) {
            const raw = fs.readFileSync(path.join(newGuideSiteDir, siFile), 'utf-8');
            newGuideCrawlContext += `\n\n=== ${siFile} ===\n${raw.slice(0, 8000)}`;
          }
          const mdFile = siteFiles.find(f => f.endsWith('.md') && !f.startsWith('menu_'));
          if (mdFile) {
            const raw = fs.readFileSync(path.join(newGuideSiteDir, mdFile), 'utf-8');
            newGuideCrawlContext += `\n\n=== ${mdFile} (Markdown) ===\n${raw.slice(0, 3000)}`;
          }
        }

        const authoringPath = path.resolve(__dirname, '../GUIDE_AUTHORING.md');
        const authoringMd = fs.existsSync(authoringPath)
          ? fs.readFileSync(authoringPath, 'utf-8').slice(0, 6000)
          : '';

        // Provide existing guides as examples (include ID list to prevent duplicate guideIds)
        const existingGuideIds = allGuides.map(g => g.guideId).join(', ');
        const existingGuidesJson = JSON.stringify(allGuides.slice(0, 2), null, 2).slice(0, 4000);

        const newGuidePrompt = [
          'Below is the creation specification for guide-patterns.json:',
          authoringMd,
          '',
          'Below are examples of existing guides for the same site (for reference):',
          existingGuidesJson,
          '',
          `List of existing guide IDs (DO NOT DUPLICATE): ${existingGuideIds}`,
          '',
          'Below are the crawl results for the target site:',
          `Target URL: ${targetUrl}`,
          newGuideCrawlContext,
          '',
          `User request: "${prompt}"`,
          '',
          '【Instructions】',
          'Following the specification and existing guides above, generate exactly one new guide that addresses this user request.',
          '- Return ONLY a JSON object {...} (not an array, just a single object)',
          '- Make guideId a unique string that does not overlap with the existing ID list',
          '- MUST include guideId, version, locale, title, and steps',
          '- Include approximately 3-6 steps, using accurate CSS selectors based on the crawl results provided above',
          '- No other explanatory text is required. Return ONLY the JSON.'
        ].join('\n');

        console.log(`[generate-guide] Generating new guide with LLM... (provider=${provider}, model=${modelName})`);
        const newGuideResponse = await callLLM(provider, { ollamaUri, modelName, prompt: newGuidePrompt, apiKey });

        const newJsonMatch = newGuideResponse.match(/\{[\s\S]*\}/);
        if (!newJsonMatch) throw new Error('LLM did not return a JSON object for the new guide');
        const newGuide = JSON.parse(newJsonMatch[0]);
        if (!newGuide.guideId || !Array.isArray(newGuide.steps)) throw new Error('Invalid format for the generated guide');

        // Append to existing guide-patterns.json and save
        const existingRaw = fs.existsSync(newGuidePatternPath)
          ? fs.readFileSync(newGuidePatternPath, 'utf-8').replace(/^\uFEFF/, '')
          : '[]';
        const existingArray = JSON.parse(existingRaw);
        existingArray.push(newGuide);
        fs.writeFileSync(newGuidePatternPath, JSON.stringify(existingArray, null, 2), 'utf-8');
        console.log(`[generate-guide] Appended and saved new guide: ${newGuide.guideId} -> ${newGuidePatternPath}`);

        // Update cache
        _siteGuideCache.delete(newGuideSiteKey);
        _cachedGuidePatterns = null;

        sendText(res, 200, JSON.stringify({
          ok: true,
          selectedGuideId: newGuide.guideId,
          guideTitle: newGuide.title || newGuide.guideId,
          keywords: selectionResult.keywords || [],
          reasoning: selectionResult.reasoning || '',
          newGuideCreated: true,
          guideJson: newGuide
        }), 'application/json; charset=utf-8');
        return;
      } catch (newGuideErr) {
        console.error('[generate-guide] New guide generation error:', newGuideErr.message);
        // Continue to fallback in case of error
      }
    }

    // Fallback for new guide generation
    // If the AI could not determine an appropriate guide, display a basic operation overview guide.
    const FALLBACK_GUIDE_ID = 'nbrc-basic-overview';
    const fallbackGuide = allGuides.find(g => g.guideId === FALLBACK_GUIDE_ID);
    if (fallbackGuide) {
      console.log(`No guide selected by AI. Falling back to "${FALLBACK_GUIDE_ID}".`);
      sendText(res, 200, JSON.stringify({
        ok: true,
        selectedGuideId: FALLBACK_GUIDE_ID,
        guideTitle: fallbackGuide.title || FALLBACK_GUIDE_ID,
        keywords: selectionResult.keywords || [],
        reasoning: selectionResult.reasoning || 'AI could not determine an appropriate guide, so a basic overview of operations is displayed.',
        fallback: true,
        guideJson: fallbackGuide
      }), 'application/json; charset=utf-8');
      return;
    }

    // If fallback guide is also not found
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
    // If ?url= is specified, return only site-specific guides
    const targetUrl = reqUrl.searchParams.get('url') || '';
    const siteGuides = getGuidesForTargetUrl(targetUrl);

    let guides;
    if (siteGuides !== null) {
      // If site is identified, return only that site's guides
      guides = [...siteGuides];
    } else {
      // Unspecified URL or no match: All guides (backward compatibility)
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

    // Search from site-specific guides
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

    // Unspecified URL: Backward compatibility (search from all guides)
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
