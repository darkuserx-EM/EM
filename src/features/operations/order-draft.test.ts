import {describe,it,expect} from 'vitest';
import {draftKey,draftTexts,readDraft,canRestoreDraft,type OrderDraft} from './order-draft';
import type {Actor} from '../../domain/model';
const draft:OrderDraft={version:1,savedAt:1000,baseVersion:'v1',requestId:'request-1',equipment:'OS-QA',texts:draftTexts({diagnostico:'Diagnóstico pendiente',estado:'Completada',firma:'secreto'})};
const storage=(raw:string|null)=>({getItem:()=>raw,removeItem:()=>{raw=null;}});
describe('respaldo de texto de órdenes',()=>{
 it.each(['Administrador','Coordinador','Técnico','Cliente'] as const)('aísla cuenta, rol y orden de %s',rol=>{
  const actor:Actor={id:'a',nombre:'QA',rol};
  expect(draftKey(actor,'os1')).not.toBe(draftKey({...actor,id:'b'},'os1'));
  expect(draftKey(actor,'os1')).not.toBe(draftKey(actor,'os2'));
 });
 it('recupera texto, preserva id de reintento y excluye estados y evidencias',()=>{
  const result=readDraft(storage(JSON.stringify(draft)),'k',2000)!;
  expect(result.texts.diagnostico).toBe('Diagnóstico pendiente');
  expect(result.texts).not.toHaveProperty('estado');expect(result.texts).not.toHaveProperty('firma');
  expect(result.requestId).toBe('request-1');
 });
 it('bloquea restauración sobre una versión posterior de otro participante',()=>{
  expect(canRestoreDraft(draft,'v1')).toBe(true);expect(canRestoreDraft(draft,'v2')).toBe(false);
 });
 it('rechaza borradores caducados, corruptos o con campos inválidos',()=>{
  expect(readDraft(storage(JSON.stringify(draft)),'k',8*86400000)).toBeUndefined();
  expect(readDraft(storage('{'),'k',2000)).toBeUndefined();
  expect(readDraft(storage(JSON.stringify({...draft,texts:{}})),'k',2000)).toBeUndefined();
 });
 it('expone fallos de almacenamiento para no anunciar respaldo inexistente',()=>{
  expect(()=>readDraft({getItem:()=>{throw new Error('denied');},removeItem:()=>{}},'k')).toThrow('denied');
 });
});
