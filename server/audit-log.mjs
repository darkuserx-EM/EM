const fail = message => Object.assign(new Error(message), {status:400,expose:true});
const encode = row => Buffer.from(JSON.stringify([row.created_at,row.id])).toString('base64url');
function page(query, maximum) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw fail('El tamaño de la página no es válido.');
  let cursor;
  if (query.cursor !== undefined) {
    try { if (typeof query.cursor !== 'string' || query.cursor.length > 600) throw Error(); cursor = JSON.parse(Buffer.from(query.cursor,'base64url')); }
    catch { throw fail('El cursor no es válido.'); }
    if (!Array.isArray(cursor) || cursor.length !== 2 || !['string','number'].includes(typeof cursor[0]) || typeof cursor[1] !== 'string' || cursor[1].length > 128) throw fail('El cursor no es válido.');
  }
  return {limit,cursor};
}
export function registerAuditRoutes(app, pool) {
  const admin = (req,_res,next) => { if (req.actor.rol !== 'Administrador') throw Object.assign(new Error('Solo administración puede consultar el historial.'),{status:403,expose:true}); next(); };
  app.get('/api/audit-log', admin, async (req,res) => {
    const {limit,cursor} = page(req.query,200), where = [], args = [];
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
    const [rows] = await pool.execute(`SELECT a.id,a.created_at,a.payload FROM em_audit_log a ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY a.created_at DESC,a.id DESC LIMIT ${limit+1}`,args);
    const selected=rows.slice(0,limit);
    res.json({rows:selected.map(row=>JSON.parse(row.payload)),nextCursor:rows.length>limit?encode(selected.at(-1)):null});
  });
  app.get('/api/admin/security-events', admin, async (req,res) => {
    const {limit,cursor}=page(req.query,100);
    if (cursor && (!Number.isSafeInteger(cursor[0]) || cursor[0]<0)) throw fail('El cursor no es válido.');
    const [rows]=await pool.execute(`SELECT e.*,a.name AS actor_name,a.email AS actor_email,t.name AS target_name,t.email AS target_email FROM em_security_events e LEFT JOIN em_users a ON a.id=e.actor_id LEFT JOIN em_users t ON t.id=e.target_id ${cursor?'WHERE (e.created_at<? OR (e.created_at=? AND e.id<?))':''} ORDER BY e.created_at DESC,e.id DESC LIMIT ${limit+1}`,cursor?[cursor[0],cursor[0],cursor[1]]:[]);
    const selected=rows.slice(0,limit).map(row=>({...row,created_at:Number(row.created_at)}));
    res.json({rows:selected,nextCursor:rows.length>limit?encode(selected.at(-1)):null});
  });
}
