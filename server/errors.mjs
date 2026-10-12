/** @param {unknown} error @param {string} name @returns {unknown} */
export function errorField(error, name) {
  return error !== null && typeof error === 'object' ? Reflect.get(error, name) : undefined;
}
/** @param {unknown} error */
export function errorCode(error) {
  const value = errorField(error, 'code');
  return typeof value === 'string' ? value : undefined;
}
