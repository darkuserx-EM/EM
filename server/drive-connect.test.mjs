import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {createConnectionServer} from '../scripts/connect-google-drive.mjs';

test('Conexión Drive local: CSRF, PKCE, un solo uso, permiso mínimo y carpeta privada',async t=>{
  const config={clientId:'qa-client',clientSecret:'qa-secret',pickerKey:'qa-picker',projectNumber:'12345',folderId:'qa-private-folder',ownerEmail:'owner@example.invalid'};
  let saved,calls=0,expectedChallenge;
  const request=async(url,init)=>{
    calls++;
    if(url==='https://oauth2.googleapis.com/token'){
      const body=new URLSearchParams(init.body);assert.equal(body.get('client_secret'),config.clientSecret);
      if(body.get('grant_type')==='authorization_code')assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),expectedChallenge);
      return Response.json({access_token:'qa-access',refresh_token:'qa-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'});
    }
    assert.ok(String(url).startsWith('https://www.googleapis.com/drive/v3/files/qa-private-folder?'));
    return Response.json({id:config.folderId,name:'PORTAL_EM',mimeType:'application/vnd.google-apps.folder',trashed:false,ownedByMe:true,owners:[{emailAddress:config.ownerEmail}],permissions:[{type:'user',role:'owner'}],capabilities:{canAddChildren:true}});
  };
  const server=createConnectionServer({...config,save:async values=>{saved=values;},request}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}`,host='127.0.0.1:33124',origin='http://'+host;
  const call=(path,options={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(url+path,{method:options.method||'GET',headers:{Host:host,...options.headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const headers=new Headers();for(const [key,value]of Object.entries(res.headers))for(const item of Array.isArray(value)?value:[value])if(item!==undefined)headers.append(key,item);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});
    });req.on('error',reject);req.end(options.body);
  });
  assert.equal((await fetch(url)).status,403,'rechaza Host ajeno / DNS rebinding');
  const page=await call('/'),html=await page.text(),cookie=page.headers.getSetCookie()[0].split(';')[0],csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
  assert.ok(!html.includes(config.clientSecret));assert.equal((await call('/picker.js')).status,403);
  assert.equal((await call('/start',{method:'POST',headers:{Cookie:cookie,Origin:'https://foreign.invalid'},body:`csrf=${csrf}`})).status,403);
  assert.equal(calls,0);
  const start=await call('/start',{method:'POST',headers:{Cookie:cookie,Origin:origin},body:`csrf=${csrf}`});assert.equal(start.status,303);
  const auth=new URL(start.headers.get('location'));assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');assert.equal(auth.searchParams.get('include_granted_scopes'),'false');expectedChallenge=auth.searchParams.get('code_challenge');
  assert.equal((await call('/callback?state=wrong&code=qa',{headers:{Cookie:cookie}})).status,400);assert.equal(calls,0);
  const callback=`/callback?state=${auth.searchParams.get('state')}&code=qa`;
  assert.equal((await call(callback,{headers:{Cookie:cookie}})).status,303);
  assert.equal((await call(callback,{headers:{Cookie:cookie}})).status,400);
  const script=await (await call('/picker.js',{headers:{Cookie:cookie}})).text();assert.ok(script.includes('qa-access'));assert.ok(!script.includes('qa-refresh'));assert.ok(!script.includes('qa-secret'));
  const finish=folderId=>call('/finish',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({folderId})});
  assert.equal((await finish('another-folder')).status,400);assert.equal(saved,undefined);
  assert.equal((await finish(config.folderId)).status,200);assert.equal(saved.GOOGLE_DRIVE_REFRESH_TOKEN,'qa-refresh');assert.equal(saved.GOOGLE_DRIVE_FOLDER_ID,config.folderId);
  assert.equal((await call('/picker.js',{headers:{Cookie:cookie}})).status,403,'retira el token efímero al terminar');
});
