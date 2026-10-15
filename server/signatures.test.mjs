import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import { registerAttachmentRoutes } from './attachments.mjs';
import { validateRestoreFile } from './attachment-backup.mjs';
import { registerSignatureRoutes, SIGNATURE_MAX_BYTES, SIGNATURES_PER_ORDER } from './signatures.mjs';

const png = (width, height) => sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
const base = { cliente_id: 'client-a', equipo_id: 'equipment-a', tecnico_id: 'tech-a', schema_operacion: 1, visible_cliente: true };
const orders = () => [
  { ...base, id: 'order-open', codigo: 'OS-1', estado: 'En proceso' },
  { ...base, id: 'order-closed', codigo: 'OS-2', estado: 'Completada' },
  { ...base, id: 'order-cancelled', codigo: 'OS-3', estado: 'Cancelada' },
  { ...base, id: 'order-private', codigo: 'OS-4', estado: 'En proceso', visible_cliente: false },
  { ...base, id: 'order-imported', codigo: 'OS-5', estado: 'Completada', importado: true, schema_operacion: undefined },
];

/** Base en memoria con las consultas que usan las rutas de firma y de adjuntos. */
function memory() {
  const records = orders(), files = [], audit = [], users = new Map([['user-tech', 'Técnico de prueba'], ['user-coord', 'Coordinación de prueba']]);
  const fake = {
    async execute(sql, args = []) {
      if (sql.startsWith("SELECT payload FROM em_records WHERE entity='OrdenServicio'")) return [records.filter(row => row.id === args[0]).map(row => ({ payload: JSON.stringify(row) }))];
      if (sql.startsWith('SELECT a.id,a.name,a.created_at,u.name AS captured_by')) {
        const latest = files.filter(file => file.order_id === args[0] && file.category === 'Firma').sort((a, b) => b.created_at - a.created_at || b.seq - a.seq)[0];
        return [latest ? [{ id: latest.id, name: latest.name, created_at: latest.created_at, captured_by: users.get(latest.uploaded_by) ?? null }] : []];
      }
      if (sql.startsWith('SELECT id,order_id,category,sha256 FROM em_attachments WHERE request_id=?')) return [files.filter(file => file.request_id === args[0])];
      if (sql === "SELECT COUNT(*) AS n FROM em_attachments WHERE order_id=? AND category='Firma'") return [[{ n: files.filter(file => file.order_id === args[0] && file.category === 'Firma').length }]];
      if (sql.startsWith('INSERT INTO em_attachments')) {
        const [id, order_id, request_id, category, name, mime, size, sha256, uploaded_by, created_at, content] = args;
        files.push({ id, order_id, request_id, category, name, mime, size, sha256, uploaded_by, created_at, content, seq: files.length }); return [{}];
      }
      if (sql.startsWith('SELECT id,order_id,ticket_id,category') && sql.includes('WHERE order_id=?')) return [files.filter(file => file.order_id === args[0] && (!sql.includes("category<>'Firma'") || file.category !== 'Firma'))];
      if (sql.startsWith('SELECT id,order_id,ticket_id,category') && sql.includes('WHERE id=?')) return [files.filter(file => file.id === args[0])];
      if (sql === 'SELECT content,storage_key FROM em_attachments WHERE id=?') return [files.filter(file => file.id === args[0]).map(file => ({ content: file.content, storage_key: null }))];
      if (sql.startsWith('SELECT id,payload FROM em_audit_log')) return [[]];
      if (sql.startsWith('INSERT INTO em_audit_log')) { for (let i = 0; i < args.length; i += 7) audit.push(JSON.parse(args[i + 6])); return [{}]; }
      if (sql.startsWith('UPDATE em_audit_state') || sql.startsWith('UPDATE em_meta')) return [{}];
      throw new Error(`Consulta inesperada: ${sql}`);
    },
    async query(sql) {
      if (sql === 'SELECT id FROM em_meta WHERE id=1 FOR UPDATE') return [[{ id: 1 }]];
      if (sql.startsWith('SELECT last_sequence')) return [[{ last_sequence: audit.length }]];
      throw new Error(`Consulta inesperada: ${sql}`);
    },
    async getConnection() { return { ...fake, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }; },
  };
  return { pool: fake, files, audit };
}

