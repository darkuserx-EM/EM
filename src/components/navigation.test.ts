import { describe, expect, it } from 'vitest';
import { navigation, upcomingItems } from './navigation';
import { demoUsers } from '../data/seed';

const user = (id: string) => demoUsers.find(item => item.id === id)!;
const modules = (id: string) => upcomingItems(user(id)).map(item => item.module);

describe('menú lateral · «Próximamente»', () => {
  it('reúne solo los cuatro módulos sin construir, que conservan su grupo para el antetítulo', () => {
    expect(navigation.flatMap(group => group.items.filter(item => item.upcoming).map(item => `${group.label} / ${item.module}`))).toEqual(['ESPACIO DE TRABAJO / contratos', 'SERVICIO Y OPERACIÓN / checklists', 'SERVICIO Y OPERACIÓN / horas', 'SERVICIO Y OPERACIÓN / viaticos']);
  });

  it('muestra a cada perfil solo los módulos próximos que puede abrir', () => {
    expect(modules('user-admin')).toEqual(['contratos', 'checklists', 'horas', 'viaticos']);
    expect(modules('user-coord')).toEqual(['contratos', 'checklists']);
    expect(modules('user-tec1')).toEqual([]);
    expect(modules('user-client')).toEqual([]);
  });
});
