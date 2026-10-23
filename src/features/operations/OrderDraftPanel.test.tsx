import {it,expect,vi,afterEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {OrderDraftPanel} from './OrderDraftPanel';
import type {Actor} from '../../domain/model';
afterEach(()=>vi.unstubAllGlobals());
it.each(['Administrador','Coordinador','Técnico'] as const)('avisa sin conexión sin bloquear el trabajo de %s',rol=>{
 vi.stubGlobal('navigator',{onLine:false});
 const html=renderToStaticMarkup(<OrderDraftPanel actor={{id:rol,nombre:rol,rol}} scope="os" version="v1" equipment="OS-QA" values={{}} initial={{}} requestId="r" onRestore={()=>{}}/>);
 expect(html).toContain('El dispositivo indica que no tiene conexión');
 expect(html).toContain('No incluye fotos, videos ni firmas');
 expect(html).not.toContain('disabled');
});
it('no presenta herramientas de borrador al cliente',()=>{
 vi.stubGlobal('navigator',{onLine:false});
 const actor:Actor={id:'client',nombre:'QA',rol:'Cliente'};
 expect(renderToStaticMarkup(<OrderDraftPanel actor={actor} scope="os" version="v1" equipment="OS-QA" values={{}} initial={{}} requestId="r" onRestore={()=>{}}/>)).toBe('');
});
