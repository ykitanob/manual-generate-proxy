'use strict';

/**
 * validate-guide.js
 *
 * GuidePackage server-side validation (Node.js + AJV)
 *
 * Dependencies:
 *   npm install ajv ajv-formats
 *
 * Usage:
 *   const { validateGuidePackage, verifySignature } = require('./validate-guide');
 *
 *   const result = validateGuidePackage(guidePackageObj);
 *   if (!result.valid) {
 *     console.error(result.errors);  // AJV error array
 *   }
 */

const path = require('path');
const fs   = require('fs');
const Ajv  = require('ajv');
const addFormats = require('ajv-formats');

// ---------- Load Schema ----------

const SCHEMA_PATH = path.resolve(__dirname, '../guide-package.schema.json');

let _schema;
function loadSchema() {
  if (!_schema) {
    const raw = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    _schema = JSON.parse(raw);
  }
  return _schema;
}

// ---------- AJV Instance ----------

let _ajv;
let _compiledValidate;

function getValidator() {
  if (!_compiledValidate) {
    _ajv = new Ajv({
      allErrors:   true,   // Collect all errors (don't stop at first)
      strict:      false,  // Allow unknown keywords in JSON Schema Draft 2020-12
      verbose:     true,   // Attach data/parentData to errors
    });
    addFormats(_ajv);      // Enable validation for formats like date-time, uri, etc.

    const schema = loadSchema();
    _compiledValidate = _ajv.compile(schema);
  }
  return _compiledValidate;
}

// ---------- Main Exports ----------

/**
 * Validate GuidePackage object against JSON Schema.
 *
 * @param {unknown} data Raw data to validate (e.g., LLM output)
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
 * Stub for verifying GuidePackage signature.
 *
 * Replace this with HMAC-SHA256 or RSA signature verification in production.
 * See GUIDE_ARCHITECTURE_RULES.md §7.
 *
 * @param {object} guidePackage Signed GuidePackage
 * @param {string} signingSecret Signature verification key (inject via environment variable)
 * @returns {boolean} true if signature is valid
 */
function verifySignature(guidePackage, signingSecret) {
  if (!guidePackage || typeof guidePackage.signature !== 'string') {
    return false;
  }
  if (!signingSecret) {
    throw new Error('SIGNING_SECRET is not set');
  }

  // ---- TODO: Replace with actual signature verification logic ----
  // Example: HMAC-SHA256
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
