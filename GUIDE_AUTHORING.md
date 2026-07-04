# Guide JSON Authoring Specifications

## Overview

This system injects Driver.js-based step navigation into pages via a proxy.
Guide definitions are written in JSON files and loaded during server startup.

---

## File Structure

| File | Target Site |
|---|---|
| `togodx_guide-patterns.json` | TogoDX (https://togodx.dbcls.jp) |
| `guide-patterns.json` | NBRC Microbe List (https://www.nite.go.jp) |

Each file should be written as a **JSON array** of guide objects: `[{...}, {...}]`.

---

## Schema

```jsonc
{
  "guideId": "string",      // Unique identifier (kebab-case recommended)
  "version": 1,             // Schema version (currently fixed at 1)
  "locale": "en-US",        // Locale
  "title": "string",        // Title displayed in the guide selection UI
  "description": "string",  // (Optional) Overview of the guide
  "steps": [ /* Step[] */ ]
}
```

---

## Step Object

```jsonc
{
  "id": "step-N",           // Step identifier (sequential numbering recommended)
  "selector": "string",     // CSS selector (see below)
  "action": "string",       // "highlight" | "tooltip" | "complete"
  "title": "string",        // Title of the popover
  "description": "string",  // Body text of the popover (HTML tags allowed)
  "placement": "string"     // (Optional) "top" | "bottom" | "left" | "right"
}
```

---

## `selector` Field Specifications

The way parameters are passed to Driver.js changes based on the combination of `selector` and `action`.

### Pattern A — Direct Element Specification

```json
"selector": "button[data-testid='result-button'], button[type='submit']",
"action": "highlight"
```

Resolved via `querySelector`, and the found element is highlighted.
Multiple selectors can be specified, separated by commas (the first match takes priority).

### Pattern B — Auto-Resolution from `description` Path (TogoDX Specific)

```json
"selector": "",
"action": "highlight"
```

If `selector` is an empty string and `action: "highlight"`, the target element is determined by parsing the **`『A → B → C』` formatted string** within the `description` field.

Resolution algorithm priority:

| Priority | Target | Matching Method |
|---|---|---|
| 1 | `li.track-filter-view[data-node]`'s `span.label` | Exact / Partial text match |
| 2 | `.attribute-track-view h2.title` | Exact / Partial text match (scoped by `data-category-id`) |
| 3 | `[data-node]` attribute value | Match after normalization (removing spaces, underscores, etc.) |
| 4 | `[title]` / `[aria-label]` attribute values | Partial match |
| 5 | `.label`, `.title`, `span`, `li`, `h2`, `h3`, etc. text | Exact / Partial match |
| Final | `h3[data-category-id="${catId}"]` | Returns the entire category header |

**Path Format Rules:**
- Enclosed in `『』` (double angle brackets)
- Hierarchy separator is ` → ` (arrow with spaces)
- The first element is used as a category hint (e.g., `gene`, `protein`, `disease`)
- Search is performed starting from the **last (most specific) keyword**

```
『Gene → Tissue-specific high expression (HPA) → Lung』
  ↓ Extraction
['Gene', 'Tissue-specific high expression (HPA)', 'Lung']
  ↓ Search Order
Lung → Tissue-specific high expression (HPA) → Gene
```

**Available Aliases (Defined in inject.js):**

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

---

## ファイル構成（2026-07-02 更新）

旧構成（ルート直下の単一ファイル）からサイト別ディレクトリ構成に移行した。

```
guides/
├── nbrc/         guide-patterns.json   ← www.nite.go.jp
├── nanbyodata/   guide-patterns.json   ← nanbyodata.jp
└── togodx/       guide-patterns.json   ← togodx.dbcls.jp
```

`server.js` の `SITE_GUIDE_MAP` でホスト名とディレクトリを対応付けている。  
新しいサイトを追加する際は、`SITE_GUIDE_MAP` にホスト名を追記し、  
`guides/<サイト名>/guide-patterns.json` を作成するだけでよい。

**ガイド選択 UI の動作：**  
inject.js は `/api/guides?url=<targetUrl>` でサーバーを呼び出し、  
現在閲覧中のサイトに対応するガイドのみをボタン一覧として表示する。  
未登録サイトではガイドなし表示になる。

---

## crawl4AI を使ったセレクタ情報の収集

将来的には「Webサイトのマークダウン + JSON記述ルール + 人間用操作手順」の  
3セットから guide-patterns.json を自動生成することを目標としている。  
crawl4AI でWebサイトをクロールしてマークダウンを取得する場合、  
**通常のマークダウンはCSSセレクタに必要な属性情報を捨ててしまう**。

### マークダウン出力に必要な要素

**HTML要素の識別情報（selector の根拠）**
- 要素の `id` 属性（`#tblUList`, `#NANDO` 等）
- 要素の `class` 属性（`.corr`, `.bgroup`, `.lpsn` 等）
- 要素タグ名（`input`, `button`, `table`, `tr`, `a` 等）

**属性情報（セレクタのフィルタ条件）**
- `<a>` の `href` 値（部分一致パターン用）
- `<input>` の `type` 属性（`text`, `checkbox`, `submit` 等）
- `<input>` の `placeholder` テキスト
- `<button>` の `type` 属性
- `role` 属性（`role="checkbox"` 等）

**ページ構造・階層**
- セクション見出し（H1〜H3）と配下要素の対応関係
- ナビゲーションメニューの項目とリンク先URL
- フォーム要素のグループ構造
- テーブルのヘッダー（`thead`）とデータ行（`tbody`）の構成

**インタラクティブ要素のラベル**
- ボタン・リンクの表示テキスト
- フォームラベルと `input` の対応
- テーブルの列ヘッダーテキスト

**補足情報（セレクタの精度向上）**
- 要素の出現順序・位置（`:nth-child` 生成用）
- 親要素との関係（子孫セレクタ用）
- `data-*` カスタム属性

### 推奨アプローチ

1. **生HTML を併用する** — crawl4AI の `fit_markdown` だけでなく生HTMLも取得し、属性情報を保持する
2. **構造化リストとして出力する** — インタラクティブ要素（リンク・ボタン・フォーム）の属性付き一覧を別途出力する
3. **マークダウン内にメタデータブロックを埋め込む** — HTML コメントや YAML フロントマターとして `id`/`class` を記録する

---

## よくある誤りと注意点

### フィールド名の誤り：`"element"` vs `"selector"`

Step オブジェクトの要素指定フィールドは **`"selector"`** が正しい。  
`"element"` を使うとサーバー側で `step.selector` が `undefined` になり、  
ガイドが `document.querySelector('')` 相当の空セレクタにフォールバックして `body` をハイライトしてしまう。

```jsonc
// NG — inject.js が認識しない
{ "id": "go-bacteria", "element": "#menu > li:nth-child(1) > a", "action": "highlight" }

// OK
{ "id": "go-bacteria", "selector": "#menu > li:nth-child(1) > a", "action": "highlight" }
```

### セレクタの堅牢性

| 優先順位 | セレクタ例 | 理由 |
|---|---|---|
| 高 | `#tblUList`, `input#NANDO` | id は変更されにくい |
| 高 | `a[href='/mrinda/list/crossLink']` | 固定URLは安定 |
| 中 | `input[type='text']`, `button[type='submit']` | 属性値は比較的安定 |
| 低 | `.btn-primary`, `div.content > p:nth-child(3)` | クラス名・位置はリニューアルで壊れる |

### `selector` が空文字の挙動

- `selector: ""` + `action: "highlight"` → `description` 内の `『...』` パスで要素解決（TogoDX専用）
- `selector: ""` + `action: "tooltip"` → Floating Tooltip（ページ操作可能）
- `selector: "body"` → `action` 問わず Floating Tooltip扱い

### JSON 構文の確認

ガイドファイルは配列 `[{...}, {...}]` 形式。  
末尾カンマ・シングルクォート・コメント (`//`) はいずれも JSON 不正になる。  
`node proxy-server/validate-guide.js <ファイルパス>` でスキーマ検証を行うこと。
