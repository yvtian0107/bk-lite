import { describe, expect, it } from 'vitest';

import { buildFiltersFromDashboardLayout, syncDashboardLayoutFilterBindings } from '@/app/ops-analysis/(pages)/view/dashBoard/hooks/useDashboardLayoutSync';
import {
  buildFiltersFromScreenItems,
  syncScreenFilterBindings,
} from '@/app/ops-analysis/(pages)/view/screen/utils/layoutUtils';
import { buildFiltersFromNodes } from '@/app/ops-analysis/(pages)/view/topology/utils/namespaceUtils';
import type {
  DashboardLayoutItem,
  FilterBindings,
  UnifiedFilterDefinition,
} from '@/app/ops-analysis/types/dashBoard';
import type { DatasourceItem, InputControlConfig, ParamItem } from '@/app/ops-analysis/types/dataSource';
import type { ScreenViewSets } from '@/app/ops-analysis/types/screen';

const FILTER_ID = 'organization__string';

const organizationParam: ParamItem = {
  name: 'organization',
  alias_name: '组织',
  type: 'string',
  filterType: 'filter',
  value: null,
};

const keysOf = (definitions: { key: string }[]) => definitions.map((item) => item.key);

const dashboardLayout = (
  bindings: Array<FilterBindings | undefined>,
): DashboardLayoutItem[] =>
  bindings.map((filterBindings, index) => ({
    i: `widget-${index}`,
    x: 0,
    y: index,
    w: 4,
    h: 4,
    name: `组件 ${index}`,
    valueConfig: {
      chartType: 'single',
      dataSourceParams: [organizationParam],
      ...(filterBindings ? { filterBindings } : {}),
    },
  }));

const discoverDashboard = (bindings: Array<FilterBindings | undefined>) =>
  buildFiltersFromDashboardLayout({
    layout: dashboardLayout(bindings),
    previousDefinitions: [],
    dataSources: [],
  });

const screenView = (bindings: Array<FilterBindings | undefined>): ScreenViewSets => ({
  viewport: { width: 1920, height: 1080, adapter: 'fill' },
  decorations: {},
  items: bindings.map((filterBindings, index) => ({
    id: `screen-${index}`,
    type: 'widget' as const,
    chartType: 'single' as const,
    title: `组件 ${index}`,
    x: 0,
    y: index,
    w: 200,
    h: 120,
    zIndex: index + 1,
    valueConfig: {
      chartType: 'single' as const,
      dataSourceParams: [organizationParam],
      ...(filterBindings ? { filterBindings } : {}),
    },
  })),
});

const discoverScreen = (bindings: Array<FilterBindings | undefined>) =>
  buildFiltersFromScreenItems({
    viewSets: screenView(bindings),
    previousDefinitions: [],
    dataSources: [],
  });

const discoverTopology = (bindings: Array<FilterBindings | undefined>) =>
  buildFiltersFromNodes(
    {
      getNodes: () =>
        bindings.map((filterBindings) => ({
          getData: () => ({
            type: 'single-value',
            valueConfig: {
              dataSourceParams: [organizationParam],
              ...(filterBindings ? { filterBindings } : {}),
            },
          }),
        })),
    } as never,
    [],
    [],
  );

describe('canvas filter chips follow widget bindings', () => {
  it('hides the chip when every widget explicitly opts out', () => {
    const unbound = [{ [FILTER_ID]: false }, { [FILTER_ID]: false }] as FilterBindings[];
    expect(keysOf(discoverDashboard(unbound))).toEqual([]);
    expect(keysOf(discoverScreen(unbound))).toEqual([]);
    expect(keysOf(discoverTopology(unbound))).toEqual([]);
  });

  it('keeps the chip when one widget still follows', () => {
    const mixed = [
      { [FILTER_ID]: false },
      { [FILTER_ID]: true },
    ] as FilterBindings[];
    expect(keysOf(discoverDashboard(mixed))).toEqual(['organization']);
    expect(keysOf(discoverScreen(mixed))).toEqual(['organization']);
    expect(keysOf(discoverTopology(mixed))).toEqual(['organization']);
  });

  it('keeps the chip when widget bindings are missing', () => {
    expect(keysOf(discoverDashboard([undefined, undefined]))).toEqual(['organization']);
    expect(keysOf(discoverScreen([undefined]))).toEqual(['organization']);
    expect(keysOf(discoverTopology([undefined]))).toEqual(['organization']);
    const partial = [undefined, { [FILTER_ID]: false }] as Array<FilterBindings | undefined>;
    expect(keysOf(discoverDashboard(partial))).toEqual(['organization']);
    expect(keysOf(discoverScreen(partial))).toEqual(['organization']);
    expect(keysOf(discoverTopology(partial))).toEqual(['organization']);
  });

  it('keeps explicit opt-outs after sync so the chip does not return', () => {
    const layout = dashboardLayout([
      { [FILTER_ID]: false },
      { [FILTER_ID]: false },
    ]);
    const dropped = discoverDashboard([
      { [FILTER_ID]: false },
      { [FILTER_ID]: false },
    ]);
    const synced = syncDashboardLayoutFilterBindings(layout, dropped, []);
    expect(synced.map((item) => (
      'valueConfig' in item ? item.valueConfig?.filterBindings : undefined
    ))).toEqual([
      { [FILTER_ID]: false },
      { [FILTER_ID]: false },
    ]);
    expect(keysOf(buildFiltersFromDashboardLayout({
      layout: synced,
      previousDefinitions: dropped,
      dataSources: [],
    }))).toEqual([]);

    const screen = screenView([
      { [FILTER_ID]: false },
      { [FILTER_ID]: true },
    ]);
    const screenFilters = discoverScreen([
      { [FILTER_ID]: false },
      { [FILTER_ID]: true },
    ]);
    const syncedScreen = syncScreenFilterBindings(screen, screenFilters, []);
    expect(syncedScreen.items.map((item) => item.valueConfig?.filterBindings)).toEqual([
      { [FILTER_ID]: false },
      { [FILTER_ID]: true },
    ]);
    expect(keysOf(buildFiltersFromScreenItems({
      viewSets: syncedScreen,
      previousDefinitions: screenFilters,
      dataSources: [],
    }))).toEqual(['organization']);
  });
});

