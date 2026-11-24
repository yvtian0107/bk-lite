// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatasourceItem } from '@/app/ops-analysis/types/dataSource';
import type { ValueConfig } from '@/app/ops-analysis/types/dashBoard';

const testState = vi.hoisted(() => ({
  getSourceDataByApiId: vi.fn(),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, defaultMessage?: string, values?: Record<string, string>) => {
      const template = defaultMessage || key;
      if (!values) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
    },
  }),
}));

vi.mock('@/app/ops-analysis/api/topology', () => ({
  useTopologyApi: () => ({
    saveTopology: vi.fn(),
    getTopologyDetail: vi.fn(),
  }),
}));

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => ({
    getSourceDataByApiId: (...args: unknown[]) => testState.getSourceDataByApiId(...args),
  }),
  withRuntimeSourceDataErrorSuppression: <T,>(fn: T) => fn,
}));

import { useGraphData } from '../useGraphData';

const room = {
  name: 'server_room_id',
  alias_name: '机房',
  type: 'string',
  filterType: 'filter',
  value: '',
  required: true,
};

const target = {
  name: 'monitor_object_id',
  alias_name: '监控对象',
  type: 'string',
  filterType: 'params',
  value: '',
  required: true,
};

const filters = [{
  id: 'server_room_id__string',
  key: 'server_room_id',
  name: '机房',
  type: 'string' as const,
  enabled: true,
}];

const chartConfig = (params: unknown[]): ValueConfig => ({
  dataSource: 120,
  chartType: 'pie',
  dataSourceParams: params as ValueConfig['dataSourceParams'],
  filterBindings: { 'server_room_id__string': true },
});

const sourceOf = (params: unknown): DatasourceItem => ({
  id: 120,
  params,
} as unknown as DatasourceItem);

const createFakeNode = (initial: Record<string, unknown>) => {
  let data: Record<string, unknown> = { ...initial };
  return {
    id: String(initial.id),
    getData: () => data,
    setData: (next: Record<string, unknown>) => {
      data = { ...next };
    },
    isNode: () => true,
  };
};

const createGraph = (node: ReturnType<typeof createFakeNode>) => ({
  getCellById: (id: string) => (id === node.id ? node : null),
  getNodes: () => [node],
});

afterEach(() => {
  testState.getSourceDataByApiId.mockReset();
});

