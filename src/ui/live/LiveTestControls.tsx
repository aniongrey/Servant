import type { ReactNode } from 'react';
import type { LiveEvent, QueueBand } from '../../integrations/barrage/events/LiveEvent';
import { formatEventType } from './liveTestFormat';
export function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="metricItem">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

export function Panel({
  title,
  icon,
  action,
  children
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="livePanel">
      <div className="panelHeader">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function QueueColumn({ band, events }: { band: QueueBand; events: LiveEvent[] }) {
  const labels: Record<QueueBand, string> = { high: 'HIGH', normal: 'NORMAL', low: 'LOW' };
  return (
    <section className="queueColumn" data-band={band}>
      <header>
        <span>{labels[band]}</span>
        <strong>{events.length}</strong>
      </header>
      <div className="queueList">
        {events.length === 0 && <EmptyState text="队列为空" />}
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}

export function EventRow({ event, compact = false }: { event: LiveEvent; compact?: boolean }) {
  const aggregation = event.metadata?.aggregation;
  return (
    <article className="eventRow" data-compact={compact}>
      <div className="eventMeta">
        <span>{formatEventType(event.type)}</span>
        <strong>{event.priority}</strong>
      </div>
      <p>
        {event.content ??
          (event.gift ? `${event.gift.name} x${event.gift.count}` : formatEventType(event.type))}
      </p>
      <footer>
        <span>{event.user?.name ?? '系统'}</span>
        {aggregation && (
          <span>
            {aggregation.uniqueUsers} 人 / {aggregation.count} 条
          </span>
        )}
      </footer>
    </article>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="emptyState">{text}</div>;
}
