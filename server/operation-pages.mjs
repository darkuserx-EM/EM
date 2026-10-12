import {operationalEntities} from './operation-index.mjs';
import {projectOperation} from './generated/domain.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status,expose:true});
function scope(actor,entity) {
  const where=['o.entity=?'],args=[entity];
  if(actor.rol==='Cliente') {
    if(!actor.cliente_id)where.push('FALSE');
    else if(entity==='LecturaHorometro'){where.push("EXISTS (SELECT 1 FROM em_records eq WHERE eq.entity='Equipo' AND eq.id=o.equipment_id AND BINARY JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.cliente_id'))=BINARY ?)");args.push(actor.cliente_id);}
    else{where.push('o.client_id=?');args.push(actor.cliente_id);if(entity==='OrdenServicio')where.push('o.visible_client=TRUE');}
  } else if(actor.rol==='Técnico') {
    if(!actor.tecnico_id||entity==='Ticket')where.push('FALSE');
    else if(entity==='OrdenServicio'){where.push('o.technician_id=?');args.push(actor.tecnico_id);}
    else{where.push("EXISTS (SELECT 1 FROM em_operation_index assigned WHERE assigned.entity='OrdenServicio' AND assigned.equipment_id=o.equipment_id AND assigned.technician_id=?)");args.push(actor.tecnico_id);}
  } else if(!['Administrador','Coordinador'].includes(actor.rol))where.push('FALSE');
  return {where,args};
}
export async function operationPage(conn,actor,entity,query,revision) {
  if(!operationalEntities.includes(entity))throw fail(404,'Colección no disponible.');
  const pageSize=query.pageSize===undefined?25:Number(query.pageSize),requested=query.page===undefined?1:Number(query.page);
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>200||!Number.isSafeInteger(requested)||requested<1||requested>10000000)throw fail(400,'Página no válida.');
  for(const [key,value] of Object.entries(query))if(!['page','pageSize','token'].includes(key)&&(typeof value!=='string'||value.length>200))throw fail(400,'Filtro no válido.');
  for(const key of ['from','to'])if(query[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(query[key])||!Number.isFinite(Date.parse(query[key]))||new Date(query[key]).toISOString().slice(0,10)!==query[key]))throw fail(400,'Fecha no válida.');
  if(query.origin&&!['actual','historico'].includes(query.origin))throw fail(400,'Origen no válido.');
  const base=scope(actor,entity),where=[...base.where],args=[...base.args];
  const [groups]=await conn.execute(`SELECT state,current_flag,COUNT(*) n FROM em_operation_index o WHERE ${base.where.join(' AND ')} GROUP BY state,current_flag`,base.args);
  const counts={total:0,actual:0,historico:0,states:Object.create(null),actualStates:Object.create(null)},states=[];
  for(const row of groups){const n=Number(row.n);counts.total+=n;counts[row.current_flag?'actual':'historico']+=n;counts.states[row.state]=(counts.states[row.state]||0)+n;if(row.current_flag)counts.actualStates[row.state]=(counts.actualStates[row.state]||0)+n;if(row.state&&!states.includes(row.state))states.push(row.state);}
  for(const [key,column] of Object.entries({client:'client_id',equipment:'equipment_id',technician:'technician_id',id:'id',ticket:'ticket_id',order:'order_id'}))if(query[key]){where.push(`o.${column}=?`);args.push(query[key]);}
  if(query.state==='abiertas')where.push("o.current_flag=TRUE AND o.state NOT IN ('Completada','Cancelada')");
  else if(query.state){where.push('BINARY o.state=BINARY ?');args.push(query.state);}
  for(const [key,sign] of [['from','>='],['to','<=']])if(query[key]){where.push(`o.day_value<>'' AND o.day_value${sign}?`);args.push(query[key]);}
  if(query.origin)where.push(`o.current_flag=${query.origin==='actual'?'TRUE':'FALSE'}`);
  if(query.search?.trim()) {
    const text=query.search.trim().toLocaleLowerCase('es');
    where.push(`(LOCATE(?,o.${['Administrador','Coordinador'].includes(actor.rol)?'search_text':'search_public'})>0 OR EXISTS (SELECT 1 FROM em_records eq WHERE eq.entity='Equipo' AND eq.id=o.equipment_id AND LOCATE(?,LOWER(CONCAT_WS(' ',JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.codigo')),JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.id_interno_cliente')),JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.marca')),JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.modelo')),JSON_UNQUOTE(JSON_EXTRACT(eq.payload,'$.serie')))) COLLATE utf8mb4_bin)>0) OR EXISTS (SELECT 1 FROM em_records cl WHERE cl.entity='Cliente' AND cl.id=o.client_id AND LOCATE(?,LOWER(CONCAT_WS(' ',JSON_UNQUOTE(JSON_EXTRACT(cl.payload,'$.nombre')),JSON_UNQUOTE(JSON_EXTRACT(cl.payload,'$.nombre_comercial')))) COLLATE utf8mb4_bin)>0))`);args.push(text,text,text);
  }
  const clause=where.join(' AND ');
  const [totals]=await conn.execute(`SELECT COUNT(*) n FROM em_operation_index o WHERE ${clause}`,args),total=Number(totals[0].n),page=Math.min(requested,Math.max(1,Math.ceil(total/pageSize)));
  const [rows]=await conn.execute(`SELECT r.payload FROM em_operation_index o JOIN em_records r ON r.entity=o.entity AND r.id=o.id WHERE ${clause} ORDER BY o.sort_value DESC,o.id DESC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`,args);
  return {rows:rows.map(row=>projectOperation(actor,entity,JSON.parse(row.payload))),total,page,pageSize,revision,counts,states};
}
export function registerOperationPages(app,{pool,syncToken}) {
  app.get('/api/operations/:entity',async(req,res)=>{
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();const [meta]=await conn.query('SELECT revision FROM em_meta WHERE id=1'),revision=Number(meta[0].revision);
      if(req.query.token!==undefined&&req.query.token!==syncToken(revision,req.actor))throw fail(409,'Los datos cambiaron. Actualiza la consulta.');
      const result=await operationPage(conn,req.actor,req.params.entity,req.query,revision);await conn.commit();res.json(result);
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  });
}
