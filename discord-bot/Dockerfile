# 請在「專案根目錄」建置：docker build -f discord-bot/Dockerfile .
# 若部署在 Fly.io（Linux），請用同平台建置，sharp 才會裝對二進位：
#   docker build --platform linux/amd64 -f discord-bot/Dockerfile .
# 或直接 fly deploy（在 Fly 上建置即為 linux/amd64）。
FROM --platform=linux/amd64 node:20-slim

RUN apt-get update -qq && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN corepack enable pnpm 2>/dev/null || true
RUN pnpm install 2>/dev/null || npm install --workspaces 2>/dev/null || (cd frontend && npm install && cd ../discord-bot && npm install)
# 確保 discord-bot 有獨立 node_modules（含 dotenv），避免 ESM 在容器內找不到
RUN cd /app/discord-bot && npm install
# 驗證 frontend 的 sharp 可載入（建置時即發現問題）
RUN cd /app/frontend && node -e "require('sharp'); console.log('sharp OK')"

RUN chmod +x /app/discord-bot/fly-entrypoint.sh
ENTRYPOINT ["/app/discord-bot/fly-entrypoint.sh"]
