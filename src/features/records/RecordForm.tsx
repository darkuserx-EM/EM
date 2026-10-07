import { useState, type FormEvent } from 'react';
import { Check, Info } from 'lucide-react';
import { useActor, useRows, useToast } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';
import { definitions, type EntityRecord, type Scalar } from '../../domain/model';
import { getDataSource, serverMode } from '../../data/source';
import { clientDisplayName, clientSectors } from '../../domain/client-profile';
import { departments } from '../../domain/site-profile';
import { ClientLogoField } from './ClientLogo';
import './client-directory.css';

export type EditableRecord = 'Cliente' | 'Equipo' | 'Contacto' | 'Sede';
const names = { Cliente: 'cliente', Equipo: 'equipo', Contacto: 'contacto', Sede: 'sede' };
export const fieldLabels: Record<string, string> = {
  referencia_ubicacion: 'Referencia de ubicación / Plus Code',
  nombre_comercial: 'Nombre comercial / nombre conocido', plus_code: 'Plus Code',
  autoriza_contacto_id: 'Quién autoriza el ingreso',
  nombre: 'Nombre', sector: 'Sector / actividad', estado: 'Estado', ubicacion: 'Ubicación principal', referencia_cliente: 'Referencia del cliente', nit: 'NIT', direccion_fiscal: 'Dirección fiscal', dia_facturacion: 'Día de facturación', reporte_mensual_horas: '¿Requiere reporte mensual de horas?', notas_operativas: 'Notas operativas', cliente_id: 'Cliente', cargo: 'Cargo / área', telefono: 'Teléfono', correo: 'Correo electrónico', principal: '¿Es el contacto principal?', direccion: 'Dirección', municipio: 'Municipio', departamento: 'Departamento', horario_atencion: 'Horario de atención', autoriza_ingreso: 'Quién autoriza el ingreso', marca: 'Marca', modelo: 'Modelo', serie: 'Número de serie', tipo: 'Tipo de equipo', propiedad: 'Propiedad', horometro: 'Horómetro (horas)', sede_id: 'Sede del cliente', anio: 'Año', capacidad_kg: 'Capacidad (kg)', altura_elevacion_m: 'Altura de elevación (m)', voltaje: 'Voltaje (V)', bateria: 'Batería', cargador: 'Cargador', combustible: 'Combustible', llantas: 'Llantas', notas: 'Observaciones',
};
const groups: Record<EditableRecord, { title: string; fields: string[] }[]> = {
  Cliente: [
    { title: 'Identificación de la empresa', fields: ['nombre', 'nombre_comercial', 'nit', 'estado', 'sector'] },
    { title: 'Ubicación y atención', fields: ['ubicacion', 'plus_code', 'direccion_fiscal', 'notas_operativas'] },
  ],
  Equipo: [
    { title: 'Identificación', fields: ['propiedad', 'marca', 'modelo', 'serie', 'anio', 'tipo'] },
    { title: 'Asignación y horómetro', fields: ['estado', 'cliente_id', 'sede_id', 'horometro'] },
    { title: 'Especificaciones opcionales', fields: ['capacidad_kg', 'altura_elevacion_m', 'voltaje', 'combustible', 'bateria', 'cargador', 'llantas', 'notas'] },
  ],
  Contacto: [{ title: 'Datos de contacto', fields: ['nombre', 'cargo', 'telefono', 'correo', 'principal'] }],
  Sede: [{ title: 'Ubicación y acceso', fields: ['nombre', 'direccion', 'municipio', 'departamento', 'referencia_ubicacion', 'autoriza_contacto_id'] }],
};

