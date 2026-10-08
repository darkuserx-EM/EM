import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, Pencil, Plus, Search, Upload } from 'lucide-react';
import { useActor, useRows, useToast } from '../../app/state';
import { EmptyState, ErrorNotice, SectionTitle, Status } from '../../components/ui';
import { equipmentStates, type EntityRecord } from '../../domain/model';
import { formatHourMeter } from '../../domain/format';
import { normalize } from '../../domain/validation';
import { EquipmentDetail } from '../fleet/EquipmentDetail';
import { ClientDirectory } from './ClientDirectory';
import { EquipmentPhoto } from './EquipmentImages';
import type { ClientSection } from './ClientInspector';
import { RecordForm, type EditableRecord } from './RecordForm';
import { getDataSource, serverMode } from '../../data/source';
import { assertAdmin } from '../../domain/permissions';
const ClientImportDialog = lazy(() => import('./ClientImportDialog'));

export function RecordsPage({ module }: { module: 'flota' | 'clientes' }) {
  const actor = useActor(); const editable = actor.rol === 'Administrador'; const notify = useToast(state => state.notify);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('Todos');
  const [clientSection, setClientSection] = useState<ClientSection>('Resumen');
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<{ entity: EditableRecord; row?: EntityRecord; clientId?: string } | null>(null);
  const equipmentQuery = useRows('Equipo'); const clientQuery = useRows('Cliente');
  const equipments = equipmentQuery.rows; const clients = clientQuery.rows;
  const filtered = equipments.filter(row => normalize(`${row.codigo} ${row.marca} ${row.modelo} ${row.serie} ${row.id_interno_cliente ?? ''}`).includes(normalize(search)) && (status === 'Todos' || row.estado === status));
  const filteredClients = clients.filter(row => normalize(`${row.codigo} ${row.nombre} ${row.nombre_comercial ?? ''} ${row.nit ?? ''} ${row.ubicacion ?? ''} ${row.plus_code ?? ''}`).includes(normalize(search)) && (status === 'Todos' || row.estado === status));
  const selected = equipments.find(row => row.id === params.get('equipo'));
  const selectedClient = filteredClients.find(row => row.id === params.get('cliente')) ?? filteredClients[0];
  const open = (entity: EditableRecord, row?: EntityRecord, clientId?: string) => setEditing({ entity, row, clientId });
  const saved = (record: EntityRecord) => {
    if (editing?.entity === 'Cliente') { setSearch(''); setStatus('Todos'); setParams({ cliente: record.id }); setClientSection('Resumen'); }
    if (editing?.entity === 'Equipo' && module === 'flota') { setSearch(''); setStatus('Todos'); setParams({ equipo: record.id }); }
    setEditing(null);
  };
  const exportList = async (entity: 'Equipo' | 'Cliente', rows: EntityRecord[]) => {
    try { assertAdmin(actor); const ids = new Set(rows.map(row => row.id)); const allowedRows = await getDataSource().repository(entity, actor).export(row => ids.has(row.id)); const { exportRows } = await import('../../data/excel'); exportRows(entity, allowedRows, actor); }
    catch { notify('No se pudo descargar el archivo. Intenta de nuevo.'); }
  };
  const dialog = editing && editable ? <RecordForm key={`${editing.entity}-${editing.row?.id ?? 'new'}`} {...editing} onClose={() => setEditing(null)} onSaved={saved} /> : null;
  if (module === 'flota' && selected) return <><EquipmentDetail key={selected.id} equipment={selected} clients={clients} onBack={() => setParams({})} onEdit={editable ? () => open('Equipo', selected) : undefined} />{dialog}</>;
  return <><SectionTitle eyebrow="ESPACIO DE TRABAJO" title={module === 'flota' ? 'Flota de equipos' : 'Clientes'} description={module === 'flota' ? 'Registra tus equipos, asígnalos a un cliente y consulta su expediente.' : 'Encuentra una empresa y consulta su ficha sin salir de la lista.'}>
    {editable && (module === 'flota' ? <><button className="button" onClick={() => exportList('Equipo', filtered)}><Download size={16} />Exportar equipos</button><button className="button button-dark" onClick={() => open('Equipo')}><Plus size={17} />Nuevo equipo</button></> : <><a className="button" href="/templates/Plantilla-clientes-EMSA.xlsx" download><Download size={16} />Plantilla de clientes</a><button className="button client-import-trigger" onClick={() => setImporting(true)}><Upload size={16} />Importar clientes</button><button className="button" onClick={() => exportList('Cliente', filteredClients)}><Download size={16} />Exportar clientes</button><button className="button button-dark" onClick={() => open('Cliente')}><Plus size={17} />Nuevo cliente</button></>)}
  </SectionTitle>
  {module === 'flota' && <div className="capture-banner"><span className="capture-banner-icon"><Plus size={19} /></span><div><strong>{editable ? 'Altas y ediciones desde la web' : 'Consulta de registros'}</strong><p>{editable ? 'Usa Nuevo equipo. Marca, modelo, serie, tipo, propiedad y estado son obligatorios. Puedes dejar el horómetro pendiente.' : 'Administración puede agregar y editar clientes y equipos.'} {serverMode ? 'Los cambios se guardan en el servidor.' : 'Los cambios se guardan en este navegador.'}</p></div></div>}
  <ErrorNotice message={equipmentQuery.error || clientQuery.error} />
  {module === 'flota' ? <section className="panel"><div className="table-toolbar"><label className="search-box"><Search size={17} /><input placeholder="Buscar código, ID del cliente, marca, modelo o serie…" aria-label="Buscar equipo" value={search} onChange={event => setSearch(event.target.value)} /></label><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filtrar estado del equipo"><option>Todos</option>{equipmentStates.map(state => <option key={state}>{state}</option>)}</select><span className="subtle-label">{filtered.length} equipos</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Equipo</th><th>Tipo</th><th>Propiedad</th><th>Estado</th><th className="numeric">Horómetro</th><th>Acciones</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><button className="equipment-cell link-button" onClick={() => setParams({ equipo: row.id })}><EquipmentPhoto equipment={row} /><span><strong>{row.codigo}</strong><small>{row.marca} {row.modelo}</small>{row.id_interno_cliente && <small>ID cliente: {row.id_interno_cliente}</small>}</span></button></td><td>{row.tipo}</td><td>{row.propiedad}</td><td><Status value={String(row.estado)} /></td><td className="numeric mono">{formatHourMeter(row.horometro)}</td><td><div className="record-row-actions">{editable && <button className="icon-button" aria-label={`Editar ${row.codigo}`} onClick={() => open('Equipo', row)}><Pencil size={15} /></button>}<button className="icon-button" aria-label={`Ver ${row.codigo}`} onClick={() => setParams({ equipo: row.id })}><ArrowRight size={16} /></button></div></td></tr>)}</tbody></table>{!filtered.length && <EmptyState title={equipmentQuery.loading ? 'Cargando equipos…' : 'No encontramos equipos'} description="Agrega un equipo o prueba con otro filtro." />}</div></section>
    : <ClientDirectory clients={filteredClients} selected={selectedClient} equipments={equipments} loading={clientQuery.loading} equipmentLoading={equipmentQuery.loading} search={search} status={status} section={clientSection} onSearch={setSearch} onStatus={setStatus} onSelect={id => { setParams({ cliente: id }); setClientSection('Resumen'); }} onSectionChange={setClientSection} onEdit={open} />}
  {dialog}{editable && importing && <Suspense fallback={<p role="status">Preparando importación…</p>}><ClientImportDialog onClose={() => setImporting(false)} onImported={clientId => { setImporting(false); setSearch(''); setStatus('Todos'); setClientSection('Resumen'); if (clientId) setParams({ cliente: clientId }); }} /></Suspense>}</>;
}
