# 請在「專案根目錄」建置：docker build -f discord-bot/Dockerfile .
FROM node:20-slim

RUN apt-get update -qq && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN corepack enable pnpm 2>/dev/null || true
RUN pnpm install 2>/dev/null || npm install --workspaces 2>/dev/null || (cd frontend && npm install && cd ../discord-bot && npm install)
RUN cd discord-bot && (pnpm install 2>/dev/null || npm install)

RUN chmod +x /app/discord-bot/fly-entrypoint.sh
ENTRYPOINT ["/app/discord-bot/fly-entrypoint.sh"]