async function serve(t, db, storage) {
  const app = express();
  app.use((req, _res, next) => {
    const rol = req.get('x-role') || 'Técnico';
    req.actor = { id: rol === 'Técnico' ? 'user-tech' : rol === 'Cliente' ? 'user-client' : 'user-coord', nombre: rol === 'Técnico' ? 'Técnico de prueba' : 'Coordinación de prueba', rol, cliente_id: req.get('x-client') || 'client-a', tecnico_id: req.get('x-tech') || 'tech-a' };
    next();
  });
  // Mismo límite que el resto de solicitudes pequeñas en app.mjs; aquí más amplio para probar el tope propio de la firma.
  app.use(express.json({ limit: '1mb' }));
  registerAttachmentRoutes(app, { pool: db.pool });
  registerSignatureRoutes(app, { pool: db.pool, files: storage });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    get: (path, headers = {}) => fetch(url + path, { headers }),
    sign: (order, body, headers = {}) => fetch(`${url}/api/orders/${order}/signature`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
  };
}

test('el técnico asignado guarda la firma; la ven la orden, la bitácora y el cliente sin el nombre de quien la capturó', async t => {
  const db = memory(); const api = await serve(t, db); const image = await png(240, 80);
  const saved = await api.sign('order-open', { signer: '  Persona   de prueba ', base64: image.toString('base64'), requestId: randomUUID() });
  assert.equal(saved.status, 201);
  const { signature } = await saved.json();
  assert.equal(signature.signer, 'Persona de prueba'); assert.equal(signature.capturedBy, 'Técnico de prueba'); assert.ok(Number.isFinite(signature.signedAt));
  assert.deepEqual(db.files.map(file => [file.category, file.name, file.mime, file.uploaded_by]), [['Firma', 'Firma de Persona de prueba.png', 'image/png', 'user-tech']]);
  assert.deepEqual(db.audit.map(row => [row.accion, row.archivo_id, row.registrado_por, row.orden_id]), [['Firma registrada', signature.id, 'Técnico de prueba', 'order-open']]);

  const staff = await (await api.get('/api/orders/order-open/signature', { 'x-role': 'Coordinador' })).json();
  assert.deepEqual(staff.signature, signature);
  const client = await (await api.get('/api/orders/order-open/signature', { 'x-role': 'Cliente' })).json();
  assert.equal(client.signature.signer, 'Persona de prueba'); assert.equal('capturedBy' in client.signature, false);
  const image_ = await api.get(`/api/attachments/${signature.id}/file`, { 'x-role': 'Cliente' });
  assert.equal(image_.status, 200); assert.equal(image_.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await image_.arrayBuffer()), image);

  assert.equal((await api.get('/api/orders/order-open/signature', { 'x-role': 'Cliente', 'x-client': 'client-b' })).status, 404);
  assert.equal((await api.get(`/api/attachments/${signature.id}/file`, { 'x-role': 'Cliente', 'x-client': 'client-b' })).status, 404);
  assert.equal((await api.get('/api/orders/order-open/signature', { 'x-tech': 'tech-b' })).status, 404);
  // La firma no se lista como evidencia: no aparece en el panel ni en el anexo de fotos del reporte.
  assert.deepEqual((await (await api.get('/api/attachments?orderId=order-open')).json()).files, []);
  // Sin firma, la respuesta es explícita.
  assert.deepEqual(await (await api.get('/api/orders/order-private/signature')).json(), { signature: null });
});

