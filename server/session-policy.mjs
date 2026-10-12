export function idleTimeout(value = '60') {
  const minutes=Number(value);
  if (!Number.isInteger(minutes) || minutes<15 || minutes>240) throw Object.assign(new Error('SESSION_IDLE_MINUTES debe estar entre 15 y 240.'),{code:'CONFIG_SESSION_IDLE_MINUTES'});
  return minutes*60000;
}
/**
 * @param {{clearCookie: (name:string, options:{path:string,secure:boolean,httpOnly:boolean,sameSite:'strict'})=>unknown}} res
 * @param {boolean} production
 */
export function clearSessionCookies(res, production) {
  for (const name of production ? ['__Host-em_session','em_session'] : ['em_session']) res.clearCookie(name,{path:'/',secure:production,httpOnly:true,sameSite:'strict'});
}
