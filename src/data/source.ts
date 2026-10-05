import { getDataSource as getLocalDataSource } from './repository';
import { RemoteDataSource } from './remote';
export const serverMode = import.meta.env.VITE_DATA_MODE !== 'local' && (import.meta.env.VITE_DATA_MODE === 'server' || !['localhost', '127.0.0.1'].includes(window.location.hostname));
export const remoteSource = new RemoteDataSource();
export function getDataSource() { return serverMode ? remoteSource : getLocalDataSource(); }