test('las reglas de escritura son las de las evidencias: asignación, estado y motivo después del cierre', async t => {
  const db = memory(); const api = await serve(t, db); const base64 = (await png(240, 80)).toString('base64');
  const body = () => ({ signer: 'Persona de prueba', base64, requestId: randomUUID() });
  assert.equal((await api.sign('order-open', body(), { 'x-role': 'Cliente' })).status, 403);
  assert.equal((await api.sign('order-open', body(), { 'x-tech': 'tech-b' })).status, 404);
  assert.equal((await api.sign('order-private', body(), { 'x-role': 'Cliente' })).status, 403);
  assert.equal((await api.sign('order-cancelled', body(), { 'x-role': 'Coordinador' })).status, 403);
  assert.equal((await api.sign('order-imported', body(), { 'x-role': 'Administrador' })).status, 403);
  assert.equal((await api.sign('order-closed', body())).status, 403);
  const noReason = await api.sign('order-closed', body(), { 'x-role': 'Coordinador' });
  assert.equal(noReason.status, 400); assert.match((await noReason.json()).error, /motivo/);
  const late = await api.sign('order-closed', { ...body(), reason: 'Firma capturada al entregar el equipo' }, { 'x-role': 'Coordinador' });
  assert.equal(late.status, 201);
  assert.deepEqual(db.audit.map(row => [row.accion, row.motivo, row.registrado_por]), [['Firma posterior al cierre', 'Firma capturada al entregar el equipo', 'Coordinación de prueba']]);
  assert.equal(db.files.length, 1);
  const admin = await api.sign('order-open', body(), { 'x-role': 'Administrador' });
  assert.equal(admin.status, 201); assert.equal(db.files.length, 2);
  assert.equal(db.audit[1].accion, 'Firma registrada');
});

