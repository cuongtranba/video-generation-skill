import { Badge, Button, Card } from 'frontend'

export function ProjectCard() {
  return (
    <Card
      title="surfing-cat-01"
      meta="awaiting approval"
      actions={<Badge tone="neutral">$0.06</Badge>}
    >
      <p style={{ margin: 0, color: 'var(--vg-color-text-muted)', fontSize: 'var(--vg-text-sm)' }}>
        A calico cat learns to surf at sunrise. 2 scenes, Vietnamese narration.
      </p>
      <Button variant="ghost" size="sm">Select</Button>
    </Card>
  )
}

export function Plain() {
  return (
    <Card title="Render output">
      <p style={{ margin: 0, color: 'var(--vg-color-text-muted)', fontSize: 'var(--vg-text-sm)' }}>
        output.mp4 · 9:16 · 16s · 1080×1920
      </p>
    </Card>
  )
}
