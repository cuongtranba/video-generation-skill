import { Badge } from 'frontend'

export function Tones() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <Badge tone="neutral">draft</Badge>
      <Badge tone="good">Live</Badge>
      <Badge tone="bad">Disconnected</Badge>
    </div>
  )
}

export function Cost() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Badge tone="neutral">$0.04</Badge>
      <Badge tone="bad">$0.14</Badge>
    </div>
  )
}
