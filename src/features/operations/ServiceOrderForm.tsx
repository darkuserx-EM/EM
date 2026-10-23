import { OrderDraftPanel } from './OrderDraftPanel';
import { assignedTo, supportFields } from '../../domain/order-team';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
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
import { ReceiverSignature } from '../attachments/ReceiverSignature';
import TicketPhotos from '../attachments/TicketPhotos';
import { formatDate, formatNumber } from '../../domain/format';
import { latestEquipmentReading } from '../../domain/equipment-history';
import { changedFields, dateTimeInput, equipmentLabel, fromDateTimeInput, meterWarning, optionalMeterFields, orderAssignmentFields as assignmentFields, orderExecutionFields as executionFields, orderNotStarted, priorities, savedFormValues, serviceTypes } from './operations-ui';
import './operations.css';
import { addSymptom, orderEntryTimes, orderSections as steps, symptomOptions } from './order-entry';

export default function ServiceOrderForm({ row: original, ticket, onClose, onSaved, onCreated }: { row?: EntityRecord; ticket?: EntityRecord; onClose: () => void; onSaved: (row: EntityRecord) => void; onCreated?: (row: EntityRecord) => void }) {
  // Keep the version actually loaded/saved by this editor. Background refreshes must
  // not silently replace it while another participant is writing to the order.
  const [row, setRow] = useState(original);
  const actor = useActor(); const notify = useToast(state => state.notify); const manager = ['Administrador', 'Coordinador'].includes(actor.rol);
  const equipment = useRows('Equipo', true); const clients = useRows('Cliente', true); const sites = useRows('Sede', true); const technicians = useRows('Tecnico', true);
  const symptoms = useRows('Catalogos', true);

  const correcting = row?.estado === 'Completada' && manager;
  const [reason, setReason] = useState('');
  const creating = !row && actor.rol === 'Técnico';
  const canIdentify = !correcting && (manager || creating);
  const canEditTeam = !correcting && (manager || creating || row?.tecnico_id === actor.tecnico_id);
  const canSchedule = !correcting && (manager || creating || actor.rol === 'Técnico' && row?.estado === 'Borrador');
  const enabledIds = technicianEquipmentIds(actor, { Equipo: equipment.rows, Tecnico: technicians.rows });
  const eligibleEquipment = creating ? equipment.rows.filter(item => enabledIds.has(item.id)) : equipment.rows;
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries([...assignmentFields, ...executionFields].map(key => [key, String(row?.[key] ?? '')])),
    cliente_id: String(row?.cliente_id || ticket?.cliente_id || ''), equipo_id: String(row?.equipo_id || ticket?.equipo_id || ''), sede_id: String(row?.sede_id || ticket?.sede_id || ''),
    ticket_id: String(row?.ticket_id || ticket?.id || ''), tecnico_id: String(row?.tecnico_id || (creating ? actor.tecnico_id : ticket?.responsable_id) || ''),
    tipo: String(row?.tipo || 'Correctivo'), estado: String(row?.estado || (creating ? 'En proceso' : 'Borrador')), prioridad: String(row?.prioridad || ticket?.prioridad || 'Media'),
    sintoma: String(row?.sintoma || ticket?.descripcion || ''), ...orderEntryTimes(row, ticket, new Date(), creating),
    fecha_fin: dateTimeInput(row?.fecha_fin), visible_cliente: row?.visible_cliente === true ? 'true' : 'false',
  }));
  const [initialValues, setInitialValues] = useState(values);
  const [attachmentPending, setAttachmentPending] = useState(false); const [signaturePending, setSignaturePending] = useState(false);
  const guard = useUnsavedChanges(JSON.stringify(values) !== JSON.stringify(initialValues) || !!reason || attachmentPending || signaturePending, () => { if (JSON.stringify(values) !== JSON.stringify(initialValues)) clearDraft.current(); onClose(); });
  const [savedMessage, setSavedMessage] = useState('');
  const clearDraft = useRef<() => void>(() => {});
  const [step, setStep] = useState(original && !correcting && ['En proceso', 'En espera'].includes(String(original.estado)) ? 1 : 0); const [saving, setBusy] = useState(false); const [attachmentBusy, setAttachmentBusy] = useState(false); const [signatureBusy, setSignatureBusy] = useState(false); const [error, setError] = useState(''); const busy = saving || attachmentBusy || signatureBusy;
  const form = useRef<HTMLFormElement>(null); const pendingFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { pendingFocus.current?.focus(); pendingFocus.current = null; }, [step]);
  const set = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value }));
  const selectedEquipment = equipment.rows.find(item => item.id === values.equipo_id);
  // Última lectura del equipo: el aviso aparece al capturar el horómetro, no recién al completar la orden.
  const readings = useRows('LecturaHorometro', true, { equipment: values.equipo_id }, !!values.equipo_id);
  const lastReading = latestEquipmentReading(values.equipo_id, readings.rows);
  const meterNotice = correcting ? '' : meterWarning(values.horometro, lastReading ? { valor: Number(lastReading.valor), fecha: String(lastReading.fecha) } : undefined);
  const queries = [equipment, clients, sites, technicians]; const loading = queries.some(query => !query.ready); const queryError = queries.find(query => query.error)?.error || '';
  const completed = values.estado === 'Completada';
  const requiredAssignment = ['Programada', 'En proceso', 'En espera', 'Completada'].includes(values.estado);
  // «Iniciar atención» deja la orden en proceso: exige el técnico responsable aunque el formulario aún diga «Borrador»
  // (el día programado se completa solo). El botón lo aplica con flushSync, para que la validación del navegador ya lo vea.
  const [starting, setStarting] = useState(false);
  const requiredTechnician = requiredAssignment || starting;
  // Con una firma guardada, «Recibido por» toma su nombre y queda fijo: la orden y la firma dicen lo mismo.
  const [signedName, setSignedName] = useState<string | null>(null);
  useEffect(() => { if (signedName) setValues(previous => previous.recibido_por === signedName ? previous : { ...previous, recibido_por: signedName }); }, [signedName]);
  function validate(onlyStep = false) {
    const controls = Array.from(form.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea') || []);
    const invalid = controls.find(control => !control.disabled && (!onlyStep || Number(control.closest('[data-order-step]')?.getAttribute('data-order-step')) === step) && !control.checkValidity());
    if (!invalid) return true;
    invalid.closest('details')?.setAttribute('open', '');
    const target = Number(invalid.closest('[data-order-step]')?.getAttribute('data-order-step') || 0);
    setError(`Revisa ${invalid.closest('label')?.childNodes[0]?.textContent || 'el campo señalado'} en ${steps[target]}.`);
    if (step === target) { invalid.focus(); invalid.reportValidity(); } else { pendingFocus.current = invalid; setStep(target); }
    return false;
  }
  async function save(event?: FormEvent, start = false) {
    event?.preventDefault(); if (busy || loading) return;
    if (['Completada', 'Cancelada'].includes(values.estado) && attachmentPending) { setError('Hay evidencia pendiente. Vuelve a cargarla o quita la selección antes de cerrar la orden.'); setStep(1); return; }
    if (['Completada', 'Cancelada'].includes(values.estado) && signaturePending) { setError('Hay una firma sin confirmar. Confírmala o cancélala antes de cerrar la orden.'); setStep(2); return; }
    if (!validate()) return;
    // El servidor rechaza completar con un horómetro menor que la última lectura: avisarlo aquí, junto al campo.
    if (completed && !correcting && lastReading && values.horometro.trim() && Number(values.horometro) < Number(lastReading.valor)) { setError(meterNotice); setStep(1); return; }
    setBusy(true); setError('');
    try {
      const keys = (canIdentify || correcting ? [...assignmentFields, ...executionFields] : [...(canEditTeam ? supportFields : []), ...executionFields.filter(key => key !== 'sintoma'), ...(canSchedule ? ['fecha_programada', 'hora_programada'] : [])]).filter(key => !['horometro', 'odometro_millas'].includes(key));
      const all: Record<string, Scalar> = { ...Object.fromEntries(keys.map(key => [key, ['fecha', 'fecha_fin'].includes(key) ? fromDateTimeInput(values[key]) : values[key]])), ...optionalMeterFields(values, row) };
      const fields = row ? changedFields(all, values, initialValues) : all;
      if (start) { fields.estado = 'En proceso'; if (!row?.fecha_programada && !values.fecha_programada) fields.fecha_programada = todayGT(); }
      if (correcting) {
        const allowed = ['sintoma','diagnostico','trabajo_realizado','recomendaciones','pruebas_realizadas','resultado_pruebas','recibido_por','notas_seguridad','insumos','repuestos'];
        for (const key of Object.keys(fields)) if (!allowed.includes(key)) delete fields[key];
        fields.revision_accion = 'corregir'; fields.revision_motivo = reason;
      }
      if (manager && !correcting) fields.visible_cliente = values.visible_cliente === 'true';
      if (!row) fields.solicitud_id = requestId;
      if (!row && ticket) fields.desde_solicitud = true;
      if (row) fields.expected_updated_at = row.fecha_actualizacion;
      const repo = getDataSource().repository('OrdenServicio', actor);
      const saved = row ? await repo.update(row.id, fields) : await repo.create(fields);
      const next = savedFormValues(saved, values);
      clearDraft.current(); setRow(saved); setValues(next); setInitialValues(next); setReason('');
      setSavedMessage(`${saved.codigo} · ${start ? 'Atención iniciada' : 'Avance guardado'} en el portal.`);
      if (start) setStep(1);
      if (!row) onCreated?.(saved);
      if (saved.estado === 'Completada' || saved.estado === 'Cancelada') { notify(`${saved.codigo} guardada correctamente.`); onSaved(saved); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar. El borrador permanece aquí para reintentar.'); }
    finally { setBusy(false); }
  }
  const text = (key: string, label: string, required = false, hint?: string) => <label className="os-field os-span">{label}{required ? ' *' : ''}<textarea rows={3} maxLength={4000} value={values[key]} onChange={event => set(key, event.target.value)} disabled={busy || key === 'sintoma' && !canIdentify && !correcting} required={required} />{hint && <small>{hint}</small>}</label>;
  // Native date/time controls can emit input before committing change on blur.
  const input = (key: string, label: string, type = 'text', required = false, disabled = false) => <label className="os-field">{label}{required ? ' *' : ''}<input type={type} value={values[key]} onInput={['date', 'time', 'datetime-local'].includes(type) ? event => set(key, event.currentTarget.value) : undefined} onChange={event => set(key, event.target.value)} disabled={busy || disabled || correcting && ['horometro','odometro_millas','fecha','fecha_fin'].includes(key)} required={required} min={type === 'number' ? '0' : undefined} step={type === 'number' ? 'any' : undefined} maxLength={type === 'text' ? 500 : undefined} /></label>;
  const choose = (key: string, label: string, options: readonly string[], disabled = false) => <label className="os-field">{label}<select value={values[key]} onChange={event => set(key, event.target.value)} disabled={busy || disabled || correcting && key === 'estado'}>{!options.includes(values[key]) && <option>{values[key]}</option>}{options.map(option => <option key={option}>{option}</option>)}</select></label>;
  return <Modal title={row ? `${correcting ? 'Corregir' : 'Atender'} ${row.codigo}` : 'Nueva orden de servicio'} wide className="os-form-modal" onClose={() => { if (!busy) guard.requestClose(); }}>{guard.prompt}
    <OrderDraftPanel key={`${actor.id}:${actor.rol}:${row?.id || 'new'}`} actor={actor} scope={row?.id || `new:${ticket?.id || 'standalone'}`} version={String(row?.fecha_actualizacion || '')} equipment={String(row?.codigo || (selectedEquipment ? equipmentLabel(selectedEquipment) : 'Orden nueva'))} values={values} initial={initialValues} requestId={requestId} onRestore={(texts, id) => { setValues(previous => ({ ...previous, ...texts })); if (!row) setRequestId(id); }} onSavedDraft={clear => { clearDraft.current = clear; }} />
    <form ref={form} onSubmit={save} noValidate>
      <>{correcting&&<label className="os-field os-span">Motivo de corrección *<textarea required minLength={8} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/><small>Se conserva la versión anterior, el cierre, las lecturas y las evidencias.</small></label>}</><p className="os-intro">Identifica el equipo, documenta el trabajo y registra las pruebas. Los campos con * son obligatorios.</p>
      <nav className="os-steps" aria-label="Pasos del reporte">{steps.map((label, index) => <button type="button" key={label} aria-current={step === index ? 'step' : undefined} disabled={busy} onClick={() => { setStep(index); setError(''); }}><span>{index + 1}</span>{label}</button>)}</nav>
      <div className="os-equipment-context"><strong>{selectedEquipment ? equipmentLabel(selectedEquipment) : 'Selecciona un equipo para comenzar'}</strong>{values.ticket_id && <small>Solicitud vinculada{ticket ? `: ${ticket.codigo}` : ''}</small>}</div>
      <p className="os-help" role="status">{savedMessage || (row ? `${row.codigo} · ${row.estado}` : 'Inicia la atención para registrar la orden y adjuntar evidencias aquí.')} {row && !correcting && 'Guarda tus avances para compartirlos; el respaldo local de texto no sustituye el guardado en el portal.'}</p>
      <ErrorNotice message={queryError} />{creating && <p className="os-help">La orden quedará asignada a ti. Puedes elegir cualquier equipo activo y agregar hasta dos técnicos de apoyo. Los tres podrán trabajar en esta misma orden.</p>}
      <section hidden={step !== 0} data-order-step="0" aria-label={steps[0]} className="os-form-grid">
        <label className="os-field">Cliente / patio<select value={values.cliente_id} disabled={busy || !canIdentify || !!row || !!ticket || loading} onChange={event => setValues(previous => ({ ...previous, cliente_id: event.target.value, equipo_id: '', sede_id: '' }))}><option value="">Patio EMSA · sin cliente asignado</option>{clients.rows.map(client => <option value={client.id} key={client.id}>{clientDisplayName(client)}</option>)}</select></label>
        <label className="os-field">Equipo *<select value={values.equipo_id} disabled={busy || !canIdentify || !!row || !!ticket || loading} required onChange={event => { const machine = equipment.rows.find(item => item.id === event.target.value); setValues(previous => ({ ...previous, equipo_id: event.target.value, sede_id: String(machine?.sede_id || '') })); }}><option value="">Selecciona un equipo</option>{eligibleEquipment.filter(item => String(item.cliente_id || '') === values.cliente_id).map(item => <option value={item.id} key={item.id}>{equipmentLabel(item)}</option>)}</select></label>
        <label className="os-field">Sede<select value={values.sede_id} disabled={busy || !manager || correcting || loading} onChange={event => set('sede_id', event.target.value)}><option value="">Sin sede asignada</option>{sites.rows.filter(site => site.cliente_id === values.cliente_id).map(site => <option value={site.id} key={site.id}>{site.nombre}</option>)}</select></label>
        <label className="os-field">Técnico responsable{requiredTechnician ? ' *' : ''}<select value={values.tecnico_id} disabled={busy || !manager || correcting || loading} required={requiredTechnician} onChange={event => set('tecnico_id', event.target.value)}><option value="">Sin asignar</option>{technicians.rows.map(technician => <option value={technician.id} key={technician.id}>{technician.nombre}</option>)}</select></label>
        {supportFields.map((key, index) => <label className="os-field" key={key}>Técnico de apoyo {index + 1}<select value={values[key]} disabled={busy || !canEditTeam || loading} onChange={event => set(key, event.target.value)}><option value="">Sin apoyo</option>{technicians.rows.filter(person => person.activo !== false && person.id !== values.tecnico_id && !supportFields.some(other => other !== key && values[other] === person.id)).map(person => <option key={person.id} value={person.id}>{person.nombre}</option>)}</select></label>)}
        {choose('tipo', 'Tipo de servicio', serviceTypes, !canIdentify)}{choose('prioridad', 'Prioridad', priorities, !canIdentify)}
        {input('fecha_programada', 'Día de visita', 'date', requiredAssignment, !canSchedule)}{input('hora_programada', 'Hora de visita · Guatemala', 'time', false, !canSchedule)}
        {input('fecha', 'Inicio del trabajo · Guatemala', 'datetime-local', false, orderNotStarted(values.estado))}
        <p className="os-help">{orderNotStarted(values.estado) ? 'El inicio del trabajo se registra al pulsar «Iniciar atención». Después puedes ajustarlo si empezaste antes.' : !row ? 'El inicio es la hora en que abriste esta orden; ajústalo si empezaste antes.' : 'Ajusta el inicio si el trabajo empezó a otra hora.'}</p>
        {(canIdentify || correcting) && <div className="os-symptoms os-span"><span>Síntomas frecuentes · opcional</span><div>{symptomOptions(symptoms.rows).map(symptom => <button type="button" className="button" key={symptom} disabled={busy} onClick={() => { try { set('sintoma', addSymptom(values.sintoma, symptom)); setError(''); } catch (cause) { setError((cause as Error).message); } }}>{symptom}</button>)}</div><small>{symptoms.error ? 'No se pudieron cargar las sugerencias. Puedes escribir el motivo.' : 'Pulsa para agregar al motivo. Puedes completar o editar el texto.'}</small></div>}
        {text('sintoma', 'Síntoma o motivo reportado', true)}
      </section>
      <section hidden={step !== 1} data-order-step="1" aria-label={steps[1]} className="os-form-grid">
        {text('diagnostico', 'Diagnóstico técnico', completed)}{text('trabajo_realizado', 'Trabajo realizado', completed)}
        {input('horometro', 'Horómetro H1 · horas', 'number')}{input('odometro_millas', 'Odómetro H3 · millas', 'number')}
        <p className="os-help os-span os-meter-note" role="status">{!correcting && lastReading ? <>Última lectura del equipo: {formatNumber(Number(lastReading.valor))} h el {formatDate(String(lastReading.fecha))}.{meterNotice && <strong> {meterNotice}</strong>}</> : 'Captura las lecturas que marca el equipo. Si el horómetro es menor que la última lectura, la orden no se podrá completar.'}</p>
        <details className="os-extra os-span" open={!!(initialValues.insumos || initialValues.repuestos || initialValues.recomendaciones)}><summary>Materiales y recomendaciones · opcional</summary><div className="os-form-grid">{text('insumos', 'Insumos utilizados', false, 'Descripción y cantidades utilizadas.')}{text('repuestos', 'Repuestos utilizados', false, 'Descripción, número de parte y cantidad si están disponibles.')}{text('recomendaciones', 'Recomendaciones y siguiente acción')}</div></details>
        {text('notas_seguridad', 'Hallazgos de seguridad / restricciones', false, 'Documenta cualquier restricción de uso y comunica el hallazgo al coordinador.')}
      </section>
      <section hidden={step !== 2} data-order-step="2" aria-label={steps[2]} className="os-form-grid">
        {choose('estado', 'Estado de la orden', allowedOperationStates('OrdenServicio', row, actor))}
        {input('fecha_fin', 'Final del trabajo · Guatemala', 'datetime-local', completed)}
        {text('pruebas_realizadas', 'Pruebas realizadas', completed)}{text('resultado_pruebas', 'Resultado de las pruebas', completed)}
        <ReceiverSignature orderId={row?.id} signer={values.recibido_por} completed={correcting} onBusy={setSignatureBusy} onPending={setSignaturePending} onSigner={setSignedName} editable={!saving && !!row && row.estado !== 'Cancelada' && (manager || actor.rol === 'Técnico' && assignedTo(row, actor.tecnico_id))}>{input('recibido_por', 'Nombre de quien recibe el servicio', 'text', false, !!signedName)}</ReceiverSignature>
        {manager && !correcting && <label className="os-check os-span"><input type="checkbox" checked={values.visible_cliente === 'true'} onChange={event => set('visible_cliente', String(event.target.checked))} disabled={busy} /><span>Compartir este reporte con el cliente</span></label>}
        <p className="os-help os-span">Completar la orden documenta el servicio. La condición operativa y los hallazgos del equipo requieren su propia revisión.</p>
        {values.ticket_id && <p className="os-help os-span">La solicitud vinculada se resolverá al completar todas sus órdenes. Si alguna sigue pendiente o fue cancelada, coordinación revisará el cierre de la solicitud.</p>}
      </section>
      <section hidden={step !== 1} data-order-step="1" aria-label="Evidencias de la atención" className="os-form-grid">
        {row?.ticket_id && <div className="os-span"><TicketPhotos orderId={row.id}/></div>}
        {row ? <div className="os-span"><AttachmentPanel orderId={row.id} completed={correcting} preferredCategory="Antes" onBusy={setAttachmentBusy} onPending={setAttachmentPending} editable={!saving && (manager || actor.rol === 'Técnico' && assignedTo(row, actor.tecnico_id))} /></div> : <div className="os-evidence-note os-span"><h3>Fotografías antes y después</h3><p>Pulsa «Iniciar atención» después de indicar el equipo, el responsable y el motivo. Las evidencias se cargarán en esta misma ventana.</p></div>}
      </section>
      <ErrorNotice message={error} />
      <footer className="modal-actions os-form-actions"><button type="button" className="button" onClick={guard.requestClose} disabled={busy}>{row ? 'Salir de la orden' : 'Cancelar'}</button><div>{step > 0 && <button type="button" className="button" onClick={() => setStep(step - 1)} disabled={busy}><ChevronLeft size={16} />Anterior</button>}{step < steps.length - 1 && <button type="button" className="button" disabled={busy} onClick={() => { if (validate(true)) { setStep(step + 1); setError(''); } }}>Siguiente<ChevronRight size={16} /></button>}{!correcting && (!row || ['Borrador', 'Programada', 'En espera'].includes(String(row.estado))) && <button type="button" className="button button-dark" disabled={busy || loading || !!queryError} onClick={() => { flushSync(() => setStarting(true)); void save(undefined, true); setStarting(false); }}>{row?.estado === 'En espera' ? 'Reanudar atención' : 'Iniciar atención'}</button>}<button type="submit" className="button button-dark" disabled={busy || loading || !!queryError}><Check size={16} />{busy ? 'Guardando…' : correcting ? 'Guardar corrección' : completed ? 'Completar orden' : row ? 'Guardar avance' : 'Guardar orden'}</button></div></footer>
    </form>
  </Modal>;
}
