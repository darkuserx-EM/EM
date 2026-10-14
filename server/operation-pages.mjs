import { select, selectQuery } from './sql.mjs';
import { oneOf } from './guards.mjs';
import {operationalEntities} from './operation-index.mjs';
import {projectOperation} from './generated/domain.mjs';
/** @param {number} status @param {string} message */
const fail =(status,message)=>Object.assign(new Error(message),{status,expose:true});
/** @param {string} alias */
const teamScope = alias => `(${alias}.technician_id=? OR EXISTS (SELECT 1 FROM em_records team WHERE team.entity='OrdenServicio' AND team.id=${alias}.id AND (BINARY JSON_UNQUOTE(JSON_EXTRACT(team.payload,'$.tecnico_apoyo_1_id'))=BINARY ? OR BINARY JSON_UNQUOTE(JSON_EXTRACT(team.payload,'$.tecnico_apoyo_2_id'))=BINARY ?)))`;
/** @param {import("../src/domain/model.js").Actor} actor @param {import("../src/domain/model.js").EntityName} entity */
function scope(actor,entity) {
  /** @type {string[]} */
  const args=[entity];const where=['o.entity=?'];
  if(actor.rol==='Cliente') {
    if(!actor.cliente_id)where.push('FALSE');
    else if(entity==='LecturaHorometro'){where.push("EXISTS (SELECT 1 FROM em_records eq WHERE eq.entity='Equipo' AND eq.id=o.equipment_id AND BINARY JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.cliente_id'))=BINARY ?)");args.push(actor.cliente_id);}
    else{where.push('o.client_id=?');args.push(actor.cliente_id);if(entity==='OrdenServicio')where.push('o.visible_client=TRUE');}
  } else if(actor.rol==='Técnico') {
    if(!actor.tecnico_id)where.push('FALSE');
    else if(entity==='OrdenServicio'){where.push(teamScope('o'));args.push(actor.tecnico_id,actor.tecnico_id,actor.tecnico_id);}
    // The legacy shared index can contain tecnico_id on a ticket. Only the
    // ticket's actual responsable_id authorizes reading it, including old data.
    else if(entity==='Ticket'){where.push("EXISTS (SELECT 1 FROM em_records assigned_ticket WHERE assigned_ticket.entity='Ticket' AND assigned_ticket.id=o.id AND BINARY JSON_UNQUOTE(JSON_EXTRACT(assigned_ticket.payload,'$.responsable_id'))=BINARY ?)");args.push(actor.tecnico_id);}
    else{where.push(`EXISTS (SELECT 1 FROM em_operation_index assigned WHERE assigned.entity='OrdenServicio' AND assigned.equipment_id=o.equipment_id AND ${teamScope('assigned')})`);args.push(actor.tecnico_id,actor.tecnico_id,actor.tecnico_id);}
  } else if(!['Administrador','Coordinador'].includes(actor.rol))where.push('FALSE');
  return {where,args};
}
/** @param {import("mysql2/promise").PoolConnection} conn @param {import("../src/domain/model.js").Actor} actor @param {string} entity @param {Record<string,unknown>} query @param {number} revision @returns {Promise<import("../src/data/operation-page.js").OperationPage>} */
export async function operationPage(conn,actor,entity,query,revision) {
  if(!oneOf(operationalEntities,entity))throw fail(404,'Colección no disponible.');
  const pageSize=query.pageSize===undefined?25:Number(query.pageSize),requested=query.page===undefined?1:Number(query.page);
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>200||!Number.isSafeInteger(requested)||requested<1||requested>10000000)throw fail(400,'Página no válida.');
  /** @type {Record<string,string>} */
  const filters={};
  for(const [key,value] of Object.entries(query))if(!['page','pageSize','token'].includes(key)){if(typeof value!=='string'||value.length>200)throw fail(400,'Filtro no válido.');filters[key]=value;}
  for(const key of ['from','to'])if(filters[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(filters[key])||!Number.isFinite(Date.parse(filters[key]))||new Date(filters[key]).toISOString().slice(0,10)!==filters[key]))throw fail(400,'Fecha no válida.');
  if(filters.origin&&!['actual','historico'].includes(filters.origin))throw fail(400,'Origen no válido.');
  const base=scope(actor,entity),where=[...base.where],args=[...base.args];

