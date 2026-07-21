import { Callout } from 'frontend'

export function Tones() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Callout tone="info">Uploading 3 assets…</Callout>
      <Callout tone="good">Render complete — output.mp4 ready.</Callout>
      <Callout tone="warn">Locked. Voice and captions are frozen once the storyboard is approved.</Callout>
      <Callout tone="error">Cost cap reached: $0.15 of $0.15 spent.</Callout>
    </div>
  )
}
