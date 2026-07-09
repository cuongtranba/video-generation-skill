// Headless proof that the SAME browser-path import (wsconnect from
// @nats-io/nats-core) can subscribe to VIDGEN_EVENTS over the WS listener
// (ws://localhost:8081) and receive JetStream messages published over the
// separate TCP transport (4223). This isolates the actual spike risk
// (JetStream-over-WebSocket) from browser DOM plumbing.
import { wsconnect } from '@nats-io/nats-core'
import { jetstream } from '@nats-io/jetstream'

const received: { seq: number; subject: string; data: string; t: number }[] = []
const start = Date.now()

const nc = await wsconnect({ servers: 'ws://localhost:8081' })
console.log(`[ws-check] connected to ${nc.getServer()}`)

const js = jetstream(nc)
const c = await js.consumers.get('VIDGEN_EVENTS')
console.log('[ws-check] got ordered consumer, waiting for messages...')

const consumeDone = c.consume({
  callback: (m) => {
    const t = Date.now() - start
    received.push({ seq: m.seq, subject: m.subject, data: m.string(), t })
    console.log(`[ws-check] recv seq=${m.seq} subject=${m.subject} data=${m.string()} +${t}ms`)
    m.ack()
  },
})

// Wait up to 10s for at least 3 messages, then report and exit.
const deadline = Date.now() + 10_000
while (received.length < 3 && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 100))
}

console.log(`[ws-check] RESULT: received ${received.length} messages over WS (>=3 required)`)
if (received.length >= 3) {
  console.log('[ws-check] PASS')
} else {
  console.log('[ws-check] FAIL')
}

await nc.close()
process.exit(received.length >= 3 ? 0 : 1)
