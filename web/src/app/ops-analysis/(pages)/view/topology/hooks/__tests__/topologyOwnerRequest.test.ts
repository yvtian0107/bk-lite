// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopologyNodeData } from '@/app/ops-analysis/types/topology';
import type { ValueConfig } from '@/app/ops-analysis/types/dashBoard';

const testState = vi.hoisted(() => ({
  fetchWidgetData: vi.fn(),
  fetchCompareData: vi.fn(),
  getSourceDataByApiId: vi.fn(),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/app/ops-analysis/api/topology', () => ({
  useTopologyApi: () => ({
    saveTopology: vi.fn(),
    getTopologyDetail: vi.fn(),
  }),
}));

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => ({
    getSourceDataByApiId: testState.getSourceDataByApiId,
  }),
  withRuntimeSourceDataErrorSuppression: <T,>(fn: T) => fn,
}));

vi.mock('@/app/ops-analysis/utils/widgetDataTransform', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/ops-analysis/utils/widgetDataTransform')
      >('@/app/ops-analysis/utils/widgetDataTransform');
  return {
    ...actual,
    fetchWidgetData: (...args: unknown[]) => testState.fetchWidgetData(...args),
  };
});

vi.mock('@/app/ops-analysis/utils/compareQuery', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/ops-analysis/utils/compareQuery')
      >('@/app/ops-analysis/utils/compareQuery');
  return {
    ...actual,
    fetchCompareData: (...args: unknown[]) => testState.fetchCompareData(...args),
  };
});

vi.mock('../../utils/singleValueNodeError', () => ({
  clearSingleValueFetchError: vi.fn(),
  resetSingleValueFetchErrorVisual: vi.fn(),
  showSingleValueFetchError: vi.fn(
    (node: { getData: () => Record<string, unknown>; setData: (next: Record<string, unknown>) => void }, errorMessage: string) => {
      node.setData({
        ...node.getData(),
        isLoading: false,
        hasError: true,
        fetchError: true,
        errorMessage,
      });
    },
  ),
  SINGLE_VALUE_ERROR_PLACEHOLDER: '--',
}));

vi.mock('../../utils/topologyUtils', async () => {
  const actual = await vi.importActual<
    typeof import('../../utils/topologyUtils')
      >('../../utils/topologyUtils');
  return {
    ...actual,
    adjustSingleValueNodeSize: vi.fn(),
  };
});

vi.mock('../../utils/registerNode', () => ({
  createNodeByType: vi.fn(),
  updateNodeAttributes: vi.fn(),
}));

import { updateNodeAttributes } from '../../utils/registerNode';
import { useGraphData } from '../useGraphData';
import { useGraphNodeOperations } from '../useGraphNodeOperations';

const chartValueConfig: ValueConfig = {
  dataSource: 7,
  chartType: 'pie',
};

const readyCatalog = { id: 7, params: [] };

const singleValueNode: TopologyNodeData = {
  id: 'sv-1',
  type: 'single-value',
  name: 'cpu',
  valueConfig: {
    dataSource: 7,
    selectedFields: ['cpu'],
  },
};

const createFakeNode = (initial: Record<string, unknown> = {}) => {
  let data: Record<string, unknown> = { ...initial };
  return {
    getData: () => data,
    setData: (next: Record<string, unknown>) => {
      data = { ...next };
    },
    setAttrByPath: vi.fn(),
    isNode: () => true,
  };
};

const createFakeGraph = (nodes: Record<string, ReturnType<typeof createFakeNode>>) => ({
  getCellById: (id: string) => nodes[id] ?? null,
});

afterEach(() => {
  testState.fetchWidgetData.mockReset();
  testState.fetchCompareData.mockReset();
  testState.getSourceDataByApiId.mockReset();
  vi.mocked(updateNodeAttributes).mockReset();
});

