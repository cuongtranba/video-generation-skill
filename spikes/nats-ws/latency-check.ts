// Supplementary (not part of the D3 deliverable skeleton): measures publish->WS-receive
// latency using fresh unique msgIDs so JetStream dedup doesn't swallow the publish.
import { wsconnect } from '@nats-io/nats-core'
import { connect } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'

const wsnc = await wsconnect({ servers: 'ws://localhost:8081' })
const js = jetstream(wsnc)
const c = await js.consumers.get('VIDGEN_EVENTS')

const nonce = Date.now()

const done = c.consume({
  callback: (m) => {
    const payload = m.json<{ n: number; nonce: number; tSend: number }>()
    if (payload.nonce === nonce) {
      const recvAt = Date.now()
      console.log(`[latency] recv n=${payload.n} latency=${recvAt - payload.tSend}ms`)
      m.ack()
    }
  },
})

const tcpnc = await connect({ servers: 'localhost:4223' })
const pjs = jetstream(tcpnc)
for (let i = 0; i < 3; i++) {
  const tSend = Date.now()
  await pjs.publish(`vidgen.evt.p1.Ping`, JSON.stringify({ n: i, nonce, tSend }), {
    msgID: `latency-${nonce}-${i}`,
  })
}

await new Promise((r) => setTimeout(r, 3000))
await tcpnc.drain()
await wsnc.close()
process.exit(0)
