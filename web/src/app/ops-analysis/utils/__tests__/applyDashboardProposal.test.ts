import assert from 'node:assert/strict';
import test from 'node:test';

import type { DashboardLayoutItem, UnifiedFilterDefinition } from '@/app/ops-analysis/types/dashBoard';
import { applyDashboardProposal, proposalTargetsDashboard } from '../applyDashboardProposal';

const allocateId = (preferred: string | undefined, used: Set<string>) => {
  if (preferred && !used.has(preferred)) return preferred;
  let index = 1;
  while (used.has(`new-${index}`)) index += 1;
  return `new-${index}`;
};

const layout = (): DashboardLayoutItem[] => [
  {
    i: 'group-1',
    itemType: 'group',
    x: 0,
    y: 0,
    w: 12,
    h: 4,
    name: '分组',
  },
  {
    i: 'card-1',
    x: 0,
    y: 0,
    w: 3,
    h: 2,
    groupId: 'group-1',
    name: '资产总数',
    valueConfig: {
      chartType: 'single',
      dataSource: 23,
      selectedFields: ['value'],
      decimalPlaces: 0,
      thresholdColors: [{ value: '10', color: 'red' }],
      dataSourceParams: [{ name: 'organization_id', alias_name: '组织', value: 'org-001' }],
      filterBindings: { filter_organization: true },
    },
  },
  {
    i: 'topo-1',
    x: 0,
    y: 6,
    w: 12,
    h: 8,
    name: '网络拓扑',
    valueConfig: { chartType: 'networkStatusTopology', sceneWidgetType: 'networkStatusTopology' },
  },
];

const filters = (): UnifiedFilterDefinition[] => [
  {
    id: 'filter_organization',
    key: 'organization_id',
    name: '组织',
    type: 'string',
    defaultValue: 'org-001',
    order: 0,
    enabled: true,
    inputConfig: {
      control: 'select',
      optionsSource: { type: 'dynamic', sourceId: 35, valueField: 'id', labelField: 'name' },
    },
  },
];

