---
target: c3-1008
scope: insert
base: c3-1008#n477@v1:sha256:091aa3c929420de4ef0539bb030dc952e3eaf85b4d7899cedb2db40257cf66d8
---
| POST /api/login | IN | Verifies credentials (timing-safe); sets HttpOnly vg_session signed cookie on success; 401 on bad credentials | HTTP | api/src/auth.ts, api/src/http.ts |
| POST /api/logout | IN | Clears the vg_session cookie | HTTP | api/src/http.ts |
| GET /api/session | IN | Returns { authenticated: boolean } by verifying the request's vg_session cookie | HTTP | api/src/http.ts |
| /api/* auth gate | IN | Every /api route except login/logout/session requires a valid session cookie; 401 otherwise. SPA and /media stay open | HTTP | api/src/http.ts |