/** @type {{state:string,current_flag:number,n:number}[]} */
    const groups = await select(conn,`SELECT state,current_flag,COUNT(*) n FROM em_operation_index o WHERE ${base.where.join(' AND ')} GROUP BY state,current_flag`,base.args);
  /** @type {{total:number,actual:number,historico:number,states:Record<string,number>,actualStates:Record<string,number>}} */
  const counts={total:0,actual:0,historico:0,states:Object.create(null),actualStates:Object.create(null)};
  /** @type {string[]} */
  const states=[];
  for(const row of groups){const n=Number(row.n);counts.total+=n;counts[row.current_flag?'actual':'historico']+=n;counts.states[row.state]=(counts.states[row.state]||0)+n;if(row.current_flag)counts.actualStates[row.state]=(counts.actualStates[row.state]||0)+n;if(row.state&&!states.includes(row.state))states.push(row.state);}
  for(const [key,column] of Object.entries({client:'client_id',equipment:'equipment_id',technician:'technician_id',id:'id',ticket:'ticket_id',order:'order_id'}))if(filters[key]){if(key==='technician' && entity==='OrdenServicio'){where.push(teamScope('o'));args.push(filters[key],filters[key],filters[key]);}else{where.push(`o.${column}=?`);args.push(filters[key]);}}
  if(filters.state==='abiertas')where.push("o.current_flag=TRUE AND o.state NOT IN ('Completada','Cancelada')");
  else if(filters.state){where.push('BINARY o.state=BINARY ?');args.push(filters.state);}
  for(const [key,sign] of [['from','>='],['to','<=']])if(filters[key]){where.push(`o.day_value<>'' AND o.day_value${sign}?`);args.push(filters[key]);}
  if(filters.origin)where.push(`o.current_flag=${filters.origin==='actual'?'TRUE':'FALSE'}`);
  if(filters.search?.trim()) {
    const text=filters.search.trim().toLocaleLowerCase('es');
    where.push(`(LOCATE(?,o.${['Administrador','Coordinador'].includes(actor.rol)?'search_text':'search_public'})>0 OR EXISTS (SELECT 1 FROM em_records eq WHERE eq.entity='Equipo' AND eq.id=o.equipment_id AND LOCATE(?,LOWER(CONCAT_WS(' ',JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.codigo')),JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.id_interno_cliente')),JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.marca')),JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.modelo')),JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.serie')))) COLLATE utf8mb4_bin)>0) OR EXISTS (SELECT 1 FROM em_records cl WHERE cl.entity='Cliente' AND cl.id=o.client_id AND LOCATE(?,LOWER(CONCAT_WS(' ',JSON_UNQUOTE(JSON_EXTRACT(cl.payload,'$.nombre')),JSON_UNQUOTE(JSON_EXTRACT(cl.payload,'$.nombre_comercial')))) COLLATE utf8mb4_bin)>0))`);args.push(text,text,text);
  }
  const clause=where.join(' AND ');

/** @type {{n:number}[]} */
    const totals = await select(conn,`SELECT COUNT(*) n FROM em_operation_index o WHERE ${clause}`,args),total=Number(totals[0].n),page=Math.min(requested,Math.max(1,Math.ceil(total/pageSize)));

  // Only a boolean crosses the access boundary; the linked order keeps its own scope.
  const relation=entity==='Ticket'?", (o.order_id<>'' OR EXISTS (SELECT 1 FROM em_operation_index linked WHERE linked.entity='OrdenServicio' AND linked.ticket_id=o.id)) AS has_order":'';
/** @type {{payload:string,has_order?:number}[]} */
    const rows = await select(conn,`SELECT r.payload${relation} FROM em_operation_index o JOIN em_records r ON r.entity=o.entity AND r.id=o.id WHERE ${clause} ORDER BY o.sort_value DESC,o.id DESC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`,args);
  return {rows:rows.map(row=>projectOperation(actor,entity,{...JSON.parse(row.payload),...(entity==='Ticket'?{tiene_orden:!!row.has_order}:{})})),total,page,pageSize,revision,counts,states};
}
/** @param {import("express").Express} app @param {{pool:import("mysql2/promise").Pool,syncToken:(revision:number,actor:import("../src/domain/model.js").Actor)=>string}} options */
export function registerOperationPages(app,{pool,syncToken}) {
  app.get('/api/operations/:entity',/** @param {import("./http-contracts.js").PortalRequest<unknown>} req @param {import("./http-contracts.js").PortalResponse<import("../src/data/operation-page.js").OperationPage>} res */ async (req,res)=>{
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
/** @type {{revision:number}[]} */
    const meta = await selectQuery(conn,'SELECT revision FROM em_meta WHERE id=1'),revision=Number(meta[0].revision);
      if(req.query.token!==undefined&&req.query.token!==syncToken(revision,req.actor))throw fail(409,'Los datos cambiaron. Actualiza la consulta.');
      const result=await operationPage(conn,req.actor,req.params.entity,req.query,revision);await conn.commit();res.json(result);
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  });
}