test('valida nombre e imagen, no duplica reintentos y limita las firmas por orden', async t => {
  const db = memory(); const api = await serve(t, db); const image = await png(240, 80);
  const send = (fields, headers) => api.sign('order-open', { signer: 'Persona de prueba', base64: image.toString('base64'), requestId: randomUUID(), ...fields }, headers);
  const error = async response => [response.status, (await response.json()).error];
  assert.deepEqual(await error(await send({ signer: ' ' })), [400, 'Escribe el nombre de quien recibe el servicio (2 a 120 caracteres).']);
  assert.deepEqual(await error(await send({ signer: 'x'.repeat(121) })), [400, 'Escribe el nombre de quien recibe el servicio (2 a 120 caracteres).']);
  const jpeg = await sharp({ create: { width: 240, height: 80, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
  assert.deepEqual(await error(await send({ base64: jpeg.toString('base64') })), [400, 'La firma debe ser una imagen PNG.']);
  assert.equal((await send({ base64: (await png(2000, 80)).toString('base64') })).status, 400);
  const heavy = Buffer.concat([image, Buffer.alloc(70 * 1024)]);
  assert.deepEqual(await error(await send({ base64: heavy.toString('base64') })), [400, 'La firma supera el tamaño permitido. Bórrala y vuelve a firmar.']);
  assert.equal(db.files.length, 0);

  const requestId = randomUUID();
  const first = await send({ requestId }); assert.equal(first.status, 201);
  const retry = await send({ requestId }); assert.equal(retry.status, 200);
  assert.equal((await retry.json()).signature.id, (await first.json()).signature.id);
  assert.equal((await send({ requestId, base64: (await png(250, 80)).toString('base64') })).status, 409);
  assert.equal(db.files.length, 1);

  // Volver a firmar: vale la más reciente y las anteriores se conservan.
  const again = await (await send({ signer: 'Otra persona de prueba', base64: (await png(260, 80)).toString('base64') })).json();
  assert.equal((await (await api.get('/api/orders/order-open/signature')).json()).signature.id, again.signature.id);
  while (db.files.length < SIGNATURES_PER_ORDER) assert.equal((await send({ base64: (await png(200 + db.files.length, 80)).toString('base64') })).status, 201);
  assert.deepEqual(await error(await send({ base64: (await png(300, 80)).toString('base64') })), [400, `La orden admite hasta ${SIGNATURES_PER_ORDER} firmas. Pide a coordinación que revise la orden.`]);
});

test('rechaza PNG truncados o corruptos antes de almacenar archivos o escribir la bitácora', async t => {
  const db = memory(); let uploads = 0;
  const api = await serve(t, db, { prepare: async () => { uploads++; throw new Error('No debe almacenar una firma inválida'); } });
  const image = await png(240, 80);
  const idat = image.indexOf(Buffer.from('IDAT'));
  assert.ok(idat > 24);
  const corrupt = Buffer.from(image); corrupt[idat + 4] ^= 0xff;
  for (const [label, bytes] of [
    ['solo cabecera y medidas', image.subarray(0, 24)],
    ['datos de píxeles incompletos', image.subarray(0, idat + 8)],
    ['datos de píxeles corruptos', corrupt],
  ]) {
    const response = await api.sign('order-open', { signer: 'Persona de prueba', base64: bytes.toString('base64'), requestId: randomUUID() });
    assert.equal(response.status, 400, label);
    assert.match((await response.json()).error, /La imagen de la firma no es válida/, label);
  }
  assert.equal(uploads, 0); assert.equal(db.files.length, 0); assert.equal(db.audit.length, 0);
});

test('el límite de 64 KB se aplica a los bytes PNG decodificados, incluido el redondeo de base64', async t => {
  const db = memory(); let uploads = 0;
  const api = await serve(t, db, { prepare: async bytes => { uploads++; return { content: bytes, storage_key: null }; } });
  const image = await png(240, 80);
  // Un PNG decodificable con relleno tras IEND: 65536, 65537 y 65538 bytes producen base64 del mismo largo.
  const padded = size => Buffer.concat([image, Buffer.alloc(size - image.length)]);
  for (const excess of [1, 2]) {
    const bytes = padded(SIGNATURE_MAX_BYTES + excess);
    assert.equal(bytes.toString('base64').length, padded(SIGNATURE_MAX_BYTES).toString('base64').length);
    await sharp(bytes).raw().toBuffer();
    const response = await api.sign('order-open', { signer: 'Persona de prueba', base64: bytes.toString('base64'), requestId: randomUUID() });
    assert.equal(response.status, 400, `${excess} byte(s) de exceso`);
    assert.match((await response.json()).error, /La firma supera el tamaño permitido/);
  }
  assert.equal(uploads, 0); assert.equal(db.files.length, 0); assert.equal(db.audit.length, 0);
  const boundary = padded(SIGNATURE_MAX_BYTES);
  const response = await api.sign('order-open', { signer: 'Persona de prueba', base64: boundary.toString('base64'), requestId: randomUUID() });
  assert.equal(response.status, 201);
  assert.equal(uploads, 1); assert.equal(db.files.length, 1); assert.equal(db.audit.length, 1);
  assert.equal(db.files[0].size, SIGNATURE_MAX_BYTES); assert.deepEqual(db.files[0].content, boundary);
});

test('la carga general de adjuntos no acepta la categoría Firma', async t => {
  const db = memory(); const api = await serve(t, db);
  const response = await fetch(`${api.url}/api/attachments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: 'order-open', category: 'Firma', name: 'firma.png', base64: (await png(240, 80)).toString('base64'), requestId: randomUUID() }) });
  assert.equal(response.status, 400); assert.equal((await response.json()).error, 'La firma se guarda desde «Pedir firma» en la orden.');
  assert.equal(db.files.length, 0);
});

test('el respaldo de adjuntos restaura las firmas con su nombre y solo como PNG', async () => {
  const image = await png(240, 80), jpeg = await sharp({ create: { width: 240, height: 80, channels: 3, background: { r: 255, g: 255, b: 255 } } }).jpeg().toBuffer();
  const metadata = bytes => ({ id: randomUUID(), request_id: randomUUID(), order_id: 'order-open', category: 'Firma', name: 'Firma de Persona de prueba.png', mime: 'image/png', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), uploaded_by: 'user-tech', created_at: Date.now() });
  const restored = validateRestoreFile({ metadata: metadata(image), base64: image.toString('base64') });
  assert.equal(restored.metadata.category, 'Firma'); assert.equal(restored.metadata.name, 'Firma de Persona de prueba.png');
  assert.throws(() => validateRestoreFile({ metadata: { ...metadata(jpeg), mime: 'image/jpeg' }, base64: jpeg.toString('base64') }), /PNG/);
});
