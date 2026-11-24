// @vitest-environment jsdom

import { message } from 'antd';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSingleValueConfig } from '../useSingleValueConfig';

const translate = vi.hoisted(() => (
  id: string,
  _defaultMessage?: string,
  values?: Record<string, string>,
) => {
  if (id === 'dashboard.requiredParamListSeparator') return '、';
  if (id === 'dashboard.selectRequiredParam') return `请选择${values?.label ?? ''}`;
  if (id === 'dashboard.fillRequiredParams') return `请补充：${values?.labels ?? ''}`;
  return id;
});

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({ t: translate }),
}));

const room = {
  name: 'server_room_id',
  alias_name: '机房',
  type: 'string' as const,
  filterType: 'params' as const,
  value: '',
  required: true,
};

const renderConfig = (
  source: { id: number; params: unknown },
  params: Record<string, unknown>,
  api: ReturnType<typeof vi.fn>,
) => renderHook(() => useSingleValueConfig({
  form: {
    getFieldsValue: () => ({ params }),
    getFieldValue: () => false,
    setFieldsValue: () => undefined,
  } as never,
  selectedDataSource: source as never,
  dataSourceId: source.id,
  getSourceDataByApiId: api as never,
  chartType: 'single',
}));

describe('single value config required catalog', () => {
  it('does not request when a required catalog value is empty', async () => {
    const api = vi.fn();
    const warning = vi.spyOn(message, 'warning').mockImplementation(() => ({}) as never);
    const { result } = renderConfig({ id: 7, params: [room] }, { server_room_id: '' }, api);

    await act(async () => {
      await result.current.fetchSingleValueDataFields();
    });

    expect(api).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('请选择机房');
    expect(result.current.loadingSingleValueData).toBe(false);
    warning.mockRestore();
  });

  it('requests when the catalog has no params, including a null catalog list', async () => {
    const api = vi.fn(async () => ({ data: { cpu: 1 } }));
    const { result } = renderConfig({ id: 7, params: null }, {}, api);

    await act(async () => {
      await result.current.fetchSingleValueDataFields();
    });

    expect(api).toHaveBeenCalledTimes(1);
  });

  it('reports a catalog whose params are neither a list nor null', async () => {
    const api = vi.fn();
    const error = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
    const { result } = renderConfig({ id: 7, params: undefined }, {}, api);

    await act(async () => {
      await result.current.fetchSingleValueDataFields();
    });

    expect(api).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('dashboard.dataSourceParamsInvalid');
    error.mockRestore();
  });

  it('reports an invalid catalog without requesting', async () => {
    const api = vi.fn();
    const error = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
    const { result } = renderConfig({ id: 7, params: { broken: true } }, {}, api);

    await act(async () => {
      await result.current.fetchSingleValueDataFields();
    });

    expect(api).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('dashboard.dataSourceParamsInvalid');
    error.mockRestore();
  });
});
