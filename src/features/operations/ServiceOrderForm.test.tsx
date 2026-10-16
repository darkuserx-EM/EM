import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { createSeed } from '../../data/seed';
import ServiceOrderForm from './ServiceOrderForm';

vi.mock('../../data/source', () => ({ getDataSource: () => undefined, serverMode: true }));
vi.mock('../attachments/AttachmentPanel', () => ({ default: () => null }));
vi.mock('../attachments/TicketPhotos', () => ({ default: () => null }));
vi.mock('../../app/state', () => ({ useActor: () => ({ id: 'ronny', rol: 'Técnico', tecnico_id: 'tech-1' }), useToast: () => () => {}, useRows: (entity: keyof ReturnType<typeof createSeed>['entities']) => ({ rows: createSeed().entities[entity], ready: true }) }));
vi.mock('../../components/ui', () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>, ErrorNotice: () => null, useUnsavedChanges: () => ({ requestClose: () => {}, prompt: null }) }));
vi.mock('../attachments/ReceiverSignature', () => ({ ReceiverSignature: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

describe('formulario de tres secciones', () => {
  it('permite iniciar en Inicio; agrupa diagnóstico y trabajo, conserva cierre y quita captura de causa', () => {
    const html = renderToStaticMarkup(<ServiceOrderForm onClose={() => {}} onSaved={() => {}} />);
    expect(html).toContain('<span>1</span>Inicio');
    expect(html).toContain('<span>2</span>Atención');
    expect(html).toContain('<span>3</span>Cierre');
    expect(html).not.toContain('Causa confirmada');
    const sections = html.split('<section');
    expect(sections.find(section => section.includes('aria-label="Inicio"'))).toContain('Síntoma o motivo reportado');
    expect(sections.find(section => section.includes('aria-label="Atención"'))).toContain('Trabajo realizado');
    expect(sections.find(section => section.includes('aria-label="Atención"'))).toContain('Diagnóstico técnico');
    expect(sections.find(section => section.includes('aria-label="Cierre"'))).toContain('Resultado de las pruebas');
    expect(html).toContain('Síntomas frecuentes');
    expect(html).toContain('Hora de visita · Guatemala');
    expect(html).toContain('Inicio del trabajo · Guatemala');
  });
});
