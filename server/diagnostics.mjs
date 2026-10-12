import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { errorField } from './errors.mjs';

// Never serialize the error itself: mysql messages and stacks can contain values.
/** @param {unknown} error @param {{event:string,method?:string,route?:string,status:number}} context @param {(line:string)=>void} [logger] */
export function logFailure(error, { event, method, route, status }, logger = console.error) {
  const reference = randomUUID();
  const names = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ValidationError'];
  const rawCode=errorField(error,'code'),stack=errorField(error,'stack'),name=errorField(error,'name'),errno=errorField(error,'errno');
  const code = typeof rawCode === 'string' && /^(ER_[A-Z0-9_]+|E[A-Z]{2,24}|CONFIG_[A-Z_]+)$/.test(rawCode) ? rawCode : undefined;
  const frames = typeof stack === 'string' ? stack.split('\n').slice(1, 9).flatMap(line => {
    const location = line.match(/([\w.-]+\.(?:[cm]?js|ts):\d+:\d+)\)?$/);
    return location ? [location[1]] : [];
  }) : [];
  logger(JSON.stringify({ level: 'error', time: new Date().toISOString(), event, reference, method, route, status,
    error: { name: typeof name==='string' && names.includes(name) ? name : 'Error', code, errno: Number.isInteger(errno) ? errno : undefined, frames } }));
  return reference;
}

export function parseTrustProxy(raw = '1') {
  const value = raw.trim();
  if (/^[0-5]$/.test(value)) return Number(value);
  const ranges = value.split(',').map(part => part.trim());
  if (ranges.every(part => {
    if (['loopback', 'uniquelocal', 'linklocal'].includes(part)) return true;
    const [address, prefix, extra] = part.split('/');
    const version = isIP(address);
    return version && extra === undefined && (prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) > 0 && Number(prefix) <= (version === 4 ? 32 : 128)));
  })) return ranges;
  throw Object.assign(new Error('TRUST_PROXY debe indicar de 0 a 5 saltos o direcciones/subredes verificadas.'), { code: 'CONFIG_TRUST_PROXY' });
}
