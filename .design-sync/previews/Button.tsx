import { Button } from 'frontend'

export function Primary() {
  return <Button>Create project</Button>
}

export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <Button variant="primary">Generate voiceovers</Button>
      <Button variant="ghost">Select</Button>
      <Button variant="danger">Delete render</Button>
    </div>
  )
}

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button size="md">Approve storyboard</Button>
      <Button size="sm" variant="ghost">Select</Button>
    </div>
  )
}

export function Disabled() {
  return <Button disabled>Creating…</Button>
}
