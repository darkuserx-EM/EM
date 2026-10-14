import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useActor, useRows, useToast } from '../../app/state';
import { ErrorNotice, Modal, useUnsavedChanges } from '../../components/ui';
import { getDataSource } from '../../data/source';
import type { EntityRecord, Scalar } from '../../domain/model';
import { clientDisplayName } from '../../domain/client-profile';
import { allowedOperationStates } from '../../domain/operations';
import { technicianEquipmentIds } from '../../domain/technician-work';
import { todayGT } from '../../domain/maintenance-plan';
import AttachmentPanel from '../attachments/AttachmentPanel';
import { dateTimeInput, equipmentLabel, fromDateTimeInput, optionalMeterFields, priorities, serviceTypes } from './operations-ui';
import './operations.css';

const steps = ['Identificación', 'Diagnóstico', 'Trabajo', 'Pruebas y cierre', 'Evidencias'];
const executionFields = ['estado', 'fecha', 'fecha_fin', 'sintoma', 'diagnostico', 'causa_confirmada', 'trabajo_realizado', 'recomendaciones', 'insumos', 'repuestos', 'pruebas_realizadas', 'resultado_pruebas', 'recibido_por', 'notas_seguridad', 'horometro', 'odometro_millas'];
const assignmentFields = ['equipo_id', 'cliente_id', 'sede_id', 'ticket_id', 'tecnico_id', 'tipo', 'prioridad', 'fecha_programada', 'hora_programada'];

