// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatasourceItem, ParamItem } from '@/app/ops-analysis/types/dataSource';

const fetchCompareData = vi.hoisted(() => vi.fn());

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, _defaultMessage?: string, values?: Record<string, string>) => {
      if (key === 'dashboard.selectRequiredParam') return `请选择${values?.label ?? ''}`;
      if (key === 'dashboard.fillRequiredParams') return `请补充：${values?.labels ?? ''}`;
      return key;
    },
  }),
}));

vi.mock('@/app/ops-analysis/context/common', () => ({
  useOpsAnalysis: () => ({ canvasDataSourceLookupStatus: 'ready', dataSources: [] }),
}));

vi.mock('@/app/ops-analysis/api/dataSource', async () => {
  const actual = await vi.importActual<typeof import('@/app/ops-analysis/api/dataSource')>(
    '@/app/ops-analysis/api/dataSource',
  );
  return {
    ...actual,
    useDataSourceApi: () => ({
      getSourceDataByApiId: vi.fn(),
      getDataSourceList: vi.fn(),
      getDataSourceDetails: vi.fn(),
    }),
  };
});

vi.mock('@/app/ops-analysis/hooks/useParamInputOptions', () => ({
  useParamInputOptions: () => ({ status: 'idle', options: [] }),
}));

vi.mock('@/app/ops-analysis/utils/compareQuery', async () => {
  const actual = await vi.importActual<typeof import('@/app/ops-analysis/utils/compareQuery')>(
    '@/app/ops-analysis/utils/compareQuery',
  );
  return {
    ...actual,
    fetchCompareData,
  };
});

vi.mock('@/app/ops-analysis/components/widgetRegistry', () => ({
  getWidgetComponent: () => function FakeChart({ rawData }: { rawData: unknown }) {
    return <div data-testid="chart-renderer">{JSON.stringify(rawData)}</div>;
  },
}));

import WidgetWrapper from '../widgetDataRenderer';

const datasource = (params: ParamItem[]): DatasourceItem => ({
  id: 120,
  created_at: '',
  updated_at: '',
  created_by: '',
  updated_by: '',
  domain: '',
  updated_by_domain: '',
  name: '机房设备类型分布',
  source_type: 'nats',
  desc: '',
  params,
  chart_type: ['pie'],
  namespaces: [],
});

const roomParam: ParamItem = {
  name: 'server_room_id',
  alias_name: '机房',
  type: 'string',
  filterType: 'filter',
  value: '',
  required: true,
};

const objectParam: ParamItem = {
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

const chart = ({
  source,
  values = {},
  searchVersion = 0,
  reloadVersion = 'screen:0',
  suppliedRawData,
  suppliedRawDataVersion = 0,
}: {
  source: DatasourceItem;
  values?: Record<string, unknown>;
  searchVersion?: number;
  reloadVersion?: string;
  suppliedRawData?: unknown;
  suppliedRawDataVersion?: number;
}) => (
  <WidgetWrapper
    dashboardId="screen"
    widgetId="room-pie"
    chartType="pie"
    config={{
      dataSource: source.id,
      chartType: 'pie',
      dataSourceParams: source.params,
      filterBindings: { 'server_room_id__string': true },
    }}
    dataSource={source}
    unifiedFilterValues={values}
    filterDefinitions={filters as never}
    filterSearchVersion={searchVersion}
    reloadVersion={reloadVersion}
    refreshCause={searchVersion > 0 ? 'manual' : 'initial'}
    suppliedRawData={suppliedRawData}
    suppliedRawDataVersion={suppliedRawDataVersion}
    runtimeActive
  />
);

afterEach(() => {
  cleanup();
  fetchCompareData.mockReset();
});

describe('widget required parameter wait', () => {
  it('does not request on first paint, search, or refresh while the room is missing', async () => {
    fetchCompareData.mockResolvedValue({
      currentData: [{ name: '服务器', value: 1 }],
      baselineData: null,
    });
    const source = datasource([roomParam]);
    const view = render(chart({ source, values: { 'server_room_id__string': '' } }));

    expect(await screen.findByText('请选择机房')).toBeTruthy();
    expect(screen.queryByTestId('chart-renderer')).toBeNull();
    expect(fetchCompareData).not.toHaveBeenCalled();

    view.rerender(chart({
      source,
      values: { 'server_room_id__string': '   ' },
      searchVersion: 1,
      reloadVersion: 'screen:1',
    }));
    view.rerender(chart({
      source,
      values: { 'server_room_id__string': '' },
      searchVersion: 1,
      reloadVersion: 'screen:2',
    }));

    await waitFor(() => {
      expect(screen.getByText('请选择机房')).toBeTruthy();
    });
    expect(fetchCompareData).not.toHaveBeenCalled();
  });

  it('requests after a value is applied, then drops an in-flight response when the value is cleared', async () => {
    let resolveFetch: (value: { currentData: unknown; baselineData: null }) => void = () => undefined;
    fetchCompareData.mockImplementation(
      () => new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const source = datasource([roomParam]);
    const view = render(chart({
      source,
      values: { 'server_room_id__string': 'room-1' },
      searchVersion: 1,
    }));

    await waitFor(() => {
      expect(fetchCompareData).toHaveBeenCalledTimes(1);
    });

    view.rerender(chart({
      source,
      values: { 'server_room_id__string': '' },
      searchVersion: 2,
    }));
    expect(await screen.findByText('请选择机房')).toBeTruthy();

    resolveFetch({ currentData: [{ name: '旧数据', value: 9 }], baselineData: null });
    await waitFor(() => {
      expect(screen.queryByText(/旧数据/)).toBeNull();
    });
    expect(screen.getByText('请选择机房')).toBeTruthy();
    expect(fetchCompareData).toHaveBeenCalledTimes(1);
  });

  it('lists every missing parameter and ignores a supplied preview payload', async () => {
    fetchCompareData.mockResolvedValue({ currentData: [{ name: '服务器', value: 1 }], baselineData: null });
    const source = datasource([roomParam, objectParam]);
    render(chart({
      source,
      values: { 'server_room_id__string': null },
      suppliedRawData: [{ name: '预览旧数据', value: 3 }],
      suppliedRawDataVersion: 1,
    }));

    expect(await screen.findByText('请补充：机房、监控对象')).toBeTruthy();
    expect(screen.queryByText(/预览旧数据/)).toBeNull();
    expect(fetchCompareData).not.toHaveBeenCalled();
  });

  it('still requests a widget whose catalog does not require the room', async () => {
    fetchCompareData.mockResolvedValue({ currentData: [{ name: '服务器', value: 1 }], baselineData: null });
    render(chart({
      source: datasource([{ ...roomParam, required: false }]),
      values: { 'server_room_id__string': '' },
    }));

    await waitFor(() => {
      expect(fetchCompareData).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('请选择机房')).toBeNull();
  });
});
