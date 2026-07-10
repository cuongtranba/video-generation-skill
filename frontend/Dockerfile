# Stage "build": compiles the SPA to static assets at /app/dist.
#
# `docker build --target build -t vidgen-frontend-build .` produces /app/dist.
# Per index §3/§5, api — not this image — serves the SPA in production:
# api's own Dockerfile (P1) is expected to `COPY --from=` this stage's
# /app/dist into whatever directory api/src/http.ts serves statically
# (ASSUMED `public/` here — confirm against api/src/http.ts once P1 is
# authored; this is a handshake point between P1 and P4, not a frozen fact).
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Stage "dev": local development server, used by docker-compose's `frontend`
# service (index §2's runtime diagram). Proxies /api and /media to the api
# container per vite.config.ts's VITE_API_PROXY_TARGET (see Task 2 — set
# this env var in docker-compose.yml to api's real container DNS name/port
# once P1 defines it). Also bun-based (not node) — the dev server is started
# via `bun run dev`, which needs the `bun` binary on PATH.
FROM oven/bun:1 AS dev
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 5173
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0"]
