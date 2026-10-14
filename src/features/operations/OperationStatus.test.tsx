import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperationStatus, operationTone } from './OperationStatus';

describe('OperationStatus', () => {
  it('usa Badge con el tono del estado', () => {
    expect(renderToStaticMarkup(<OperationStatus value="Programada" />)).toBe('<span class="status blue"><i aria-hidden="true"></i>Programada</span>');
    expect(renderToStaticMarkup(<OperationStatus value="" />)).toBe('<span class="status neutral"><i aria-hidden="true"></i>Sin estado</span>');
  });

  it('listo en verde, programado o en curso en azul, en espera o en revisión en ámbar', () => {
    expect(['Completada', 'Resuelto', 'Finalizado'].map(operationTone)).toEqual(['success', 'success', 'success']);
    expect(['En proceso', 'Programada', 'Programado'].map(operationTone)).toEqual(['info', 'info', 'info']);
    expect(['En espera', 'En revisión'].map(operationTone)).toEqual(['warning', 'warning']);
    expect(['Borrador', 'Pendiente de firma'].map(operationTone)).toEqual(['neutral', 'neutral']);
  });
});
