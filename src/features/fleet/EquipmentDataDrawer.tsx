import { Modal, ErrorNotice } from '../../components/ui';
import type { EntityRecord, Scalar } from '../../domain/model';
import { equipmentSpecificationDetails } from '../../domain/equipment-specifications';

type Detail = [string, Scalar | undefined];

function DataGroup({ title, details }: { title: string; details: Detail[] }) {
  const present = details.filter(([, value]) => value !== undefined && value !== null && value !== '');
  return <section className="equipment-data-group"><h3>{title}</h3>{present.length ? <dl>{present.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>Sin información registrada.</p>}</section>;
}

export function EquipmentDataDrawer({ equipment, client, site, siteError, sitesReady, onClose }: {
  equipment: EntityRecord; client?: EntityRecord; site?: EntityRecord;
  siteError: string; sitesReady: boolean; onClose: () => void;
}) {
  return <Modal title="Datos del equipo" className="equipment-data-drawer" onClose={onClose}>
    <div className="equipment-data-scroll" role="region" aria-label="Información técnica y ubicación del equipo" tabIndex={0}>
      <p className="equipment-data-identity">{equipment.marca} {equipment.modelo} · {equipment.codigo}</p>
      <DataGroup title="Identificación" details={[
        ['Código EMSA', equipment.codigo], ['ID interno del cliente', equipment.id_interno_cliente],
        ['Número de serie', equipment.serie], ['Propiedad', equipment.propiedad], ['Año', equipment.anio],
      ]} />
      <section className="equipment-data-location">
        <ErrorNotice message={siteError} />
        {!sitesReady && !siteError && <p role="status">Cargando sede…</p>}
        <DataGroup title="Cliente y ubicación" details={[
          ['Cliente asignado', client?.nombre_comercial || client?.nombre || 'Sin asignación'],
          ['Sede', site?.nombre],
          ['Ubicación de referencia', site?.direccion || client?.ubicacion || (!equipment.cliente_id ? 'Patio EMSA' : undefined)],
          ['Referencia de ubicación / Plus Code', site?.referencia_ubicacion],
        ]} />
      </section>
      <DataGroup title="Especificaciones técnicas" details={equipmentSpecificationDetails(equipment)} />
      <DataGroup title="Observaciones" details={equipment.notas ? [['Notas del equipo', equipment.notas]] : []} />
    </div>
  </Modal>;
}
