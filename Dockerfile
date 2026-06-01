# --- Build stage ---
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain for building better-sqlite3's native addon.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
# Disable pnpm's minimum-release-age supply-chain gate for this hermetic build:
# the committed lockfile is already pinned and trusted, and the gate would
# otherwise reject very recently published (dev-only) deps in CI/server builds.
RUN pnpm install --frozen-lockfile --config.minimumReleaseAge=0 \
    || pnpm install --config.minimumReleaseAge=0

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN pnpm build

# Prune dev deps for a lean runtime node_modules (keeps native binding).
RUN pnpm prune --prod

# --- Runtime stage ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# content/ + index.db live here; mount a volume to persist.
ENV AGENTNEWS_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/index.js"]
