import { select, selectQuery } from './sql.mjs';
import {orderDay,projectOperation} from './generated/domain.mjs';
/** @type {import("../src/domain/model.js").EntityName[]} */
export const operationalEntities=['Ticket','OrdenServicio','LecturaHorometro'];
/** @param {import("mysql2/promise").Pool} pool */
export async function ensureOperationIndex(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS em_operation_index (
    entity VARCHAR(40) COLLATE utf8mb4_bin NOT NULL,id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    client_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,equipment_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    technician_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,ticket_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,order_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    state TEXT NOT NULL,sort_value VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,day_value CHAR(10) COLLATE utf8mb4_bin NOT NULL,
    current_flag BOOLEAN NOT NULL,visible_client BOOLEAN NOT NULL,search_text LONGTEXT COLLATE utf8mb4_bin NOT NULL,search_public LONGTEXT COLLATE utf8mb4_bin NOT NULL,
    PRIMARY KEY(entity,id),INDEX idx_operation_sort(entity,sort_value,id),INDEX idx_operation_client(entity,client_id,sort_value,id),
    INDEX idx_operation_equipment(entity,equipment_id,sort_value,id),INDEX idx_operation_technician(entity,technician_id,sort_value,id),INDEX idx_operation_ticket(entity,ticket_id)
  ) ENGINE=InnoDB`);
}
/** @param {import("../src/domain/model.js").EntityRecord} row */
const searchable=row=>[row.codigo,row.orden_origen,row.titulo,row.sintoma,row.motivo,row.diagnostico].join(' ').toLocaleLowerCase('es');
/** @param {import("mysql2/promise").PoolConnection} conn @param {{entity:import("../src/domain/model.js").EntityName,row:import("../src/domain/model.js").EntityRecord}[]} entries */
export async function indexOperations(conn,entries) {
  if(!entries.length)return;
  const values=entries.map(({entity,row})=>[entity,row.id,String(row.cliente_id||''),String(row.equipo_id||''),String(row.tecnico_id||row.responsable_id||''),String(row.ticket_id||''),String(row.orden_id||''),String(row.estado||''),String(row.fecha||row.fecha_programada||row.fecha_creacion),orderDay(row),row.schema_operacion===1&&row.importado!==true,row.visible_cliente===true,searchable(row),searchable(projectOperation({id:'',nombre:'',rol:'Cliente'},entity,row))]);
  await conn.execute(`INSERT INTO em_operation_index (entity,id,client_id,equipment_id,technician_id,ticket_id,order_id,state,sort_value,day_value,current_flag,visible_client,search_text,search_public) VALUES ${values.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')} ON DUPLICATE KEY UPDATE client_id=VALUES(client_id),equipment_id=VALUES(equipment_id),technician_id=VALUES(technician_id),ticket_id=VALUES(ticket_id),order_id=VALUES(order_id),state=VALUES(state),sort_value=VALUES(sort_value),day_value=VALUES(day_value),current_flag=VALUES(current_flag),visible_client=VALUES(visible_client),search_text=VALUES(search_text),search_public=VALUES(search_public)`,values.flat());
}
/** @param {import("mysql2/promise").Pool} pool @param {{afterBatch?:()=>void|Promise<void>}} [options] */
export async function migrateOperationIndex(pool,{afterBatch}={}) {
  const conn=await pool.getConnection();
  try {
    /** @type {{schema_version:number}[]} */
    const version=await selectQuery(conn,'SELECT schema_version FROM em_meta WHERE id=1');if(Number(version[0].schema_version)>=10)return;
    // Projection only: original records are never changed or removed.
    for(const entity of operationalEntities) {
      let after='';
      while(true) {
        await conn.beginTransaction();await conn.query('SELECT revision FROM em_meta WHERE id=1 FOR UPDATE');
        /** @type {import("./contracts.js").StoredPayload[]} */
        const rows=await select(conn,'SELECT id,payload FROM em_records WHERE entity=? AND id>? ORDER BY id LIMIT 100',[entity,after]);
        await indexOperations(conn,rows.map(row=>({entity,row:JSON.parse(row.payload)})));await conn.commit();
        if(!rows.length)break;after=rows[rows.length-1].id;await afterBatch?.();
      }
    }
    await conn.beginTransaction();await conn.query('SELECT revision FROM em_meta WHERE id=1 FOR UPDATE');
    /** @type {{n:number}[]} */
    const missing=await selectQuery(conn,"SELECT COUNT(*) n FROM em_records r LEFT JOIN em_operation_index o ON o.entity=r.entity AND o.id=r.id WHERE r.entity IN ('Ticket','OrdenServicio','LecturaHorometro') AND o.id IS NULL");
    if(Number(missing[0].n))throw Error('Operational projection incomplete');
    await conn.query('UPDATE em_meta SET schema_version=GREATEST(schema_version,10) WHERE id=1');await conn.commit();
  } catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