export function RecordForm({ entity, row, clientId, onClose, onSaved }: { entity: EditableRecord; row?: EntityRecord; clientId?: string; onClose: () => void; onSaved: (record: EntityRecord) => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify);
  const clients = useRows('Cliente'); const sites = useRows('Sede'); const catalogs = useRows('Catalogos'); const contacts = useRows('Contacto');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = entity === 'Equipo' ? { estado: 'Disponible', propiedad: 'Propio' } : entity === 'Cliente' ? { estado: 'Activo' } : entity === 'Sede' && !row ? { departamento: 'Guatemala' } : {};
    return { ...defaults, ...Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, value === null ? '' : String(value)])), ...(clientId ? { cliente_id: clientId } : {}) };
  });
  const [logoBusy, setLogoBusy] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const change = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value, ...(key === 'cliente_id' ? { sede_id: '' } : {}) }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const fields: Record<string, Scalar> = Object.fromEntries(definitions[entity].columns.filter(column => groups[entity].some(group => group.fields.includes(column.key)) || (entity === 'Cliente' && column.key === 'logo') || column.key === 'cliente_id').map(column => [column.key, column.type === 'number' ? values[column.key]?.trim() ? Number(values[column.key]) : column.required ? '' : null : values[column.key] ?? '']));
      const repo = getDataSource().repository(entity, actor);
      const saved = row ? await repo.update(row.id, fields) : await repo.create(fields);
      notify(`${saved.codigo} guardado ${serverMode ? 'en el servidor' : 'en este navegador'}.`); onSaved(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const renderField = (key: string) => {
    const column = definitions[entity].columns.find(item => item.key === key)!;
    const needsClient = entity === 'Equipo' && (values.propiedad === 'De cliente' || values.estado === 'En renta');
    const required = !!column.required || (key === 'cliente_id' && needsClient);
    const disabled = busy || logoBusy || (entity === 'Equipo' && !!row && ['horometro', 'propiedad'].includes(key));
    const multiline = ['direccion_fiscal', 'notas_operativas', 'direccion', 'notas'].includes(key);
    const label = key === 'nombre' && entity === 'Cliente' ? 'Razón social' : fieldLabels[key] || column.label;
    const common = { value: values[key] ?? '', required, disabled, id: `record-${key}`, placeholder: key === 'nombre_comercial' ? 'Ej.: Lamfer' : key === 'ubicacion' ? 'Ej.: planta principal o municipio' : key === 'plus_code' ? 'Ej.: código y localidad de Google Maps' : key === 'referencia_ubicacion' ? 'Ej.: G96Q+P5 Villa Nueva' : key === 'nombre' ? entity === 'Cliente' ? 'Ej.: Distelsa' : entity === 'Sede' ? 'Ej.: Bodega A' : '' : key === 'direccion' ? 'Ej.: Parque Logística Unisur 4, CA-9 zona 10' : undefined };
    let control;
    if (key === 'cliente_id') control = <select {...common} disabled={disabled || clients.loading || !!clientId} onChange={event => change(key, event.target.value)}><option value="">{needsClient ? 'Selecciona un cliente' : 'Sin asignar / patio EMSA'}</option>{clients.rows.map(client => <option key={client.id} value={client.id}>{clientDisplayName(client)} · {client.codigo}</option>)}</select>;
    else if (key === 'sede_id') control = <select {...common} disabled={disabled || !values.cliente_id || sites.loading} onChange={event => change(key, event.target.value)}><option value="">Sin sede asignada</option>{sites.rows.filter(site => site.cliente_id === values.cliente_id).map(site => <option key={site.id} value={site.id}>{site.nombre}</option>)}</select>;
    else if (key === 'departamento') control = <select {...common} onChange={event => change(key,event.target.value)}><option value="">Selecciona un departamento</option>{values.departamento && !departments.includes(values.departamento) && <option value={values.departamento}>{values.departamento} (actual)</option>}{departments.map(department => <option key={department}>{department}</option>)}</select>;
    else if (key === 'autoriza_contacto_id') control = <select {...common} disabled={disabled || contacts.loading || !!contacts.error} onChange={event => change(key,event.target.value)}><option value="">Sin contacto seleccionado</option>{contacts.rows.filter(contact => contact.cliente_id === values.cliente_id).map(contact => <option key={contact.id} value={contact.id}>{contact.nombre}{contact.cargo ? ` · ${contact.cargo}` : ''}</option>)}</select>;
    else if (key === 'sector') {
      const configured = catalogs.rows.filter(item => item.categoria === 'Sectores / actividades');
      const choices = configured.length ? configured.filter(item => item.activo).map(item => String(item.nombre)) : clientSectors;
      const selected = String(values.sector ?? '');
      control = <select {...common} onChange={event => change(key,event.target.value)}><option value="">Selecciona un sector</option>{selected && !choices.includes(selected) && <option value={selected}>{selected} (actual)</option>}{choices.map(option => <option key={option}>{option}</option>)}</select>;
    }
    else if (column.options) control = <select {...common} onChange={event => change(key, event.target.value)}>{!required && <option value="">Sin especificar</option>}{column.options.map(option => <option key={option}>{option}</option>)}</select>;
    else if (multiline) control = <textarea {...common} rows={3} maxLength={500} onChange={event => change(key, event.target.value)} />;
    else control = <input {...common} type={column.type === 'number' ? 'number' : key === 'correo' ? 'email' : key === 'telefono' ? 'tel' : 'text'} min={key === 'dia_facturacion' ? 1 : column.type === 'number' ? 0 : undefined} max={key === 'dia_facturacion' ? 31 : undefined} step={column.type === 'number' ? ['dia_facturacion', 'anio'].includes(key) ? '1' : 'any' : undefined} maxLength={column.type === 'number' ? undefined : 500} list={['marca','tipo'].includes(key) ? `suggestions-${key}` : undefined} onChange={event => change(key, event.target.value)} />;
    return <div className={`record-field ${multiline ? 'record-field-wide' : ''}`} key={key}><label htmlFor={`record-${key}`}>{label}{required && <span className="required-mark"> *</span>}</label>{control}
      {key === 'ubicacion' && <small>Referencia de la sede principal. Agrega las direcciones de atención en Sedes.</small>}
      {key === 'plus_code' && <small>Copia el Plus Code con su localidad desde Google Maps.</small>}
      {key === 'autoriza_contacto_id' && <small>{contacts.error ? 'No se pudieron cargar los contactos. Intenta abrir la sede nuevamente.' : contacts.loading ? 'Cargando contactos…' : contacts.rows.some(contact => contact.cliente_id === values.cliente_id) ? 'Selecciona una persona registrada en Contactos de este cliente.' : 'Agrega primero una persona en Contactos de este cliente. Puedes guardar la sede sin asignarla.'}{row?.autoriza_ingreso && row.autoriza_contacto_id === undefined ? ` Dato anterior: ${row.autoriza_ingreso}.` : ''}</small>}
      {key === 'referencia_cliente' && <small>Opcional: referencia usada en tu Excel. El código CLI se genera al guardar.</small>}
      {key === 'propiedad' && <small>{row ? 'La corrección de propiedad se habilitará con su flujo de auditoría.' : 'Propio: código TCL. De cliente: código TCE.'}</small>}
      {key === 'horometro' && <small>{row ? 'Valor registrado. Las nuevas lecturas y correcciones se habilitan en la etapa de horómetros.' : 'Indica la lectura actual; se guardará como primera lectura del equipo.'}</small>}
      {key === 'sede_id' && values.cliente_id && !sites.rows.some(site => site.cliente_id === values.cliente_id) && <small>Puedes agregar sedes desde la ficha del cliente.</small>}
    </div>;
  };
  return <Modal title={`${row ? 'Editar' : entity === 'Sede' ? 'Nueva' : 'Nuevo'} ${names[entity]}`} onClose={() => { if (!busy && !logoBusy) onClose(); }} wide><form onSubmit={save} className="record-form"><p className="record-intro">{row ? `Código ${row.codigo}. ` : 'El código se genera automáticamente. '}Los campos con <strong>*</strong> son obligatorios.</p>
    {entity === 'Cliente' && <><div className="client-auto-code"><span>Código de cliente</span><strong>{row?.codigo || 'Automático al guardar'}</strong></div><ClientLogoField value={String(values.logo || '')} onChange={value => change('logo',value)} disabled={busy || logoBusy} onBusy={setLogoBusy} /></>}
    {clientId && <div className="record-parent"><Info size={16} />{clientDisplayName(clients.rows.find(client => client.id === clientId))}</div>}
    {groups[entity].map(group => <fieldset className="record-section" key={group.title}><legend>{group.title}</legend><div className="record-fields">{group.fields.map(renderField)}</div></fieldset>)}
    {['marca','tipo'].map(key => <datalist id={`suggestions-${key}`} key={key}>{catalogs.rows.filter(item => item.activo && item.categoria === (key === 'marca' ? 'Marcas' : 'Tipos de equipo')).map(item => <option key={item.id} value={String(item.nombre)} />)}</datalist>)}
    {entity === 'Cliente' && !row && <p className="record-footer-note">Al guardar se abrirá la ficha para agregar sus contactos, sedes y equipos.</p>}
    <ErrorNotice message={error} /><div className="modal-actions record-actions"><button type="button" className="button" onClick={onClose} disabled={busy || logoBusy}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy || logoBusy}><Check size={16} />{busy ? 'Guardando…' : `Guardar ${names[entity]}`}</button></div>
  </form></Modal>;
}
