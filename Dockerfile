# ---------- 构建静态前端 ----------
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_BASE=/wrap/
ENV VITE_BASE=${VITE_BASE}
RUN npm run build:web

# ---------- 运行 API + 静态资源 ----------
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    STATIC_DIR=/app/dist

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY src ./src
COPY bin ./bin
COPY scripts ./scripts
COPY assets ./assets
RUN node scripts/fetch-assets.mjs
COPY samples ./samples
COPY --from=web /app/dist ./dist
COPY LICENSE NOTICE.md README.md ./

RUN addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
