import { ArrowRight, Forklift, Mail, MapPin, Pencil, Phone, Plus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useActor, useRows } from '../../app/state';
import { EmptyState, ErrorNotice, Status } from '../../components/ui';
import type { EntityRecord } from '../../domain/model';
import { fieldLabels, type EditableRecord } from './RecordForm';

export type ClientSection = 'Resumen' | 'Equipos' | 'Contactos' | 'Sedes';
const sections: ClientSection[] = ['Resumen', 'Equipos', 'Contactos', 'Sedes'];
const display = (value: EntityRecord[string]) => value === undefined || value === null || value === '' ? 'Sin registrar' : value;

export function ClientInspector({ client, equipments, equipmentLoading, section, onSectionChange, onEdit }: {
  client: EntityRecord; equipments: EntityRecord[]; equipmentLoading: boolean; section: ClientSection;
  onSectionChange: (section: ClientSection) => void;
  onEdit: (entity: EditableRecord, row?: EntityRecord, clientId?: string) => void;
}) {
  const editable = useActor().rol === 'Administrador';
  const contacts = useRows('Contacto'); const sites = useRows('Sede');
  const ownContacts = contacts.rows.filter(row => row.cliente_id === client.id);
  const ownSites = sites.rows.filter(row => row.cliente_id === client.id);
  const ownEquipment = equipments.filter(row => row.cliente_id === client.id);
  const counts = { Equipos: equipmentLoading ? '…' : ownEquipment.length, Contactos: contacts.loading ? '…' : ownContacts.length, Sedes: sites.loading ? '…' : ownSites.length };
  const firstSite = ownSites[0];

  return <section className="client-inspector" aria-label="Ficha del cliente seleccionado">
    <header className="client-inspector-heading"><div><span className="eyebrow">{client.codigo}</span><h2>{client.nombre}</h2><p>{client.ubicacion || 'Ubicación por completar'}</p></div><div className="client-inspector-actions"><Status value={String(client.estado)} />{editable && <button className="button button-small" onClick={() => onEdit('Cliente', client)}><Pencil size={14} />Editar cliente</button>}</div></header>
    <nav className="client-section-tabs" aria-label="Secciones del cliente">{sections.map(item => <button key={item} aria-pressed={section === item} onClick={() => onSectionChange(item)}>{item}{item !== 'Resumen' && <span>{counts[item]}</span>}</button>)}</nav>
    <ErrorNotice message={contacts.error || sites.error} />
    {section === 'Resumen' && <div className="client-summary" aria-label="Resumen del cliente">
      <dl className="client-summary-fields"><div><dt>NIT</dt><dd>{display(client.nit)}</dd></div><div><dt>Sector / actividad</dt><dd>{display(client.sector)}</dd></div><div><dt>Sedes</dt><dd>{counts.Sedes}</dd></div><div><dt>Equipos vinculados</dt><dd>{counts.Equipos}</dd></div></dl>
      <div className="client-summary-location"><div className="client-section-heading"><h3><MapPin size={17} />Ubicaciones</h3><button className="text-link" onClick={() => onSectionChange('Sedes')}>{ownSites.length || !editable ? 'Ver sedes' : 'Agregar sede'}<ArrowRight size={14} /></button></div>{sites.loading ? <p>Cargando sedes…</p> : firstSite ? <><strong>{firstSite.nombre}</strong><p>{[firstSite.direccion, firstSite.municipio, firstSite.departamento].filter(Boolean).join(', ') || 'Dirección por completar'}</p>{firstSite.referencia_ubicacion && <span className="client-location-reference">{firstSite.referencia_ubicacion}</span>}</> : <p>Aún no hay sedes registradas para este cliente.</p>}</div>
      <details className="client-billing-details" key={client.id}><summary>Facturación y referencias</summary><dl className="client-summary-fields">{['referencia_cliente','direccion_fiscal','dia_facturacion','reporte_mensual_horas'].map(key => <div key={key} className={key === 'direccion_fiscal' ? 'client-summary-wide' : ''}><dt>{fieldLabels[key]}</dt><dd>{display(client[key])}</dd></div>)}</dl></details>
      {client.notas_operativas && <div className="client-summary-notes"><h3>Notas operativas</h3><p>{client.notas_operativas}</p></div>}
    </div>}
    {section === 'Equipos' && <section className="client-section-content" aria-label="Equipos del cliente"><div className="client-section-heading"><h3><Forklift size={17} />Equipos vinculados</h3>{editable && <button className="button button-small" onClick={() => onEdit('Equipo', undefined, client.id)}><Plus size={14} />Nuevo equipo</button>}</div>{equipmentLoading ? <p className="client-section-empty">Cargando equipos…</p> : ownEquipment.length ? <div className="client-inspector-equipment">{ownEquipment.map(row => <Link key={row.id} to={`/flota?equipo=${row.id}`}><span className="client-equipment-symbol"><Forklift size={21} /></span><span className="client-equipment-copy"><strong>{row.codigo} · {row.marca} {row.modelo}</strong><small>Serie {row.serie}</small>{row.sede_id && <small>{ownSites.find(site => site.id === row.sede_id)?.nombre || 'Sede asignada'}</small>}</span><Status value={String(row.estado)} /><ArrowRight size={16} /></Link>)}</div> : <EmptyState title="Sin equipos vinculados" description="Crea un equipo aquí o selecciona este cliente al editar uno existente en Flota." />}</section>}
    {section === 'Contactos' && <section className="client-section-content" aria-label="Contactos del cliente"><div className="client-section-heading"><h3><Users size={17} />Personas de contacto</h3>{editable && <button className="button button-small" onClick={() => onEdit('Contacto', undefined, client.id)}><Plus size={14} />Agregar contacto</button>}</div>{contacts.loading ? <p className="client-section-empty">Cargando contactos…</p> : ownContacts.length ? <div className="client-inspector-related">{ownContacts.map(row => <article key={row.id}><div className="related-title"><strong>{row.nombre}</strong>{row.principal === 'Sí' && <span className="plain-tag">Principal</span>}{editable && <button className="icon-button" aria-label={`Editar contacto ${row.nombre}`} onClick={() => onEdit('Contacto', row, client.id)}><Pencil size={15} /></button>}</div><p>{row.cargo || 'Cargo sin especificar'}</p>{row.telefono && <p><Phone size={14} />{row.telefono}</p>}{row.correo && <p><Mail size={14} />{row.correo}</p>}</article>)}</div> : <p className="client-section-empty">Agrega a la persona con quien coordinas visitas o servicios.</p>}</section>}
    {section === 'Sedes' && <section className="client-section-content" aria-label="Sedes del cliente"><div className="client-section-heading"><h3><MapPin size={17} />Ubicaciones y acceso</h3>{editable && <button className="button button-small" onClick={() => onEdit('Sede', undefined, client.id)}><Plus size={14} />Agregar sede</button>}</div>{sites.loading ? <p className="client-section-empty">Cargando sedes…</p> : ownSites.length ? <div className="client-inspector-related">{ownSites.map(row => <article key={row.id}><div className="related-title"><strong>{row.nombre}</strong>{editable && <button className="icon-button" aria-label={`Editar sede ${row.nombre}`} onClick={() => onEdit('Sede', row, client.id)}><Pencil size={15} /></button>}</div><p>{[row.direccion,row.municipio,row.departamento].filter(Boolean).join(', ') || 'Dirección por completar'}</p>{row.referencia_ubicacion && <span className="client-location-reference">{row.referencia_ubicacion}</span>}{row.horario_atencion && <p>Horario: {row.horario_atencion}</p>}{row.autoriza_ingreso && <p>Autoriza ingreso: {row.autoriza_ingreso}</p>}</article>)}</div> : <p className="client-section-empty">Agrega una sede para asignarle equipos y registrar su dirección y condiciones de acceso.</p>}</section>}
  </section>;
}
