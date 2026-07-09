// Browser consumer over WS. Context7-confirmed: wsconnect is exported from
// @nats-io/nats-core (not @nats-io/transport-node) for browser/Deno/Node-22 WS use.
import { wsconnect } from '@nats-io/nats-core'
import { jetstream } from '@nats-io/jetstream'

const nc = await wsconnect({ servers: 'ws://localhost:8081' })
const js = jetstream(nc)
const c = await js.consumers.get('VIDGEN_EVENTS') // ordered ephemeral consumer (no name arg)
const log = document.getElementById('log')!
await c.consume({
  callback: (m) => {
    const li = document.createElement('li')
    li.textContent = `${m.seq} ${m.subject} ${m.string()}`
    log.appendChild(li)
    m.ack()
  },
})
