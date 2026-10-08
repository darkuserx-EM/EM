import { Search, X } from 'lucide-react';
import { clientDisplayName } from '../../domain/client-profile';
import { ClientLogo } from './ClientLogo';
import { serverMode } from '../../data/source';
import { EmptyState, Status } from '../../components/ui';
import type { EntityRecord } from '../../domain/model';
import { ClientInspector, type ClientSection } from './ClientInspector';
import type { EditableRecord } from './RecordForm';
import './client-directory.css';

export function ClientDirectory({ clients, selected, equipments, loading, equipmentLoading, search, status, section, onSearch, onStatus, onSelect, onSectionChange, onEdit }: {
  clients: EntityRecord[]; selected?: EntityRecord; equipments: EntityRecord[]; loading: boolean; equipmentLoading: boolean;
  search: string; status: string; section: ClientSection;
  onSearch: (search: string) => void; onStatus: (status: string) => void; onSelect: (id: string) => void;
  onSectionChange: (section: ClientSection) => void;
  onEdit: (entity: EditableRecord, row?: EntityRecord, clientId?: string) => void;
}) {
  return <div className="client-directory">
    <div className="client-directory-toolbar"><label className="search-box"><Search size={17} /><input aria-label="Buscar cliente" placeholder="Buscar empresa, NIT o ubicación…" value={search} onChange={event => onSearch(event.target.value)} />{search && <button className="icon-button" aria-label="Limpiar búsqueda" onClick={() => onSearch('')}><X size={14} /></button>}</label><select aria-label="Filtrar estado del cliente" value={status} onChange={event => onStatus(event.target.value)}><option value="Todos">Todos los estados</option><option>Activo</option><option>Prospecto</option><option>Inactivo</option></select></div>
    <div className="client-directory-layout"><aside className="client-directory-list" aria-label="Directorio de clientes"><div className="client-directory-caption"><span>DIRECTORIO</span><span>{loading ? 'Cargando…' : `${clients.length} ${clients.length === 1 ? 'empresa' : 'empresas'}`}</span></div>{clients.map(client => {
      const count = equipments.filter(equipment => equipment.cliente_id === client.id).length;
      return <button key={client.id} className="client-directory-item" aria-pressed={client.id === selected?.id} onClick={() => onSelect(client.id)}><span className="client-directory-item-top"><span className="client-directory-code">{client.codigo}</span><Status value={String(client.estado)} /></span><span className="client-directory-identity"><ClientLogo value={client.logo} name={clientDisplayName(client)} small /><span><strong>{clientDisplayName(client)}</strong>{client.nombre_comercial && <small>{client.nombre}</small>}</span></span><span className="client-directory-meta">{client.ubicacion || 'Ubicación por completar'}<span>·</span>{equipmentLoading ? '…' : `${count} ${count === 1 ? 'equipo' : 'equipos'}`}</span></button>;
    })}{!clients.length && <p className="client-directory-no-results">{loading ? 'Cargando clientes…' : 'Sin coincidencias'}</p>}</aside>
      {selected ? <ClientInspector key={selected.id} client={selected} equipments={equipments} equipmentLoading={equipmentLoading} section={section} onSectionChange={onSectionChange} onEdit={onEdit} /> : <div className="client-inspector client-inspector-empty"><EmptyState title={loading ? 'Cargando clientes…' : 'No encontramos clientes'} description={loading ? 'Preparando tu directorio.' : search || status !== 'Todos' ? 'Cambia la búsqueda o el estado para ver otros clientes.' : 'Empieza con Nuevo cliente para registrar una empresa.'} />{!loading && (search || status !== 'Todos') && <button className="button" onClick={() => { onSearch(''); onStatus('Todos'); }}>Limpiar filtros</button>}</div>}
    </div><p className="client-directory-note">{serverMode ? 'Los cambios se guardan en el servidor y se comparten entre dispositivos.' : 'Los cambios se guardan en este navegador.'}</p>
  </div>;
}
