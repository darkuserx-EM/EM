import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { createSeed } from '../../data/seed';
import type { EntityName } from '../../domain/model';
import { HistoricalReadingsCleanup } from './HistoricalReadingsCleanup';

vi.mock('../../data/source', () => ({ remoteSource: {}, serverMode: true }));
vi.mock('../../components/ui', () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>, ErrorNotice: () => null }));
vi.mock('../../app/state', () => ({ useActor: () => ({ id: 'admin', rol: 'Administrador' }), useRevision: () => 1, useToast: () => () => {}, useRows: (entity: EntityName) => ({ rows: db.entities[entity], ready: true }) }));
const db = createSeed();

describe('depuración de lecturas del historial', () => {
  it('abre sin cliente, sin lista y con la eliminación desactivada', () => {
    const html = renderToStaticMarkup(<HistoricalReadingsCleanup onClose={() => {}} />);
    expect(html).toContain('<option value="" selected="">Selecciona el cliente</option>');
    expect(html).not.toContain('lecturas a eliminar');
    expect(html).toContain('Primero se muestran; solo se eliminan al confirmar.');
    expect(html).toMatch(/<button class="button button-dark" disabled="">Eliminar lecturas<\/button>/);
  });
});
