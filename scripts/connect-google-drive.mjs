// One-time owner authorization on this computer. Never exposed by the portal.
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createDriveStorage } from '../server/drive-storage.mjs';

const scope='https://www.googleapis.com/auth/drive.file';
const origin='http://127.0.0.1:33124';
const redirect=origin+'/callback';
const random=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export function createConnectionServer({clientId,clientSecret,pickerKey,projectNumber,folderId,ownerEmail,save,request=fetch}) {
  if(!clientId||!clientSecret||!pickerKey||!/^\d+$/.test(projectNumber)||!/^[\w-]{10,200}$/.test(folderId)||!ownerEmail?.includes('@'))throw Error('Completa la configuración privada de Google antes de iniciar.');
  const cookie=random(),csrf=random();let state,verifier,grant,busy=false,finished=false;
  const page=body=>`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conectar PORTAL EM</title><style>body{font:16px system-ui;max-width:740px;margin:8vh auto;padding:24px;color:#243326;background:#f7f8f4}button{font:inherit;padding:12px 20px;cursor:pointer}p{line-height:1.6}</style><h1>Conectar PORTAL EM con Google Drive</h1>${body}</html>`;
  return createServer(async(req,res)=>{
    // no-referrer makes ordinary form POSTs send Origin: null in browsers.
    // Keep Origin validation and let Picker verify its restricted key from the
    // local origin. Cross-origin referrers never contain paths or OAuth codes.
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'self' https://apis.google.com; frame-src https://docs.google.com https://drive.google.com; connect-src 'self' https://*.googleapis.com; img-src https://*.googleusercontent.com https://*.gstatic.com; base-uri 'none'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'");
    const send=(status,text)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(page(text));};
    try {
      if(req.headers.host!=='127.0.0.1:33124')return send(403,'Dirección no permitida.');
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&url.pathname==='/'){
        res.setHeader('Set-Cookie',`em_drive_setup=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800`);
        return send(200,`<p>Cuenta propietaria: <b>${escape(ownerEmail)}</b>. La autorización se limita a los archivos que cree PORTAL EM y a la carpeta que elijas expresamente. No se solicita acceso a todo Drive.</p><p>Selecciona la carpeta privada <b>PORTAL_EM</b>. Los clientes y técnicos seguirán entrando solo por el portal.</p><form action="/start" method="post"><input type="hidden" name="csrf" value="${csrf}"><button>Autorizar con Google</button></form>`);
      }
      if(!req.headers.cookie?.split(';').some(item=>equal(item.trim(),`em_drive_setup=${cookie}`)))return send(403,'Abre primero la página de conexión en este mismo navegador.');
      let body='';
      if(req.method==='POST'){
        if(req.headers.origin!==origin)return send(403,'Origen no permitido.');
        for await(const chunk of req){body+=chunk;if(body.length>2048)return send(413,'Solicitud demasiado grande.');}
      }
      if(req.method==='POST'&&url.pathname==='/start'){
        if(!equal(new URLSearchParams(body).get('csrf'),csrf)||busy||finished)return send(403,'Solicitud no permitida.');
        state=random();verifier=random();grant=undefined;
        const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
        target.search=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope,access_type:'offline',prompt:'consent',include_granted_scopes:'false',login_hint:ownerEmail,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
        res.writeHead(303,{Location:target.href});return res.end();
      }
      if(req.method==='GET'&&url.pathname==='/callback'){
        if(!state||!equal(url.searchParams.get('state'),state)||busy||finished)return send(400,'La autorización no coincide o ya se utilizó. Vuelve a comenzar.');
        state=undefined;
        if(url.searchParams.has('error')||!url.searchParams.get('code'))return send(400,'Google no autorizó la conexión. No se guardaron credenciales.');
        busy=true;
        try {
          const response=await request('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,redirect_uri:redirect,grant_type:'authorization_code',code:url.searchParams.get('code'),code_verifier:verifier})});
          if(!response.ok)throw Error('Google no completó la autorización.');
          const data=await response.json();
          if(!data.refresh_token||!data.access_token||data.scope!==scope)throw Error('Se necesita una autorización nueva y limitada a drive.file.');
          grant={refresh:data.refresh_token,access:data.access_token};
        }finally{busy=false;verifier=undefined;}
        res.writeHead(303,{Location:'/choose'});return res.end();
      }
      if(!grant||finished)return send(403,'Inicia la autorización o cierra esta ventana si ya terminó.');
      if(req.method==='GET'&&url.pathname==='/choose')return send(200,'<p>Elige la carpeta <b>PORTAL_EM</b>. Se verificará que pertenece a tu cuenta y no está compartida.</p><button id="choose">Elegir carpeta de Drive</button><p id="result" role="status"></p><script src="https://apis.google.com/js/api.js"></script><script src="/picker.js"></script>');
      if(req.method==='GET'&&url.pathname==='/picker.js'){
        res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});
        return res.end(`const settings=${JSON.stringify({key:pickerKey,project:projectNumber,access:grant.access,csrf}).replaceAll('<','\\u003c')};
document.getElementById('choose').addEventListener('click',()=>gapi.load('picker',()=>{const view=new google.picker.DocsView().setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder');new google.picker.PickerBuilder().addView(view).setOAuthToken(settings.access).setDeveloperKey(settings.key).setAppId(settings.project).setOrigin(location.origin).setCallback(async data=>{if(data.action!==google.picker.Action.PICKED)return;document.getElementById('choose').disabled=true;const result=document.getElementById('result');result.textContent='Verificando carpeta y guardando la conexión…';try{const response=await fetch('/finish',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':settings.csrf},body:JSON.stringify({folderId:data.docs[0].id})});result.textContent=await response.text();if(!response.ok)document.getElementById('choose').disabled=false;}catch{result.textContent='No se pudo completar. Conserva esta ventana y vuelve a intentarlo.';document.getElementById('choose').disabled=false;}}).build().setVisible(true);}));`);
      }
      if(req.method==='POST'&&url.pathname==='/finish'){
        if(!equal(req.headers['x-csrf-token'],csrf)||busy)return send(403,'Solicitud no permitida.');
        const selection=JSON.parse(body);
        if(selection.folderId!==folderId){res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Selecciona la carpeta PORTAL_EM preparada para esta conexión.');}
        busy=true;
        try {
          const drive=createDriveStorage({clientId,clientSecret,refreshToken:grant.refresh,folderId,ownerEmail,fetch:request});
          await drive.verifyFolder();
          await save({FILE_STORAGE:'google-drive',GOOGLE_DRIVE_CLIENT_ID:clientId,GOOGLE_DRIVE_CLIENT_SECRET:clientSecret,GOOGLE_DRIVE_REFRESH_TOKEN:grant.refresh,GOOGLE_DRIVE_FOLDER_ID:folderId,GOOGLE_DRIVE_OWNER_EMAIL:ownerEmail});
          finished=true;grant=undefined;
          res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Conexión guardada de forma local. Ya puedes cerrar esta ventana. Falta verificar la carga desde el portal y activar la configuración del alojamiento.');
        }finally{busy=false;}
      }
      return send(404,'Página no disponible.');
    } catch {return send(503,'No se pudo completar la conexión. Revisa la configuración de Google y vuelve a comenzar. No se muestran ni registran claves.');}
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const env=process.env,directory=resolve('private/google-drive-connection'),output=resolve(directory,'authorized.env');
  await mkdir(directory,{recursive:true,mode:0o700});
  if(process.platform==='win32'){
    const owner=execFileSync('whoami.exe',[],{encoding:'utf8',windowsHide:true}).trim();
    execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',`${owner}:(OI)(CI)F`],{stdio:'pipe',windowsHide:true});
  }
  const server=createConnectionServer({clientId:env.GOOGLE_DRIVE_CLIENT_ID,clientSecret:env.GOOGLE_DRIVE_CLIENT_SECRET,pickerKey:env.GOOGLE_PICKER_API_KEY,projectNumber:env.GOOGLE_CLOUD_PROJECT_NUMBER,folderId:env.GOOGLE_DRIVE_FOLDER_ID,ownerEmail:env.GOOGLE_DRIVE_OWNER_EMAIL,save:async values=>{
    const content=Object.entries(values).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n';
    await writeFile(output,content,{flag:'wx',mode:0o600});console.log('Conexión guardada en private/google-drive-connection/authorized.env. No publiques ese archivo.');
  }});
  server.listen(33124,'127.0.0.1',()=>console.log(`Abre ${origin}. La conexión caduca en 30 minutos.`));
  setTimeout(()=>{server.closeAllConnections();server.close();},30*60*1000).unref();
}
