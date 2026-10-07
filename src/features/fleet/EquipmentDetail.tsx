import { useState } from 'react';
import { assertAdmin } from '../../domain/permissions';
import { ArrowLeft, ChevronDown, Download, Gauge, MapPin, Wrench, Clock3, Package, SlidersHorizontal, TrendingUp, Pencil } from 'lucide-react';
import { useActor, useRows, useToast } from '../../app/state';
import { EmptyState, ErrorNotice, Status } from '../../components/ui';
import { equipmentHistory, type UsageReading } from '../../domain/equipment-history';
import { formatDate, formatMoney, formatNumber, formatTime } from '../../domain/format';
import type { EntityRecord } from '../../domain/model';
import { equipmentSpecificationDetails } from '../../domain/equipment-specifications';
import { getDataSource, serverMode } from '../../data/source';
import { EquipmentPhoto, EquipmentImageGallery } from '../records/EquipmentImages';

function MeterChart({ readings, equipment }: { readings: UsageReading[]; equipment: EntityRecord }) {
  if (readings.length < 2) return <EmptyState illustration={<EquipmentPhoto equipment={equipment} large />} title="Faltan lecturas para comparar" description="Selecciona un período con al menos dos lecturas para ver la evolución del horómetro." />;
  const values = readings.map(item => Number(item.row.valor));
  const dates = readings.map(item => Date.parse(String(item.row.fecha)));
  const low = Math.min(...values); const high = Math.max(...values); const span = Math.max(high - low, 1);
  const first = dates[0]; const duration = Math.max(dates.at(-1)! - first, 1);
  const points = readings.map((item, i) => ({ x: 58 + ((dates[i] - first) / duration) * 614, y: 177 - ((Number(item.row.valor) - low) / span) * 139, row: item.row }));
  return <svg className="meter-chart" viewBox="0 0 710 220" role="img" aria-label={`Evolución del horómetro: ${formatNumber(values[0])} a ${formatNumber(values.at(-1)!)} horas. Detalle en la tabla de lecturas.`}>
    {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="58" y1={177 - fraction * 139} x2="672" y2={177 - fraction * 139} stroke="#e1e6dc" strokeDasharray="4 5" /><text x="46" y={181 - fraction * 139} textAnchor="end">{formatNumber(Math.round(low + span * fraction))}</text></g>)}
    <polygon points={`58,177 ${points.map(point => `${point.x},${point.y}`).join(' ')} 672,177`} fill="#e7eddf" />
    <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#687d53" strokeWidth="2.5" strokeLinejoin="round" />
    {points.map(point => <circle key={point.row.id} cx={point.x} cy={point.y} r="4" fill="#fff" stroke="#687d53" strokeWidth="2"><title>{formatDate(String(point.row.fecha))}: {formatNumber(Number(point.row.valor))} h</title></circle>)}
    <text x="58" y="207">{formatDate(String(readings[0].row.fecha))}</text><text x="672" y="207" textAnchor="end">{formatDate(String(readings.at(-1)!.row.fecha))}</text>
  </svg>;
}

