# ガイド JSON 作成仕様書

## 概要

本システムは Driver.js ベースのステップナビゲーションをプロキシ経由でページに注入する。
ガイドの定義は JSON ファイルに記述し、サーバー起動時にロードされる。

---

## ファイル構成

| ファイル | 対象サイト |
|---|---|
| `togodx_guide-patterns.json` | TogoDX（https://togodx.dbcls.jp） |
| `guide-patterns.json` | NBRC 微生物有害情報リスト（https://www.nite.go.jp） |

各ファイルはガイドオブジェクトの **JSON 配列** `[{...}, {...}]` として記述する。

---

## スキーマ

```jsonc
{
  "guideId": "string",      // 一意な識別子（kebab-case 推奨）
  "version": 1,             // スキーマバージョン（現在は 1 固定）
  "locale": "ja-JP",        // ロケール
  "title": "string",        // ガイド選択 UI に表示されるタイトル
  "description": "string",  // (省略可) ガイドの概要
  "steps": [ /* Step[] */ ]
}
```

---

## Step オブジェクト

```jsonc
{
  "id": "step-N",           // ステップ識別子（連番推奨）
  "selector": "string",     // CSS セレクタ（後述）
  "action": "string",       // "highlight" | "tooltip" | "complete"
  "title": "string",        // ポップオーバーのタイトル
  "description": "string",  // ポップオーバーの本文（HTML タグ使用可）
  "placement": "string"     // (省略可) "top" | "bottom" | "left" | "right"
}
```

---

## `selector` フィールドの仕様

`selector` と `action` の組み合わせによって Driver.js への渡し方が切り替わる。

### パターン A — 実要素を直接指定

```json
"selector": "button[data-testid='result-button'], button[type='submit']",
"action": "highlight"
```

`querySelector` で解決し、見つかった要素をハイライトする。
複数セレクタはカンマ区切りで指定可能（先にマッチした要素が優先）。

### パターン B — `description` パスからの自動解決（TogoDX 専用）

```json
"selector": "",
"action": "highlight"
```

`selector` が空文字かつ `action: "highlight"` の場合、`description` フィールド内の
**`『A → B → C』` 形式の文字列**を解析してターゲット要素を決定する。

解決アルゴリズムの優先順位：

| 優先度 | 対象 | マッチング方法 |
|---|---|---|
| 1 | `li.track-filter-view[data-node]` の `span.label` | テキスト完全一致 / 部分一致 |
| 2 | `.attribute-track-view h2.title` | テキスト完全一致 / 部分一致（`data-category-id` でスコープを絞る） |
| 3 | `[data-node]` 属性値 | 正規化後マッチ（スペース・アンダースコア等を除去して比較） |
| 4 | `[title]` / `[aria-label]` 属性値 | 部分一致 |
| 5 | `.label`, `.title`, `span`, `li`, `h2`, `h3` 等のテキスト | 完全一致 / 部分一致 |
| 最終 | `h3[data-category-id="${catId}"]` | カテゴリヘッダー全体を返す |

**パス形式の規則：**
- `『』`（二重鉤括弧）で囲む
- 階層区切りは ` → `（全角矢印・前後スペース）
- 先頭要素がカテゴリヒント（`gene`, `protein`, `disease` 等）として使われる
- 検索は**末尾（最も具体的）のキーワードから**順に試みる

```
『Gene → Tissue-specific high expression (HPA) → Lung』
  ↓ 抽出
['Gene', 'Tissue-specific high expression (HPA)', 'Lung']
  ↓ 検索順
Lung → Tissue-specific high expression (HPA) → Gene
```

**使用可能なエイリアス（inject.js 内で定義）：**

| 入力 | 自動的に追加されるバリアント |
|---|---|
| `intestine` | `small intestine` |
| `zebrafish` | `danio rerio` |

### パターン C — Floating Tooltip（操作許可ステップ）

```json
"selector": "",
"action": "tooltip"
```

