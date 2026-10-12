import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Badge, Button, ButtonLink, Field, IconButton, KpiCard, Panel, Tabs, buttonClass, nextTab, statusTone } from './design-system';

const html = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe('componentes compartidos', () => {
  it('Button es type="button" por defecto y aplica la variante', () => {
    expect(html(<Button>Guardar</Button>)).toBe('<button type="button" class="button">Guardar</button>');
    expect(html(<Button type="submit" variant="primary">Enviar</Button>)).toBe('<button type="submit" class="button button-dark">Enviar</button>');
    expect(buttonClass({ variant: 'danger', size: 'sm', className: 'extra' })).toBe('button button-danger button-small extra');
  });

  it('ButtonLink es un enlace con aspecto de botón', () => {
    expect(html(<ButtonLink to="/plan" variant="primary">Ver plan</ButtonLink>)).toBe('<a class="button button-dark" href="/plan" data-discover="true">Ver plan</a>');
  });

  it('IconButton exige etiqueta accesible', () => {
    expect(html(<IconButton label="Editar TCL-001" icon={<svg />} />)).toBe('<button type="button" class="icon-button" aria-label="Editar TCL-001" title="Editar TCL-001"><svg></svg></button>');
  });

  it('Badge usa el tono semántico y Status conserva sus colores', () => {
    expect(html(<Badge tone="warning">Por vencer</Badge>)).toBe('<span class="status amber"><i aria-hidden="true"></i>Por vencer</span>');
    expect(['Operativo', 'Disponible', 'En reparación', 'No operativo', 'Pendiente de revisión'].map(statusTone)).toEqual(['success', 'info', 'warning', 'danger', 'neutral']);
  });

  it('Panel muestra el encabezado solo si hay título o acciones', () => {
    expect(html(<Panel>contenido</Panel>)).toBe('<section class="panel">contenido</section>');
    expect(html(<Panel title="Servicios" description="Por mes" className="extra">x</Panel>)).toBe('<section class="panel extra"><div class="panel-heading"><div><h2>Servicios</h2><p>Por mes</p></div></div>x</section>');
  });

  it('Field vincula etiqueta, ayuda y error con el control', () => {
    const markup = html(<Field label="Marca" required help="Como aparece en la placa" error="Indica la marca">{control => <input {...control} />}</Field>);
    const id = markup.match(/<label for="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(markup).toContain(`<input id="${id}" aria-describedby="${id}-ayuda ${id}-error" aria-invalid="true" required=""/>`);
    expect(markup).toContain('<span class="required-mark" aria-hidden="true"> *</span>');
    expect(markup).toContain(`<small id="${id}-error" class="field-error">Indica la marca</small>`);
    expect(html(<Field label="Notas">{control => <textarea {...control} />}</Field>)).not.toContain('aria-describedby');
  });

  it('Tabs marca la pestaña activa y deja enfocable solo esa', () => {
    const markup = html(<Tabs label="Secciones" value="b" onChange={() => {}} items={[{ value: 'a', label: 'Resumen' }, { value: 'b', label: 'Equipos', count: 3 }]} />);
    expect(markup).toContain('role="tablist" aria-label="Secciones"');
    expect(markup).toContain('<button type="button" role="tab" aria-selected="false" tabindex="-1">Resumen</button>');
    expect(markup).toContain('<button type="button" role="tab" aria-selected="true" tabindex="0">Equipos<span class="tabs-count">3</span></button>');
  });

  it('Tabs navega con flechas, Inicio y Fin', () => {
    expect(nextTab('ArrowRight', 2, 3)).toBe(0);
    expect(nextTab('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTab('Home', 2, 3)).toBe(0);
    expect(nextTab('End', 0, 3)).toBe(2);
    expect(nextTab('Enter', 1, 3)).toBeNull();
  });

  it('KpiCard es botón con onClick y filtro solo si recibe pressed', () => {
    expect(html(<KpiCard label="Abiertas" value={12} />)).toBe('<div class="kpi-card"><span class="kpi-card-label">Abiertas</span><strong class="kpi-card-value">12</strong></div>');
    expect(html(<KpiCard label="Abiertas" value={12} onClick={() => {}} />)).toMatch(/^<button type="button" class="kpi-card">/);
    expect(html(<KpiCard label="Abiertas" value={12} pressed onClick={() => {}} />)).toMatch(/^<button type="button" class="kpi-card" aria-pressed="true">/);
  });
});
