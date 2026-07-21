---
target: c3-1008
scope: insert
base: c3-1008#n379@v1:sha256:649a4baee16f01b4bd2225f89bff4ad0f8ecefb8d376091c93a4540363a68792
---
| GET /api/config | IN | Returns { ttsProvider } read from config.yaml (Bun.YAML.parse); fpt fallback if unreadable | HTTP | api/src/http.ts |
