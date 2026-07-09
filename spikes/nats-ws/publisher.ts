// Node-side publisher over TCP (4223). Context7-confirmed: connect is exported
// from @nats-io/transport-node for Node.
import { connect } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'

const nc = await connect({ servers: 'localhost:4223' })
const js = jetstream(nc)
for (let i = 0; i < 3; i++) {
  await js.publish(`vidgen.evt.p1.Ping`, JSON.stringify({ v: 1, type: 'Ping', n: i }), { msgID: `ping-${i}` })
}
await nc.drain()
console.log('published 3')