Driver.js に `element` を渡さない（floating tooltip モード）。
オーバーレイが表示されずページ全体を操作可能になる。
アコーディオン展開など**ユーザー操作が必要なステップ**に使用する。

### パターン D — Floating Tooltip（イントロ・完了）

```json
"selector": "body",
"action": "tooltip"   // または "complete"
```

`selector: "body"` は実要素セレクタとして扱われず Floating Tooltip になる。
ガイド開始前の説明ステップ（intro）や完了ステップに使用する。

---

## `action` フィールドの仕様

| 値 | 動作 | 用途 |
|---|---|---|
| `"highlight"` | 要素をハイライト（オーバーレイあり） | 操作対象を指し示す |
| `"tooltip"` | Floating Tooltip（オーバーレイなし） | 説明のみ / ユーザー操作許可 |
| `"complete"` | Floating Tooltip（オーバーレイなし） | ガイド最終ステップ |

> **注意：** `selector` が実要素 CSS セレクタ（`body`・空文字以外）の場合、
> `action` の値によらず常にハイライトモードになる。

---

## -do ステップパターン（TogoDX 固有）

アコーディオン UI など動的に表示される要素を操作させたい場合、
**indicator ステップ（highlight）と operation ステップ（tooltip）をペアで定義**する。

```jsonc
// indicator: 場所を示す（見えていれば要素をハイライト）
{
  "id": "step-3",
  "selector": "",
  "action": "highlight",
  "title": "網膜色素変性症に関連するタンパク質を選択",
  "description": "左側の『Protein → Disease-related proteins → Retinitis pigmentosa』を展開し、チェックを入れます。"
},
// operation: ユーザーに操作させる（floating tooltip でページ操作を解放）
{
  "id": "step-3-do",
  "selector": "",
  "action": "tooltip",
  "title": "網膜色素変性症に関連するタンパク質を選択",
  "description": "左側の『Protein → Disease-related proteins → Retinitis pigmentosa』を展開し、チェックを入れます。"
}
```

**-do ステップが必要なケース：**
- アコーディオンを展開しないと選択肢が表示されない項目
- 動的ロード（非同期 fetch）で後から DOM に追加される要素

**-do ステップが不要なケース：**
- ページロード時点で `li.track-filter-view` が展開済みの項目（例：Case1 の Lung）
- `<select>`, `<button>` など常に表示されている要素

---

## ガイドテンプレート（TogoDX 向け）

```json
{
  "guideId": "togodx-caseX-search",
  "version": 1,
  "locale": "ja-JP",
  "title": "CaseX: （ガイドのタイトル）",
  "steps": [
    {
      "id": "step-1",
      "selector": "body",
      "action": "tooltip",
      "title": "CaseX検索ガイド",
      "description": "（ガイドの概要説明）"
    },
    {
      "id": "step-2",
      "selector": "select[data-testid='dataset-selector'], select",
      "action": "highlight",
      "title": "（データセット名） を選択",
      "description": "対象データセットから『（データセット名）』を選択します。"
    },
    {
      "id": "step-3",
      "selector": "",
      "action": "highlight",
      "title": "（フィルター名）を選択",
      "description": "左側の『カテゴリ → パネル → 項目』を展開し、チェックを入れます。"
    },
    {
      "id": "step-3-do",
      "selector": "",
      "action": "tooltip",
      "title": "（フィルター名）を選択",
      "description": "左側の『カテゴリ → パネル → 項目』を展開し、チェックを入れます。"
    },
    {
      "id": "step-N",
      "selector": "button[data-testid='result-button'], button[type='submit']",
      "action": "highlight",
      "title": "検索を実行",
      "description": "『Result』ボタンをクリックすると結果が表示されます。"
    },
    {
      "id": "step-N+1",
      "selector": "body",
      "action": "complete",
      "title": "ガイド完了",
      "description": "（完了メッセージ）"
    }
  ]
}
```

---

## TogoDX カテゴリと `data-category-id` の対応

`『A → B → C』` の先頭要素 `A` は以下の値にマッピングされる（大文字小文字を正規化して比較）。

