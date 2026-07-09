// Supplementary: publish 3 fresh (unique msgID) events for the live-browser DOM check.
import { connect } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'

const nc = await connect({ servers: 'localhost:4223' })
const js = jetstream(nc)
const nonce = Date.now()
for (let i = 0; i < 3; i++) {
  await js.publish(`vidgen.evt.p1.Ping`, JSON.stringify({ v: 1, type: 'Ping', n: i, nonce }), {
    msgID: `live-${nonce}-${i}`,
  })
}
await nc.drain()
console.log(`published 3 (nonce=${nonce})`)
