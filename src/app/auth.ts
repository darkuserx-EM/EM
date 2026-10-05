import { create } from 'zustand';
import type { Actor } from '../domain/model';
export const useAuth = create<{ actor?: Actor; setActor: (actor?: Actor) => void }>(set => ({ setActor: actor => set({ actor }) }));
