import type { Actor } from '../../domain/model';
export const draftFields = ['sintoma','diagnostico','trabajo_realizado','recomendaciones','pruebas_realizadas','resultado_pruebas','notas_seguridad','insumos','repuestos'] as const;
export type OrderDraft = { version:1; savedAt:number; baseVersion:string; requestId:string; equipment:string; texts:Record<string,string> };
export const draftKey = (actor:Actor, order:string) => `portal-em.order-draft.v1:${encodeURIComponent(JSON.stringify([actor.id,actor.rol,actor.tecnico_id||'',actor.cliente_id||'',order]))}`;
export const draftTexts = (values:Record<string,string>) => Object.fromEntries(draftFields.map(key=>[key,values[key]||'']));
export function readDraft(storage:Pick<Storage,'getItem'|'removeItem'>, key:string, now=Date.now()):OrderDraft|undefined {
  const raw=storage.getItem(key); if(!raw)return;
  try {
    const d=JSON.parse(raw);
    if(d.version!==1 || !Number.isFinite(d.savedAt) || d.savedAt>now || now-d.savedAt>7*86400000 || typeof d.baseVersion!=='string' || typeof d.requestId!=='string' || typeof d.equipment!=='string' || !d.texts || draftFields.some(k=>typeof d.texts[k]!=='string'||d.texts[k].length>4000))throw new Error('Invalid draft');
    return {...d,texts:draftTexts(d.texts)};
  } catch { storage.removeItem(key); return; }
}
export const canRestoreDraft = (draft:OrderDraft, version:string) => draft.baseVersion===version;
