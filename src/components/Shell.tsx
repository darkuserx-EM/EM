import {fleetContextLink} from '../domain/fleet-navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Building2, ChevronDown, ChevronRight, Menu, ShieldCheck } from 'lucide-react';
import { Brand, Modal, Toast } from './ui';
import { demoUsers } from '../data/seed';
import { useActor, useSession } from '../app/state';
import { remoteSource, serverMode } from '../data/source';
import { AccountDialog } from '../features/settings/AccountDialog';
import { canAccessModule } from '../domain/permissions';
import { clientNavigation, navigation, upcomingItems, type NavItem } from './navigation';
import './client-shell.css';

export function Shell() {
  const actor = useActor(); const setUser = useSession(state => state.setUserId); const location = useLocation(); const navigate = useNavigate();
  const [menu, setMenu] = useState(false); const [roles, setRoles] = useState(false);
  const module = location.pathname.split('/')[1] || 'inicio';
  const connection = useSyncExternalStore(remoteSource.subscribeConnection, remoteSource.getConnection);
  const connectionLabel = !serverMode ? 'Demostración local' : connection === 'ok' ? 'Datos sincronizados' : connection === 'error' ? 'Sin conexión confirmada: revisa tu red' : 'Comprobando conexión';
  const isClient = actor.rol === 'Cliente';
  const upcoming = upcomingItems(actor);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  // Si se entra a un módulo próximo (por enlace o dirección), la sección se abre para mostrarlo marcado.
  const onUpcoming = upcoming.some(item => item.module === module);
  useEffect(() => { if (onUpcoming) setUpcomingOpen(true); }, [onUpcoming]);
  const navItem = (item: NavItem) => <NavLink key={item.module} to={fleetContextLink(`/${item.module}`,location.pathname,location.search)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><item.icon size={18} strokeWidth={1.7} /><span>{item.title}</span></NavLink>;
  const title = (isClient ? clientNavigation.find(item => item.path === module)?.label : navigation.flatMap(group => group.items).find(item => item.module === module)?.title) ?? 'Portal del cliente';
  useEffect(() => setMenu(false), [location.pathname]);
  useEffect(() => { if (!canAccessModule(actor, module)) navigate(actor.rol === 'Cliente' ? '/portal' : '/inicio', { replace: true }); }, [actor, module, navigate]);
  return <div className={`app-shell ${isClient ? 'client-shell' : ''}`}>
    {menu && <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
      <NavLink to={isClient ? '/portal' : '/inicio'} className="brand-link" aria-label="Portal EM, inicio"><Brand /></NavLink>
      <div className="workspace-label"><span className="workspace-symbol">E</span><div><strong>EMSA Guatemala</strong><small>Gestión de flota y servicio</small></div><span className="online-dot" data-connection={serverMode ? connection : "local"} role="status" aria-label={connectionLabel} title={connectionLabel} /></div>
      <nav aria-label="Navegación principal">
        {isClient ? <>{clientNavigation.map(item=><NavLink key={item.path} className="nav-item" to={fleetContextLink(`/${item.path}`,location.pathname,location.search)}><item.icon size={18}/><span>{item.label}</span></NavLink>)}</> : navigation.map(group => {
          const items = group.items.filter(item => !item.upcoming && canAccessModule(actor, item.module));
          return items.length ? <div className="nav-group" key={group.label}><p>{group.label}</p>{items.map(navItem)}</div> : null;
        })}
        {upcoming.length > 0 && <div className="nav-group"><button type="button" className="nav-group-toggle" aria-expanded={upcomingOpen} aria-controls="nav-proximamente" onClick={() => setUpcomingOpen(open => !open)}>PRÓXIMAMENTE<span className="nav-group-count">{upcoming.length}</span><ChevronDown size={14} aria-hidden="true" /></button><div id="nav-proximamente" hidden={!upcomingOpen}>{upcoming.map(navItem)}</div></div>}
      </nav>
      <div className="sidebar-bottom"><span className="small-square"><ShieldCheck size={17} /></span><div><strong>{serverMode ? 'Pruebas en línea' : 'Espacio de demostración'}</strong><small>{serverMode ? 'Datos compartidos · MySQL' : 'Datos ficticios · versión 0.1'}</small></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMenu(true)} aria-label="Abrir menú"><Menu size={22} /></button><span>Espacio de trabajo</span><ChevronRight size={14} /><strong>{title}</strong></div><div className="topbar-actions"><span className="demo-pill"><i />{serverMode ? 'Pruebas en línea' : 'Demostración'}</span><button className="profile-button" onClick={() => setRoles(true)} aria-label={serverMode ? 'Ver cuenta' : 'Cambiar usuario de demostración'}><span className="avatar">{actor.rol === 'Administrador' ? 'AD' : actor.nombre.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><span className="profile-text"><strong>{actor.rol}</strong><small>{serverMode ? actor.nombre : 'Cambiar vista'}</small></span><ChevronDown size={14} /></button></div></header>
      <main id="main-content" className="main-content" key={actor.id}>{canAccessModule(actor, module) && <Outlet />}</main>
      <footer className="app-footer"><span>© {new Date().getFullYear()} Expertos en Montacargas, S.A.</span><span>Hecho para mantener tu operación en movimiento.</span></footer>
    </div>
    {roles && !serverMode && <Modal title="Explorar como…" onClose={() => setRoles(false)}><p className="modal-intro">Cambia de perfil para revisar la navegación. Este selector es una simulación; los accesos reales se conectarán antes de usar información de la empresa.</p><div className="role-options">{demoUsers.map(user => <button key={user.id} className={`role-option ${actor.id === user.id ? 'selected' : ''}`} onClick={() => { setUser(user.id); setRoles(false); navigate(user.rol === 'Cliente' ? '/portal' : '/inicio'); }}><span className="role-avatar">{user.rol === 'Cliente' ? <Building2 size={20} /> : <ShieldCheck size={20} />}</span><span><strong>{user.nombre}</strong><small>{user.rol}</small></span>{user.id === actor.id ? <span className="selected-dot" /> : <ChevronRight size={16} />}</button>)}</div><a className="operator-link" href="/revision/TCL-001" onClick={() => setRoles(false)}>Ver acceso del operador sin cuenta<ArrowUpRight size={16} /></a></Modal>}
    {roles && serverMode && <AccountDialog onClose={() => setRoles(false)} />}
    <Toast />
  </div>;
}