test('keeps stored config when the contract matches and overlays written format fields', () => {
  const result = applyDashboardProposal({
    layout: layout(),
    filters: filters(),
    filterValues: { filter_organization: 'org-live' },
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      dashboardId: 'current',
      layout: [{
        i: 'card-1',
        x: 1,
        name: '资产总量',
        valueConfig: {
          chartType: 'single',
          dataSource: 23,
          selectedFields: ['value'],
          decimalPlaces: 2,
          dataSourceParams: [{ name: 'organization_id', alias_name: '组织', value: 'org-001' }],
          filterBindings: { filter_organization: true },
        },
      }],
      filters: filters(),
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const card = result.layout.find((item) => item.i === 'card-1');
  assert.ok(card && 'valueConfig' in card);
  if (!card || !('valueConfig' in card)) return;
  assert.equal(card.name, '资产总量');
  assert.equal(card.x, 1);
  assert.equal(card.y, 0);
  assert.equal(card.groupId, 'group-1');
  assert.equal(card.valueConfig?.decimalPlaces, 2);
  assert.deepEqual(card.valueConfig?.thresholdColors, [{ value: '10', color: 'red' }]);
  assert.ok(result.layout.some((item) => item.i === 'group-1'));
  assert.ok(result.layout.some((item) => item.i === 'topo-1'));
  assert.equal(result.filterValues.filter_organization, 'org-live');
});

test('replaces the widget config when the chart contract changes and drops omitted datasource widgets', () => {
  const result = applyDashboardProposal({
    layout: layout(),
    filters: filters(),
    filterValues: { filter_organization: 'org-live' },
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [{
        i: 'card-1',
        valueConfig: { chartType: 'pie', dataSource: 24, dimensionField: 'type', valueField: 'count' },
      }],
      filters: [],
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const card = result.layout.find((item) => item.i === 'card-1');
  assert.equal(card && 'valueConfig' in card && card.valueConfig?.chartType, 'pie');
  assert.equal(card && 'valueConfig' in card && card.valueConfig?.decimalPlaces, undefined);
  assert.equal(result.filters.length, 0);
  assert.equal(result.filterValues.filter_organization, undefined);
  assert.ok(result.layout.some((item) => item.i === 'topo-1'));
});

test('adds a root widget and switches the current filter value when the default changes', () => {
  const result = applyDashboardProposal({
    layout: layout(),
    filters: filters(),
    filterValues: { filter_organization: 'org-live' },
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [
        {
          i: 'card-1',
          valueConfig: {
            chartType: 'single',
            dataSource: 23,
            selectedFields: ['value'],
            filterBindings: { filter_organization: true },
            dataSourceParams: [{ name: 'organization_id', alias_name: '组织', value: 'org-001' }],
          },
        },
        {
          i: 'pie-1',
          x: 3,
          y: 0,
          w: 4,
          h: 4,
          name: '类型分布',
          valueConfig: { chartType: 'pie', dataSource: 24 },
        },
      ],
      filters: [{ ...filters()[0], defaultValue: 'org-002' }],
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const pie = result.layout.find((item) => item.i === 'pie-1');
  assert.equal(pie && 'groupId' in pie && pie.groupId, null);
  assert.equal(result.filterValues.filter_organization, 'org-002');
});

test('rejects a proposal whose schema version is not 1.0', () => {
  const result = applyDashboardProposal({
    layout: [],
    filters: [],
    filterValues: {},
    allocateId,
    proposal: { schemaVersion: '2.0', layout: [], filters: [] },
  });
  assert.deepEqual(result, { ok: false, reason: 'schema' });
});

test('matches widgets written with id and treats omitted filters as an empty set', () => {
  const result = applyDashboardProposal({
    layout: layout(),
    filters: filters(),
    filterValues: { filter_organization: 'org-live' },
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [{
        id: 'card-1',
        valueConfig: {
          chartType: 'single',
          dataSource: 23,
          selectedFields: ['value'],
          dataSourceParams: [{ name: 'organization_id', value: 'org-001' }],
          filterBindings: { filter_organization: true },
        },
      }],
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.layout.filter((item) => item.i === 'card-1').length, 1);
  assert.equal(result.filters.length, 0);
  assert.ok(result.layout.some((item) => item.i === 'topo-1'));
});

test('packs a fresh proposal into three widgets per row', () => {
  const result = applyDashboardProposal({
    layout: [],
    filters: [],
    filterValues: {},
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [
        { i: 'a', valueConfig: { chartType: 'line', dataSource: 1 } },
        { i: 'b', valueConfig: { chartType: 'line', dataSource: 2 } },
        { i: 'c', valueConfig: { chartType: 'line', dataSource: 3 } },
        { i: 'd', valueConfig: { chartType: 'pie', dataSource: 4 } },
      ],
      filters: [],
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.layout.map((item) => [item.i, item.x, item.y, item.w, item.h]),
    [
      ['a', 0, 0, 8, 6],
      ['b', 8, 0, 8, 6],
      ['c', 16, 0, 8, 6],
      ['d', 0, 6, 8, 6],
    ],
  );
});

test('applies page settings only when the proposal names them', () => {
  const result = applyDashboardProposal({
    layout: [],
    filters: [],
    filterValues: {},
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [{ i: 'a', valueConfig: { chartType: 'single', dataSource: 1, selectedFields: ['pct'], unitId: 'percent', decimalPlaces: 2 } }],
      filters: [],
      otherConfig: { displayMode: 'compact' },
      refreshInterval: 60000,
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.otherConfig, { displayMode: 'compact' });
  assert.equal(result.refreshInterval, 60000);
  assert.equal(result.layout[0].valueConfig?.unitId, 'percent');

  const untouched = applyDashboardProposal({
    layout: [],
    filters: [],
    filterValues: {},
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [{ i: 'a', valueConfig: { chartType: 'single', dataSource: 1 } }],
      filters: [],
      otherConfig: {},
      refreshInterval: 15,
    },
  });
  assert.equal(untouched.ok, true);
  if (!untouched.ok) return;
  assert.equal(untouched.otherConfig, undefined);
  assert.equal(untouched.refreshInterval, undefined);
});

const dynamicFilter = (
  id: string,
  key: string,
  queryParams: Record<string, unknown>,
): UnifiedFilterDefinition => ({
  id,
  key,
  name: key,
  type: 'string',
  defaultValue: null,
  order: 0,
  enabled: true,
  inputConfig: {
    control: 'select',
    optionsSource: {
      type: 'dynamic',
      sourceId: 9,
      valueField: 'id',
      labelField: 'name',
      queryParams,
    },
  },
});

const dynamicQuery = (filter: UnifiedFilterDefinition | undefined) => {
  const config = filter?.inputConfig;
  if (!config || config.control !== 'select' || config.optionsSource.type !== 'dynamic') return undefined;
  return config.optionsSource.queryParams;
};

test('drops concatenated query params and warns instead of storing them', () => {
  const result = applyDashboardProposal({
    layout: [{
      i: 'card-9',
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      name: '设备',
      valueConfig: {
        chartType: 'single',
        dataSource: 9,
        dataSourceParams: [{
          name: 'device_id',
          alias_name: '设备',
          type: 'string',
          filterType: 'filter',
          value: null,
          inputConfig: {
            control: 'select',
            optionsSource: {
              type: 'dynamic',
              sourceId: 9,
              valueField: 'id',
              labelField: 'name',
              queryParams: { room_id: 'pre-$site$' },
            },
          },
        }],
      },
    }],
    filters: [],
    filterValues: {},
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [{
        i: 'card-9',
        valueConfig: {
          chartType: 'single',
          dataSource: 9,
          dataSourceParams: [{
            name: 'device_id',
            alias_name: '设备',
            type: 'string',
            filterType: 'filter',
            value: null,
            inputConfig: {
              control: 'select',
              optionsSource: {
                type: 'dynamic',
                sourceId: 9,
                valueField: 'id',
                labelField: 'name',
                queryParams: { room_id: 'pre-$site$' },
              },
            },
          }],
        },
      }],
      filters: [dynamicFilter('device_id__string', 'device_id', { room_id: 'pre-$site$' })],
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(dynamicQuery(result.filters[0]), undefined);
  assert.ok(result.warnings?.includes('filter:device_id:concat'));
  const card = result.layout.find((item) => item.i === 'card-9');
  const param = card && 'valueConfig' in card
    ? card.valueConfig?.dataSourceParams?.[0]
    : undefined;
  const paramConfig = param?.inputConfig;
  assert.equal(
    paramConfig && paramConfig.control === 'select' && paramConfig.optionsSource.type === 'dynamic'
      ? paramConfig.optionsSource.queryParams
      : 'kept',
    undefined,
  );
  assert.ok(result.warnings?.includes('param:device_id:concat'));
});

test('drops a query-param cycle with the same validator and warns', () => {
  const result = applyDashboardProposal({
    layout: [],
    filters: [],
    filterValues: {},
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [],
      filters: [
        dynamicFilter('device_id__string', 'device_id', { rack_id: { ref: 'rack_id' } }),
        dynamicFilter('rack_id__string', 'rack_id', { device_id: { ref: 'device_id' } }),
      ],
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(dynamicQuery(result.filters[0]), undefined);
  assert.equal(dynamicQuery(result.filters[1]), undefined);
  assert.ok(result.warnings?.includes('graph:cycle'));
});

test('drops a query-param chain longer than three nodes and warns', () => {
  const result = applyDashboardProposal({
    layout: [],
    filters: [],
    filterValues: {},
    allocateId,
    proposal: {
      schemaVersion: '1.0',
      layout: [],
      filters: [
        dynamicFilter('room_id__string', 'room_id', {}),
        dynamicFilter('device_id__string', 'device_id', { room_id: { ref: 'room_id' } }),
        dynamicFilter('rack_id__string', 'rack_id', { device_id: { ref: 'device_id' } }),
        dynamicFilter('port_id__string', 'port_id', { rack_id: { ref: 'rack_id' } }),
      ],
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.warnings?.includes('graph:depth'));
  assert.equal(dynamicQuery(result.filters.find((item) => item.key === 'port_id')), undefined);
});

test('directory node id matches the open dashboard numeric id', () => {
  assert.equal(proposalTargetsDashboard('current', 426), true);
  assert.equal(proposalTargetsDashboard('dashboard_426', 426), true);
  assert.equal(proposalTargetsDashboard(426, 426), true);
  assert.equal(proposalTargetsDashboard('dashboard_419', 426), false);
  assert.equal(proposalTargetsDashboard('dashboard_426', undefined), false);
});

