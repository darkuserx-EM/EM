import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { demoUsers } from '../data/seed';
import { getDataSource, serverMode } from '../data/source';
import { useAuth } from './auth';
import type { EntityName, EntityRecord } from '../domain/model';
import type { OperationPage, OperationQuery, PagedEntity } from '../data/operation-page';

export const useSession = create<{ userId: string; setUserId: (id: string) => void }>()(persist(set => ({ userId: demoUsers[0].id, setUserId: userId => set({ userId }) }), { name: 'portal-em.session.v1', storage: createJSONStorage(() => localStorage), version: 1 }));
export function useActor() { const id = useSession(state => state.userId); const actor = useAuth(state => state.actor); if (serverMode) { if (!actor) throw new Error('Inicia sesión para continuar.'); return actor; } return demoUsers.find(user => user.id === id) ?? demoUsers[0]; }
export function useRevision() { const source = getDataSource(); return useSyncExternalStore(source.subscribe, source.getRevision, source.getRevision); }
/** `enabled = false`: no consulta ni se vuelve a pedir en cada revisión; devuelve una lista vacía y lista. */
export function useRows(entity: EntityName, keepPrevious = false, query:OperationQuery = {}, enabled = true) {
  const actor = useActor(); const revision = useRevision();
  const [result, setResult] = useState<{ key: string; scope: string; rows: EntityRecord[] }>({ key: '', scope: '', rows: [] });
  const [error, setError] = useState('');
  // Retain records during a revision refresh only within the same access scope.
  const queryKey=JSON.stringify(query);
  const scope = JSON.stringify([entity, actor.id, actor.rol, actor.cliente_id, actor.tecnico_id,queryKey,enabled]);
  const key = enabled ? `${scope}:${revision}` : scope;
  useEffect(() => { let active = true; setError(''); if (!enabled) { setResult({ key, scope, rows: [] }); return; } getDataSource().repository(entity, actor).getAll(JSON.parse(queryKey)).then(rows => { if (active) setResult({ key, scope, rows }); }).catch(cause => { if (active) setError(String(cause)); }); return () => { active = false; }; }, [actor, entity, key, scope,queryKey,enabled]);
  return { rows: result.key === key || (keepPrevious && result.scope === scope) ? result.rows : [], ready: result.scope === scope, loading: result.key !== key, error };
}
// A page is never retained across a filter, revision or access change.
export function useOperationPage(entity:PagedEntity,query:OperationQuery={},enabled=true) {
  const actor=useActor(),revision=useRevision(),queryKey=JSON.stringify(query);
  const key=JSON.stringify([entity,actor,revision,queryKey,enabled]);
  const [result,setResult]=useState<{key:string;data?:OperationPage;error?:string}>({key:''});
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    getDataSource().operationPage(entity,actor,JSON.parse(queryKey)).then(data=>{if(active)setResult({key,data});}).catch(cause=>{if(active)setResult({key,error:cause instanceof Error?cause.message:String(cause)});});
    return()=>{active=false;};
  },[entity,actor,queryKey,key,enabled]);
  const data=enabled&&result.key===key?result.data:undefined;
  return {data,rows:data?.rows||[],ready:!enabled||result.key===key,error:enabled&&result.key===key?result.error||'':''};
}
export const useToast = create<{ message: string; notify: (message: string) => void; clear: () => void }>(set => ({ message: '', notify: message => set({ message }), clear: () => set({ message: '' }) }));
