import { Badge, Button, Stack } from 'frontend'

export function Default() {
  return (
    <Stack gap="md">
      <Badge tone="good">Live</Badge>
      <p style={{ margin: 0, color: 'var(--vg-color-text-muted)', fontSize: 'var(--vg-text-sm)' }}>
        Scenes resolved. Voiceovers synthesized. Captions ready.
      </p>
      <Button>Approve storyboard</Button>
    </Stack>
  )
}

export function Gaps() {
  const box = { background: 'var(--vg-color-surface-2)', borderRadius: 6, padding: 8, fontSize: 12 }
  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <Stack gap="xs">
        <div style={box}>tight</div>
        <div style={box}>xs</div>
        <div style={box}>gap</div>
      </Stack>
      <Stack gap="lg">
        <div style={box}>loose</div>
        <div style={box}>lg</div>
        <div style={box}>gap</div>
      </Stack>
    </div>
  )
}
