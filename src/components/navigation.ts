// Menú lateral: grupos y módulos del personal, y menú del cliente. Sin dependencias del navegador, para poder probarlo.
import { Building2, CalendarDays, ChartNoAxesColumn, ClipboardList, Clock3, Database, FileText, Forklift, LayoutGrid, ListChecks, Route, Settings2, ShieldCheck, Ticket, Wallet, Wrench, type LucideIcon } from 'lucide-react';
import { canAccessModule } from '../domain/permissions';

/** `upcoming`: módulo sin construir. Se muestra en la sección plegable «Próximamente», al final del menú. */
export type NavItem = { module: string; title: string; icon: LucideIcon; stage?: number; upcoming?: boolean };
export const navigation: { label: string; items: NavItem[] }[] = [
  { label: 'ESPACIO DE TRABAJO', items: [{ module: 'inicio', title: 'Inicio', icon: LayoutGrid }, { module: 'flota', title: 'Flota de equipos', icon: Forklift, stage: 3 }, { module: 'clientes', title: 'Clientes', icon: Building2, stage: 2 }, { module: 'contratos', title: 'Contratos', icon: FileText, stage: 2, upcoming: true }] },
  { label: 'SERVICIO Y OPERACIÓN', items: [{ module: 'tickets', title: 'Solicitudes', icon: Ticket, stage: 4 }, { module: 'ordenes', title: 'Órdenes de servicio', icon: ClipboardList, stage: 5 }, { module: 'preventivos', title: 'Mantenimiento', icon: Wrench, stage: 6 }, { module: 'calendario', title: 'Calendario', icon: CalendarDays }, { module: 'planificador', title: 'Planificador', icon: LayoutGrid }, { module: 'checklists', title: 'Checklist diario', icon: ListChecks, stage: 7, upcoming: true }, { module: 'horas', title: 'Horas de técnicos', icon: Clock3, stage: 8, upcoming: true }, { module: 'viaticos', title: 'Viáticos', icon: Wallet, stage: 8, upcoming: true }, { module: 'reportes', title: 'Reportes', icon: ChartNoAxesColumn, stage: 8 }] },
  { label: 'ADMINISTRACIÓN', items: [{ module: 'catalogos', title: 'Catálogos', icon: Settings2 }, { module: 'datos', title: 'Datos y respaldos', icon: Database }, { module: 'accesos', title: 'Roles y accesos', icon: ShieldCheck }, { module: 'plan', title: 'Plan de trabajo', icon: Route }] },
];
/** Módulos sin construir que el perfil puede abrir: van en la sección «Próximamente». */
export const upcomingItems = (actor: Parameters<typeof canAccessModule>[0]) => navigation.flatMap(group => group.items).filter(item => item.upcoming && canAccessModule(actor, item.module));
/** Menú del cliente: sus nombres también se usan en la ruta de navegación. */
export const clientNavigation = [{ path: 'portal', label: 'Mi empresa', icon: LayoutGrid }, { path: 'tickets', label: 'Solicitudes', icon: Ticket }, { path: 'ordenes', label: 'Reportes de servicio', icon: ClipboardList }, { path: 'calendario', label: 'Agenda', icon: CalendarDays }, { path: 'reportes', label: 'Indicadores', icon: ChartNoAxesColumn }];
