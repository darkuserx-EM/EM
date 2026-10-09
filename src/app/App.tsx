import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, Link } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { Home } from '../features/home/Home';
import { ModulePage } from '../features/modules/ModulePage';
import { RecordsPage } from '../features/records/RecordsPage';
import { AccessPage, PlanPage } from '../features/settings/Settings';
import { ClientPortal, OperatorPreview } from '../features/portal/Portal';
import { Brand } from '../components/ui';
const Catalogs = lazy(() => import('../features/catalogs/Catalogs'));
const MaintenancePage = lazy(() => import('../features/fleet/MaintenancePage'));
const DataPage = lazy(() => import('../features/data/DataPage'));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Do not log customer data or overwrite damaged storage. */ }
  render() {
    return this.state.error ? <div className="fatal-error"><Brand /><h1>No pudimos abrir el espacio local.</h1><p>{this.state.error}</p><p>Conserva los datos del navegador y solicita revisar o recuperar el respaldo antes de borrarlos.</p><button className="button" onClick={() => window.location.reload()}>Volver a intentar</button></div> : this.props.children;
  }
}
export default function App() {
  return <ErrorBoundary><BrowserRouter><a className="skip-link" href="#main-content">Ir al contenido</a><Suspense fallback={<div className="loading-screen">Preparando tu espacio…</div>}><Routes><Route path="/revision/TCL-001" element={<OperatorPreview />} /><Route element={<Shell />}><Route index element={<Navigate to="/inicio" replace />} /><Route path="inicio" element={<Home />} /><Route path="catalogos" element={<Catalogs />} /><Route path="datos" element={<DataPage />} /><Route path="accesos" element={<AccessPage />} /><Route path="plan" element={<PlanPage />} /><Route path="portal" element={<ClientPortal />} /><Route path="flota" element={<RecordsPage key="flota" module="flota" />} /><Route path="clientes" element={<RecordsPage key="clientes" module="clientes" />} /><Route path="preventivos" element={<MaintenancePage />} />{['contratos', 'tickets', 'ordenes', 'calendario', 'checklists', 'horas', 'viaticos', 'costos', 'reportes', 'dashboard'].map(path => <Route key={path} path={path} element={<ModulePage />} />)}<Route path="*" element={<div className="empty-state"><h1>Esta página no existe</h1><Link className="button" to="/inicio">Volver al inicio</Link></div>} /></Route></Routes></Suspense></BrowserRouter></ErrorBoundary>;
}
