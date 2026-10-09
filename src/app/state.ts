import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { demoUsers } from '../data/seed';
import { getDataSource, serverMode } from '../data/source';
import { useAuth } from './auth';
import type { EntityName, EntityRecord } from '../domain/model';

export const useSession = create<{ userId: string; setUserId: (id: string) => void }>()(persist(set => ({ userId: demoUsers[0].id, setUserId: userId => set({ userId }) }), { name: 'portal-em.session.v1', storage: createJSONStorage(() => localStorage), version: 1 }));
export function useActor() { const id = useSession(state => state.userId); const actor = useAuth(state => state.actor); if (serverMode) { if (!actor) throw new Error('Inicia sesión para continuar.'); return actor; } return demoUsers.find(user => user.id === id) ?? demoUsers[0]; }
export function useRevision() { const source = getDataSource(); return useSyncExternalStore(source.subscribe, source.getRevision, source.getRevision); }
export function useRows(entity: EntityName, keepPrevious = false) {
  const actor = useActor(); const revision = useRevision();
  const [result, setResult] = useState<{ key: string; scope: string; rows: EntityRecord[] }>({ key: '', scope: '', rows: [] });
  const [error, setError] = useState('');
  // Retain records during a revision refresh only within the same access scope.
  const scope = JSON.stringify([entity, actor.id, actor.rol, actor.cliente_id, actor.tecnico_id]);
  const key = `${scope}:${revision}`;
  useEffect(() => { let active = true; setError(''); getDataSource().repository(entity, actor).getAll().then(rows => { if (active) setResult({ key, scope, rows }); }).catch(cause => { if (active) setError(String(cause)); }); return () => { active = false; }; }, [actor, entity, key, scope]);
  return { rows: result.key === key || (keepPrevious && result.scope === scope) ? result.rows : [], ready: result.scope === scope, loading: result.key !== key, error };
}
export const useToast = create<{ message: string; notify: (message: string) => void; clear: () => void }>(set => ({ message: '', notify: message => set({ message }), clear: () => set({ message: '' }) }));
