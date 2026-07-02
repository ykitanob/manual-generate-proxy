'use strict';

/**
 * validate-guide.js
 *
 * GuidePackage サーバー側バリデーション (Node.js + AJV)
 *
 * 依存:
 *   npm install ajv ajv-formats
 *
 * 使い方:
 *   const { validateGuidePackage, verifySignature } = require('./validate-guide');
 *
 *   const result = validateGuidePackage(guidePackageObj);
 *   if (!result.valid) {
 *     console.error(result.errors);  // AJV エラー配列
 *   }
 */

const path = require('path');
const fs   = require('fs');
const Ajv  = require('ajv');
const addFormats = require('ajv-formats');

// ---------- スキーマ読み込み ----------

const SCHEMA_PATH = path.resolve(__dirname, '../guide-package.schema.json');

let _schema;
function loadSchema() {
  if (!_schema) {
    const raw = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    _schema = JSON.parse(raw);
  }
  return _schema;
}

// ---------- AJV インスタンス ----------

let _ajv;
let _compiledValidate;

function getValidator() {
  if (!_compiledValidate) {
    _ajv = new Ajv({
      allErrors:   true,   // 全エラーを収集（最初の1件で止めない）
      strict:      false,  // JSON Schema Draft 2020-12 の未知キーワードを許容
      verbose:     true,   // エラーに data/parentData を付与
    });
    addFormats(_ajv);      // date-time, uri 等のフォーマット検証を有効化

    const schema = loadSchema();
    _compiledValidate = _ajv.compile(schema);
  }
  return _compiledValidate;
}

// ---------- メインエクスポート ----------

/**
 * GuidePackage オブジェクトを JSON Schema で検証する。
 *
 * @param {unknown} data  LLM 出力など、検証対象の生データ
 * @returns {{ valid: boolean, errors: import('ajv').ErrorObject[] | null }}
 */
function validateGuidePackage(data) {
  const validate = getValidator();
  const valid = validate(data);
  return {
    valid,
    errors: valid ? null : (validate.errors ?? null),
  };
}

/**
 * GuidePackage の署名を検証するスタブ。
 *
 * 本番実装では HMAC-SHA256 または RSA 署名検証に置き換える。
 * GUIDE_ARCHITECTURE_RULES.md §7 参照。
 *
 * @param {object} guidePackage  署名済み GuidePackage
 * @param {string} signingSecret 署名検証キー（環境変数で注入すること）
 * @returns {boolean} 署名が有効なら true
 */
function verifySignature(guidePackage, signingSecret) {
  if (!guidePackage || typeof guidePackage.signature !== 'string') {
    return false;
  }
  if (!signingSecret) {
    throw new Error('SIGNING_SECRET is not set');
  }

  // ---- TODO: 以下を実際の署名検証ロジックに置き換える ----
  // 例: HMAC-SHA256
  //
  //   const crypto = require('crypto');
  //   const payload = JSON.stringify({ ...guidePackage, signature: undefined });
  //   const expected = crypto
  //     .createHmac('sha256', signingSecret)
  //     .update(payload, 'utf-8')
  //     .digest('hex');
  //   return crypto.timingSafeEqual(
  //     Buffer.from(guidePackage.signature, 'hex'),
  //     Buffer.from(expected, 'hex'),
  //   );
  // --------------------------------------------------------

  // スタブ: 常に false を返す（未実装を明示）
  void signingSecret;
  return false;
}

// ---------- セルフテスト（npm run validate:schema で実行） ----------

function selfTest() {
  const goodPackage = {
    id:      'guide-test-001',
    version: '1.0.0',
    title:   'テストガイド',
    targetDomain: 'example.com',
    steps: [
      {
        id:            'step-1',
        selector:      '#main-button',
        action:        'highlight',
        title:         '最初のステップ',
        description:   'このボタンをクリックしてください。',
        placement:     'bottom',
        nextCondition: 'onClick',
        timeoutMs:     30000,
      },
    ],
    theme: {
      primaryColor: '#005faf',
      textColor:    '#ffffff',
      zIndex:       9999,
    },
    constraints: {
      allowedDomains:  ['example.com'],
      blockedSelectors: ['#admin-panel', '.secret'],
      maxDomOps:       100,
      maxDurationMs:   120000,
    },
    createdAt:  new Date().toISOString(),
    signature:  'dummy-signature-placeholder-1234567890abcdef',
  };

  const result = validateGuidePackage(goodPackage);
  if (!result.valid) {
    console.error('[selfTest] FAILED: goodPackage should be valid');
    console.error(JSON.stringify(result.errors, null, 2));
    process.exit(1);
  }
  console.log('[selfTest] PASS: goodPackage is valid');

  // 危険セレクタの拒否を確認
  const badPackage = JSON.parse(JSON.stringify(goodPackage));
  badPackage.steps[0].selector = 'script';
  const badResult = validateGuidePackage(badPackage);
  if (badResult.valid) {
    console.error('[selfTest] FAILED: dangerous selector should be rejected');
    process.exit(1);
  }
  console.log('[selfTest] PASS: dangerous selector correctly rejected');
}

module.exports = { validateGuidePackage, verifySignature, selfTest };
