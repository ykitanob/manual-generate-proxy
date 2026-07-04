# Implementation Rules for LLM-Linked Guide Delivery (Secure Version)

## 1. Policy

- Do not let the LLM write executable code.
- The LLM only returns the guide definition JSON.
- Execution is handled exclusively by the fixed runtime on the extension side.

## 2. Overall Configuration

1. Content Script Runtime
2. Extension Service Worker
3. Guide API Server
4. LLM Adapter
5. Policy Engine

## 3. Responsibilities of Each Component

### 3.1 Content Script Runtime

- Reads the page DOM.
- Executes the guide JSON.
- Displays the guide UI.
- Sends execution logs.

### 3.2 Service Worker

- Communicates with the Guide API.
- Adds authentication headers.
- Rate limiting.
- Short-term caching.

### 3.3 Guide API Server

- Request validation.
- LLM invocation.
- Validation of generation results.
- Guide signing.
- Guide delivery.

### 3.4 LLM Adapter

- Prompt management.
- Model invocation.
- Retry control.

### 3.5 Policy Engine

- Domain-specific permission rules.
- Definition of allowed operations.
- Management of prohibited selectors.

## 4. Message Specifications

### 4.1 Runtime -> Worker

`GUIDE_GENERATE_REQUEST`

- requestId
- pageUrl
- pageTitle
- language
- domSnapshot
- userIntent
- contextVersion

### 4.2 Worker -> Guide API

`POST /v1/guides/generate`

- sessionId
- tenantId
- pageContext
- intent
- capabilities
- maxSteps

### 4.3 Guide API -> Worker

`GuidePackage`

- guideId
- version
- expiresAt
- steps
- theme
- constraints
- signature

### 4.4 Runtime -> Worker

`GUIDE_EVENT`

- guideId
- stepId
- eventType
- timestamp
- result

## 5. Recommended Structure for GuidePackage

### 5.1 トップレベル

- guideId: string
- version: integer
- expiresAt: ISO8601
- locale: string
- steps: array
- theme: object
- constraints: object
- signature: string

### 5.2 Step

- stepId: string
- selector: string | null
- title: string
- description: string
- action: enum
- placement: enum
- nextCondition: enum
- timeoutMs: integer

### 5.3 action enum

- highlight
- tooltip
- scrollIntoView
- focusInput
- waitForClick
- waitForText
- complete

### 5.4 placement enum

- top
- right
- bottom
- left
- center

### 5.5 constraints

- allowedDomains: array
- blockedSelectors: array
- maxDomOps: integer
- maxDurationMs: integer

## 6. 検証ルール

1. selector検証
   - script, iframe, html, body全域破壊系は拒否
   - 許可済みセレクタパターンのみ実行
2. action検証
   - enum外は拒否
3. 文字列長検証
   - title 80文字以内
   - description 400文字以内
4. ステップ数検証
   - 1以上10以下
5. ドメイン検証
   - pageUrlがallowedDomainsに一致しない場合は拒否
6. 署名検証
   - 署名不一致は破棄
7. 期限検証
   - expiresAt超過は実行不可

## 7. セキュア実行ルール

1. eval/new Function/任意スクリプト実行を禁止
2. DOM変更は固定ランタイム関数経由に限定
3. スタイル注入は名前空間クラスに限定
4. 失敗時は即ロールバック
5. 1ガイドあたり操作回数と実行時間に上限を設ける

## 8. API最小セット

1. `POST /v1/guides/generate`
   - GuidePackageを返す
2. `POST /v1/guides/events`
   - step開始/完了/失敗を記録
3. `GET /v1/guides/policy`
   - ドメイン別許可ルール配布

## 9. 実行フロー

1. ページ読込後、Runtimeが軽量DOM要約を作成
2. WorkerがGuide APIへ生成依頼
3. Guide APIがLLM生成結果を検証し署名
4. Runtimeが署名検証後にガイド実行
5. ユーザー操作に応じて次ステップへ進行
6. 実行ログをevents APIへ送信

## 10. PoC成功基準

1. Eボタン未選択時
   - E案内 -> クリック待ち -> 遷移後Search再開
2. Eボタン選択済み時
   - Eステップのみ説明スキップ、他ステップ継続
3. UI破壊なし
   - 主要レイアウト差分が小さい
4. セキュリティ
   - 任意JS実行ゼロ
   - 署名不一致ガイドの拒否

## 11. スキーマ運用

- GuidePackage の正式な検証ルールは [guide-package.schema.json](guide-package.schema.json) を参照する
- サーバー側は LLM 応答を必ずスキーマ検証してから返却する
- 拡張側も受信時に再検証し、検証失敗時は実行せずに破棄する

### 11.1 検証の実装ポイント

1. 生成直後に検証
   - LLM 応答 JSON を [guide-package.schema.json](guide-package.schema.json) で検証
2. 署名前に検証
   - 不正な JSON に署名しない
3. 実行前に検証
   - Runtime でも再検証して二重ガード

### 11.2 互換性ルール

1. `version` を必須とし、破壊的変更時にメジャーを上げる
2. 既存クライアントと互換しない項目は `additionalProperties: false` で拒否する
3. 新規項目を追加する場合は先に schema を更新し、その後に生成側を更新する

### 11.3 トラブル時の扱い

1. 検証エラー時はガイドを実行しない
2. ユーザーには「ガイドを生成できませんでした」を表示
3. ログには requestId, guideId, 失敗したフィールド名を残す
