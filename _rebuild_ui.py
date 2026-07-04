import json, sys
sys.stdout.reconfigure(encoding='utf-8')

PROMPT_PATH = 'proxy-server/guide-selection-prompt.json'
with open(PROMPT_PATH, encoding='utf-8') as f:
    config = json.load(f)

NEW_HTML = """\
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Guide Proxy</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Yu Gothic UI", Meiryo, sans-serif; margin: 24px; background: #f5f5f5; }
    h1 { color: #333; }
    .section { background: white; padding: 24px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .section h2 { margin-top: 0; color: #005faf; }
    label { font-size: 13px; color: #555; font-weight: bold; }
    input, textarea, select { width: 100%; max-width: 800px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; margin-top: 4px; }
    input:focus, textarea:focus, select:focus { outline: none; border-color: #005faf; box-shadow: 0 0 4px rgba(0, 95, 175, 0.3); }
    .field { margin-bottom: 14px; }
    .row { display: flex; gap: 12px; max-width: 800px; }
    .row .field { flex: 1; }
    details { margin-bottom: 14px; }
    summary { cursor: pointer; color: #005faf; font-size: 13px; user-select: none; padding: 6px 0; }
    summary:hover { text-decoration: underline; }
    .llm-fields { padding: 12px 0 0 0; }
    button.primary { padding: 10px 24px; background: #005faf; color: white; border: none; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 15px; }
    button.primary:hover { background: #004080; }
    a { color: #005faf; }
    .status { margin-top: 12px; padding: 10px; border-radius: 4px; font-size: 14px; max-width: 800px; }
    .status.success { background: #d4edda; color: #155724; }
    .status.error { background: #f8d7da; color: #721c24; white-space: pre-wrap; word-break: break-all; }
    .status.loading { background: #d1ecf1; color: #0c5460; }
    .hint { font-size: 12px; color: #888; margin-top: 6px; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body>
  <h1>Guide Proxy</h1>

  <div class="section">
    <h2>ガイド付きページを開く</h2>

    <div class="field">
      <label for="proxy-url">URL</label>
      <input type="url" id="proxy-url" required value="https://www.nite.go.jp/nbrc/mrinda/list/risk/bacteria">
      <p class="hint">既知サイト（NBRC / TogoDX / nanbyodata）はそのまま開きます。未知サイトは自動でクロール → ガイド生成を行います。</p>
    </div>

    <div class="field">
      <label for="guide-prompt">やりたいこと（プロンプト）</label>
      <textarea id="guide-prompt" rows="3" placeholder="例: E菌でリスク区分を調べたい"></textarea>
      <p class="hint">既知サイト: ガイドを選択します。未知サイト: ガイド生成の指示として使われます。</p>
    </div>

    <details open>
      <summary>⚙ LLM 設定</summary>
      <div class="llm-fields">
        <div class="field">
          <label for="llm-provider">プロバイダー</label>
          <select id="llm-provider">
            <option value="ollama">Ollama（ローカル）</option>
            <option value="openai">OpenAI</option>
            <option value="claude">Claude (Anthropic)</option>
            <option value="gemini">Gemini (Google)</option>
          </select>
        </div>
        <div id="field-ollama-uri" class="field">
          <label for="ollama-uri">Ollama エンドポイント</label>
          <input type="text" id="ollama-uri" placeholder="http://localhost:11434" value="http://172.27.184.54:11434">
        </div>
        <div class="field">
          <label for="ollama-model">モデル名</label>
          <input type="text" id="ollama-model" placeholder="zephyr:7b" value="zephyr:7b">
        </div>
        <div class="field">
          <label for="ollama-apikey" id="label-apikey">API キー（クラウド版 https://ollama.com を使う場合のみ）</label>
          <input type="password" id="ollama-apikey" placeholder="ローカル版は空欄のまま" value="">
        </div>
      </div>
    </details>

    <button class="primary" onclick="openWithGuide()">開く</button>
    <div id="main-status"></div>
  </div>

  <script>
    const MODEL_PLACEHOLDERS = {
      ollama: 'zephyr:7b',
      openai: 'gpt-4o-mini',
      claude: 'claude-3-5-haiku-20241022',
      gemini: 'gemini-2.0-flash'
    };

    function updateProviderFields() {
      const provider = document.getElementById('llm-provider').value;
      const ollamaUriField = document.getElementById('field-ollama-uri');
      const apikeyLabel   = document.getElementById('label-apikey');
      const apikeyInput   = document.getElementById('ollama-apikey');
      const modelInput    = document.getElementById('ollama-model');

      modelInput.placeholder = MODEL_PLACEHOLDERS[provider] || '';

      if (provider === 'ollama') {
        ollamaUriField.style.display = '';
        apikeyLabel.textContent = 'API キー（クラウド版 https://ollama.com を使う場合のみ）';
        apikeyInput.placeholder = 'ローカル版は空欄のまま';
      } else {
        ollamaUriField.style.display = 'none';
        apikeyLabel.textContent = 'API キー（必須）';
        apikeyInput.placeholder = provider + ' API キーを入力';
      }
    }

    async function openWithGuide() {
      const url      = document.getElementById('proxy-url').value.trim();
      const prompt   = document.getElementById('guide-prompt').value.trim();
      const provider = document.getElementById('llm-provider').value;
      const ollamaUri = document.getElementById('ollama-uri').value.trim();
      const modelName = document.getElementById('ollama-model').value.trim();
      const apiKey   = document.getElementById('ollama-apikey').value;
      const statusDiv = document.getElementById('main-status');

      if (!url) {
        statusDiv.className = 'status error';
        statusDiv.textContent = 'URLを入力してください';
        return;
      }

      const setLoading = (msg) => {
        statusDiv.className = 'status loading';
        statusDiv.innerHTML = `<span style="animation: pulse 1s infinite; display: inline-block;">${msg}</span>`;
      };

      setLoading('サイト確認中...');

      try {
        // Step 1: Bootstrap (既知サイトは即返却、未知サイトはクロール＋ガイド生成)
        const bsResp = await fetch('/api/bootstrap-site', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetUrl: url, provider, ollamaUri, modelName, apiKey, prompt })
        });
        const bsData = await bsResp.json();
        if (!bsResp.ok || !bsData.ok) {
          statusDiv.className = 'status error';
          statusDiv.textContent = 'エラー: ' + (bsData.error || '不明なエラー');
          return;
        }

        let proxyUrl = bsData.proxyUrl;
        let statusMsg = bsData.bootstrapped
          ? `ガイドを ${bsData.guideCount} 件生成しました。`
          : '';

        // Step 2: プロンプトがある場合はガイド選択
        if (prompt && modelName) {
          setLoading('AIがガイドを選択中...');
          try {
            const genResp = await fetch('/api/generate-guide', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ provider, ollamaUri, modelName, apiKey, prompt, targetUrl: url })
            });
            if (genResp.ok) {
              const genData = await genResp.json();
              if (genData.selectedGuideId) {
                proxyUrl += '&guideId=' + encodeURIComponent(genData.selectedGuideId);
                if (genData.newGuideCreated) {
                  statusMsg += `新しいガイド「${genData.guideTitle}」を生成しました。`;
                } else {
                  statusMsg += `「${genData.guideTitle}」を選択しました。`;
                }
                if (genData.keywords && genData.keywords.length) {
                  statusMsg += `\n🔑 キーワード: ${genData.keywords.join(', ')}`;
                }
                if (genData.reasoning) {
                  statusMsg += `\n💭 ${genData.reasoning}`;
                }
              }
            }
          } catch (_) { /* ガイド選択失敗は無視してページを開く */ }
        }

        statusDiv.className = 'status success';
        statusDiv.style.whiteSpace = 'pre-line';
        statusDiv.textContent = (statusMsg || '') + '\\nページへ移動します...';
        setTimeout(() => { window.location.href = proxyUrl; }, 800);

      } catch (err) {
        statusDiv.className = 'status error';
        statusDiv.textContent = 'エラー: ' + err.message;
      }
    }

    // Enter キーで送信
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) openWithGuide();
    });

    // プロバイダー切替イベント（インライン onchange よりイベントリスナの方が確実）
    document.getElementById('llm-provider').addEventListener('change', updateProviderFields);
    // 初期表示（スクリプトは body 末尾のため DOM は既に構築済み）
    updateProviderFields();
  </script>
</body>
</html>"""

config['ui']['html'] = NEW_HTML

with open(PROMPT_PATH, 'w', encoding='utf-8') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)

print('OK: UIを統合しました')