describe('topology chart node owner requests', () => {
  it('skips a silent tick while a manual chart request is in flight and still accepts the manual success', async () => {
    const node = createFakeNode({ type: 'chart', rawData: { name: 'A' } });
    const graph = createFakeGraph({ 'chart-1': node });
    let resolveManual: ((value: unknown) => void) | undefined;
    testState.fetchWidgetData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveManual = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useGraphData(graph as never, vi.fn()),
    );

    void result.current.loadChartNodeData('chart-1', chartValueConfig, undefined, undefined, readyCatalog);
    await Promise.resolve();
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.loadChartNodeData('chart-1', chartValueConfig, undefined, undefined, readyCatalog, undefined, undefined, {
        silent: true,
      });
    });
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveManual?.({ name: 'Manual' });
      await Promise.resolve();
    });
    expect(node.getData().rawData).toEqual({ name: 'Manual' });
    expect(node.getData().hasError).toBe(false);
  });

  it('skips a silent tick while a manual chart request is in flight and still records the manual error', async () => {
    const node = createFakeNode({ type: 'chart', rawData: { name: 'A' } });
    const graph = createFakeGraph({ 'chart-1': node });
    let rejectManual: ((reason?: unknown) => void) | undefined;
    testState.fetchWidgetData.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectManual = reject;
        }),
    );

    const { result } = renderHook(() =>
      useGraphData(graph as never, vi.fn()),
    );

    void result.current.loadChartNodeData('chart-1', chartValueConfig, undefined, undefined, readyCatalog);
    await Promise.resolve();

    await act(async () => {
      await result.current.loadChartNodeData('chart-1', chartValueConfig, undefined, undefined, readyCatalog, undefined, undefined, {
        silent: true,
      });
    });
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectManual?.(new Error('manual failed'));
      await Promise.resolve();
    });
    expect(node.getData().rawData).toBeNull();
    expect(node.getData().hasError).toBe(true);
  });

  it('lets a manual chart request become latest while a silent request is in flight', async () => {
    const node = createFakeNode({ type: 'chart', rawData: { name: 'A' } });
    const graph = createFakeGraph({ 'chart-1': node });
    let resolveSilent: ((value: unknown) => void) | undefined;
    let resolveManual: ((value: unknown) => void) | undefined;
    testState.fetchWidgetData
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSilent = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveManual = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useGraphData(graph as never, vi.fn()),
    );

    void result.current.loadChartNodeData(
      'chart-1',
      chartValueConfig,
      undefined,
      undefined,
      readyCatalog,
      undefined,
      undefined,
      { silent: true },
    );
    await Promise.resolve();

    void result.current.loadChartNodeData('chart-1', chartValueConfig, undefined, undefined, readyCatalog);
    await Promise.resolve();
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSilent?.({ name: 'Stale' });
      await Promise.resolve();
    });
    expect(node.getData().rawData).toEqual({ name: 'A' });

    await act(async () => {
      resolveManual?.({ name: 'Latest' });
      await Promise.resolve();
    });
    expect(node.getData().rawData).toEqual({ name: 'Latest' });
  });

  it('skips the next periodic tick when an older silent chart request is still in flight after a newer manual completes', async () => {
    const node = createFakeNode({ type: 'chart', rawData: { name: 'A' } });
    const graph = createFakeGraph({ 'chart-1': node });
    let resolveSilent: ((value: unknown) => void) | undefined;
    let resolveManual: ((value: unknown) => void) | undefined;
    testState.fetchWidgetData
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSilent = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveManual = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useGraphData(graph as never, vi.fn()),
    );

    void result.current.loadChartNodeData(
      'chart-1',
      chartValueConfig,
      undefined,
      undefined,
      readyCatalog,
      undefined,
      undefined,
      { silent: true },
    );
    await Promise.resolve();
    void result.current.loadChartNodeData('chart-1', chartValueConfig, undefined, undefined, readyCatalog);
    await Promise.resolve();
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveManual?.({ name: 'Latest' });
      await Promise.resolve();
    });
    expect(node.getData().rawData).toEqual({ name: 'Latest' });

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        chartValueConfig,
        undefined,
        undefined,
        readyCatalog,
        undefined,
        undefined,
        { silent: true },
      );
    });
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSilent?.({ name: 'Stale' });
      await Promise.resolve();
    });
    expect(node.getData().rawData).toEqual({ name: 'Latest' });
  });

  it('skips a visibility tick when an older manual chart request is still in flight after a newer manual completes', async () => {
    const node = createFakeNode({ type: 'chart', rawData: { name: 'A' } });
    const graph = createFakeGraph({ 'chart-1': node });
    let resolveOlder: ((value: unknown) => void) | undefined;
    let resolveNewer: ((value: unknown) => void) | undefined;
    testState.fetchWidgetData
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOlder = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNewer = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useGraphData(graph as never, vi.fn()),
    );

    void result.current.loadChartNodeData('chart-1', chartValueConfig, undefined, undefined, readyCatalog);
    await Promise.resolve();
    void result.current.loadChartNodeData('chart-1', chartValueConfig, undefined, undefined, readyCatalog);
    await Promise.resolve();
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveNewer?.({ name: 'Latest' });
      await Promise.resolve();
    });
    expect(node.getData().rawData).toEqual({ name: 'Latest' });

    await act(async () => {
      await result.current.loadChartNodeData(
        'chart-1',
        chartValueConfig,
        undefined,
        undefined,
        readyCatalog,
        undefined,
        undefined,
        { silent: true },
      );
    });
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveOlder?.({ name: 'Stale' });
      await Promise.resolve();
    });
    expect(node.getData().rawData).toEqual({ name: 'Latest' });
  });

  it('aborts the in-flight chart query when the canvas drops it and does not mark an error', async () => {
    const node = createFakeNode({ type: 'chart', rawData: { name: 'A' } });
    const graph = createFakeGraph({ 'chart-1': node });
    const signals: AbortSignal[] = [];
    testState.getSourceDataByApiId.mockImplementation((_id: number, _params: unknown, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise(() => {});
    });
    testState.fetchWidgetData.mockImplementation(async (input: {
      getSourceDataByApiId: (id: number, params?: unknown) => Promise<{ data: unknown }>;
    }) => {
      await input.getSourceDataByApiId(1, {});
      return { name: 'late' };
    });

    const { result } = renderHook(() => useGraphData(graph as never, vi.fn()));
    void result.current.loadChartNodeData(
      'chart-1',
      chartValueConfig,
      undefined,
      undefined,
      readyCatalog,
    );
    await waitFor(() => expect(signals).toHaveLength(1));

    act(() => {
      result.current.abortInflightChartRequests();
    });

    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(node.getData().hasError).not.toBe(true);
    expect(node.getData().rawData).toEqual({ name: 'A' });
  });
});

