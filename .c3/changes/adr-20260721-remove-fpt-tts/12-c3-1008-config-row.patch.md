---
target: c3-1008
scope: block
base: c3-1008#n988@v1:sha256:b4ce7132736854829ad941967df83541ff0fba6a7cca277756c6b14cb425354f
---
| GET /api/config | IN | Returns { ttsProvider } read from config.yaml (Bun.YAML.parse); elevenlabs fallback if unreadable | HTTP | api/src/http.ts |
