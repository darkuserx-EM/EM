import { afterEach, expect, it, vi } from 'vitest';
import { api } from './remote';
afterEach(()=>vi.unstubAllGlobals());
it('rechaza respuestas HTML incluso con estado 200 sin darlas por un guardado exitoso',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>Error de alojamiento</html>',{status:200})));
  await expect(api('mutate',{action:'create'})).rejects.toThrow('HTTP 200');
});
it('conserva la explicación de validación enviada por la API',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Razón social obligatoria'},{status:400})));
  await expect(api('mutate',{})).rejects.toThrow('Razón social obligatoria');
});
it('no vuelve a enviar automáticamente un guardado cuya conexión falló',async()=>{
  const fetch=vi.fn(async()=>{throw new TypeError('Network failure');});vi.stubGlobal('fetch',fetch);
  await expect(api('mutate',{})).rejects.toThrow('No recibimos confirmación');expect(fetch).toHaveBeenCalledTimes(1);
});
