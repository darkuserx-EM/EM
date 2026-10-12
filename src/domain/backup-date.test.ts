import { expect, it, vi } from 'vitest';
import { todayGT } from './maintenance-plan';
it('nombra el respaldo con la fecha local de Guatemala después de medianoche UTC', () => {
  vi.useFakeTimers();
  try { vi.setSystemTime(new Date('2026-10-12T05:30:00Z')); expect(todayGT()).toBe('2026-10-11'); }
  finally { vi.useRealTimers(); }
});
