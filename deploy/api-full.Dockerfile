# Production image: builds the React SPA and the api, and serves BOTH from the
# single api process (SPA_DIR=/app/public). The frontend uses relative /api and
# /media URLs, so SPA and API must be same-origin — bundling the SPA into the
# api image (the design frontend/Dockerfile's comments always intended) delivers
# that with one service, no CORS, and no path-routing gymnastics.
#
# Build context is the repo ROOT (see docker-compose.dokploy.yml) so this file
# can COPY from both frontend/ and api/. The dev workflow is unchanged and still
# uses api/Dockerfile + frontend/Dockerfile.
# syntax=docker/dockerfile:1

# --- Stage 1: build the SPA ---
FROM oven/bun:1 AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
# NATS WebSocket URL is baked at build time (Vite import.meta.env.VITE_NATS_WS_URL).
# Same-origin through Traefik: wss://<host>/nats (stripped to / for the nats WS
# listener). Overridable per-deploy via the build arg in the compose file.
ARG VITE_NATS_WS_URL="wss://vidgen.lowbit.link/nats"
ENV VITE_NATS_WS_URL=$VITE_NATS_WS_URL
RUN bun run build
# -> /fe/dist

# --- Stage 2: api runtime, serving the SPA from /app/public ---
FROM oven/bun:1 AS api
WORKDIR /app
ENV NODE_ENV=production
COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile
COPY api/tsconfig.json ./
COPY api/src ./src
COPY api/migrations ./migrations
COPY --from=frontend /fe/dist ./public
EXPOSE 8080
CMD ["bun", "src/index.ts"]
