import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { migrate } from './database.mjs';
import { createApp } from './app.mjs';
import { token } from './security.mjs';

test('Respaldo y recuperación de adjuntos: binarios completos, integridad y autorización', { skip: process.env.MYSQL_INTEGRATION !== '1', timeout: 120000 }, async t => {
  const host = process.env.TEST_DB_HOST || '127.0.0.1'; assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host));
  const config = { host, port: Number(process.env.TEST_DB_PORT || 3306), user: process.env.TEST_DB_USER || 'root', password: process.env.TEST_DB_PASSWORD }; assert.ok(config.password);
  const name = `em_ci_${randomUUID().replaceAll('-', '')}`; const control = await mysql.createConnection(config);
  await control.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4`);
  const pool = mysql.createPool({ ...config, database: name }); let server;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.end(); assert.match(name, /^em_ci_[a-f0-9]{32}$/); await control.query(`DROP DATABASE ${name}`); await control.end();
  });
  await migrate(pool);
  const origin = 'http://localhost:3000', setupToken = token(), logs = [];
  server = createApp({ pool, origin, setupToken, production: false, logger: entry => logs.push(entry) }).listen(0, '127.0.0.1');
  await once(server, 'listening'); const url = `http://127.0.0.1:${server.address().port}/api/`; let serial = 1;
  const headers = session => ({ Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${serial++}`, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) });
  async function call(path, body, session) {
    const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: headers(session), body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function login(email, password) {
    const response = await call('login', { email, password }); assert.equal(response.status, 200);
    const session = { cookie: response.headers.getSetCookie()[0].split(';')[0], csrf: '' };
    const state = (await call('session', undefined, session)).data; session.csrf=state.csrf;
    if(state.mustChangePassword)assert.equal((await call('password',{currentPassword:password,newPassword:password+' changed'},session)).status,200);
    return session;
  }
  const password = 'Synthetic backup test password 2026!';
  assert.equal((await call('setup', { setupToken, email: 'admin@example.invalid', name: 'QA Backup', password })).status, 201);
  const admin = await login('admin@example.invalid', password);
  async function create(entity, fields) {
    const revision = (await call('database', undefined, admin)).data.revision;
    const response = await call('mutate', { revision, action: 'create', entity, fields }, admin); assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data.result;
  }
  const client = await create('Cliente', { nombre: 'Cliente QA Backup', estado: 'Activo' });
  const equipment = await create('Equipo', { marca: 'QA', modelo: 'Prueba', serie: 'BACKUP-SYNTHETIC', tipo: 'Reach', propiedad: 'De cliente', estado: 'Disponible', cliente_id: client.id });
  const order = await create('OrdenServicio', { equipo_id: equipment.id, cliente_id: client.id, sintoma: 'Verificación sintética', visible_cliente: true });
  const account = await call('admin/users', { name: 'Cliente QA', email: 'client@example.invalid', role: 'Cliente', clientId: client.id, days: 7 }, admin); assert.equal(account.status, 201);
  const restricted = await login(account.data.email, account.data.password);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp9sAAAAASUVORK5CYII=', 'base64');
  const bytes = Buffer.concat([png, Buffer.alloc(180000)]); // Exercises the authenticated 6 MB parser, beyond small JSON limit.
  const requestId = randomUUID();
  const uploaded = await call('attachments', { orderId: order.id, requestId, category: 'Antes', name: 'equipo-ñ.png', base64: bytes.toString('base64') }, admin); assert.equal(uploaded.status, 201);
  let backupFile;
  await t.test('JSONL incluye binario y footer verificable; acceso sólo administración', async () => {
    assert.equal((await fetch(url + 'admin/attachments-backup', { headers: headers(restricted) })).status, 403);
    assert.equal((await fetch(url + 'admin/attachments-backup', { headers: headers() })).status, 401);
    const response = await fetch(url + 'admin/attachments-backup', { headers: headers(admin) }); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /attachment/); assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    const lines = (await response.text()).trimEnd().split('\n'); const values = lines.map(line => JSON.parse(line));
    assert.equal(values.length, 3); assert.deepEqual({ type: values[0].type, version: values[0].version, count: values[0].count }, { type: 'portal-em.attachments', version: 1, count: 1 });
    assert.equal(values[1].type, 'attachment'); backupFile = values[1].file;
    assert.deepEqual(Buffer.from(backupFile.base64, 'base64'), bytes); assert.equal(backupFile.metadata.request_id, requestId); assert.equal(backupFile.metadata.id, uploaded.data.file.id);
    assert.equal(backupFile.metadata.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(values[2], { type: 'complete', count: 1, sha256: createHash('sha256').update(lines[1] + '\n').digest('hex') });
  });
  await t.test('recupera contenido, identidad, autoría y fecha; reintentos no duplican ni sobrescriben', async () => {
    assert.equal((await call('admin/attachments/restore', { file: backupFile }, restricted)).status, 403);
    const invalidJson = await fetch(url + 'admin/attachments/restore', { method: 'POST', headers: headers(restricted), body: '{not json' }); assert.equal(invalidJson.status, 403);
    const noCsrf = headers(admin); delete noCsrf['X-CSRF-Token'];
    assert.equal((await fetch(url + 'admin/attachments/restore', { method: 'POST', headers: noCsrf, body: JSON.stringify({ file: backupFile }) })).status, 403);
    // Delete only this test's isolated synthetic attachment to prove recovery, never production.
    await pool.execute('DELETE FROM em_attachments WHERE id=?', [backupFile.metadata.id]);
    const restore = await call('admin/attachments/restore', { file: backupFile }, admin); assert.equal(restore.status, 201); assert.equal(restore.data.duplicate, false);
    const [saved] = await pool.execute('SELECT * FROM em_attachments WHERE id=?', [backupFile.metadata.id]);
    for (const [key, value] of Object.entries(backupFile.metadata)) assert.equal(saved[0][key], value, key);
    assert.deepEqual(saved[0].content, bytes);
    const repeated = await call('admin/attachments/restore', { file: backupFile }, admin); assert.equal(repeated.status, 200); assert.equal(repeated.data.duplicate, true);
    const [events] = await pool.query("SELECT * FROM em_security_events WHERE action='attachment.restored'"); assert.equal(events.length, 1); assert.equal(events[0].target_id, backupFile.metadata.id);
    const download = await fetch(url + `attachments/${backupFile.metadata.id}/file`, { headers: headers(restricted) }); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  });
  await t.test('rechaza corrupción, metadatos alterados, colisiones y órdenes inexistentes', async () => {
    const badBytes = Buffer.from(bytes); badBytes[badBytes.length - 1] = 1;
    for (const file of [
      { ...backupFile, base64: badBytes.toString('base64') },
      { ...backupFile, metadata: { ...backupFile.metadata, sha256: '0'.repeat(64) } },
      { ...backupFile, metadata: { ...backupFile.metadata, mime: 'text/html' } },
      { ...backupFile, metadata: { ...backupFile.metadata, size: 12 } },
    ]) assert.equal((await call('admin/attachments/restore', { file }, admin)).status, 400);
    for (const metadata of [
      { ...backupFile.metadata, name: 'otro-nombre.png' },
      { ...backupFile.metadata, id: randomUUID() },
      { ...backupFile.metadata, request_id: randomUUID() },
      { ...backupFile.metadata, id: randomUUID(), request_id: randomUUID(), order_id: 'missing-order' },
    ]) assert.equal((await call('admin/attachments/restore', { file: { ...backupFile, metadata } }, admin)).status, 409);
    const [rows] = await pool.query('SELECT content FROM em_attachments'); assert.equal(rows.length, 1); assert.deepEqual(rows[0].content, bytes);
  });
  await t.test('un archivo corrupto almacenado interrumpe descarga sin emitir footer completo', async () => {
    await pool.execute('UPDATE em_attachments SET sha256=? WHERE id=?', ['0'.repeat(64), backupFile.metadata.id]);
    await assert.rejects(async () => { const response = await fetch(url + 'admin/attachments-backup', { headers: headers(admin) }); await response.text(); });
    assert.equal(logs.length, 1);
    assert.ok(!JSON.stringify(logs).includes(backupFile.base64));
    await pool.execute('UPDATE em_attachments SET sha256=? WHERE id=?', [backupFile.metadata.sha256, backupFile.metadata.id]);
  });
});
