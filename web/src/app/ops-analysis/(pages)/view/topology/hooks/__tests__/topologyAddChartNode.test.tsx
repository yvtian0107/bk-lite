// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatasourceItem } from '@/app/ops-analysis/types/dataSource';
import type { FilterValue } from '@/app/ops-analysis/types/dashBoard';
import type { DataSourceLookupStatus } from '@/app/ops-analysis/utils/widgetRequestVersion';
import { fetchWidgetData, WidgetRequestBlocked } from '@/app/ops-analysis/utils/widgetDataTransform';

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

vi.mock('../../utils/registerNode', () => ({
  createNodeByType: (config: { id: string }) => ({ id: config.id, data: config }),
  updateNodeAttributes: vi.fn(),
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

import { useGraphNodeOperations } from '../useGraphNodeOperations';
import { useNodeConfigFlow } from '../useNodeConfigFlow';
import { useTopologyRefresh } from '../useTopologyRefresh';

const room = {
  name: 'server_room_id',
  alias_name: '机房',
  type: 'string',
  filterType: 'filter',
  value: '',
  required: true,
};

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

const createGraph = () => {
  const nodes = new Map<string, ReturnType<typeof createFakeNode>>();
  return {
    addNode: (meta: { id?: string; data?: Record<string, unknown> }) => {
      const id = String(meta.id || meta.data?.id);
      const node = createFakeNode({ ...(meta.data || {}), id });
      nodes.set(id, node);
      return { id };
    },
    getCellById: (id: string) => nodes.get(id) ?? null,
    getNodes: () => [...nodes.values()],
  };
};

const newChartDraft = () => ({
  isNewNode: true,
  type: 'chart' as const,
  position: { x: 12, y: 24 },
});

const chartValues = (value: string) => ({
  name: '机房设备',
  chartType: 'pie',
  dataSource: 120,
  dataSourceParams: [{ ...room, value }],
});

const useAddChartHarness = (
  lookupRef: { current: DataSourceLookupStatus },
  sourcesRef: { current: DatasourceItem[] },
) => {
  const graphRef = useRef(createGraph());
  const [editing, setEditing] = useState(newChartDraft());
  const [definitions, setDefinitions] = useState<never[]>([]);
  const [filterValues, setFilterValues] = useState<Record<string, FilterValue>>({});
  const [applied, setApplied] = useState<Record<string, FilterValue>>({});
  const state = {
    editingNodeData: editing,
    setEditingNodeData: setEditing,
    setViewConfigVisible: vi.fn(),
    setNodeEditVisible: vi.fn(),
    graphInstance: graphRef.current,
  };
  const operations = useGraphNodeOperations({
    graphInstance: graphRef.current as never,
    state: state as never,
    handleSave: vi.fn(),
    dataSources: sourcesRef.current,
    dataSourceLookupStatus: lookupRef.current,
  });
  const refresh = useTopologyRefresh({
    graphInstance: graphRef.current as never,
    namespaceOptions: [],
    refreshTimerRef: { current: null },
    dataSources: sourcesRef.current,
    definitions: definitions as never,
    filterValues,
    appliedFilterValues: applied,
    appliedNamespaceId: undefined,
    namespaceDraftId: undefined,
    setAppliedFilterValues: setApplied,
    setAppliedNamespaceId: vi.fn(),
    setDefinitions: setDefinitions as never,
    setFilterValues,
    setNamespaceDraftId: vi.fn(),
    setNodeChangeKey: vi.fn(),
    syncTopologyCanvasResources: async () => sourcesRef.current,
    refreshAllSingleValueNodes: vi.fn(),
    refreshAllChartNodes: operations.refreshAllChartNodes,
    updateDefinitions: vi.fn(),
    dataSourceLookupStatus: lookupRef.current,
    readCanvasDataSourceLookupStatus: () => lookupRef.current,
  });
  const flow = useNodeConfigFlow({
    state: state as never,
    t: (key: string) => key,
    dataSources: sourcesRef.current,
    definitions: definitions as never,
    appliedFilterValues: applied,
    appliedNamespaceId: undefined,
    addNewNode: operations.addNewNode,
    handleAddChartNode: operations.handleAddChartNode,
    handleNodeUpdate: vi.fn(),
    dataSourceLookupStatus: lookupRef.current,
    handleViewConfigConfirm: operations.handleViewConfigConfirm,
    loadChartNodeData: operations.loadChartNodeData,
    scheduleTopologyPostMutation: refresh.scheduleTopologyPostMutation,
    updateSingleNodeData: operations.updateSingleNodeData,
  });
  return { flow, graph: graphRef.current, operations, setApplied, setEditing };
};

const addedNode = (graph: ReturnType<typeof createGraph>) => graph.getNodes().at(-1);

afterEach(() => {
  testState.getSourceDataByApiId.mockReset();
});

describe('topology add chart node catalog gate', () => {
  it('does not request from the widget snapshot when fetch has no catalog', async () => {
    const api = vi.fn();
    await expect(fetchWidgetData({
      config: {
        dataSource: 120,
        dataSourceParams: [{ ...room, value: 'room-1', required: false }],
      },
      getSourceDataByApiId: api,
      throwError: true,
    })).rejects.toBeInstanceOf(WidgetRequestBlocked);
    expect(api).not.toHaveBeenCalled();
  });

  it('does not request when a new chart is added before the catalog arrives', async () => {
    const lookup = { current: 'loading' as DataSourceLookupStatus };
    const sources = { current: [] as DatasourceItem[] };
    const { result } = renderHook(() => useAddChartHarness(lookup, sources));

    await act(async () => {
      await result.current.flow.handleTopologyViewConfigConfirm(chartValues(''));
    });

    await waitFor(() => {
      expect(addedNode(result.current.graph)?.getData().chartRequestState).toBe('pending');
    });
    expect(testState.getSourceDataByApiId).not.toHaveBeenCalled();
    expect(addedNode(result.current.graph)?.getData().isLoading).toBe(true);
  });

  it('shows the catalog error and ends loading when lookup failed', async () => {
    const lookup = { current: 'error' as DataSourceLookupStatus };
    const sources = { current: [] as DatasourceItem[] };
    const { result } = renderHook(() => useAddChartHarness(lookup, sources));

    await act(async () => {
      await result.current.flow.handleTopologyViewConfigConfirm(chartValues(''));
    });

    await waitFor(() => {
      expect(addedNode(result.current.graph)?.getData().chartRequestState).toBe('error');
    });
    const data = addedNode(result.current.graph)?.getData();
    expect(data?.isLoading).toBe(false);
    expect(data?.hasError).toBe(true);
    expect(data?.errorMessage).toBe('dashboard.dataSourceLoadFailed');
    expect(testState.getSourceDataByApiId).not.toHaveBeenCalled();
  });

  it('waits for a missing required value, then fetches after the value is present', async () => {
    const lookup = { current: 'success' as DataSourceLookupStatus };
    const sources = { current: [sourceOf([{ ...room, value: '' }])] };
    const { result } = renderHook(() => useAddChartHarness(lookup, sources));

    await act(async () => {
      await result.current.flow.handleTopologyViewConfigConfirm(chartValues(''));
    });

    await waitFor(() => {
      expect(addedNode(result.current.graph)?.getData().chartRequestState).toBe('waiting');
    });
    const waitingNode = addedNode(result.current.graph)?.getData();
    expect(waitingNode?.waitMessage).toBe('请选择机房');
    expect(waitingNode?.rawData).toBeNull();
    expect(testState.getSourceDataByApiId).not.toHaveBeenCalled();
    const followedFilterId = Object.keys(waitingNode?.valueConfig?.filterBindings || {})[0];
    expect(followedFilterId).toBeTruthy();

    testState.getSourceDataByApiId.mockResolvedValue({ data: { name: '恢复' } });
    await act(async () => {
      result.current.setApplied({ [followedFilterId]: 'room-1' });
      result.current.setEditing(newChartDraft());
    });
    await act(async () => {
      await result.current.flow.handleTopologyViewConfigConfirm(chartValues('room-1'));
    });

    await waitFor(() => {
      expect(addedNode(result.current.graph)?.getData().chartRequestState).toBe('ready');
    });
    expect(addedNode(result.current.graph)?.getData().rawData).toEqual({ name: '恢复' });
    expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(1);
  });

  it('does not backfill an older response after the new node starts waiting', async () => {
    const lookup = { current: 'success' as DataSourceLookupStatus };
    const sources = { current: [sourceOf([{ ...room, value: '' }])] };
    let resolveFetch: ((value: unknown) => void) | undefined;
    testState.getSourceDataByApiId.mockImplementation(
      () => new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result } = renderHook(() => useAddChartHarness(lookup, sources));

    await act(async () => {
      await result.current.flow.handleTopologyViewConfigConfirm(chartValues('room-1'));
    });
    await waitFor(() => {
      expect(testState.getSourceDataByApiId).toHaveBeenCalledTimes(1);
    });
    const node = addedNode(result.current.graph);
    expect(node).toBeTruthy();

    await act(async () => {
      await result.current.operations.loadChartNodeData(
        node!.id,
        { dataSource: 120, chartType: 'pie', dataSourceParams: [{ ...room, value: '' }] },
        {},
        [],
        sources.current[0],
        undefined,
        undefined,
        { dataSourceLookupStatus: 'success' },
      );
    });
    expect(node?.getData().chartRequestState).toBe('waiting');
    expect(node?.getData().rawData).toBeNull();

    await act(async () => {
      resolveFetch?.({ data: { name: '旧响应' } });
      await Promise.resolve();
    });
    expect(node?.getData().rawData).toBeNull();
    expect(node?.getData().chartRequestState).toBe('waiting');
    expect(node?.getData().hasError).toBe(false);
  });
});