export default function ServiceOrderForm({ row, ticket, onClose, onSaved }: { row?: EntityRecord; ticket?: EntityRecord; onClose: () => void; onSaved: (row: EntityRecord) => void }) {
  const actor = useActor(); const notify = useToast(state => state.notify); const manager = ['Administrador', 'Coordinador'].includes(actor.rol);
  const equipment = useRows('Equipo', true); const clients = useRows('Cliente', true); const sites = useRows('Sede', true); const technicians = useRows('Tecnico', true);
  const tickets = useRows('Ticket', !row && !manager); const orders = useRows('OrdenServicio', !row && !manager);
  const creating = !row && actor.rol === 'Técnico';
  const canIdentify = manager || creating;
  const canSchedule = manager || creating || actor.rol === 'Técnico' && row?.estado === 'Borrador';
  const enabledIds = technicianEquipmentIds(actor, { Ticket: tickets.rows, OrdenServicio: orders.rows, Tecnico: technicians.rows });
  const eligibleEquipment = creating ? equipment.rows.filter(item => enabledIds.has(item.id)) : equipment.rows;
  const [requestId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries([...assignmentFields, ...executionFields].map(key => [key, String(row?.[key] ?? '')])),
    cliente_id: String(row?.cliente_id || ticket?.cliente_id || ''), equipo_id: String(row?.equipo_id || ticket?.equipo_id || ''), sede_id: String(row?.sede_id || ticket?.sede_id || ''),
    ticket_id: String(row?.ticket_id || ticket?.id || ''), tecnico_id: String(row?.tecnico_id || (creating ? actor.tecnico_id : ticket?.responsable_id) || ''),
    tipo: String(row?.tipo || 'Correctivo'), estado: String(row?.estado || (creating ? 'Programada' : 'Borrador')), prioridad: String(row?.prioridad || ticket?.prioridad || 'Media'),
    sintoma: String(row?.sintoma || ticket?.descripcion || ''), fecha_programada: String(row?.fecha_programada || ticket?.fecha_programada || (creating ? todayGT() : '')),
    fecha: dateTimeInput(row?.fecha), fecha_fin: dateTimeInput(row?.fecha_fin), visible_cliente: row?.visible_cliente === true ? 'true' : 'false',
  }));
  const [initialValues] = useState(values); const guard = useUnsavedChanges(JSON.stringify(values) !== JSON.stringify(initialValues), onClose);
  const [step, setStep] = useState(0); const [saving, setBusy] = useState(false); const [attachmentBusy, setAttachmentBusy] = useState(false); const [error, setError] = useState(''); const busy = saving || attachmentBusy;
  const form = useRef<HTMLFormElement>(null); const pendingFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { pendingFocus.current?.focus(); pendingFocus.current = null; }, [step]);
  const set = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value }));
  const selectedEquipment = equipment.rows.find(item => item.id === values.equipo_id);
  const queries = [equipment, clients, sites, technicians, ...(creating ? [tickets, orders] : [])]; const loading = queries.some(query => !query.ready); const queryError = queries.find(query => query.error)?.error || '';
  const completed = values.estado === 'Completada';
  const requiredAssignment = ['Programada', 'En proceso', 'En espera', 'Completada'].includes(values.estado);
  function validate(onlyStep = false) {
    const controls = Array.from(form.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea') || []);
    const invalid = controls.find(control => !control.disabled && (!onlyStep || Number(control.closest('[data-order-step]')?.getAttribute('data-order-step')) === step) && !control.checkValidity());
    if (!invalid) return true;
    const target = Number(invalid.closest('[data-order-step]')?.getAttribute('data-order-step') || 0);
    setError(`Revisa ${invalid.closest('label')?.childNodes[0]?.textContent || 'el campo señalado'} en ${steps[target]}.`);
    if (step === target) { invalid.focus(); invalid.reportValidity(); } else { pendingFocus.current = invalid; setStep(target); }
    return false;
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || loading || !validate()) return;
    setBusy(true); setError('');
    try {
      const keys = (canIdentify ? [...assignmentFields, ...executionFields] : [...executionFields.filter(key => key !== 'sintoma'), ...(canSchedule ? ['fecha_programada', 'hora_programada'] : [])]).filter(key => !['horometro', 'odometro_millas'].includes(key));
      const fields: Record<string, Scalar> = { ...Object.fromEntries(keys.map(key => [key, ['fecha', 'fecha_fin'].includes(key) ? fromDateTimeInput(values[key]) : values[key]])), ...optionalMeterFields(values, row) };
      if (manager) fields.visible_cliente = values.visible_cliente === 'true';
      if (!row) fields.solicitud_id = requestId;
      if (!row && ticket) fields.desde_solicitud = true;
      if (row) fields.expected_updated_at = row.fecha_actualizacion;
      const repo = getDataSource().repository('OrdenServicio', actor);
      const saved = row ? await repo.update(row.id, fields) : await repo.create(fields);
      notify(`${saved.codigo} guardada correctamente.`); onSaved(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar. El borrador permanece aquí para reintentar.'); }
    finally { setBusy(false); }
  }
  const text = (key: string, label: string, required = false, hint?: string) => <label className="os-field os-span">{label}{required ? ' *' : ''}<textarea rows={3} maxLength={4000} value={values[key]} onChange={event => set(key, event.target.value)} disabled={busy || key === 'sintoma' && !canIdentify} required={required} />{hint && <small>{hint}</small>}</label>;
  const input = (key: string, label: string, type = 'text', required = false, disabled = false) => <label className="os-field">{label}{required ? ' *' : ''}<input type={type} value={values[key]} onChange={event => set(key, event.target.value)} disabled={busy || disabled} required={required} min={type === 'number' ? '0' : undefined} step={type === 'number' ? 'any' : undefined} maxLength={type === 'text' ? 500 : undefined} /></label>;
  const choose = (key: string, label: string, options: readonly string[], disabled = false) => <label className="os-field">{label}<select value={values[key]} onChange={event => set(key, event.target.value)} disabled={busy || disabled}>{!options.includes(values[key]) && <option>{values[key]}</option>}{options.map(option => <option key={option}>{option}</option>)}</select></label>;
  return <Modal title={row ? `Editar ${row.codigo}` : 'Nueva orden de servicio'} wide className="os-form-modal" onClose={() => { if (!busy) guard.requestClose(); }}>{guard.prompt}
    <form ref={form} onSubmit={save} noValidate>
      <p className="os-intro">Identifica el equipo, documenta el trabajo y registra las pruebas. Los campos con * son obligatorios.</p>
      <nav className="os-steps" aria-label="Pasos del reporte">{steps.map((label, index) => <button type="button" key={label} aria-current={step === index ? 'step' : undefined} disabled={busy} onClick={() => { setStep(index); setError(''); }}><span>{index + 1}</span>{label}</button>)}</nav>
      <div className="os-equipment-context"><strong>{selectedEquipment ? equipmentLabel(selectedEquipment) : 'Selecciona un equipo para comenzar'}</strong>{values.ticket_id && <small>Solicitud vinculada{ticket ? `: ${ticket.codigo}` : ''}</small>}</div>
      <ErrorNotice message={queryError} />{creating && <p className="os-help">La orden quedará asignada a ti. Puedes elegir equipos habilitados por administración o con trabajo abierto asignado. Si falta un equipo, solicita su habilitación en Roles y accesos.</p>}
      <section hidden={step !== 0} data-order-step="0" aria-label={steps[0]} className="os-form-grid">
        <label className="os-field">Cliente / patio<select value={values.cliente_id} disabled={busy || !canIdentify || !!row || !!ticket || loading} onChange={event => setValues(previous => ({ ...previous, cliente_id: event.target.value, equipo_id: '', sede_id: '' }))}><option value="">Patio EMSA · sin cliente asignado</option>{clients.rows.map(client => <option value={client.id} key={client.id}>{clientDisplayName(client)}</option>)}</select></label>
        <label className="os-field">Equipo *<select value={values.equipo_id} disabled={busy || !canIdentify || !!row || !!ticket || loading} required onChange={event => { const machine = equipment.rows.find(item => item.id === event.target.value); setValues(previous => ({ ...previous, equipo_id: event.target.value, sede_id: String(machine?.sede_id || '') })); }}><option value="">Selecciona un equipo</option>{eligibleEquipment.filter(item => String(item.cliente_id || '') === values.cliente_id).map(item => <option value={item.id} key={item.id}>{equipmentLabel(item)}</option>)}</select></label>
        <label className="os-field">Sede<select value={values.sede_id} disabled={busy || !manager || loading} onChange={event => set('sede_id', event.target.value)}><option value="">Sin sede asignada</option>{sites.rows.filter(site => site.cliente_id === values.cliente_id).map(site => <option value={site.id} key={site.id}>{site.nombre}</option>)}</select></label>
        <label className="os-field">Técnico responsable{requiredAssignment ? ' *' : ''}<select value={values.tecnico_id} disabled={busy || !manager || loading} required={requiredAssignment} onChange={event => set('tecnico_id', event.target.value)}><option value="">Sin asignar</option>{technicians.rows.map(technician => <option value={technician.id} key={technician.id}>{technician.nombre}</option>)}</select></label>
        {choose('tipo', 'Tipo de servicio', serviceTypes, !canIdentify)}{choose('prioridad', 'Prioridad', priorities, !canIdentify)}
        {input('fecha_programada', 'Día programado', 'date', requiredAssignment, !canSchedule)}{input('hora_programada', 'Hora de visita · Guatemala', 'time', false, !canSchedule)}
      </section>
      <section hidden={step !== 1} data-order-step="1" aria-label={steps[1]} className="os-form-grid">
        {text('sintoma', 'Síntoma o motivo reportado', true)}{text('diagnostico', 'Diagnóstico técnico', completed)}{text('causa_confirmada', 'Causa confirmada', false, 'Registra solo lo comprobado; si está en estudio indícalo en el diagnóstico.')}
        {input('horometro', 'Horómetro H1 · horas', 'number')}{input('odometro_millas', 'Odómetro H3 · millas', 'number')}
        <p className="os-help os-span">Captura las lecturas observadas. Una lectura menor requiere revisión del contador; conserva el dato original y explica la situación en el diagnóstico.</p>
      </section>
      <section hidden={step !== 2} data-order-step="2" aria-label={steps[2]} className="os-form-grid">
        {text('trabajo_realizado', 'Trabajo realizado', completed)}{text('insumos', 'Insumos utilizados', false, 'Descripción y cantidades utilizadas.')}{text('repuestos', 'Repuestos utilizados', false, 'Descripción, número de parte y cantidad si están disponibles.')}{text('recomendaciones', 'Recomendaciones y siguiente acción')}{text('notas_seguridad', 'Hallazgos de seguridad / restricciones', false, 'Documenta cualquier restricción de uso y comunica el hallazgo al coordinador.')}
      </section>
      <section hidden={step !== 3} data-order-step="3" aria-label={steps[3]} className="os-form-grid">
        {choose('estado', 'Estado de la orden', allowedOperationStates('OrdenServicio', row, actor))}
        {input('recibido_por', 'Nombre de quien recibe el servicio')}{input('fecha', 'Inicio del trabajo · Guatemala', 'datetime-local')}{input('fecha_fin', 'Final del trabajo · Guatemala', 'datetime-local', completed)}
        {text('pruebas_realizadas', 'Pruebas realizadas', completed)}{text('resultado_pruebas', 'Resultado de las pruebas', completed)}
        {manager && <label className="os-check os-span"><input type="checkbox" checked={values.visible_cliente === 'true'} onChange={event => set('visible_cliente', String(event.target.checked))} disabled={busy} /><span>Compartir este reporte con el cliente</span></label>}
        <p className="os-help os-span">Completar la orden documenta el servicio. La condición operativa y los hallazgos del equipo requieren su propia revisión.</p>
        {values.ticket_id && <p className="os-help os-span">La solicitud vinculada se resolverá al completar todas sus órdenes. Si alguna sigue pendiente o fue cancelada, coordinación revisará el cierre de la solicitud.</p>}
      </section>
      <section hidden={step !== 4} data-order-step="4" aria-label={steps[4]} className="os-form-grid">
        {row ? <div className="os-span"><AttachmentPanel orderId={row.id} onBusy={setAttachmentBusy} editable={!saving && (actor.rol === 'Administrador' || actor.rol === 'Técnico' && row.tecnico_id === actor.tecnico_id)} /></div> : <div className="os-evidence-note os-span"><h3>Fotografías antes y después</h3><p>Guarda primero el reporte como borrador o programado. Así podrás adjuntar las evidencias a su orden y mantenerlas relacionadas con el equipo.</p><p>Al guardar se abrirá el detalle con las opciones de evidencia. Agrégalas antes de completar la orden.</p></div>}
      </section>
      <ErrorNotice message={error} />
      <footer className="modal-actions os-form-actions"><button type="button" className="button" onClick={guard.requestClose} disabled={busy}>Cancelar</button><div>{step > 0 && <button type="button" className="button" onClick={() => setStep(step - 1)} disabled={busy}><ChevronLeft size={16} />Anterior</button>}{step < steps.length - 1 && <button type="button" className="button" disabled={busy} onClick={() => { if (validate(true)) { setStep(step + 1); setError(''); } }}>Siguiente<ChevronRight size={16} /></button>}<button type="submit" className="button button-dark" disabled={busy || loading || !!queryError}><Check size={16} />{busy ? 'Guardando…' : row ? 'Guardar reporte' : 'Guardar orden'}</button></div></footer>
    </form>
  </Modal>;
}
