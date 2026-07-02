// ======================================================
// NBRC Driver Guide — content.js
// nite.go.jp のページに自動注入されます
// ======================================================

(function () {
  const RESUME_KEY = 'nbrcGuideResume';
  const RESUME_TTL_MS = 2 * 60 * 1000;

  function setResumeState(state) {
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...state, ts: Date.now() }));
    } catch {
      // sessionStorage が使えない場合は再開を行わない
    }
  }

  function getResumeState() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (!raw) return null;

      const state = JSON.parse(raw);
      if (!state || !state.ts) return null;

      if (Date.now() - state.ts > RESUME_TTL_MS) {
        sessionStorage.removeItem(RESUME_KEY);
        return null;
      }

      return state;
    } catch {
      return null;
    }
  }

  function clearResumeState() {
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch {
      // no-op
    }
  }

  // 起動ボタンが既に存在する場合は追加しない
  if (document.getElementById('nbrc-guide-btn')) return;

  // ── 起動ボタンを作成 ──────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'nbrc-guide-btn';
  btn.textContent = 'ガイドを開始';
  document.body.appendChild(btn);

  // ── ガイドのステップ定義 ──────────────────────────
  function startGuide(options = {}) {
    const { resumeAfterE = false, silent = false } = options;

    if (!window.driver || !window.driver.js) {
      if (!silent) {
        alert('Driver.js の読み込みに失敗しました。拡張機能を再読み込みしてください。');
      }
      return;
    }

    const bacteriaLinkSelector = 'a[href="/mrinda/list/risk/bacteria"], a[href*="/mrinda/list/risk/bacteria"], a[href*="/risk/bacteria"]';
    const introElement = document.querySelector(bacteriaLinkSelector) ? bacteriaLinkSelector : 'body';
    const eButtonSelector = 'a[title="E"][href*="/mrinda/list/risk/bacteria/E"], a[href="/mrinda/list/risk/bacteria/E"], a[href*="/risk/bacteria/E"]';
    const hasEButton = Boolean(document.querySelector(eButtonSelector));
    const isEAlreadySelected = /\/risk\/bacteria\/E(?:$|[?#])/.test(location.pathname + location.search + location.hash)
      || Array.from(document.querySelectorAll('li.current')).some((li) => li.textContent.trim() === 'E');

    const steps = [
      // ステップ 1: はじめに
      {
        stepId: 'intro',
        element: introElement,
        popover: {
          title: 'NBRCガイドへようこそ',
          description: 'まず「細菌」リンク（https://www.nite.go.jp/nbrc/mrinda/list/risk/bacteria）を確認します。このガイドでは「E. coli」を検索する手順を案内します。'
        }
      }
    ];

    // 「E」ボタンがある場合はハイライト、既に E 選択済みなら説明だけ出す
    if (hasEButton) {
      steps.push({
        stepId: 'e',
        element: eButtonSelector,
        popover: {
          title: '「E」ボタン',
          description: '対象の微生物の頭文字をクリックします。<br>「E」をクリックすると <em>Escherichia</em> など E 始まりの細菌だけが表示されます。',
          side: 'bottom',
          align: 'center'
        },
        onHighlightStarted: (el) => {
          const markResume = () => {
            setResumeState({ after: 'E' });
          };

          el.addEventListener('click', markResume, { once: true, capture: true });
        }
      });
    } else if (isEAlreadySelected) {
      steps.push({
        stepId: 'e-skip',
        popover: {
          title: '「E」ボタン',
          description: '対象の微生物の頭文字をクリックします。'
        }
      });
    }

    steps.push(
      // Search 入力欄
      {
        stepId: 'search',
        element: 'input[type="text"]',
        popover: {
          title: 'Search（絞り込み検索）',
          description: 'ここに菌名を入力すると一覧をリアルタイムで絞り込めます。<br>例：<strong>E coli</strong> と入力してみましょう。',
          side: 'bottom',
          align: 'start'
        },
        onHighlightStarted: (el) => {
          el.focus();
        }
      },
      // テーブル説明（要素を直接ハイライトしない）
      {
        element: '#tblUList',
        popover: {
          title: '細菌リスト一覧',
          description: '学名・BSL区分・法規制情報がまとまっています。<br>行をクリックすると詳細ページへ遷移します。'
        },
        onHighlightStarted: (el) => {
          // 本体テーブルの先頭が見えるようにスクロールしてからハイライト
          el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        }
      },
      // 完了
      {
        stepId: 'done',
        popover: {
          title: 'ガイド完了',
          description: 'これで基本的な使い方の説明は終わりです。<br>左上の「ガイドを開始」ボタンでいつでも再実行できます。'
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

    let startIndex = 0;
    if (resumeAfterE) {
      const searchIndex = steps.findIndex((step) => step.stepId === 'search');
      startIndex = searchIndex >= 0 ? searchIndex : 0;
    }

    drv.drive(startIndex);
  }

  // ── ボタンクリックでガイド起動 ────────────────────
  btn.addEventListener('click', () => {
    clearResumeState();
    startGuide();
  });

  const resume = getResumeState();
  if (resume && resume.after === 'E') {
    clearResumeState();
    window.setTimeout(() => {
      startGuide({ resumeAfterE: true, silent: true });
    }, 250);
  }
})();
