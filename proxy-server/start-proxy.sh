#!/usr/bin/env bash
#
# プロキシサーバー起動スクリプト（WSL / bash）
#
# 使い方:
#   ./start-proxy.sh              # PORT=18080 で起動
#   PORT=9000 ./start-proxy.sh    # ポートを指定して起動
#
# 停止: Ctrl + C
#
set -euo pipefail

# このスクリプトのあるディレクトリ（proxy-server/）へ移動
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ポート（環境変数 PORT があれば優先、なければ 18080）
PORT="${PORT:-18080}"

# Node.js の存在確認
if ! command -v node >/dev/null 2>&1; then
  echo "エラー: node が見つかりません。Node.js をインストールしてください。" >&2
  exit 1
fi

# 依存パッケージが未インストールなら install
if [ ! -d "node_modules" ]; then
  echo "依存パッケージをインストールします..."
  npm install
fi

echo "プロキシサーバーを起動します: http://localhost:${PORT}"
echo "停止するには Ctrl + C を押してください。"
echo

exec env PORT="$PORT" node server.js
