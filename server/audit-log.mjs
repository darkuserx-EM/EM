import { select } from './sql.mjs';
/** @param {string} message */
const fail = message => Object.assign(new Error(message), {status:400,expose:true});
/** @param {{created_at:string|number,id:string}} row */
const encode = row => Buffer.from(JSON.stringify([row.created_at,row.id])).toString('base64url');
/** @param {Record<string,unknown>} query @param {number} maximum */
function page(query, maximum) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw fail('El tamaño de la página no es válido.');
  /** @type {[string|number,string]|undefined} */
  let cursor;
  if (query.cursor !== undefined) {
    /** @type {unknown} */
    let parsed;
    try { if (typeof query.cursor !== 'string' || query.cursor.length > 600) throw Error(); parsed = JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')); }
    catch { throw fail('El cursor no es válido.'); }
    if (!Array.isArray(parsed) || parsed.length !== 2 || (typeof parsed[0]!=='string'&&typeof parsed[0]!=='number') || typeof parsed[1] !== 'string' || parsed[1].length > 128) throw fail('El cursor no es válido.');
    cursor=[parsed[0],parsed[1]];
  }
  return {limit,cursor};
}
/** @param {import("express").Express} app @param {import("mysql2/promise").Pool} pool */
export function registerAuditRoutes(app, pool) {
  /** @type {import("./http-contracts.js").PortalMiddleware} */
  const admin = (req,_res,next) => { if (req.actor.rol !== 'Administrador') throw Object.assign(new Error('Solo administración puede consultar el historial.'),{status:403,expose:true}); return next(); };
  app.get('/api/audit-log', admin, /** @param {import("./http-contracts.js").PortalRequest<unknown>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").AuditReply<import("../src/domain/model.js").EntityRecord>>} res */ async (req,res)=> {
    const {limit,cursor} = page(req.query,200), where = [];
    /** @type {(string|number)[]} */
    const args = [];
    for (const [param,column] of Object.entries({entity:'entity',equipo_id:'equipment_id',hallazgo_id:'finding_id',action:'action'})) if (req.query[param] !== undefined) {
      if (typeof req.query[param] !== 'string' || !req.query[param] || req.query[param].length > 128) throw fail('Filtro de historial no válido.');
      where.push(`a.${column}=?`); args.push(req.query[param]);
    }
    for (const key of ['from','to']) if (req.query[key] !== undefined) {
      const day=req.query[key]; if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10)!==day) throw fail('Fecha de historial no válida.');
      where.push(`a.created_at ${key==='from'?'>=':'<'} ?`);
      args.push(new Date(Date.parse(day+'T06:00:00Z')+(key==='to'?86400000:0)).toISOString());
    }
    if (cursor) { where.push('(a.created_at<? OR (a.created_at=? AND a.id<?))'); args.push(cursor[0],cursor[0],cursor[1]); }

/** @type {{id:string,created_at:string,payload:string}[]} */
    const rows = await select(pool,`SELECT a.id,a.created_at,a.payload FROM em_audit_log a ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY a.created_at DESC,a.id DESC LIMIT ${limit+1}`,args);
    const selected=rows.slice(0,limit);
    res.json({rows:selected.map(row=>JSON.parse(row.payload)),nextCursor:rows.length>limit?encode(selected[selected.length-1]):null});
  });
  app.get('/api/admin/security-events', admin, /** @param {import("./http-contracts.js").PortalRequest<unknown>} req @param {import("./http-contracts.js").PortalResponse<import("./http-contracts.js").AuditReply<import("./contracts.js").SecurityEventRow>>} res */ async (req,res)=> {
    const {limit,cursor}=page(req.query,100);
    if (cursor && (typeof cursor[0]!=='number' || !Number.isSafeInteger(cursor[0]) || cursor[0]<0)) throw fail('El cursor no es válido.');

/** @type {import("./contracts.js").SecurityEventRow[]} */
    const rows = await select(pool,`SELECT e.*,a.name AS actor_name,a.email AS actor_email,t.name AS target_name,t.email AS target_email FROM em_security_events e LEFT JOIN em_users a ON a.id=e.actor_id LEFT JOIN em_users t ON t.id=e.target_id ${cursor?'WHERE (e.created_at<? OR (e.created_at=? AND e.id<?))':''} ORDER BY e.created_at DESC,e.id DESC LIMIT ${limit+1}`,cursor?[cursor[0],cursor[0],cursor[1]]:[]);
    const selected=rows.slice(0,limit).map(row=>({...row,created_at:Number(row.created_at)}));
    res.json({rows:selected,nextCursor:rows.length>limit?encode(selected[selected.length-1]):null});
  });
}