const dynamicSource = (
  restApi: string,
  queryParams?: Record<string, { ref: string }>,
): InputControlConfig => ({
  control: 'select',
  optionsSource: {
    type: 'dynamic',
    sourceRef: { type: 'rest_api', value: restApi },
    valueField: 'id',
    labelField: 'name',
    ...(queryParams ? { queryParams } : {}),
  },
});

const filterParam = (
  name: string,
  alias: string,
  inputConfig: InputControlConfig,
): ParamItem => ({
  name,
  alias_name: alias,
  type: 'string',
  filterType: 'filter',
  value: '',
  inputConfig,
});

const chartSource = (
  id: number,
  name: string,
  params: ParamItem[],
): DatasourceItem => ({
  id,
  name,
  rest_api: name,
  desc: '',
  params,
  chart_type: ['line'],
  namespaces: [],
} as DatasourceItem);

const chartLayout = (
  widgets: Array<{ dataSource: number; params: ParamItem[] }>,
): DashboardLayoutItem[] => widgets.map((widget, index) => ({
  i: `chart-${index}`,
  x: 0,
  y: index,
  w: 4,
  h: 4,
  name: `图 ${index}`,
  valueConfig: {
    chartType: 'line',
    dataSource: widget.dataSource,
    dataSourceParams: widget.params,
  },
}));

const queryRef = (definition: UnifiedFilterDefinition | undefined, name: string) => {
  const config = definition?.inputConfig;
  if (!config || config.control !== 'select' || config.optionsSource.type !== 'dynamic') return undefined;
  const value = config.optionsSource.queryParams?.[name];
  return value && typeof value === 'object' && 'ref' in value ? value.ref : undefined;
};

describe('same data source filter discovery', () => {
  it('builds one definition when two charts share a data source id', () => {
    const catalog = filterParam(
      'object_id',
      '监控对象',
      dynamicSource('demo/accept_monitor_objects'),
    );
    const drifted = filterParam(
      'object_id',
      '监控对象',
      dynamicSource('demo/accept_monitor_objects', { object_id: { ref: 'object_id' } }),
    );
    const filters = buildFiltersFromDashboardLayout({
      layout: chartLayout([
        { dataSource: 7, params: [drifted] },
        { dataSource: 7, params: [catalog] },
      ]),
      previousDefinitions: [],
      dataSources: [chartSource(7, '验收·级联指标图', [catalog])],
    });

    expect(filters.map((item) => item.id)).toEqual(['object_id__string']);
    expect(queryRef(filters[0], 'object_id')).toBeUndefined();
  });

  it('writes a bare ref to the sibling definition on the same data source', () => {
    const objectCatalog = (restApi: string) => filterParam(
      'object_id',
      '监控对象',
      dynamicSource(restApi),
    );
    const metricCatalog = (restApi: string) => filterParam(
      'metric_id',
      '指标',
      dynamicSource(restApi, { object_id: { ref: 'object_id' } }),
    );
    const sourceA = chartSource(1, 'cmdb/chart', [
      objectCatalog('cmdb/objects'),
      metricCatalog('cmdb/metrics'),
    ]);
    const sourceB = chartSource(2, 'monitor/chart', [
      objectCatalog('monitor/objects'),
      metricCatalog('monitor/metrics'),
    ]);
    const filters = buildFiltersFromDashboardLayout({
      layout: chartLayout([
        { dataSource: 1, params: sourceA.params },
        { dataSource: 2, params: sourceB.params },
      ]),
      previousDefinitions: [],
      dataSources: [sourceA, sourceB],
    });
    const sourceOf = (definition: UnifiedFilterDefinition) => {
      const config = definition.inputConfig;
      if (!config || config.control !== 'select' || config.optionsSource.type !== 'dynamic') return '';
      return config.optionsSource.sourceRef?.value ?? '';
    };
    const objectCmdb = filters.find((item) => item.key === 'object_id' && sourceOf(item) === 'cmdb/objects');
    const metricCmdb = filters.find((item) => item.key === 'metric_id' && sourceOf(item) === 'cmdb/metrics');
    const objectMonitor = filters.find((item) => item.key === 'object_id' && sourceOf(item) === 'monitor/objects');
    expect(filters.filter((item) => item.key === 'object_id')).toHaveLength(2);
    expect(filters.filter((item) => item.key === 'metric_id')).toHaveLength(2);
    expect(objectCmdb?.id).toBeTruthy();
    expect(queryRef(metricCmdb, 'object_id')).toBe(objectCmdb?.id);
    expect(queryRef(metricCmdb, 'object_id')).not.toBe(objectMonitor?.id);
  });
});
