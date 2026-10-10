import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Building2, CalendarDays, ChartNoAxesColumn, ChevronDown, ChevronRight, ClipboardList, Clock3, Database, FileText, Forklift, LayoutGrid, ListChecks, Menu, Route, Settings2, ShieldCheck, Ticket, Wallet, Wrench, type LucideIcon } from 'lucide-react';
import { Brand, Modal, Toast } from './ui';
import { demoUsers } from '../data/seed';
import { useActor, useSession } from '../app/state';
import { serverMode } from '../data/source';
import { AccountDialog } from '../features/settings/AccountDialog';
import { canAccessModule } from '../domain/permissions';
import './client-shell.css';

type NavItem = { module: string; title: string; icon: LucideIcon; stage?: number };
export const navigation: { label: string; items: NavItem[] }[] = [
  { label: 'ESPACIO DE TRABAJO', items: [{ module: 'inicio', title: 'Inicio', icon: LayoutGrid }, { module: 'flota', title: 'Flota de equipos', icon: Forklift, stage: 3 }, { module: 'clientes', title: 'Clientes', icon: Building2, stage: 2 }, { module: 'contratos', title: 'Contratos', icon: FileText, stage: 2 }] },
  { label: 'SERVICIO Y OPERACIÓN', items: [{ module: 'tickets', title: 'Tickets', icon: Ticket, stage: 4 }, { module: 'ordenes', title: 'Órdenes de servicio', icon: ClipboardList, stage: 5 }, { module: 'preventivos', title: 'Mantenimiento', icon: Wrench, stage: 6 }, { module: 'calendario', title: 'Calendario', icon: CalendarDays }, { module: 'planificador', title: 'Planificador', icon: LayoutGrid }, { module: 'checklists', title: 'Checklist diario', icon: ListChecks, stage: 7 }, { module: 'horas', title: 'Horas de técnicos', icon: Clock3, stage: 8 }, { module: 'viaticos', title: 'Viáticos', icon: Wallet, stage: 8 }, { module: 'reportes', title: 'Reportes', icon: ChartNoAxesColumn, stage: 8 }] },
  { label: 'ADMINISTRACIÓN', items: [{ module: 'catalogos', title: 'Catálogos', icon: Settings2 }, { module: 'datos', title: 'Datos y respaldos', icon: Database }, { module: 'accesos', title: 'Roles y accesos', icon: ShieldCheck }, { module: 'plan', title: 'Plan de trabajo', icon: Route }] },
];
export function Shell() {
  const actor = useActor(); const setUser = useSession(state => state.setUserId); const location = useLocation(); const navigate = useNavigate();
  const [menu, setMenu] = useState(false); const [roles, setRoles] = useState(false);
  const module = location.pathname.split('/')[1] || 'inicio';
  const title = navigation.flatMap(group => group.items).find(item => item.module === module)?.title ?? 'Portal del cliente';
  const isClient = actor.rol === 'Cliente';
  useEffect(() => setMenu(false), [location.pathname]);
  useEffect(() => { if (!canAccessModule(actor, module)) navigate(actor.rol === 'Cliente' ? '/portal' : '/inicio', { replace: true }); }, [actor, module, navigate]);
  return <div className={`app-shell ${isClient ? 'client-shell' : ''}`}>
    {menu && <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
      <NavLink to={isClient ? '/portal' : '/inicio'} className="brand-link" aria-label="Portal EM, inicio"><Brand /></NavLink>
      <div className="workspace-label"><span className="workspace-symbol">E</span><div><strong>EMSA Guatemala</strong><small>Gestión de flota y servicio</small></div><span className="online-dot" /></div>
      <nav aria-label="Navegación principal">
        {isClient ? <>{[{path:'portal',label:'Mi empresa',icon:LayoutGrid},{path:'tickets',label:'Solicitudes',icon:Ticket},{path:'ordenes',label:'Reportes de servicio',icon:ClipboardList},{path:'calendario',label:'Agenda',icon:CalendarDays},{path:'reportes',label:'Indicadores',icon:ChartNoAxesColumn}].map(item=><NavLink key={item.path} className="nav-item" to={`/${item.path}`}><item.icon size={18}/><span>{item.label}</span></NavLink>)}</> : navigation.map(group => {
          const items = group.items.filter(item => canAccessModule(actor, item.module));
          return items.length ? <div className="nav-group" key={group.label}><p>{group.label}</p>{items.map(item => <NavLink key={item.module} to={`/${item.module}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><item.icon size={18} strokeWidth={1.7} /><span>{item.title}</span>{['contratos','checklists','horas','viaticos'].includes(item.module) && <span className="nav-stage" title="Pendiente por alcance">—</span>}</NavLink>)}</div> : null;
        })}
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
