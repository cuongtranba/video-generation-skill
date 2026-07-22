import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/Badge'
import { useVidgenStore, type ConnectionState } from '../store/store'

const TONE: Record<ConnectionState, 'neutral' | 'good' | 'bad'> = {
  connecting: 'neutral',
  live: 'good',
  down: 'bad',
}

export function ConnectionStatus() {
  const { t } = useTranslation()
  const connection = useVidgenStore((state) => state.connection)
  return <Badge tone={TONE[connection]}>{t(`connection.${connection}`)}</Badge>
}
