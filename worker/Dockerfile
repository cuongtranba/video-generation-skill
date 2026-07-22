# worker/Dockerfile
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/vidgen-worker ./cmd/worker

FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
# Fail the build loudly if this base image's ffmpeg lacks libass/the ass
# filter, instead of failing later at render time with the confusing
# "ass= filter" error described in the root CLAUDE.md gotchas.
RUN ffmpeg -filters 2>/dev/null | grep -q " ass " || \
    (echo "FATAL: ffmpeg build is missing the ass subtitle filter (libass)" && exit 1)

WORKDIR /app
COPY --from=build /out/vidgen-worker /app/vidgen-worker

ENV NATS_URL=nats://nats:4222
ENV VIDGEN_ENV_PATH=/app/.env
ENV VIDGEN_CONFIG_PATH=/app/config.yaml
ENV FFMPEG_BIN=ffmpeg
ENV FFPROBE_BIN=ffprobe

ENTRYPOINT ["/app/vidgen-worker"]
