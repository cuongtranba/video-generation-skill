import { Badge, Button, Card, Surface } from 'frontend'

export function AppRoot() {
  return (
    <Surface>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 'var(--vg-text-lg)' }}>vidgen</strong>
          <Badge tone="good">Live</Badge>
        </div>
        <Card title="surfing-cat-01" meta="draft" actions={<Badge tone="neutral">$0.02</Badge>}>
          <Button variant="ghost" size="sm">Select</Button>
        </Card>
      </div>
    </Surface>
  )
}
