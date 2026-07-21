---
target: c3-2003
scope: block
base: c3-2003#n490@v1:sha256:303c98ccc647af4859a03b999246644aacca52dfbf926df026bfef407226a1d0
---
Owns the TTSProvider interface, ElevenLabsProvider (synchronous POST returning mp3 bytes; fixed voice ID), and the NewFromConfig factory. ElevenLabs is the only provider. Non-goal: does not own the Voice/Speed domain types — those are in domain/.
