import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createSeed, seedRecord } from '../../data/seed';
import { filterVisible } from '../../domain/permissions';
import type { Actor, EntityName } from '../../domain/model';
import PlanningPage from './PlanningPage';
import { CalendarEvent, CalendarViews } from './CalendarViews';
import { planningEvents } from '../../domain/planning';
import Tickets from '../operations/Tickets';
import type { OperationQuery, PagedEntity } from '../../data/operation-page';

vi.mock('../../data/source', () => ({ getDataSource: vi.fn(), serverMode:true }));
vi.mock('../../app/state', () => ({
  useActor: () => actor,
  useToast: () => vi.fn(),
  useRows: (entity: EntityName) => ({ ready: true, error: '', rows: filterVisible(actor, entity, db.entities[entity], db.entities) }),
  useOperationPage: (entity: PagedEntity, query: OperationQuery, enabled = true) => ({ ready: true, error: '', rows: enabled ? filterVisible(actor, entity, db.entities[entity], db.entities).filter(row => (!query.id || row.id === query.id) && (!query.ticket || row.ticket_id === query.ticket)) : [] }),
}));
let actor: Actor;
const db = createSeed();
db.entities.OrdenServicio = []; db.entities.PlanPM = []; db.entities.LecturaHorometro = [];
db.entities.Ticket = [
  seedRecord('own', 'TKT-OWN', { schema_operacion: 1, estado: 'Programado', titulo: 'Revisar frenos propios', descripcion: 'QA', equipo_id: 'equipment-1', cliente_id: 'client-1', responsable_id: 'tech-1', fecha_programada: '2026-10-13', prioridad: 'Alta' }),
  seedRecord('foreign', 'TKT-FOREIGN', { schema_operacion: 1, estado: 'Programado', titulo: 'Solicitud ajena', equipo_id: 'equipment-7', cliente_id: 'client-2', responsable_id: 'tech-2', fecha_programada: '2026-10-13' }),
  seedRecord('waiting', 'TKT-WAIT', { schema_operacion: 1, estado: 'Nuevo', titulo: 'Sin fecha todavía', equipo_id: 'equipment-1', cliente_id: 'client-1', responsable_id: 'tech-1', prioridad: 'Crítica' }),
];
const markup = (children: React.ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={['/calendario?fecha=2026-10-13']}>{children}</MemoryRouter>);

describe('vistas de calendario por perfil', () => {
  it.each(['Administrador', 'Coordinador', 'Cliente', 'Técnico'] as const)('%s: muestra solicitudes permitidas y acciones correctas', rol => {
    actor = { id: rol, nombre: 'QA', rol, cliente_id: 'client-1', tecnico_id: 'tech-1' };
    const html = markup(<PlanningPage />);
    expect(html).toContain('Revisar frenos propios');
    expect(html).toContain('Sin fecha todavía');
    expect(html).toContain('Solicitudes por programar');
    expect(html).toContain('/tickets?ticket=own');
    const manager = ['Administrador', 'Coordinador'].includes(rol);
    expect(html.includes('Solicitud ajena')).toBe(manager);
    expect(html.includes('Nueva orden')).toBe(manager);
    expect(html.includes('Todos los técnicos')).toBe(manager);
    expect(html.includes('Solo planes')).toBe(rol === 'Administrador');
  });
  it.each(['year', 'month', 'week'] as const)('%s: incluye solicitudes en el calendario y sus contadores accesibles', view => {
    const events = planningEvents([], [], [], [], '2026-10-12', [db.entities.Ticket[0]]);
    const html = markup(<CalendarViews view={view} events={events} focusDay="2026-10-13" today="2026-10-12" onSelectDay={() => {}} onSelectMonth={() => {}} />);
    if (view === 'year') { expect(html).toContain('1 solicitudes'); expect(html).toContain('class="ticket"'); }
    else expect(html).toContain('/tickets?ticket=own');
  });
  it('el detalle tiene enlaces separados de orden y solicitud; la vista compacta conserva el texto completo en title', () => {
    const order = seedRecord('order', 'OS-1', { schema_operacion: 1, estado: 'Programada', fecha_programada: '2026-10-13', ticket_id: 'own' });
    const event = planningEvents([order], [], [], [], '2026-10-12', db.entities.Ticket)[0];
    const full = markup(<CalendarEvent event={event} />);
    expect(full).toContain('href="/ordenes?orden=order"');
    expect(full).toContain('href="/tickets?ticket=own"');
    expect(full.match(/<a /g)).toHaveLength(2);
    expect(full).toMatch(/<\/a><a /);
    const compact = markup(<CalendarEvent event={event} compact />);
    expect(compact).toContain('Solicitud TKT-OWN');
    expect(compact.match(/<a /g)).toHaveLength(1);
  });
  it('la ficha del ticket usa la fecha de la orden visible y oculta su programación privada', () => {
    const order = seedRecord('order', 'OS-1', { schema_operacion: 1, estado: 'Programada', fecha_programada: '2026-10-15', ticket_id: 'own', cliente_id: 'client-1', visible_cliente: false });
    db.entities.OrdenServicio = [order];
    actor = { id: 'admin', nombre: 'QA', rol: 'Administrador' };
    const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/tickets?ticket=own']}><Tickets /></MemoryRouter>);
    const admin = render();
    expect(admin).toContain('Programación de la orden</dt><dd>15/10/2026');
    expect(admin).toContain('href="/ordenes?orden=order"');
    actor = { ...actor, rol: 'Cliente', cliente_id: 'client-1' };
    const client = render();
    expect(client).toContain('Programación de la orden</dt><dd>Consulta con coordinación');
    expect(client).not.toContain('href="/ordenes?orden=order"');
    expect(db.entities.Ticket[0].fecha_programada).toBe('2026-10-13');
    db.entities.OrdenServicio = [];
  });
});
