# Build stage: compiles the library (UMD + CSS) that the server serves as static files.
FROM node:22-slim AS builder
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN corepack pnpm install --frozen-lockfile
COPY . .
RUN corepack pnpm build

# Runtime stage: just the tiny Node server + the built assets, no build toolchain.
FROM node:22-slim
WORKDIR /app
COPY server/ ./server/
COPY --from=builder /repo/dist/family-chart.js ./server/public/vendor/family-chart.js
COPY --from=builder /repo/dist/styles/family-chart.css ./server/public/vendor/family-chart.css
COPY --from=builder /repo/node_modules/d3/dist/d3.min.js ./server/public/vendor/d3.min.js

ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
