import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanStatus } from './PlanCycle';
import type { PlanProjection } from '../../domain/maintenance-plan';

const status = (tone: PlanProjection['tone'], value: string, estimated = false) => renderToStaticMarkup(<PlanStatus projection={{ status: value, tone, detail: '', estimated }} />);

describe('PlanStatus', () => {
  it('usa Badge con el tono del plan', () => {
    expect(status('good', 'Al día')).toBe('<span class="status green"><i aria-hidden="true"></i>Al día</span>');
    expect(status('warning', 'Por vencer')).toContain('class="status amber"');
    expect(status('neutral', 'Sin plan')).toContain('class="status neutral"');
  });

  it('conserva el texto del estado, incluida la marca de estimado', () => {
    expect(status('danger', 'Vencido', true)).toBe('<span class="status red"><i aria-hidden="true"></i>Vencido · estimado</span>');
  });
});
