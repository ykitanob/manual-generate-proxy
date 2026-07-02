// ======================================================
// NBRC Driver Guide + 質問ナビ（最終完成版）
// 👉 解説文言反映＋ハイライト安定化済み
// ======================================================

(function () {

  // ======================================================
  // ✅ ガイド開始ボタン
  // ======================================================
  if (!document.getElementById('nbrc-guide-btn')) {
    const btn = document.createElement('button');
    btn.id = 'nbrc-guide-btn';
    btn.textContent = 'ガイドを開始';
    document.body.appendChild(btn);

    btn.onclick = () => startDriverGuide();
  }

  function startDriverGuide() {
    if (window.currentDriver) {
      window.currentDriver.destroy();
    }

    const driver = window.driver.js.driver({
      showProgress: true,
      stagePadding: 2, // ✅ 余白対策

      nextBtnText: "次へ",
      prevBtnText: "戻る",
      doneBtnText: "完了",

      steps: [
        {
          element: document.body,
          popover: {
            title: "NBRCガイドへようこそ",
            description: "微生物有害情報リストの基本操作を説明します"
          }
        },
        {
          element: document.querySelector("input[type='text']"),
          popover: {
            title: "検索機能",
            description: "ここにキーワードを入力すると一覧が絞り込まれます"
          }
        },
        {
          element: document.querySelector("table tr:nth-child(2) td"),
          popover: {
            title: "一覧表示",
            description: "検索結果（データ部分）が表示されます"
          }
        },
        {
          element: document.querySelector("a.lpsn"),
          popover: {
            title: "学名リンク",
            description: "クリックすると外部サイトで詳細確認できます"
          }
        }
      ]
    });

    window.currentDriver = driver;
    driver.drive();
  }

  // ======================================================
  // ✅ 「？」ボタン
  // ======================================================
  const navBtn = document.createElement("button");
  navBtn.innerText = "？";
  navBtn.style.position = "fixed";
  navBtn.style.bottom = "20px";
  navBtn.style.right = "20px";
  navBtn.style.zIndex = "9999";
  navBtn.style.borderRadius = "50%";
  navBtn.style.width = "50px";
  navBtn.style.height = "50px";
  navBtn.style.fontSize = "20px";

  document.body.appendChild(navBtn);

  // ======================================================
  // ✅ モーダル
  // ======================================================
  const modal = document.createElement("div");
  modal.style.display = "none";
  modal.style.position = "fixed";
  modal.style.top = "0";
  modal.style.left = "0";
  modal.style.width = "100%";
  modal.style.height = "100%";
  modal.style.background = "rgba(0,0,0,0.5)";
  modal.style.zIndex = "999999";

  modal.innerHTML = `
    <div style="background:#fff; width:420px; margin:100px auto; padding:20px; border-radius:8px;">
      <h3>何が知りたいですか？</h3>
      <textarea id="nav-input" style="width:100%; height:80px;"></textarea>
      <button id="nav-send">送信</button>
    </div>
  `;

  document.body.appendChild(modal);

  navBtn.onclick = () => {
    if (window.currentDriver) {
      window.currentDriver.destroy();
    }
    modal.style.display = "block";
  };

  // ======================================================
  // ✅ ガイド定義（あなたの文言反映）
  // ======================================================
  const GUIDE_PATTERNS = {

    scientific: {
      title: "① 学名の情報を知りたい",
      steps: [
        {
          text: "リストに微生物が一覧表示されています",
          target: {
            type: "selector",
            value: "#tblUList"
          }
        },
        {
          text: "学名に関する有害情報が一列に掲載されています。例）Acetobacter pasteurianus",
          target: { type: "selector", value: "tr#mid_a_00010" }
        },
        {
          text: "学名をクリックすることで、LPSN（外部サイト）で詳細情報が確認できます。",
          target: { type: "selector", value: "tr#mid_a_00010 span.corr" }
        },
        {
          text: "正名に対する異名の列も存在します。例）Acetobacter ascendens",
          target: { type: "selector", value: "tr#mid_a_00007" }
        },
        {
          text: "「確認」をクリックすることで、関連する微生物の表をグループごとに確認することができます。",
          target: { type: "selector", value: "tr#mid_a_00010 span.bgroup a" }
        }
      ]
    },

    search: {
      title: "② キーワード検索",
      steps: [
        {
          text: "この入力欄に学名を入力してください。例）Acaricomes phytoseiuli",
          target: { type: "selector", value: "input[type='text']" }
        },
        {
          text: "入力した内容に応じて一覧が絞り込まれます",
          target: {
            type: "selector",
            value: "tr#mid_a_00005"
          }
        }
      ]
    },

    mifup: {
      title: "③ MiFuPSafety連携",
      steps: [
        {
          text: "上部メニューの「有害機能対応表」をクリックしてください。",
          target: { type: "selector", value: "a[href='/mrinda/list/crossLink']" }
        },
        {
          text: "もしくは、リストの「MiFuP Safety へのリンク」にある♦マークをクリックしてください。",
          target: { type: "selector", value: "th.cross.safety" }
        }
      ]
    },

    download: {
      title: "④ ダウンロード",
      steps: [
        {
          text: "このボタンからリスト資料をダウンロードできます。",
          target: { type: "selector", value: "a[href*='download']" }
        }
      ]
    },

    // ✅ あなたの文言そのまま反映（ただしハイライトは小さくする）
    description: {
      title: "⑤ 解説ページ",
      steps: [
        {
          text: "上部メニューの「解説」をクリックしてください。このページではリスク欄の出典や分類の詳細が確認できます。",
          target: {
            type: "selector",
            value: "a[href='/mrinda/list/description/view']"
          }
        }
      ]
    },

    other: {
      title: "⑥ その他",
      steps: [
        {
          text: "お問い合わせはメニューから行えます。",
          target: { type: "selector", value: "a[href*='contact/index.php']" }
        }
      ]
    }

  };

  // ======================================================
  // ✅ 分類
  // ======================================================
  function classify(q) {
    q = q.toLowerCase();

    if (q.includes("検索")) return "search";
    if (q.includes("ダウンロード")) return "download";
    if (q.includes("学名") || q.includes("菌")) return "scientific";
    if (q.includes("解説")) return "description";
    if (q.includes("有害")) return "mifup";

    return "other";
  }

  // ======================================================
  // ✅ target→DOM変換
  // ======================================================
  function resolveElement(target) {

    if (!target) return document.body;

    if (target.type === "selector") {
      return document.querySelector(target.value) || document.body;
    }

    return document.body;
  }

  // ======================================================
  // ✅ Driver変換
  // ======================================================
  function convertToDriverSteps(pattern) {
    return pattern.steps.map((step, i) => ({
      element: resolveElement(step.target),
      popover: {
        title: `${pattern.title}（${i + 1}/${pattern.steps.length}）`,
        description: step.text
      }
    }));
  }

  // ======================================================
  // ✅ ガイド開始
  // ======================================================
  function startQuestionGuide(key) {

    if (window.currentDriver) {
      window.currentDriver.destroy();
    }

    const pattern = GUIDE_PATTERNS[key];

    const driver = window.driver.js.driver({
      showProgress: true,
      stagePadding: 2, // ✅ 忘れず

      nextBtnText: "次へ",
      prevBtnText: "戻る",
      doneBtnText: "完了",
      steps: convertToDriverSteps(pattern)
    });

    window.currentDriver = driver;
    driver.drive();
  }

  // ======================================================
  // ✅ 入力イベント
  // ======================================================
  document.addEventListener("click", (e) => {
    if (e.target.id === "nav-send") {

      const input = document.getElementById("nav-input").value;
      const key = classify(input);

      modal.style.display = "none";

      startQuestionGuide(key);
    }
  });

})();