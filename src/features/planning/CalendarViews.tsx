import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock3 } from 'lucide-react';
import { calendarLabel, monthGrid, weekStart, type CalendarView, type PlanningEvent } from '../../domain/planning';
import { addDays } from '../../domain/maintenance-plan';

const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export function CalendarEvent({ event, compact = false }: { event: PlanningEvent; compact?: boolean }) {
  return <Link className={`planning-event ${event.kind} ${compact ? 'compact' : ''}`} to={event.href} title={`${event.title} · ${event.detail} · ${event.state}`}>
    <span className="planning-event-title">{event.time && <time>{event.time}</time>}{event.title}</span>
    {!compact && <><span>{event.detail}</span><small>{event.kind === 'service' ? event.state : event.projected ? 'Proyección · pendiente de programar' : 'Vencimiento · pendiente de programar'}<ArrowUpRight size={12} /></small></>}
  </Link>;
}

export function CalendarViews({ view, focusDay, today, events, onSelectDay, onSelectMonth }: { view: CalendarView; focusDay: string; today: string; events: PlanningEvent[]; onSelectDay: (day: string) => void; onSelectMonth: (day: string) => void }) {
  const byDay = new Map<string, PlanningEvent[]>();
  for (const event of events) byDay.set(event.day, [...byDay.get(event.day) || [], event]);
  if (view === 'year') return <div className="planning-year">{Array.from({ length: 12 }, (_, index) => {
    const month = `${focusDay.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-01`;
    const monthEvents = events.filter(event => event.day.slice(0, 7) === month.slice(0, 7));
    return <section className="planning-mini-month" key={month} aria-label={calendarLabel(month)}><button className="planning-month-heading" onClick={() => onSelectMonth(month)}><strong>{calendarLabel(month, { month: 'long' })}</strong><span>{monthEvents.length || '—'}</span></button><div className="planning-mini-grid">{weekdays.map(day => <span className="planning-weekday" key={day}>{day.slice(0, 1)}</span>)}{monthGrid(month).map(day => {
      const items = byDay.get(day) || []; const outside = day.slice(0, 7) !== month.slice(0, 7);
      return <button disabled={outside} className={`${day === today ? 'today' : ''} ${outside ? 'outside' : ''}`} key={day} onClick={() => onSelectDay(day)} aria-label={`${calendarLabel(day, { day: 'numeric', month: 'long' })}: ${items.filter(event => event.kind === 'service').length} servicios y ${items.filter(event => event.kind === 'plan').length} vencimientos`}><span>{Number(day.slice(8))}</span><span className="planning-dots">{items.some(event => event.kind === 'service') && <i className="service" />}{items.some(event => event.kind === 'plan') && <i className="plan" />}</span></button>;
    })}</div><small>{monthEvents.filter(event => event.kind === 'service').length} citas · {monthEvents.filter(event => event.kind === 'plan').length} planes</small></section>;
  })}</div>;
  if (view === 'week') return <div className="planning-week">{Array.from({ length: 7 }, (_, index) => addDays(weekStart(focusDay), index)).map(day => {
    const items = byDay.get(day) || [];
    return <section className={`planning-week-day ${day === today ? 'today' : ''}`} key={day}><button className="planning-week-heading" onClick={() => onSelectDay(day)}><span>{calendarLabel(day, { weekday: 'short' })}</span><strong>{Number(day.slice(8))}</strong><small>{calendarLabel(day, { month: 'short' })}</small></button><div className="planning-week-events">{items.map(event => <CalendarEvent event={event} key={event.id} />)}{!items.length && <span className="planning-free"><Clock3 size={15} />Sin eventos</span>}</div></section>;
  })}</div>;
  return <div className="planning-month"><div className="planning-month-weekdays">{weekdays.map(day => <span key={day}>{day}</span>)}</div><div className="planning-month-grid">{monthGrid(focusDay).map(day => {
    const items = byDay.get(day) || [];
    return <section className={`planning-month-day ${day.slice(0, 7) !== focusDay.slice(0, 7) ? 'outside' : ''} ${day === today ? 'today' : ''}`} key={day}>
      <button className="planning-day-number" onClick={() => onSelectDay(day)} aria-label={`${calendarLabel(day, { day: 'numeric', month: 'long' })}: ${items.length} eventos`}><span>{Number(day.slice(8))}</span>{day === today && <small>Hoy</small>}</button>
      <div className="planning-month-events">{items.slice(0, 3).map(event => <CalendarEvent event={event} key={event.id} compact />)}{items.length > 3 && <button className="planning-more" onClick={() => onSelectDay(day)}>+{items.length - 3} más</button>}</div>
      {!!items.length && <button className="planning-mobile-count" onClick={() => onSelectDay(day)} aria-label={`Ver ${items.length} eventos del ${day}`}><span className="planning-dots">{items.some(event => event.kind === 'service') && <i className="service" />}{items.some(event => event.kind === 'plan') && <i className="plan" />}</span><span>{items.length}</span></button>}
    </section>;
  })}</div></div>;
}