| description に記述する文字列 | `data-category-id` |
|---|---|
| `Gene` | `gene` |
| `Protein` | `protein` |
| `Structure` | `structure` |
| `Interaction` | `interaction` |
| `Compound` | `compound` |
| `Glycan` | `glycan` |
| `Disease` | `disease` |
| `Variant` | `variant` |

---

## バリデーション

`validate-guide.js`（`proxy-server/validate-guide.js`）でスキーマ検証が可能。

```bash
node proxy-server/validate-guide.js togodx_guide-patterns.json
```

JSON 構文エラーおよび必須フィールド（`guideId`, `steps`, `steps[].id`）の欠落を検出する。

---

## 新規ガイド作成依頼：疾患データベース 3フロー

以下の3つのユーザーフローに対応するガイドを作成予定です。
各フローの対象要素の **CSS セレクタ** をご提供ください。

### 取得方法

ブラウザの開発者ツール（F12）で対象要素を右クリックし、以下のいずれかで取得できます。

- **Elements パネル** → 対象要素を右クリック → `Copy` → `Copy selector`
- HTMLソース抜粋（`id`, `data-*`, `class`, `name` 属性が含まれる行）
- `data-testid` / `aria-label` / `role` など機械的に特定できる属性値

---

### フロー 1 — 疾患名で検索して疾患ページを見る

| # | UI要素 | 取得したいセレクタ / 属性 |
|---|---|---|
| 1-1 | トップページの検索ボックス（input） | `selector:` |
| 1-2 | 検索候補・サジェストの各項目 | `selector:` |
| 1-3 | 検索実行ボタン（存在する場合） | `selector:` |
| 1-4 | 検索結果一覧の各疾患行 | `selector:` |
| 1-5 | 疾患詳細ページへのリンク（結果行内） | `selector:` |

**記入例：**
```
1-1: input#searchBox
1-2: ul.suggest-list li
1-3: button[type="submit"]
```

---

### フロー 2 — Disease List で疾患を絞り込む（フィルタ）

| # | UI要素 | 取得したいセレクタ / 属性 |
|---|---|---|
| 2-1 | Disease List ページへの導線（メニュー / リンク） | `selector:` |
| 2-2 | 指定難病 / 小児慢性特定疾病の切り替えUI（ラジオ・タブ等） | `selector:` |
| 2-3 | 五十音・カテゴリ絞り込みUI（ボタン群 / select等） | `selector:` |
| 2-4 | フィルタ適用ボタン（存在する場合） | `selector:` |
| 2-5 | 絞り込み結果の各疾患行 | `selector:` |

**備考：** 絞り込みがリアルタイム反映（ボタン押下不要）の場合は 2-4 は不要です。

---

### フロー 3 — データをダウンロードする（NANDO / 遺伝子 / 表現型）

| # | UI要素 | 取得したいセレクタ / 属性 |
|---|---|---|
| 3-1 | ダウンロードページへの導線（メニュー / リンク） | `selector:` |
| 3-2 | NANDO データのダウンロードリンク / ボタン | `selector:` |
| 3-3 | 遺伝子データのダウンロードリンク / ボタン | `selector:` |
| 3-4 | 表現型データのダウンロードリンク / ボタン | `selector:` |
| 3-5 | ファイル形式選択UI（存在する場合：CSV / TSV / OWL等） | `selector:` |

---

### ご提供いただいた情報の使い方

提供いただいたセレクタは、`guide-patterns.json` の各ステップの `"selector"` フィールドに
パターン A（実要素直接指定）として設定します。

```jsonc
// ご提供例: 1-1 が "input#searchBox" の場合
{
  "id": "step-2",
  "selector": "input#searchBox",   // ← ここに設定
  "action": "highlight",
  "title": "疾患名を入力",
  "description": "検索ボックスに調べたい疾患名を入力してください。"
}
```

`id` や `data-testid` など**変更されにくい属性**を含むセレクタが最も堅牢です。
クラス名のみのセレクタ（`.btn-primary` 等）はリニューアルで壊れやすいためご注意ください。
