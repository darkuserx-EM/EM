import { useState, type FormEvent } from 'react';
import { Check, Info } from 'lucide-react';
import { useActor, useRows, useToast } from '../../app/state';
import { ErrorNotice, Modal } from '../../components/ui';
import { definitions, type EntityRecord, type Scalar } from '../../domain/model';
import { getDataSource } from '../../data/repository';

export type EditableRecord = 'Cliente' | 'Equipo' | 'Contacto' | 'Sede';
const names = { Cliente: 'cliente', Equipo: 'equipo', Contacto: 'contacto', Sede: 'sede' };
export const fieldLabels: Record<string, string> = {
  referencia_ubicacion: 'Referencia de ubicación / Plus Code',
  nombre: 'Nombre', sector: 'Sector / actividad', estado: 'Estado', ubicacion: 'Ubicación principal', referencia_cliente: 'Referencia del cliente', nit: 'NIT', direccion_fiscal: 'Dirección fiscal', dia_facturacion: 'Día de facturación', reporte_mensual_horas: '¿Requiere reporte mensual de horas?', notas_operativas: 'Notas operativas', cliente_id: 'Cliente', cargo: 'Cargo / área', telefono: 'Teléfono', correo: 'Correo electrónico', principal: '¿Es el contacto principal?', direccion: 'Dirección', municipio: 'Municipio', departamento: 'Departamento', horario_atencion: 'Horario de atención', autoriza_ingreso: 'Quién autoriza el ingreso', marca: 'Marca', modelo: 'Modelo', serie: 'Número de serie', tipo: 'Tipo de equipo', propiedad: 'Propiedad', horometro: 'Horómetro (horas)', sede_id: 'Sede del cliente', anio: 'Año', capacidad_kg: 'Capacidad (kg)', altura_elevacion_m: 'Altura de elevación (m)', voltaje: 'Voltaje (V)', bateria: 'Batería', cargador: 'Cargador', combustible: 'Combustible', llantas: 'Llantas', notas: 'Observaciones',
};
const groups: Record<EditableRecord, { title: string; fields: string[] }[]> = {
  Cliente: [
    { title: 'Identificación de la empresa', fields: ['nombre', 'nit', 'estado', 'sector', 'referencia_cliente', 'ubicacion'] },
    { title: 'Facturación y atención', fields: ['direccion_fiscal', 'dia_facturacion', 'reporte_mensual_horas', 'notas_operativas'] },
  ],
  Equipo: [
    { title: 'Identificación', fields: ['propiedad', 'marca', 'modelo', 'serie', 'anio', 'tipo'] },
    { title: 'Asignación y horómetro', fields: ['estado', 'cliente_id', 'sede_id', 'horometro'] },
    { title: 'Especificaciones opcionales', fields: ['capacidad_kg', 'altura_elevacion_m', 'voltaje', 'combustible', 'bateria', 'cargador', 'llantas', 'notas'] },
  ],
  Contacto: [{ title: 'Datos de contacto', fields: ['nombre', 'cargo', 'telefono', 'correo', 'principal'] }],
  Sede: [{ title: 'Ubicación y acceso', fields: ['nombre', 'direccion', 'municipio', 'departamento', 'referencia_ubicacion', 'horario_atencion', 'autoriza_ingreso'] }],
};

