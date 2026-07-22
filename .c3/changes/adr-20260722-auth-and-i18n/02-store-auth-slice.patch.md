---
target: c3-3001
scope: insert
base: c3-3001#n812@v1:sha256:f8c6fbb99440d5b5dffb01422910f01dd1f0aeb542d85547cca9b5999f9a1e78
---
| checkSession | OUT | GET /api/session on bootstrap; sets auth to authenticated or anonymous | HTTP to api | frontend/src/store/store.ts |
| login | OUT | POST /api/login with credentials; flips auth to authenticated on success | HTTP to api | frontend/src/store/store.ts |
| logout | OUT | POST /api/logout; drops auth to anonymous | HTTP to api | frontend/src/store/store.ts |