export function EquipmentDetail({ equipment, clients, onBack, onEdit }: { equipment: EntityRecord; clients: EntityRecord[]; onBack: () => void; onEdit?: () => void }) {
  const sites = useRows('Sede');
  const actor = useActor(); const notify = useToast(state => state.notify);
  const services = useRows('OrdenServicio'); const readings = useRows('LecturaHorometro'); const parts = useRows('OTRepuesto'); const labor = useRows('OTHoras'); const technicians = useRows('Tecnico');
  const [view, setView] = useState<'repairs' | 'usage'>('repairs');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [exporting, setExporting] = useState(false);
  const invalidRange = !!from && !!to && from > to;
  const history = equipmentHistory(equipment.id, services.rows, readings.rows, parts.rows, labor.rows, from, to);
  const latest = equipmentHistory(equipment.id, [], readings.rows, [], []).usage.at(-1)?.row;
  const admin = actor.rol === 'Administrador';
  const loading = [services, readings, parts, labor, technicians].some(result => result.loading);
  const error = [services, readings, parts, labor, technicians].find(result => result.error)?.error ?? '';
  const client = clients.find(row => row.id === equipment.cliente_id);
  const site = sites.rows.find(row => row.id === equipment.sede_id);
  const totalCost = history.repairs.reduce((sum, row) => sum + Number(row.costo_repuestos || 0) + Number(row.costo_mano_obra || 0), 0);
  const totalLabor = history.labor.reduce((sum, row) => sum + Number(row.horas || 0), 0);
  const exportHistory = async () => {
    setExporting(true);
    try { assertAdmin(actor); const { downloadWorkbook, makeEquipmentHistoryWorkbook } = await import('../../data/excel'); const [exported] = await getDataSource().repository('Equipo',actor).export(row => row.id === equipment.id); if (!exported) throw new Error('El equipo ya no está disponible.'); downloadWorkbook(makeEquipmentHistoryWorkbook(exported, history, from, to), `Portal-EM-${equipment.codigo}-historial.xlsx`); }
    catch (cause) { notify(`No se pudo exportar el historial: ${cause instanceof Error ? cause.message : 'intenta nuevamente'}`); }
    finally { setExporting(false); }
  };
  return <div className="equipment-detail">
    <div className="history-back-row"><button className="history-back" onClick={onBack}><ArrowLeft size={16} />Volver a la flota</button><span>FICHA DEL EQUIPO</span></div>
    <header className="equipment-heading"><div className="equipment-title"><EquipmentPhoto equipment={equipment} large /><div><div className="eyebrow">{equipment.codigo} · {equipment.propiedad}</div><h1>{equipment.marca} {equipment.modelo}</h1><p>{equipment.tipo} <span>·</span> Serie {equipment.serie}</p></div></div><div className="equipment-heading-actions">{onEdit && <button className="button button-dark" onClick={onEdit}><Pencil size={15} />Editar equipo</button>}<Status value={String(equipment.estado)} />{admin && <button className="button" onClick={exportHistory} disabled={exporting || loading || invalidRange || !!error}><Download size={15} />{exporting ? 'Preparando…' : 'Exportar historial'}</button>}</div></header>
    <div className="history-demo-note">{!serverMode && <span className="plain-tag">DATOS FICTICIOS</span>}<p>La ficha se puede editar. Los servicios y las firmas se habilitarán en sus etapas.</p></div>
    <div className="history-layout"><div className="history-main"><EquipmentImageGallery equipment={equipment} />
      <div className="history-switch" aria-label="Historial del equipo"><button aria-pressed={view === 'repairs'} onClick={() => setView('repairs')}><Wrench size={17} />Reparaciones y servicios</button><button aria-pressed={view === 'usage'} onClick={() => setView('usage')}><Gauge size={17} />Uso y horómetro</button></div>
      <div className="history-filters"><SlidersHorizontal size={16} aria-hidden="true" /><label>Desde<input type="date" value={from} onInput={event => setFrom(event.currentTarget.value)} /></label><label>Hasta<input type="date" value={to} onInput={event => setTo(event.currentTarget.value)} /></label>{(from || to) ? <button className="history-clear" onClick={() => { setFrom(''); setTo(''); }}>Quitar filtros</button> : <span className="history-range-label">Todo el historial</span>}</div>
      <ErrorNotice message={invalidRange ? 'La fecha Desde debe ser anterior o igual a Hasta.' : error} />
      {loading ? <p className="history-loading" role="status">Cargando historial…</p> : !invalidRange && !error && <>
        <div className="history-metrics"><div><span>Servicios en el período</span><strong>{history.repairs.length.toString().padStart(2, '0')}</strong><small>{history.repairs.filter(row => row.tipo === 'Correctivo').length} correctivos · {history.repairs.filter(row => row.tipo === 'Preventivo').length} preventivos</small></div><div><span>Uso entre lecturas seleccionadas</span><strong>{history.hoursUsed === null ? '—' : formatNumber(history.hoursUsed)} <em>h</em></strong><small>{history.usage.length >= 2 ? `${formatDate(String(history.usage[0].row.fecha))} → ${formatDate(String(history.usage.at(-1)!.row.fecha))}` : 'Se necesitan dos lecturas comparables'}</small></div><div><span>Mano de obra registrada</span><strong>{formatNumber(totalLabor)} <em>h</em></strong><small>Tiempo de atención de los técnicos</small></div></div>
        {view === 'repairs' ? <section aria-label="Reparaciones y servicios del equipo"><div className="history-section-heading"><div><h2>Todo lo que se ha hecho</h2><p>Diagnósticos, trabajos y repuestos, en un solo lugar.</p></div><span>{history.repairs.length} registros</span></div>
          {history.repairs.length ? <div className="repair-list">{history.repairs.map((repair, index) => {
            const usedParts = history.parts.filter(row => row.orden_id === repair.id); const usedLabor = history.labor.filter(row => row.orden_id === repair.id);
            const technician = technicians.rows.find(row => row.id === repair.tecnico_id);
            return <details className="repair-card" key={repair.id} open={index === 0}>
              <summary><span className={`repair-kind ${repair.tipo === 'Correctivo' ? 'corrective' : ''}`}><Wrench size={18} /></span><span className="repair-summary"><span className="repair-meta">{formatDate(String(repair.fecha))}<span>·</span>{repair.codigo}<span>·</span>{repair.tipo}</span><strong>{repair.motivo}</strong><span className="repair-subtitle">{technician?.nombre ?? 'Técnico no registrado'}<span>·</span>{formatNumber(Number(repair.horometro))} h de horómetro</span></span><ChevronDown size={18} className="repair-chevron" /></summary>
              <div className="repair-body"><div className="repair-status-line"><Status value={String(repair.estado)} /><span><MapPin size={13} />{repair.ubicacion}</span></div><div className="repair-description"><div><h3>Diagnóstico</h3><p>{repair.diagnostico || 'Sin diagnóstico registrado.'}</p></div><div><h3>Trabajo realizado</h3><p>{repair.trabajo || 'Sin trabajo registrado.'}</p></div></div>
                <div className="repair-resources"><div><h3><Package size={14} />Repuestos y materiales</h3>{usedParts.length ? <ul>{usedParts.map(part => <li key={part.id}><span>{part.descripcion}</span><strong>× {formatNumber(Number(part.cantidad))}</strong></li>)}</ul> : <p>Sin repuestos registrados.</p>}</div><div><h3><Clock3 size={14} />Mano de obra</h3>{usedLabor.length ? <ul>{usedLabor.map(row => <li key={row.id}><span>{technicians.rows.find(tech => tech.id === row.tecnico_id)?.nombre ?? 'Técnico'}</span><strong>{formatNumber(Number(row.horas))} h</strong></li>)}</ul> : <p>Sin horas registradas.</p>}</div></div>
                {admin && <div className="repair-cost"><span>Costo interno registrado</span><span>Repuestos {formatMoney(Number(repair.costo_repuestos || 0))} <span>·</span> Mano de obra {formatMoney(Number(repair.costo_mano_obra || 0))}</span><strong>{formatMoney(Number(repair.costo_repuestos || 0) + Number(repair.costo_mano_obra || 0))}</strong></div>}
              </div>
            </details>;
          })}</div> : <div className="panel"><EmptyState illustration={<EquipmentPhoto equipment={equipment} large />} title={from || to ? "Sin servicios en este período" : "Aún no hay servicios registrados"} description={from || to ? "Cambia las fechas para consultar otros registros de este equipo." : "Las reparaciones y servicios de este equipo aparecerán aquí cuando se registren."} /></div>}
        </section> : <section aria-label="Uso y horómetro del equipo"><div className="history-section-heading"><div><h2>Así se ha utilizado el equipo</h2><p>La evolución de sus horas acumuladas de operación.</p></div><TrendingUp size={20} /></div>
          <div className="panel meter-panel"><div className="meter-heading"><h3>Horómetro acumulado <span>· horas</span></h3><span>{history.usage.length} lecturas</span></div><MeterChart readings={history.usage} equipment={equipment} /><p className="meter-note">El uso corresponde a la diferencia entre lecturas. No hay medición de turnos, días sin lectura ni disponibilidad entre lecturas.</p></div>
          {history.usage.length ? <div className="panel reading-panel"><div className="reading-heading"><h3>Bitácora de lecturas</h3><span>Más recientes primero</span></div><div className="table-scroll reading-scroll"><table className="data-table reading-table"><thead><tr><th>Fecha / origen</th><th className="numeric">Horómetro</th><th className="numeric">Uso desde lectura anterior</th><th>Registrado por / ubicación</th></tr></thead><tbody>{[...history.usage].reverse().map(({ row, previous, delta }) => <tr key={row.id}><td><strong>{formatDate(String(row.fecha))} <small>{formatTime(String(row.fecha))}</small></strong><small>{row.origen}{row.orden_id ? ` · ${services.rows.find(order => order.id === row.orden_id)?.codigo ?? 'OT'}` : ''}</small></td><td className="numeric mono">{formatNumber(Number(row.valor))} h</td><td className="numeric mono"><strong>{delta === null ? '—' : `+${formatNumber(delta)} h`}</strong><small>{previous ? delta === null ? 'Lectura a revisar' : `Desde ${formatDate(String(previous.fecha))}` : 'Primera lectura'}</small></td><td>{row.registrado_por}<small>{row.ubicacion}</small></td></tr>)}</tbody></table></div></div> : <div className="panel"><EmptyState illustration={<EquipmentPhoto equipment={equipment} large />} title="Sin lecturas en este período" description="Selecciona otras fechas para consultar el horómetro de este equipo." /></div>}
        </section>}
      </>}
    </div><aside className="history-aside"><section className="panel equipment-meter-card"><Gauge size={22} /><p>Horómetro actual</p><strong>{formatNumber(Number(equipment.horometro))}<span> h</span></strong><small>{latest ? `Última lectura · ${formatDate(String(latest.fecha))}` : 'Sin fecha de lectura registrada'}</small></section><section className="panel equipment-data-card"><h2>Datos del equipo</h2><dl>{[['Código interno', equipment.codigo], ['Número de serie', equipment.serie], ['Propiedad', equipment.propiedad], ['Cliente asignado', client?.nombre_comercial || client?.nombre || 'Sin asignación'], ['Sede', site?.nombre], ['Ubicación de referencia', site?.direccion || client?.ubicacion || 'Patio EMSA'], ['Referencia de ubicación', site?.referencia_ubicacion], ['Año', equipment.anio], ...equipmentSpecificationDetails(equipment), ['Observaciones', equipment.notas]].filter(pair => pair[1] !== undefined && pair[1] !== null && pair[1] !== '').map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>{admin && !invalidRange && !loading && !error && <section className="panel equipment-cost-card"><span>Costos del período</span><strong>{formatMoney(totalCost)}</strong><p>Repuestos y mano de obra registrados. Importes visibles para administración.</p></section>}<p className="history-next-note">Este expediente crecerá con las órdenes de servicio, checklists y lecturas capturadas en las siguientes etapas.</p></aside></div>
  </div>;
}
