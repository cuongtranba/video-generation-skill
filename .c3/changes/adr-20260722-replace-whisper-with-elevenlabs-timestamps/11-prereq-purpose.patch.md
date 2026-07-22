---
target: c3-2009
scope: block
base: c3-2009#n739@v1:sha256:bd0885b2cda37d5c5ca48cea44db1c55a146fba1138c4074ef5d2564f3191f95
---
Owns binary resolution via FFMPEG_BIN, FFPROBE_BIN env overrides (falling back to PATH). Fails fast with a clear error if a required binary is missing. Non-goal: does not resolve the claude binary (the old CLI had this; the webapp worker does not use claude CLI).
