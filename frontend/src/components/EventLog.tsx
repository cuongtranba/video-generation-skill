import { useEffect, useRef } from 'react'
import { useVidgenStore } from '../store/store'
import { formatEvent } from '../pipeline/eventFormat'

interface EventLogProps {
  projectId: string
}

export function EventLog({ projectId }: EventLogProps) {
  const events = useVidgenStore((state) => state.eventLog[projectId]) ?? []
  const scrollRef = useRef<HTMLDivElement>(null)

  // Autoscroll to the newest row as events stream in (the design pins to bottom).
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events.length])

  return (
    <div className="vg-event-log" data-testid="event-log">
      <span className="vg-event-log__title">worker events · nats</span>
      <div ref={scrollRef} className="vg-event-log__scroll">
        {events.map((event, i) => {
          const row = formatEvent(event)
          return (
            <div key={i} className={`vg-event-log__row vg-event-log__row--${row.tone}`}>
              <span className="vg-event-log__time">{row.time}</span>
              <span className="vg-event-log__type">{row.type}</span>
              <span className="vg-event-log__msg">{row.msg}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