describe('topology table page lookup', () => {
  const installHandler = (
    lookup: 'loading' | 'success',
  ) => {
    const node = {
      ...createFakeNode({
        type: 'chart',
        valueConfig: { dataSource: 7, chartType: 'table', dataSourceParams: [] },
      }),
      id: 'chart-1',
    };
    const graph = {
      getCellById: () => node,
      getNodes: () => [node],
    };
    const { result } = renderHook(() => useGraphData(graph as never, vi.fn()));
    act(() => {
      result.current.refreshAllChartNodes(undefined, undefined, [], undefined, undefined, {
        dataSourceLookupStatus: lookup,
      });
    });
    node.setData({
      ...node.getData(),
      isLoading: false,
      hasError: false,
      errorMessage: undefined,
      chartRequestState: 'ready',
    });
    return node;
  };

  it('keeps a real pending page change pending and finishes a missing source after lookup success', async () => {
    const pendingNode = installHandler('loading');
    await act(async () => {
      pendingNode.getData().onTableQueryChange?.('chart-1', { page: 2, pageSize: 20 });
      await Promise.resolve();
    });
    expect(testState.fetchWidgetData).not.toHaveBeenCalled();
    expect(pendingNode.getData().chartRequestState).toBe('pending');
    expect(pendingNode.getData().hasError).not.toBe(true);

    const missingNode = installHandler('success');
    await act(async () => {
      missingNode.getData().onTableQueryChange?.('chart-1', { page: 3, pageSize: 20 });
      await Promise.resolve();
    });
    expect(testState.fetchWidgetData).not.toHaveBeenCalled();
    expect(missingNode.getData().hasError).toBe(true);
    expect(missingNode.getData().errorMessage).toBe('dashboard.dataSourceNotFound');
    expect(missingNode.getData().chartRequestState).toBe('error');
  });

  it('resumes a page that was left pending once the catalog lookup finishes', async () => {
    const node = {
      ...createFakeNode({
        type: 'chart',
        valueConfig: { dataSource: 7, chartType: 'table', dataSourceParams: [] },
      }),
      id: 'chart-1',
    };
    const graph = {
      getCellById: () => node,
      getNodes: () => [node],
    };
    const { result, rerender } = renderHook(
      ({ catalog }: { catalog: { dataSources: unknown[]; dataSourceLookupStatus: 'loading' | 'success' } }) =>
        useGraphData(graph as never, vi.fn(), undefined, catalog as never),
      {
        initialProps: {
          catalog: { dataSources: [], dataSourceLookupStatus: 'loading' as const },
        },
      },
    );

    act(() => {
      result.current.refreshAllChartNodes(undefined, undefined, [], undefined, undefined, {
        dataSourceLookupStatus: 'loading',
      });
    });
    await act(async () => {
      node.getData().onTableQueryChange?.('chart-1', { page: 2, pageSize: 20 });
      await Promise.resolve();
    });
    expect(testState.fetchWidgetData).not.toHaveBeenCalled();
    expect(node.getData().chartRequestState).toBe('pending');

    testState.fetchWidgetData.mockResolvedValue([{ name: '服务器', value: 1 }]);
    rerender({
      catalog: {
        dataSources: [{ id: 7, params: [] }],
        dataSourceLookupStatus: 'success',
      },
    });
    await waitFor(() => expect(testState.fetchWidgetData).toHaveBeenCalledTimes(1));
    expect(node.getData().chartRequestState).toBe('ready');

    await act(async () => {
      node.getData().onTableQueryChange?.('chart-1', { page: 3, pageSize: 20 });
      await Promise.resolve();
    });
    expect(testState.fetchWidgetData).toHaveBeenCalledTimes(2);
    expect(node.getData().chartRequestState).toBe('ready');
  });

  it('finishes a pending chart as not found when lookup succeeds without that source', async () => {
    const node = {
      ...createFakeNode({
        type: 'chart',
        valueConfig: { dataSource: 7, chartType: 'pie', dataSourceParams: [] },
      }),
      id: 'chart-2',
    };
    const graph = {
      getCellById: () => node,
      getNodes: () => [node],
    };
    const { result, rerender } = renderHook(
      ({ catalog }: { catalog: { dataSources: unknown[]; dataSourceLookupStatus: 'loading' | 'success' } }) =>
        useGraphData(graph as never, vi.fn(), undefined, catalog as never),
      {
        initialProps: {
          catalog: { dataSources: [], dataSourceLookupStatus: 'loading' as const },
        },
      },
    );

    act(() => {
      result.current.refreshAllChartNodes(undefined, undefined, [], undefined, undefined, {
        dataSourceLookupStatus: 'loading',
      });
    });
    expect(testState.fetchWidgetData).not.toHaveBeenCalled();
    expect(node.getData().chartRequestState).toBe('pending');

    rerender({
      catalog: { dataSources: [], dataSourceLookupStatus: 'success' },
    });
    await waitFor(() => expect(node.getData().chartRequestState).toBe('error'));
    expect(node.getData().errorMessage).toBe('dashboard.dataSourceNotFound');
    expect(testState.fetchWidgetData).not.toHaveBeenCalled();
  });
});

