import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Wrench } from 'lucide-react';
import { SectionTitle } from '../../components/ui';
import { ButtonLink, Panel } from '../../components/design-system';
import { stages } from '../../domain/model';
import { navigation } from '../../components/navigation';

export function ModulePage({ module: fixedModule }: { module?: string }) {
  const location = useLocation(); const module = fixedModule ?? location.pathname.split('/')[1];
  const stage = stages.find(item => item.modules.includes(module));
  const title = navigation.flatMap(group => group.items).find(item => item.module === module)?.title ?? 'Módulo en preparación';
  return <><SectionTitle eyebrow={navigation.find(group => group.items.some(item => item.module === module))?.label ?? 'ESPACIO DE TRABAJO'} title={title} description={stage?.detail ?? 'Estamos preparando este espacio.'} /><div className="phase-banner"><span className="phase-number">{String(stage?.id ?? 1).padStart(2, '0')}</span><div><strong>Un espacio listo para crecer</strong><p>La gestión completa de este módulo se construirá en la etapa {stage?.id}.</p></div><Link to="/plan">Ver plan<ArrowRight size={16} /></Link></div><Panel className="upcoming-panel"><div className="upcoming-art" aria-hidden="true"><Wrench size={48} strokeWidth={1} /><span>{String(stage?.id ?? 1).padStart(2, '0')}</span></div><span className="eyebrow">PRÓXIMAMENTE · ETAPA {stage?.id}</span><h2>Primero una base sólida.<br />Después, cada detalle de tu operación.</h2><p>{stage?.detail} Revisaremos las reglas de este módulo antes de construirlo.</p><ButtonLink to="/plan">Explorar el plan de trabajo<ArrowRight size={16} /></ButtonLink></Panel></>;
}