export function RecordForm({ entity, row, clientId, onClose, onSaved }: { entity: EditableRecord; row?: EntityRecord; clientId?: string; onClose: () => void; onSaved: (record: EntityRecord) => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify);
  const clients = useRows('Cliente'); const sites = useRows('Sede'); const catalogs = useRows('Catalogos');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = entity === 'Equipo' ? { estado: 'Disponible', propiedad: 'Propio' } : entity === 'Cliente' ? { estado: 'Activo' } : {};
    return { ...defaults, ...Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, value === null ? '' : String(value)])), ...(clientId ? { cliente_id: clientId } : {}) };
  });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const change = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value, ...(key === 'cliente_id' ? { sede_id: '' } : {}) }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const fields: Record<string, Scalar> = Object.fromEntries(definitions[entity].columns.map(column => [column.key, column.type === 'number' ? values[column.key]?.trim() ? Number(values[column.key]) : column.required ? '' : null : values[column.key] ?? '']));
      const repo = getDataSource().repository(entity, actor);
      const saved = row ? await repo.update(row.id, fields) : await repo.create(fields);
      notify(`${saved.codigo} guardado en este navegador.`); onSaved(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const renderField = (key: string) => {
    const column = definitions[entity].columns.find(item => item.key === key)!;
    const needsClient = entity === 'Equipo' && (values.propiedad === 'De cliente' || values.estado === 'En renta');
    const required = !!column.required || (key === 'cliente_id' && needsClient);
    const disabled = busy || (entity === 'Equipo' && !!row && ['horometro', 'propiedad'].includes(key));
    const multiline = ['direccion_fiscal', 'notas_operativas', 'direccion', 'notas'].includes(key);
    const label = key === 'nombre' && entity === 'Cliente' ? 'Nombre / razón social' : fieldLabels[key] || column.label;
    const common = { value: values[key] ?? '', required, disabled, id: `record-${key}`, placeholder: key === 'referencia_ubicacion' ? 'Ej.: G96Q+P5 Villa Nueva' : key === 'nombre' ? entity === 'Cliente' ? 'Ej.: Distelsa' : entity === 'Sede' ? 'Ej.: Bodega A' : '' : key === 'direccion' ? 'Ej.: Parque Logística Unisur 4, CA-9 zona 10' : undefined };
    let control;
    if (key === 'cliente_id') control = <select {...common} disabled={disabled || clients.loading || !!clientId} onChange={event => change(key, event.target.value)}><option value="">{needsClient ? 'Selecciona un cliente' : 'Sin asignar / patio EMSA'}</option>{clients.rows.map(client => <option key={client.id} value={client.id}>{client.nombre} · {client.codigo}</option>)}</select>;
    else if (key === 'sede_id') control = <select {...common} disabled={disabled || !values.cliente_id || sites.loading} onChange={event => change(key, event.target.value)}><option value="">Sin sede asignada</option>{sites.rows.filter(site => site.cliente_id === values.cliente_id).map(site => <option key={site.id} value={site.id}>{site.nombre}</option>)}</select>;
    else if (column.options) control = <select {...common} onChange={event => change(key, event.target.value)}>{!required && <option value="">Sin especificar</option>}{column.options.map(option => <option key={option}>{option}</option>)}</select>;
    else if (multiline) control = <textarea {...common} rows={3} maxLength={500} onChange={event => change(key, event.target.value)} />;
    else control = <input {...common} type={column.type === 'number' ? 'number' : key === 'correo' ? 'email' : key === 'telefono' ? 'tel' : 'text'} min={key === 'dia_facturacion' ? 1 : column.type === 'number' ? 0 : undefined} max={key === 'dia_facturacion' ? 31 : undefined} step={column.type === 'number' ? ['dia_facturacion', 'anio'].includes(key) ? '1' : 'any' : undefined} maxLength={column.type === 'number' ? undefined : 500} list={['marca','tipo'].includes(key) ? `suggestions-${key}` : undefined} onChange={event => change(key, event.target.value)} />;
    return <div className={`record-field ${multiline ? 'record-field-wide' : ''}`} key={key}><label htmlFor={`record-${key}`}>{label}{required && <span className="required-mark"> *</span>}</label>{control}
      {key === 'referencia_cliente' && <small>Opcional: referencia usada en tu Excel. El código CLI se genera al guardar.</small>}
      {key === 'propiedad' && <small>{row ? 'La corrección de propiedad se habilitará con su flujo de auditoría.' : 'Propio: código TCL. De cliente: código TCE.'}</small>}
      {key === 'horometro' && <small>{row ? 'Valor registrado. Las nuevas lecturas y correcciones se habilitan en la etapa de horómetros.' : 'Indica la lectura actual; se guardará como primera lectura del equipo.'}</small>}
      {key === 'sede_id' && values.cliente_id && !sites.rows.some(site => site.cliente_id === values.cliente_id) && <small>Puedes agregar sedes desde la ficha del cliente.</small>}
    </div>;
  };
  return <Modal title={`${row ? 'Editar' : entity === 'Sede' ? 'Nueva' : 'Nuevo'} ${names[entity]}`} onClose={() => { if (!busy) onClose(); }} wide><form onSubmit={save} className="record-form"><p className="record-intro">{row ? `Código ${row.codigo}. ` : 'El código se genera automáticamente. '}Los campos con <strong>*</strong> son obligatorios.</p>
    {clientId && <div className="record-parent"><Info size={16} />{clients.rows.find(client => client.id === clientId)?.nombre ?? 'Cliente seleccionado'}</div>}
    {groups[entity].map(group => <fieldset className="record-section" key={group.title}><legend>{group.title}</legend><div className="record-fields">{group.fields.map(renderField)}</div></fieldset>)}
    {['marca','tipo'].map(key => <datalist id={`suggestions-${key}`} key={key}>{catalogs.rows.filter(item => item.activo && item.categoria === (key === 'marca' ? 'Marcas' : 'Tipos de equipo')).map(item => <option key={item.id} value={String(item.nombre)} />)}</datalist>)}
    {entity === 'Cliente' && !row && <p className="record-footer-note">Al guardar se abrirá la ficha para agregar sus contactos, sedes y equipos.</p>}
    <ErrorNotice message={error} /><div className="modal-actions record-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy}><Check size={16} />{busy ? 'Guardando…' : `Guardar ${names[entity]}`}</button></div>
  </form></Modal>;
}
