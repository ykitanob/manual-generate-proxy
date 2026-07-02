(function () {
  const RESUME_KEY = 'guideProxyResume';
  const MENU_COLLAPSED_KEY = 'guideProxyMenuCollapsed';
  let driverPopoverDragEnabled = false;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function isolateFromPageHandlers(el) {
    if (!el || el.dataset.guideProxyIsolated === '1') return;
    el.dataset.guideProxyIsolated = '1';

    const stopBubble = (ev) => {
      ev.stopPropagation();
    };

    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((type) => {
      el.addEventListener(type, stopBubble);
    });
  }

  function makeDriverPopoverDraggable(popoverEl) {
    if (!popoverEl || popoverEl.dataset.guideProxyDraggable === '1') return;
    isolateFromPageHandlers(popoverEl);

    const handle = popoverEl.querySelector('.driver-popover-title')
      || popoverEl.querySelector('.driver-popover-progress-text')
      || popoverEl;

    popoverEl.dataset.guideProxyDraggable = '1';
    handle.style.cursor = 'move';
    handle.title = 'ドラッグして移動できます';

    handle.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;

      const rect = popoverEl.getBoundingClientRect();
      const shiftX = ev.clientX - rect.left;
      const shiftY = ev.clientY - rect.top;

      popoverEl.style.position = 'fixed';
      popoverEl.style.left = `${rect.left}px`;
      popoverEl.style.top = `${rect.top}px`;
      popoverEl.style.right = 'auto';
      popoverEl.style.bottom = 'auto';
      popoverEl.style.zIndex = '2147483647';

      const onMove = (moveEv) => {
        const maxLeft = Math.max(0, window.innerWidth - rect.width);
        const maxTop = Math.max(0, window.innerHeight - rect.height);
        const nextLeft = clamp(moveEv.clientX - shiftX, 0, maxLeft);
        const nextTop = clamp(moveEv.clientY - shiftY, 0, maxTop);
        popoverEl.style.left = `${nextLeft}px`;
        popoverEl.style.top = `${nextTop}px`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      ev.preventDefault();
    });
  }

  function enableDriverPopoverDragging() {
    if (driverPopoverDragEnabled) return;
    driverPopoverDragEnabled = true;

    const apply = () => {
      document.querySelectorAll('.driver-popover').forEach((el) => {
        makeDriverPopoverDraggable(el);
      });
    };

    apply();

    const observer = new MutationObserver(() => {
      apply();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function isGuideMenuCollapsed() {
    try {
      return sessionStorage.getItem(MENU_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setGuideMenuCollapsed(collapsed) {
    const menu = document.getElementById('guide-proxy-menu');
    const content = document.getElementById('guide-proxy-menu-content');
    const title = document.getElementById('guide-proxy-menu-title');
    const toggle = document.getElementById('guide-proxy-menu-toggle');
    if (!menu || !content || !title || !toggle) return;

    if (collapsed) {
      content.style.display = 'none';
      menu.style.padding = '8px 10px';
      title.textContent = 'ガイド選択';
      toggle.textContent = '＋';
      toggle.setAttribute('aria-label', 'ガイド選択パネルを展開');
      toggle.title = '展開';
    } else {
      content.style.display = 'block';
      menu.style.padding = '12px';
      title.textContent = 'ガイド選択：';
      toggle.textContent = '－';
      toggle.setAttribute('aria-label', 'ガイド選択パネルを最小表示');
      toggle.title = '最小表示';
    }

    try {
      sessionStorage.setItem(MENU_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }

  function getTargetUrl() {
    if (window.__GUIDE_PROXY_TARGET_URL) return window.__GUIDE_PROXY_TARGET_URL;
    const p = new URLSearchParams(window.location.search);
    return p.get('url') || '';
  }

  function getGuideId() {
    const p = new URLSearchParams(window.location.search);
    return p.get('guideId') || '';
  }

  function isHttpLike(url) {
    return url.startsWith('http://') || url.startsWith('https://');
  }

  function toProxyUrl(rawHref, baseUrl) {
    if (!rawHref) return null;
    if (rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      return null;
    }

    let abs;
    try {
      abs = new URL(rawHref, baseUrl).href;
    } catch {
      return null;
    }

    if (!isHttpLike(abs)) return null;
    return `${location.origin}/proxy?url=${encodeURIComponent(abs)}`;
  }

  function rewriteLinks() {
    const baseUrl = getTargetUrl();
    if (!baseUrl) return;

    document.querySelectorAll('a[href]').forEach((a) => {
      const raw = a.getAttribute('href');
      const proxied = toProxyUrl(raw, baseUrl);
      if (proxied) {
        a.setAttribute('href', proxied);
      }
    });
  }

  function getCsrfTokenFromPage() {
    const tokenInput = document.querySelector('#frOk input[name="_csrfToken"]')
      || document.querySelector('input[name="_csrfToken"]');
    return tokenInput ? tokenInput.value : '';
  }

  async function submitConsentViaProxy(sourceUrl, fallbackUrl) {
    const csrfToken = getCsrfTokenFromPage();
    if (!csrfToken) {
      location.href = fallbackUrl;
      return;
    }

    try {
      const form = new URLSearchParams();
      form.set('sourceUrl', sourceUrl);
      form.set('_csrfToken', csrfToken);

      const resp = await fetch(`${location.origin}/consent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: form.toString(),
        credentials: 'include'
      });

      if (!resp.ok) {
        location.href = fallbackUrl;
        return;
      }

      const data = await resp.json();
      if (data && data.redirectProxyUrl) {
        location.href = data.redirectProxyUrl;
        return;
      }

      location.href = fallbackUrl;
    } catch {
      location.href = fallbackUrl;
    }
  }

  function wireConsentButton() {
    const agreeBtn = document.getElementById('btOk')
      || Array.from(document.querySelectorAll('a')).find((a) => (a.textContent || '').trim() === '同意する');
    if (!agreeBtn) return;

    const targetUrl = getTargetUrl();
    if (!targetUrl) return;

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return;
    }

    // 元URLが /nbrc 配下ならそれを維持する
    const basePrefix = parsed.pathname.includes('/nbrc/mrinda/') ? '/nbrc/mrinda' : '/mrinda';
    const agreedUrl = `${parsed.origin}${basePrefix}/list/risk/bacteria/E`;
    const proxiedAgreedUrl = `${location.origin}/proxy?url=${encodeURIComponent(agreedUrl)}`;

    // まずリンク自体を書き換えて、通常クリックでも遷移できるようにする
    agreeBtn.setAttribute('href', proxiedAgreedUrl);
    agreeBtn.setAttribute('target', '_self');
    agreeBtn.removeAttribute('onclick');
    agreeBtn.onclick = null;

    agreeBtn.addEventListener('click', async (ev) => {
      // 元ページ側の同意クリック処理が動かない場合のフォールバック
      const hasTable = !!document.querySelector('#tblUList');
      if (hasTable) return;

      ev.preventDefault();

      await submitConsentViaProxy(targetUrl, proxiedAgreedUrl);
    }, { capture: true });

    // Enter キー操作でも同じ遷移に揃える
    agreeBtn.addEventListener('keydown', async (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      await submitConsentViaProxy(targetUrl, proxiedAgreedUrl);
    });
  }

  function findEButton() {
    const anchors = Array.from(document.querySelectorAll('a[title="E"], a'));
    return anchors.find((a) => (a.textContent || '').trim() === 'E') || null;
  }

  function findBacteriaLink() {
    const anchors = Array.from(document.querySelectorAll('a[href], a'));
    return anchors.find((a) => {
      const txt = (a.textContent || '').trim();
      return txt === '細菌' || txt === 'Bacteria';
    }) || document.body;
  }

  function findSearchInput() {
    const labels = Array.from(document.querySelectorAll('label, div, td'));
    const searchLabel = labels.find((el) => /Search/i.test((el.textContent || '').trim()));
    if (searchLabel) {
      const nearby = searchLabel.parentElement ? searchLabel.parentElement.querySelector('input[type="text"]') : null;
      if (nearby) return nearby;
    }
    return document.querySelector('input[type="text"]');
  }

  function extractTreePath(step) {
    const text = `${step?.title || ''} ${step?.description || ''}`;
    const m = text.match(/『([^』]+)』/);
    if (!m || !m[1]) return [];
    return m[1]
      .split('→')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function expandKeywordVariants(keyword) {
    const k = (keyword || '').trim();
    if (!k) return [];

    const variants = new Set([k]);
    const lower = k.toLowerCase();
    variants.add(lower);

    if (lower === 'intestine') variants.add('small intestine');
    if (lower === 'small intestine') variants.add('intestine');
    if (lower.includes('zebrafish')) variants.add('danio rerio');
    if (lower.includes('danio rerio')) variants.add('zebrafish');

    return Array.from(variants);
  }

  function isVisibleCandidate(el) {
    if (!el || !el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden') {
      return false;
    }

    // TogoDX の折りたたみ領域（詳細テーブル）を誤って拾わない
    if (el.closest('.row.-lower.collapsingcontent')) {
      return false;
    }

    return el.getClientRects().length > 0;
  }

  function normalizeMatchText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_\-()]/g, '');
  }

  function findBestTreeNode(scope, keyword, categoryHint) {
    if (!keyword) return null;
    const variants = expandKeywordVariants(keyword);
    const normalizedVariants = variants.map(normalizeMatchText).filter(Boolean);

    // TogoDX 実DOM: scope が null の場合は TogoDX の属性パネルコンテナを使う
    const root = scope
      || document.querySelector('#Properties')
      || document.querySelector('section.concepts')
      || document.body;

    // カテゴリヒントによる絞り込み（'Protein' → data-category-id="protein" のパネルのみ検索）
    const catId = categoryHint ? categoryHint.toLowerCase() : null;

    // 1. TogoDX 固有: li.track-filter-view[data-node] の span.label テキストで一致
    const filterItems = Array.from(root.querySelectorAll('li.track-filter-view[data-node]'));
    const byLabel = filterItems.find((li) => {
      if (!isVisibleCandidate(li)) return false;
      const labelEl = li.querySelector('span.label');
      if (!labelEl) return false;
      const txt = (labelEl.textContent || '').trim().toLowerCase();
      return variants.some((kw) => txt === kw.toLowerCase() || txt.includes(kw.toLowerCase()));
    });
    if (byLabel) return byLabel;

    // 2. TogoDX 固有: 属性パネル(attribute-track-view)の h2.title で一致
    //    カテゴリヒントがある場合は data-category-id でスコープを絞る
    const panelSelector = catId
      ? `.attribute-track-view[data-category-id="${catId}"]`
      : '.attribute-track-view';
    const panels = Array.from(root.querySelectorAll(panelSelector));
    const byPanel = panels.find((el) => {
      const titleEl = el.querySelector('h2.title');
      if (!titleEl) return false;
      const txt = (titleEl.textContent || '').trim().toLowerCase();
      return variants.some((kw) => txt === kw.toLowerCase() || txt.includes(kw.toLowerCase()));
    });
    if (byPanel) return byPanel;

    // カテゴリスコープで見つからない場合は全パネルにフォールバック
    if (catId) {
      const allPanels = Array.from(root.querySelectorAll('.attribute-track-view'));
      const byAnyPanel = allPanels.find((el) => {
        const titleEl = el.querySelector('h2.title');
        if (!titleEl) return false;
        const txt = (titleEl.textContent || '').trim().toLowerCase();
        return variants.some((kw) => txt === kw.toLowerCase() || txt.includes(kw.toLowerCase()));
      });
      if (byAnyPanel) return byAnyPanel;
    }

    // 3. data-node 属性値で一致（pathogenic など snake_case の値）
    const dataNodeCandidates = Array.from(root.querySelectorAll('[data-node]')).filter(isVisibleCandidate);
    const byDataNode = dataNodeCandidates.find((el) => {
      const raw = (el.getAttribute('data-node') || '').trim();
      const normalized = normalizeMatchText(raw);
      if (!normalized) return false;
      return normalizedVariants.some((kw) => normalized === kw || normalized.includes(kw) || kw.includes(normalized));
    });
    if (byDataNode) return byDataNode;

    // 4. title / aria-label
    const attrCandidates = Array.from(root.querySelectorAll('[title], [aria-label]')).filter(isVisibleCandidate);
    const byAttr = attrCandidates.find((el) => {
      const t = (el.getAttribute('title') || '').trim().toLowerCase();
      const a = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      return variants.some((kw) => t.includes(kw.toLowerCase()) || a.includes(kw.toLowerCase()));
    });
    if (byAttr) return byAttr;

    // 5. テキスト一致（フォールバック）
    const strongCandidates = Array.from(root.querySelectorAll('.label, .title, label, span, td, li, h2, h3')).filter(isVisibleCandidate);
    return strongCandidates.find((el) => {
      const txt = (el.textContent || '').trim().toLowerCase();
      return variants.some((kw) => txt === kw.toLowerCase() || txt.includes(kw.toLowerCase()));
    }) || null;
  }

  // TogoDX のカテゴリ名 → data-category-id のマッピング
  // （例: 'Gene' → 'gene', 'Protein' → 'protein'）
  function findCategorySection(categoryName) {
    const catId = (categoryName || '').trim().toLowerCase();
    if (!catId) return null;
    // h3[data-category-id="..."] はTogoDXのカテゴリヘッダー
    const header = document.querySelector(`h3[data-category-id="${catId}"]`);
    if (header) {
      // カテゴリをまとめる祖先要素（class に "category" を含む要素）があればそちらを返す
      const wrapper = header.closest('[class*="category"]:not(body)');
      return wrapper || header;
    }
    // フォールバック: data-category-id を持つ最初の要素
    return document.querySelector(`[data-category-id="${catId}"]`) || null;
  }

  function resolveGuideStepElement(step) {
    const selector = step?.selector || '';
    const pathKeywords = extractTreePath(step);

    // description に『A → B → C』形式のパスがある場合:
    // 優先順位: li.track-filter-view span.label → .attribute-track-view h2.title
    //           → data-node 属性 → title/aria-label → テキスト全体
    // （findBestTreeNode がこの5段階優先順位を実装している）
    // カテゴリセクション全体（h3[data-category-id]）は最終フォールバックとする
    if (pathKeywords.length >= 1) {
      let root = null;
      if (selector && selector !== 'body') {
        try { root = document.querySelector(selector) || null; } catch { root = null; }
      }
      // 末尾キーワード（最も具体的）から順に検索
      for (let i = pathKeywords.length - 1; i >= 0; i -= 1) {
        const catHint = i > 0 ? pathKeywords[0] : null;
        const node = findBestTreeNode(root, pathKeywords[i], catHint);
        if (node) return node;
      }
      // 最終フォールバック: カテゴリセクション全体
      const section = findCategorySection(pathKeywords[0]);
      if (section) return section;
      return root || document.body;
    }

    // パスなし → selector で解決
    if (!selector) return document.body;
    try {
      return document.querySelector(selector) || document.body;
    } catch {
      return document.body;
    }
  }

  function setResumeAfterE() {
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ after: 'E', ts: Date.now() }));
    } catch {
      // ignore
    }
  }

  function shouldResumeAfterE() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (!raw) return false;
      const v = JSON.parse(raw);
      const notExpired = v && typeof v.ts === 'number' && (Date.now() - v.ts < 2 * 60 * 1000);
      return Boolean(notExpired && v.after === 'E');
    } catch {
      return false;
    }
  }

  function clearResume() {
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      // ignore
    }
  }

  function ensureGuideSelectionMenu() {
    if (document.getElementById('guide-proxy-menu')) return;
    if (!document.body) return;

    const menu = document.createElement('div');
    menu.id = 'guide-proxy-menu';
    isolateFromPageHandlers(menu);
    menu.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 10px;
      background: white;
      border: 2px solid #005faf;
      border-radius: 8px;
      padding: 12px;
      z-index: 2147483645;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      font-family: sans-serif;
      min-width: 220px;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';

    const title = document.createElement('div');
    title.id = 'guide-proxy-menu-title';
    title.style.cssText = 'font-weight: bold; margin-bottom: 8px; font-size: 14px;';
    title.textContent = 'ガイド選択：';
    header.appendChild(title);

    const toggle = document.createElement('button');
    toggle.id = 'guide-proxy-menu-toggle';
    toggle.type = 'button';
    isolateFromPageHandlers(toggle);
    toggle.style.cssText = `
      width: 26px;
      height: 26px;
      border: 1px solid #005faf;
      background: white;
      color: #005faf;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      margin-bottom: 8px;
      padding: 0;
    `;
    toggle.addEventListener('click', () => {
      setGuideMenuCollapsed(!isGuideMenuCollapsed());
    });
    header.appendChild(toggle);

    menu.appendChild(header);

    const content = document.createElement('div');
    content.id = 'guide-proxy-menu-content';
    content.style.cssText = 'max-height: 60vh; overflow-y: auto;';

    const container = document.createElement('div');
    container.id = 'guide-proxy-menu-buttons';
    content.appendChild(container);
    menu.appendChild(content);

    document.body.appendChild(menu);

    setGuideMenuCollapsed(isGuideMenuCollapsed());

    fetchAndDisplayGuides();
  }

  function initGuideProxyUi() {
    rewriteLinks();
    wireConsentButton();
    ensureGuideSelectionMenu();

    // guideId URLパラメータがあれば、自動的にツアーを開始
    const autoGuideId = getGuideId();
    if (autoGuideId) {
      // ページの読み込みが完全に完了してから起動（遅延）
      setTimeout(() => {
        startGuideById(autoGuideId);
        setGuideMenuCollapsed(true);
      }, 500);
    } else if (shouldResumeAfterE()) {
      clearResume();
      setTimeout(() => startGuide(true), 250);
    }
  }

  async function fetchAndDisplayGuides() {
    const container = document.getElementById('guide-proxy-menu-buttons');
    if (!container) return;

    // ローディング表示
    container.innerHTML = '<div style="font-size:12px;color:#666;padding:4px 0;">読み込み中...</div>';

    try {
      const targetUrl = getTargetUrl();
      const apiUrl = location.origin + '/api/guides'
        + (targetUrl ? '?url=' + encodeURIComponent(targetUrl) : '');
      const resp = await fetch(apiUrl, { credentials: 'include' });
      if (!resp.ok) {
        container.innerHTML = `<div style="font-size:12px;color:red;padding:4px 0;">エラー: HTTP ${resp.status}</div>`;
        return;
      }

      const data = await resp.json();
      if (!data.guides || !Array.isArray(data.guides) || data.guides.length === 0) {
        container.innerHTML = '<div style="font-size:12px;color:#666;padding:4px 0;">ガイドなし</div>';
        return;
      }

      container.innerHTML = '';

      data.guides.forEach(guide => {
        const btn = document.createElement('button');
        btn.style.cssText = `
          display: block;
          width: 100%;
          margin-bottom: 6px;
          padding: 8px;
          background: #005faf;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-family: sans-serif;
        `;
        btn.textContent = guide.title || guide.guideId;
        isolateFromPageHandlers(btn);
        btn.addEventListener('click', async () => {
          await startGuideById(guide.guideId);
          setGuideMenuCollapsed(true);
        });
        container.appendChild(btn);
      });
    } catch (err) {
      container.innerHTML = `<div style="font-size:12px;color:red;padding:4px 0;">取得失敗: ${err.message}</div>`;
      console.warn('Failed to fetch guides:', err);
    }
  }

  async function startGuideById(guideId) {
    try {
      const targetUrl = getTargetUrl();
      const apiUrl = location.origin + `/api/guides/${encodeURIComponent(guideId)}`
        + (targetUrl ? '?url=' + encodeURIComponent(targetUrl) : '');
      const resp = await fetch(apiUrl, { credentials: 'include' });
      if (!resp.ok) {
        alert('ガイドの読み込みに失敗しました');
        return;
      }

      const guideJSON = await resp.json();
      startGuideWithJSON(guideJSON);
    } catch (err) {
      alert('ガイド読み込みエラー: ' + err.message);
    }
  }

  function startGuideWithJSON(guideJSON) {
    if (!window.driver || !window.driver.js || typeof window.driver.js.driver !== 'function') {
      alert('Driver.js の読み込みに失敗しました。');
      return;
    }

    if (!guideJSON.steps || guideJSON.steps.length === 0) {
      alert('ガイドにステップが定義されていません');
      return;
    }

    const drv = window.driver.js.driver({
      showProgress: true,
      allowClose: true,
      nextBtnText: '次へ',
      prevBtnText: '前へ',
      doneBtnText: '完了',
      progressText: '{{current}} / {{total}}'
    });

    enableDriverPopoverDragging();

    // JSON ステップを Driver.js フォーマットに変換
    const driverSteps = guideJSON.steps.map(step => {
      const popoverConfig = {
        title: step.title || '',
        side: step.placement || 'bottom',
        align: 'start'
      };

      // description が HTML を含む場合、descriptionElement を使う
      if (step.description && step.description.includes('<')) {
        popoverConfig.descriptionElement = document.createElement('div');
        popoverConfig.descriptionElement.innerHTML = step.description;
      } else {
        popoverConfig.description = step.description || '';
      }

      // action / selector によってステップの動作を切り替える
      // 実要素セレクタ（body・空文字以外）がある → 常に要素をハイライト
      // 実要素セレクタなし + action が "highlight" → description パスから要素を解決
      // 実要素セレクタなし + action が "tooltip" / "complete" / 未設定 → floating tooltip
      const capturedStep = step;
      const hasRealSelector = step.selector && step.selector !== 'body';
      const isFloating = !hasRealSelector && step.action !== 'highlight';
      const driverStep = isFloating
        ? { popover: popoverConfig }
        : { element: () => resolveGuideStepElement(capturedStep), popover: popoverConfig };

      return driverStep;
    });

    // どのガイドでも、最初に「同意する」ボタンを押す必要がある。
    // 同意ボタンがページに存在する場合（＝未同意）、先頭に同意ステップを追加する。
    const consentBtn = document.getElementById('btOk')
      || Array.from(document.querySelectorAll('a, button, input[type="submit"]'))
        .find((el) => ((el.textContent || el.value || '').trim() === '同意する'));
    if (consentBtn) {
      driverSteps.unshift({
        element: consentBtn,
        popover: {
          title: 'まず「同意する」を押してください',
          description: 'ご利用にあたって、最初にこの「同意する」ボタンをクリックする必要があります。同意後、目的のページへ進みます。',
          side: 'bottom',
          align: 'start'
        }
      });
    }

    drv.setSteps(driverSteps);
    drv.drive(0);
  }

  function startGuide(resumeAfterE) {
    if (!window.driver || !window.driver.js || typeof window.driver.js.driver !== 'function') {
      alert('Driver.js の読み込みに失敗しました。');
      return;
    }

    const eButton = findEButton();
    const isEAlreadySelected = Array.from(document.querySelectorAll('li.current')).some((li) => (li.textContent || '').trim() === 'E');

    const steps = [
      {
        stepId: 'intro',
        element: findBacteriaLink,
        popover: {
          title: 'ガイドへようこそ',
          description: 'このページで E. coli を検索する流れを案内します。'
        }
      }
    ];

    if (eButton) {
      steps.push({
        stepId: 'e',
        element: findEButton,
        popover: {
          title: '「E」ボタン',
          description: 'E をクリックすると E 始まりの一覧に移動します。',
          side: 'bottom',
          align: 'center'
        },
        onHighlightStarted: (el) => {
          el.addEventListener('click', setResumeAfterE, { once: true, capture: true });
        }
      });
    } else if (isEAlreadySelected) {
      steps.push({
        stepId: 'e-skip',
        popover: {
          title: '「E」ボタン（スキップ）',
          description: 'このページはすでに E 選択済みなので、次へ進みます。'
        }
      });
    }

    steps.push(
      {
        stepId: 'search',
        element: findSearchInput,
        popover: {
          title: 'Search',
          description: '検索欄に E coli と入力してください。',
          side: 'bottom',
          align: 'start'
        },
        onHighlightStarted: (el) => {
          if (el && el.focus) el.focus();
        }
      },
      {
        stepId: 'table',
        element: '#tblUList',
        popover: {
          title: '細菌リスト一覧',
          description: '学名や区分情報を確認できます。'
        }
      },
      {
        stepId: 'done',
        popover: {
          title: 'ガイド完了',
          description: '以上で手順は完了です。'
        }
      }
    );

    const drv = window.driver.js.driver({
      showProgress: true,
      allowClose: true,
      nextBtnText: '次へ',
      prevBtnText: '前へ',
      doneBtnText: '完了',
      progressText: '{{current}} / {{total}}',
      steps
    });

    enableDriverPopoverDragging();

    const startIndex = resumeAfterE ? Math.max(0, steps.findIndex((s) => s.stepId === 'search')) : 0;
    drv.drive(startIndex);
  }

  if (document.body) {
    initGuideProxyUi();
  } else {
    document.addEventListener('DOMContentLoaded', initGuideProxyUi, { once: true });
  }
})();
