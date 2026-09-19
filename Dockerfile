# Build stage: compiles the library (UMD + CSS) that the server serves as static files.
FROM node:22-slim AS builder
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
# --ignore-scripts: skips postinstall scripts for cypress/esbuild, which pnpm's newer
# "approve-builds" gate otherwise hard-fails on non-interactively. Safe here specifically
# because the actual build step below runs rollup directly (build.js), never vite/cypress.
RUN corepack pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN corepack pnpm build
# Captured here (not passed as a --build-arg at deploy time) so the footer's commit link is
# always correct with no extra flag to remember at deploy time - .dockerignore deliberately
# keeps .git in the build context for exactly this line.
RUN apt-get update && apt-get install -y --no-install-recommends git \
  && git rev-parse --short HEAD > /repo/server/public/commit-sha.txt \
  && rm -rf /var/lib/apt/lists/*

# Runtime stage: just the tiny Node server + the built assets, no build toolchain.
FROM node:22-slim
WORKDIR /app
COPY server/ ./server/
COPY --from=builder /repo/server/public/commit-sha.txt ./server/public/commit-sha.txt
COPY --from=builder /repo/dist/family-chart.js ./server/public/vendor/family-chart.js
COPY --from=builder /repo/dist/styles/family-chart.css ./server/public/vendor/family-chart.css
COPY --from=builder /repo/node_modules/d3/dist/d3.min.js ./server/public/vendor/d3.min.js

ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
