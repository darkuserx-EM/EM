import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { createSeed, seedRecord } from '../../data/seed';
import type { EntityName } from '../../domain/model';
import { HistoricalReportsImport } from './HistoricalReportsImport';

// renderToStaticMarkup no ejecuta efectos: aquí corren durante el render para detectar cualquier selección automática.
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useEffect: (effect: () => void) => { effect(); } }));
vi.mock('../../data/source', () => ({ remoteSource: {}, serverMode: true }));
vi.mock('../../components/ui', () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>, ErrorNotice: () => null }));
vi.mock('../../app/state', () => ({ useActor: () => ({ id: 'admin', rol: 'Administrador' }), useRevision: () => 1, useToast: () => () => {}, useRows: (entity: EntityName) => ({ rows: db.entities[entity], ready: true }) }));
const db = createSeed();
db.entities.Sede = db.entities.Cliente.map((client, index) => seedRecord(`site-${index + 1}`, `SED-${String(index + 1).padStart(3, '0')}`, { cliente_id: client.id, nombre: `Planta de prueba ${index + 1}` }));

describe('importación de historial', () => {
  it('abre sin cliente ni sede elegidos: quien importa elige el cliente', () => {
    const html = renderToStaticMarkup(<HistoricalReportsImport onClose={() => {}} />);
    expect(html).toContain('<option value="" selected="">Selecciona el cliente</option>');
    expect(html).toContain('<option value="" selected="">Sin sede asignada</option>');
    expect(html.match(/selected=""/g)).toHaveLength(2);
    expect(html).not.toContain('Los reportes se vincularán');
    expect(html).toMatch(/<button class="button" disabled="">Seleccionar archivo<\/button>/);
  });
});
