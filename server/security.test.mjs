import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, equal, cookieToken } from './security.mjs';
test('scrypt verifies the original password and rejects other passwords', async()=>{
  const a = await hashPassword('Una clave solo para pruebas 2026!');
  const b = await hashPassword('Una clave solo para pruebas 2026!');
  assert.notEqual(a,b); assert.equal(await verifyPassword('Una clave solo para pruebas 2026!',a),true);
  assert.equal(await verifyPassword('Otra clave solo para pruebas',a),false);
  assert.equal(await verifyPassword('x','bad'),false);
  await assert.rejects(hashPassword('short'));
});
test('tokens require a matching complete value and cookie parsing is exact',()=>{
  assert.equal(equal('token','token'),true); assert.equal(equal('token',undefined),false); assert.equal(equal('token','token2'),false);
  assert.equal(cookieToken('not_em_session=wrong; em_session=correct; x=1','em_session'),'correct');
});
