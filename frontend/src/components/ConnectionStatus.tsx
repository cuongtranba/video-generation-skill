import { Badge } from '../ui/Badge'
import { useVidgenStore, type ConnectionState } from '../store/store'

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  down: 'Disconnected',
}

const TONE: Record<ConnectionState, 'neutral' | 'good' | 'bad'> = {
  connecting: 'neutral',
  live: 'good',
  down: 'bad',
}

export function ConnectionStatus() {
  const connection = useVidgenStore((state) => state.connection)
  return <Badge tone={TONE[connection]}>{LABEL[connection]}</Badge>
}
