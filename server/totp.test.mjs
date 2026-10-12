import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {base32,decode32,totp,totpStep,encryptionKey,seal,unseal} from './totp.mjs';
test('TOTP SHA1 reproduce los seis vectores de RFC 6238 y base32',()=>{
 const bytes=Buffer.from('12345678901234567890'),secret=base32(bytes);assert.deepEqual(decode32(secret),bytes);
 for(const [seconds,expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,seconds*1000,8),expected);
});
test('TOTP tolera un intervalo de reloj, rechaza repetición y formatos inválidos',()=>{
 const secret=base32(randomBytes(20)),now=30000000,step=now/30000;
 for(const drift of [-1,0,1])assert.equal(totpStep(secret,totp(secret,now+drift*30000),-1,now),step+drift);
 assert.equal(totpStep(secret,totp(secret,now),step,now),null);assert.equal(totpStep(secret,'bad',-1,now),null);
});
test('cifrado autenticado requiere la clave y el usuario correctos',()=>{
 const key=encryptionKey(randomBytes(32).toString('base64')),sealed=seal('SECRET',key,'user');
 assert.equal(unseal(sealed,key,'user'),'SECRET');assert.throws(()=>unseal(sealed,key,'another'));assert.throws(()=>unseal(sealed,randomBytes(32),'user'));assert.throws(()=>unseal(sealed,null,'user'));
 assert.equal(encryptionKey(undefined),null);assert.throws(()=>encryptionKey('bad'));
});