describe('topology chart required parameter and catalog states', () => {
  it('waits for one missing parameter and does not draw the previous chart', async () => {
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      rawData: { name: '旧图' },
      csvRequestParams: { server_room_id: 'old' },
      valueConfig: chartConfig([room]),
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        chartConfig([room]),
        { 'server_room_id__string': '   ' },
        filters as never,
        sourceOf([room]),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });

    expect(testState.getSourceDataByApiId).not.toHaveBeenCalled();
    expect(node.getData().isLoading).toBe(false);
    expect(node.getData().hasError).toBe(false);
    expect(node.getData().chartRequestState).toBe('waiting');
    expect(node.getData().waitMessage).toBe('请选择机房');
    expect(node.getData().rawData).toBeNull();
    expect(node.getData().csvRequestParams).toBeUndefined();
  });

  it('lists every missing parameter once', async () => {
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      rawData: { name: '旧图' },
      valueConfig: chartConfig([room, target]),
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        chartConfig([room, target]),
        { 'server_room_id__string': '' },
        filters as never,
        sourceOf([room, target]),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });

    expect(testState.getSourceDataByApiId).not.toHaveBeenCalled();
    expect(node.getData().waitMessage).toBe('请补充：机房、监控对象');
    expect(node.getData().hasError).toBe(false);
    expect(node.getData().rawData).toBeNull();
  });

  it('does not fetch while the catalog is still loading', async () => {
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      valueConfig: chartConfig([{ ...room, required: undefined }]),
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));

    await act(async () => {
      result.current.refreshAllChartNodes(
        {},
        filters as never,
        [],
        undefined,
        undefined,
        { dataSourceLookupStatus: 'loading' },
      );
      await Promise.resolve();
    });

    expect(testState.getSourceDataByApiId).not.toHaveBeenCalled();
    expect(node.getData().chartRequestState).toBe('pending');
    expect(node.getData().isLoading).toBe(true);
    expect(node.getData().hasError).toBe(false);
  });

  it('ends loading with a catalog error and does not fetch', async () => {
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      isLoading: true,
      valueConfig: chartConfig([room]),
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));

    await act(async () => {
      result.current.refreshAllChartNodes(
        {},
        filters as never,
        [],
        undefined,
        undefined,
        { dataSourceLookupStatus: 'error' },
      );
      await Promise.resolve();
    });

    expect(testState.getSourceDataByApiId).not.toHaveBeenCalled();
    expect(node.getData().isLoading).toBe(false);
    expect(node.getData().hasError).toBe(true);
    expect(node.getData().chartRequestState).toBe('error');
    expect(node.getData().errorMessage).toBe('dashboard.dataSourceLoadFailed');
    expect(node.getData().rawData).toBeNull();
  });

  it('fetches after the value is applied and ignores the previous response after a clear', async () => {
    let resolveFetch: (value: { data: { name: string } }) => void = () => undefined;
    testState.getSourceDataByApiId.mockImplementation(
      () => new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      rawData: { name: '旧图' },
      valueConfig: chartConfig([room]),
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));
    const loaded = result.current.loadChartNodeData(
      'chart-1',
      chartConfig([room]),
      { 'server_room_id__string': 'room-1' },
      filters as never,
      sourceOf([room]),
      undefined,
      undefined,
      { dataSourceLookupStatus: 'success' },
    );
    await waitFor(() => {
      expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        chartConfig([room]),
        { 'server_room_id__string': '' },
        filters as never,
        sourceOf([room]),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });
    expect(node.getData().chartRequestState).toBe('waiting');
    expect(node.getData().rawData).toBeNull();

    await act(async () => {
      resolveFetch({ data: { name: '旧响应' } });
      await loaded;
    });
    expect(node.getData().rawData).toBeNull();
    expect(node.getData().waitMessage).toBe('请选择机房');
    expect(node.getData().hasError).toBe(false);
    expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(1);
  });

  it('drops an in-flight error after the applied value is cleared', async () => {
    let rejectFetch: (error: Error) => void = () => undefined;
    testState.getSourceDataByApiId.mockImplementation(
      () => new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      rawData: { name: '旧图' },
      valueConfig: chartConfig([room]),
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));
    const loaded = result.current.loadChartNodeData(
      'chart-1',
      chartConfig([room]),
      { 'server_room_id__string': 'room-1' },
      filters as never,
      sourceOf([room]),
      undefined,
      undefined,
      { dataSourceLookupStatus: 'success' },
    );
    await waitFor(() => {
      expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        chartConfig([room]),
        { 'server_room_id__string': null },
        filters as never,
        sourceOf([room]),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
      rejectFetch(new Error('stale'));
      await loaded.catch(() => undefined);
    });

    expect(node.getData().hasError).toBe(false);
    expect(node.getData().chartRequestState).toBe('waiting');
    expect(node.getData().rawData).toBeNull();
  });

  it('resumes the request after the missing value is applied', async () => {
    testState.getSourceDataByApiId.mockResolvedValue({ data: { name: '恢复' } });
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      valueConfig: chartConfig([room]),
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        chartConfig([room]),
        { 'server_room_id__string': '' },
        filters as never,
        sourceOf([room]),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });
    expect(testState.getSourceDataByApiId).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        chartConfig([room]),
        { 'server_room_id__string': 'room-1' },
        filters as never,
        sourceOf([room]),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });

    expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(1);
    expect(node.getData().chartRequestState).toBe('ready');
    expect(node.getData().rawData).toEqual({ name: '恢复' });
    expect(node.getData().hasError).toBe(false);
    expect(node.getData().waitMessage).toBeUndefined();
  });

  it('requests a parameterless null catalog and an empty catalog, and stops an illegal catalog', async () => {
    testState.getSourceDataByApiId.mockResolvedValue({ data: { name: '无参' } });
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      valueConfig: { dataSource: 120, chartType: 'pie' },
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));
    const plain: ValueConfig = { dataSource: 120, chartType: 'pie' };

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        plain,
        {},
        [],
        sourceOf(null),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });
    expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(1);
    expect(node.getData().chartRequestState).toBe('ready');

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        plain,
        {},
        [],
        sourceOf([]),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });
    expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(2);
    expect(node.getData().rawData).toEqual({ name: '无参' });

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        plain,
        {},
        [],
        sourceOf({ bad: true }),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });
    expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(2);
    expect(node.getData().isLoading).toBe(false);
    expect(node.getData().hasError).toBe(true);
    expect(node.getData().errorMessage).toBe('dashboard.dataSourceParamsInvalid');
    expect(node.getData().rawData).toBeNull();
  });

  it('keeps a real empty payload distinct from the wait state', async () => {
    testState.getSourceDataByApiId.mockResolvedValue({ data: null });
    const node = createFakeNode({
      id: 'chart-1',
      type: 'chart',
      valueConfig: { dataSource: 120, chartType: 'pie' },
    });
    const { result } = renderHook(() => useGraphData(createGraph(node) as never, vi.fn()));

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        { dataSource: 120, chartType: 'pie' },
        {},
        [],
        sourceOf([]),
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });

    expect(node.getData().chartRequestState).toBe('empty');
    expect(node.getData().hasError).toBe(false);
    expect(node.getData().isLoading).toBe(false);
    expect(node.getData().waitMessage).toBeUndefined();
  });
});