describe('topology single-value node owner requests', () => {
  const dummyState = {} as never;

  it('skips a silent tick while a manual single-value request is in flight and still accepts the manual success', async () => {
    const node = createFakeNode({ type: 'single-value' });
    const graph = createFakeGraph({ 'sv-1': node });
    let resolveManual: ((value: unknown) => void) | undefined;
    testState.fetchCompareData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveManual = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: dummyState,
        handleSave: vi.fn(),
      }),
    );

    void result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
      dataSource: readyCatalog as never,
    });
    await Promise.resolve();
    expect(testState.fetchCompareData).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
        silent: true,
        dataSource: readyCatalog as never,
      });
    });
    expect(testState.fetchCompareData).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveManual?.({ currentData: { cpu: 42 }, baselineData: null });
      await Promise.resolve();
    });
    expect(node.setAttrByPath).toHaveBeenCalledWith('label/text', '42');
    expect(node.getData().hasError).toBe(false);
  });

  it('skips a silent tick while a manual single-value request is in flight and still records the manual error', async () => {
    const node = createFakeNode({ type: 'single-value' });
    const graph = createFakeGraph({ 'sv-1': node });
    let rejectManual: ((reason?: unknown) => void) | undefined;
    testState.fetchCompareData.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectManual = reject;
        }),
    );

    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: dummyState,
        handleSave: vi.fn(),
      }),
    );

    void result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
      dataSource: readyCatalog as never,
    });
    await Promise.resolve();

    await act(async () => {
      await result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
        silent: true,
        dataSource: readyCatalog as never,
      });
    });
    expect(testState.fetchCompareData).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectManual?.(new Error('manual failed'));
      await Promise.resolve();
    });
    expect(node.getData().hasError).toBe(true);
    expect(node.getData().fetchError).toBe(true);
    expect(node.getData().errorMessage).toBe('manual failed');
  });

  it('lets a manual single-value request become latest while a silent request is in flight', async () => {
    const node = createFakeNode({ type: 'single-value' });
    const graph = createFakeGraph({ 'sv-1': node });
    let resolveSilent: ((value: unknown) => void) | undefined;
    let resolveManual: ((value: unknown) => void) | undefined;
    testState.fetchCompareData
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSilent = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveManual = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: dummyState,
        handleSave: vi.fn(),
      }),
    );

    void result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
      silent: true,
      dataSource: readyCatalog as never,
    });
    await Promise.resolve();

    void result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
      dataSource: readyCatalog as never,
    });
    await Promise.resolve();
    expect(testState.fetchCompareData).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSilent?.({ currentData: { cpu: 1 }, baselineData: null });
      await Promise.resolve();
    });
    expect(node.setAttrByPath).not.toHaveBeenCalledWith('label/text', '1');

    await act(async () => {
      resolveManual?.({ currentData: { cpu: 9 }, baselineData: null });
      await Promise.resolve();
    });
    expect(node.setAttrByPath).toHaveBeenCalledWith('label/text', '9');
  });

  it('keeps numeric compare mode after editing a node that previously used percent', async () => {
    const node = createFakeNode({ type: 'single-value' });
    const graph = createFakeGraph({ 'sv-1': node });
    testState.fetchCompareData.mockResolvedValue({
      currentData: { cpu: 42 },
      baselineData: { cpu: 40 },
    });

    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: {
          editingNodeData: {
            ...singleValueNode,
            valueConfig: {
              ...singleValueNode.valueConfig,
              compare: true,
              compareMode: 'percent',
              filterBindings: { time: 'range' },
            },
          },
          setNodeEditVisible: vi.fn(),
          setEditingNodeData: vi.fn(),
        } as never,
        handleSave: vi.fn(),
        dataSources: [readyCatalog as never],
        dataSourceLookupStatus: 'success',
      }),
    );

    await act(async () => {
      await result.current.handleNodeUpdate({
        name: 'cpu',
        compare: true,
        compareMode: 'value',
        selectedFields: ['cpu'],
        dataSource: 7,
      });
    });

    expect(updateNodeAttributes).toHaveBeenCalledWith(
      node,
      expect.objectContaining({
        valueConfig: expect.objectContaining({
          compare: true,
          compareMode: 'value',
          filterBindings: { time: 'range' },
        }),
      }),
    );

    await waitFor(() => {
      expect(node.setAttrByPath).toHaveBeenCalledWith(
        'label/text',
        expect.stringMatching(/↑2(?!\.)/),
      );
    });
    const label = vi.mocked(node.setAttrByPath).mock.calls
      .filter((call) => call[0] === 'label/text')
      .at(-1)?.[1];
    expect(String(label)).not.toContain('%');
  });

  it('keeps the previous compare mode when period compare is turned off', async () => {
    const node = createFakeNode({ type: 'single-value' });
    const graph = createFakeGraph({ 'sv-1': node });
    testState.fetchCompareData.mockResolvedValue({
      currentData: { cpu: 42 },
      baselineData: { cpu: 40 },
    });

    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: {
          editingNodeData: {
            ...singleValueNode,
            valueConfig: {
              ...singleValueNode.valueConfig,
              compare: true,
              compareMode: 'value',
            },
          },
          setNodeEditVisible: vi.fn(),
          setEditingNodeData: vi.fn(),
        } as never,
        handleSave: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleNodeUpdate({
        name: 'cpu',
        compare: false,
        selectedFields: ['cpu'],
        dataSource: 7,
      });
    });

    expect(updateNodeAttributes).toHaveBeenCalledWith(
      node,
      expect.objectContaining({
        valueConfig: expect.objectContaining({
          compare: false,
          compareMode: 'value',
        }),
      }),
    );
  });

  it('aborts an in-flight single-value query without showing a fetch error', async () => {
    const node = createFakeNode({ type: 'single-value' });
    const graph = createFakeGraph({ 'sv-1': node });
    const signals: AbortSignal[] = [];
    testState.getSourceDataByApiId.mockImplementation((_id: number, _params: unknown, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise(() => {});
    });
    testState.fetchCompareData.mockImplementation(async (input: {
      getSourceDataByApiId: (id: number, params?: unknown) => Promise<unknown>;
    }) => {
      await input.getSourceDataByApiId(7, { current: true });
      return { currentData: { cpu: 1 }, baselineData: null };
    });

    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: dummyState,
        handleSave: vi.fn(),
      }),
    );

    void result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
      dataSource: readyCatalog as never,
    });
    await waitFor(() => expect(signals).toHaveLength(1));
    act(() => {
      result.current.abortInflightSingleValueRequests();
    });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(node.getData().hasError).not.toBe(true);
    expect(node.getData().fetchError).not.toBe(true);
  });

  it('waits on the latest required catalog and does not treat the old snapshot as authority', async () => {
    const node = createFakeNode({
      type: 'single-value',
      label: '42',
      rawData: { cpu: 42 },
    });
    const graph = createFakeGraph({ 'sv-1': node });
    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: dummyState,
        handleSave: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.updateSingleNodeData(
        {
          ...singleValueNode,
          valueConfig: {
            ...singleValueNode.valueConfig,
            dataSourceParams: [{ name: 'server_room_id', type: 'string', value: '' }],
          },
        },
        undefined,
        undefined,
        undefined,
        {
          dataSource: {
            id: 7,
            params: [{
              name: 'server_room_id',
              alias_name: '机房',
              type: 'string',
              required: true,
              value: '',
            }],
          } as never,
        },
      );
    });

    expect(testState.fetchCompareData).not.toHaveBeenCalled();
    expect(node.getData().isLoading).toBe(false);
    expect(node.getData().hasError).not.toBe(true);
    expect(node.getData().rawData).toBeUndefined();
    expect(node.setAttrByPath).toHaveBeenCalledWith('label/text', 'dashboard.selectRequiredParam');
  });

  it('requests when the latest catalog is empty even if the snapshot says required', async () => {
    const node = createFakeNode({ type: 'single-value' });
    const graph = createFakeGraph({ 'sv-1': node });
    testState.fetchCompareData.mockResolvedValue({ currentData: { cpu: 1 }, baselineData: null });
    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: dummyState,
        handleSave: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.updateSingleNodeData(
        {
          ...singleValueNode,
          valueConfig: {
            ...singleValueNode.valueConfig,
            dataSourceParams: [{
              name: 'server_room_id',
              type: 'string',
              required: true,
              value: '',
            }],
          },
        },
        undefined,
        undefined,
        undefined,
        { dataSource: { id: 7, params: null } as never },
      );
    });

    expect(testState.fetchCompareData).toHaveBeenCalledTimes(1);
  });

  it('keeps loading while the catalog lookup is still pending and fails when the source is missing', async () => {
    const node = createFakeNode({ type: 'single-value' });
    const graph = createFakeGraph({ 'sv-1': node });
    const { result } = renderHook(() =>
      useGraphNodeOperations({
        graphInstance: graph as never,
        state: dummyState,
        handleSave: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
        dataSourceLookupStatus: 'loading',
      });
    });
    expect(testState.fetchCompareData).not.toHaveBeenCalled();
    expect(node.getData().hasError).not.toBe(true);
    expect(node.getData().isLoading).toBe(true);

    await act(async () => {
      await result.current.updateSingleNodeData(singleValueNode, undefined, undefined, undefined, {
        dataSourceLookupStatus: 'success',
      });
    });
    expect(testState.fetchCompareData).not.toHaveBeenCalled();
    expect(node.getData().hasError).toBe(true);
    expect(node.getData().errorMessage).toBe('dashboard.dataSourceNotFound');
  });

  it('resumes a single-value node after the catalog lookup leaves loading', async () => {
    const node = Object.assign(createFakeNode({ ...singleValueNode }), { id: 'sv-1' });
    const graph = {
      getCellById: () => node,
      getNodes: () => [node],
    };
    testState.fetchCompareData.mockResolvedValue({ currentData: { cpu: 9 }, baselineData: null });
    const { result, rerender } = renderHook(
      ({
        lookup,
        sources,
      }: {
        lookup: 'loading' | 'success';
        sources: unknown[];
      }) => useGraphNodeOperations({
        graphInstance: graph as never,
        state: dummyState,
        handleSave: vi.fn(),
        dataSources: sources as never,
        dataSourceLookupStatus: lookup,
      }),
      { initialProps: { lookup: 'loading' as const, sources: [] as unknown[] } },
    );

    await act(async () => {
      await result.current.updateSingleNodeData(singleValueNode);
    });
    expect(testState.fetchCompareData).not.toHaveBeenCalled();
    expect(node.getData().catalogHold).toBe(true);
    expect(node.getData().isLoading).toBe(true);

    rerender({ lookup: 'success', sources: [readyCatalog] });
    await waitFor(() => expect(testState.fetchCompareData).toHaveBeenCalledTimes(1));
    expect(node.getData().catalogHold).toBe(false);
    expect(node.setAttrByPath).toHaveBeenCalledWith('label/text', '9');
  });
});
