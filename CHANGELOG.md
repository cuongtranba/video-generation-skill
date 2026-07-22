# Changelog

## [1.3.0](https://github.com/cuongtranba/video-generation-skill/compare/v1.2.0...v1.3.0) (2026-07-22)


### Features

* **frontend:** create-form defaults 60s/6 scenes, language select vi/en ([#27](https://github.com/cuongtranba/video-generation-skill/issues/27)) ([8fb2085](https://github.com/cuongtranba/video-generation-skill/commit/8fb2085c1b1e1e20a8e1a0a6ed4a333163291938))
* **worker:** replace Whisper caption transcription with ElevenLabs synthesis timestamps ([#29](https://github.com/cuongtranba/video-generation-skill/issues/29)) ([f9be56f](https://github.com/cuongtranba/video-generation-skill/commit/f9be56fc171d5f4967d0e7d9e5714b07de4b8c15))


### Bug Fixes

* **api:** dispatch caption job after all voiceovers (race fix) ([#30](https://github.com/cuongtranba/video-generation-skill/issues/30)) ([51fdf7f](https://github.com/cuongtranba/video-generation-skill/commit/51fdf7fccf69e2d103404fb7784dce0909f1c250))

## [1.2.0](https://github.com/cuongtranba/video-generation-skill/compare/v1.1.0...v1.2.0) (2026-07-22)


### Features

* **frontend:** Pipeline Home board — unclip RENDER, AA contrast, keyboard control ([#25](https://github.com/cuongtranba/video-generation-skill/issues/25)) ([3e0da56](https://github.com/cuongtranba/video-generation-skill/commit/3e0da56ba63989096110470be61f35bce869462d))
* Vietnamese-default i18n + single-user session auth ([#26](https://github.com/cuongtranba/video-generation-skill/issues/26)) ([68ce487](https://github.com/cuongtranba/video-generation-skill/commit/68ce487eb970a414b8ec2f54d27466744f6776a5))


### Bug Fixes

* **deploy:** unique service names (vidgen-postgres/vidgen-nats) to avoid dokploy-network DNS collision ([#23](https://github.com/cuongtranba/video-generation-skill/issues/23)) ([b8cb93e](https://github.com/cuongtranba/video-generation-skill/commit/b8cb93e9f803b6f59c381914054814bd419886c3))

## [1.1.0](https://github.com/cuongtranba/video-generation-skill/compare/v1.0.0...v1.1.0) (2026-07-22)


### Features

* **api:** P1 — TypeScript api-core (event store, aggregate, commands, projections, cost wall, HTTP) ([#8](https://github.com/cuongtranba/video-generation-skill/issues/8)) ([dc0c18c](https://github.com/cuongtranba/video-generation-skill/commit/dc0c18c3d71e815d6d6db4a463ea3ec5d60ea2fd))
* **api:** P2 — Agent SDK script service (idea → scenes, scriptUsd=0) ([#9](https://github.com/cuongtranba/video-generation-skill/issues/9)) ([926092b](https://github.com/cuongtranba/video-generation-skill/commit/926092b68be08ecf2018e5b392b9088571edbbf6))
* **frontend:** apply Vidgen design system control-room UI ([#17](https://github.com/cuongtranba/video-generation-skill/issues/17)) ([9aa0d77](https://github.com/cuongtranba/video-generation-skill/commit/9aa0d77cbedbc5a46c558e5dbd60d2ed61273056))
* **frontend:** implement Pipeline Home board UI ([#19](https://github.com/cuongtranba/video-generation-skill/issues/19)) ([b1ee185](https://github.com/cuongtranba/video-generation-skill/commit/b1ee1857dca3de7a0bd394109d935bb8c72fe54f))
* pluggable provider adapters + YAML config ([#2](https://github.com/cuongtranba/video-generation-skill/issues/2)) ([c62c953](https://github.com/cuongtranba/video-generation-skill/commit/c62c9536345f28873d08b4dd6affdf5396a2caf6))
* remove FPT.AI TTS provider; replace voice picker with ElevenLabs fixed label ([#15](https://github.com/cuongtranba/video-generation-skill/issues/15)) ([c6b7f85](https://github.com/cuongtranba/video-generation-skill/commit/c6b7f854e6bde917772d43b63d0fe699328f9066))
* **worker:** P3 — Go worker (job consume → media pipeline → result events, msgID idempotent) ([#10](https://github.com/cuongtranba/video-generation-skill/issues/10)) ([e5fbf42](https://github.com/cuongtranba/video-generation-skill/commit/e5fbf42a020bfb58dd50a41095390956c4d89b19))


### Bug Fixes

* commit .c3/c3.db so C3 works on a fresh clone ([#4](https://github.com/cuongtranba/video-generation-skill/issues/4)) ([dcd5502](https://github.com/cuongtranba/video-generation-skill/commit/dcd5502bbe64e61a911eff7914c1c87bf0c93089))
* **frontend:** inject Fast Refresh preamble in dev ([#14](https://github.com/cuongtranba/video-generation-skill/issues/14)) ([fbc2f79](https://github.com/cuongtranba/video-generation-skill/commit/fbc2f7912bfe1bc9aa8e786b89fcee3ddf1f96dd))
