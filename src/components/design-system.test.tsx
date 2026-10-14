import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Badge, BrandMark, Button, ButtonLink, DataTable, FilterToggle, Field, IconButton, KpiCard, Pagination, Panel, Steps, Tabs, buttonClass, nextTab, statusTone } from './design-system';

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

  it('KpiCard como enlace muestra la flecha y con alert marca la cifra', () => {
    const link = html(<KpiCard label="Citas atrasadas" value={4} to="/calendario" alert />);
    expect(link).toMatch(/^<a class="kpi-card kpi-card-link kpi-card-alert" href="\/calendario" data-discover="true"><span class="kpi-card-label">Citas atrasadas<\/span><strong class="kpi-card-value">4<\/strong><span class="kpi-card-arrow" aria-hidden="true"><svg/);
    const withIcon = html(<KpiCard label="Citas atrasadas" value={4} icon={<svg data-icon="" />} hint="Abiertas" to="/calendario" />);
    expect(withIcon).toContain('<span class="kpi-card-icon" aria-hidden="true"><svg data-icon=""></svg></span>');
    expect(withIcon).toContain('<small class="kpi-card-hint">Abiertas</small><span class="kpi-card-arrow"');
    expect(html(<KpiCard label="Abiertas" value={12} />)).not.toContain('kpi-card-arrow');
    const jump = html(<KpiCard label="Solicitudes por atender" value={3} to="#solicitudes-por-atender" />);
    expect(jump).toMatch(/^<a class="kpi-card kpi-card-link" href="#solicitudes-por-atender">/);
    expect(jump).toContain('lucide-arrow-down');
    expect(jump).not.toContain('data-discover');
  });
});

describe('componentes compartidos · pasos y tablas', () => {
  const steps = [{ label: 'Diagnóstico', done: true }, { label: 'Trabajo' }, { label: 'Cierre', disabled: true }];

  it('Steps marca el paso actual, los completados y los deshabilitados', () => {
    const markup = html(<Steps label="Pasos del reporte" current={1} items={steps} onSelect={() => {}} />);
    expect(markup).toContain('<nav class="steps" aria-label="Pasos del reporte"><ol>');
    expect(markup).toContain('<button type="button" class="steps-item is-done"><span class="steps-number" aria-hidden="true">✓</span>Diagnóstico<span class="sr-only"> (completado)</span></button>');
    expect(markup).toContain('<button type="button" class="steps-item" aria-current="step"><span class="steps-number" aria-hidden="true">2</span>Trabajo</button>');
    expect(markup).toContain('<button type="button" class="steps-item" disabled=""><span class="steps-number" aria-hidden="true">3</span>Cierre</button>');
  });

  it('Steps sin onSelect solo indica el avance', () => {
    const markup = html(<Steps label="Avance" current={0} items={steps} />);
    expect(markup).not.toContain('<button');
    expect(markup).toContain('<span class="steps-item is-done" aria-current="step"><span class="steps-number" aria-hidden="true">1</span>Diagnóstico</span>');
  });

  type Row = { id: string; name: string; hours: number };
  const columns = [
    { id: 'name', header: 'Equipo', cell: (row: Row) => row.name },
    { id: 'hours', header: 'Horómetro', numeric: true, cell: (row: Row) => `${row.hours} h` },
    { id: 'actions', header: 'Acciones', hideHeader: true, cell: (row: Row) => <Button size="sm">Ver {row.name}</Button> },
  ];

  it('DataTable genera cabeceras con alcance, título oculto y columnas numéricas', () => {
    const markup = html(<DataTable caption="Equipos" columns={columns} rows={[{ id: 'a', name: 'TCL-001', hours: 850 }]} rowKey={row => row.id} />);
    expect(markup).toMatch(/^<div class="table-scroll"><table class="data-table"><caption class="sr-only">Equipos<\/caption>/);
    expect(markup).toContain('<th scope="col">Equipo</th><th scope="col" class="numeric mono">Horómetro</th><th scope="col"><span class="sr-only">Acciones</span></th>');
    expect(markup).toContain('<td class="numeric mono">850 h</td>');
  });

  it('DataTable sin filas muestra el mensaje vacío en todo el ancho', () => {
    expect(html(<DataTable caption="Equipos" columns={columns} rows={[] as Row[]} rowKey={row => row.id} empty="Sin equipos" />)).toContain('<tbody><tr><td class="data-table-empty" colSpan="3">Sin equipos</td></tr></tbody>');
  });

  it('BrandMark es el logotipo decorativo y toma el color del texto', () => {
    const svg = html(<BrandMark />);
    expect(svg).toMatch(/^<svg class="brand-mark" viewBox="0 0 601.5 180" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 0H238.5V48/);
    expect(svg).not.toMatch(/<(text|title)/);
  });

  it('FilterToggle indica si los filtros están abiertos y cuántos hay activos', () => {
    expect(html(<FilterToggle open={false} active={0} controls="f" onToggle={() => {}} />)).toBe('<button type="button" class="button filter-toggle" aria-expanded="false" aria-controls="f">Más filtros</button>');
    expect(html(<FilterToggle open={false} active={1} controls="f" onToggle={() => {}} />)).toContain('>Más filtros (1 activo)</button>');
    expect(html(<FilterToggle open active={2} controls="f" onToggle={() => {}} />)).toContain('aria-expanded="true" aria-controls="f">Ocultar filtros (2 activos)</button>');
  });

  it('Pagination desactiva Anterior en la primera página y Siguiente en la última', () => {
    expect(html(<Pagination page={1} pageCount={3} onChange={() => {}} />)).toBe('<div class="pagination"><span>Página 1 de 3</span><button type="button" class="button button-small" disabled="">Anterior</button><button type="button" class="button button-small">Siguiente</button></div>');
    expect(html(<Pagination page={3} pageCount={3} onChange={() => {}} summary="24 órdenes" />)).toContain('<span>24 órdenes</span><button type="button" class="button button-small">Anterior</button><button type="button" class="button button-small" disabled="">Siguiente</button>');
  });
});
