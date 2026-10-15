import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedFilterDefinition } from '@/app/ops-analysis/types/dashBoard';
import { ChartDataTransformer } from '@/app/ops-analysis/utils/chartDataTransform';
import { buildInteractionPoints } from '@/app/ops-analysis/utils/interactionPoints';
import {
  isAllowedInteractionUrl,
  isFirstActionColumn,
  listInteractionVariables,
  listPresentDataVariables,
  listTableFieldVariables,
  migrateActionsToInteraction,
  prepareInteractionNavigation,
  readChartClickPoint,
  readWidgetInteraction,
  resolveInteractionUrl,
  shouldNavigateInteraction,
  shouldRenderEventTimelineFieldLink,
  shouldRenderInteractionActionButton,
  shouldShowInteractionEntry,
  withInteractionActionColumn,
  type ChartLinkPoint,
} from '@/app/ops-analysis/utils/interactionLink';

const filter = (
  partial: Partial<UnifiedFilterDefinition> & Pick<UnifiedFilterDefinition, 'id' | 'key' | 'type'>,
): UnifiedFilterDefinition => ({
  name: partial.key,
  order: 0,
  enabled: true,
  ...partial,
});

const now = new Date('2026-10-15T00:00:00.000Z');

test('resolves filter ids, multi-select, empty values, and escaped dollars', () => {
  const definitions = [
    filter({ id: 'env', key: 'env', type: 'string', name: '环境' }),
    filter({ id: 'hosts', key: 'host', type: 'string', name: '主机' }),
  ];
  const url = resolveInteractionUrl(
    'https://example.com/item?env=$env$&host=$host$&plain=\\$keep',
    {
      definitions,
      values: { env: 'prod-id', hosts: ['a', '', 'b'] },
      now,
    },
  );

  assert.equal(
    url,
    'https://example.com/item?env=prod-id&host=a%2C%2Cb&plain=$keep',
  );
});

test('encodes each token and leaves the rest of the URL untouched', () => {
  const definitions = [filter({ id: 'q', key: 'q', type: 'string' })];
  const url = resolveInteractionUrl('https://example.com/a b?q=$q$', {
    definitions,
    values: { q: 'x y' },
    now,
  });

  assert.equal(url, 'https://example.com/a b?q=x%20y');
});

test('converts a relative time range at click time and exposes start and end', () => {
  const definitions = [
    filter({ id: 'time', key: 'time', type: 'timeRange', name: '时间' }),
  ];
  const input = {
    definitions,
    values: { time: { selectValue: 60 } },
    now,
  };

  assert.equal(
    resolveInteractionUrl('$time$', input),
    `${encodeURIComponent('2026-10-14T23:00:00.000Z,2026-10-15T00:00:00.000Z')}`,
  );
  assert.equal(
    resolveInteractionUrl('$time.start$', input),
    encodeURIComponent('2026-10-14T23:00:00.000Z'),
  );
  assert.equal(
    resolveInteractionUrl('$time.end$', input),
    encodeURIComponent('2026-10-15T00:00:00.000Z'),
  );
});

test('resolves clicked point fields without encoding the whole URL', () => {
  const point: ChartLinkPoint = {
    seriesName: 'cpu',
    time: '2026-10-15T00:00:00.000Z',
    numeric: 1.5,
    text: '1.5',
    raw: 1.5,
    fields: { host: 'web 01', region: 'a/b' },
  };
  const url = resolveInteractionUrl(
    '/ops?series=$__series.name$&at=$__value.time$&n=$__value.numeric$&host=$__data.fields.host$',
    { definitions: [], values: {}, point, now },
  );

  assert.equal(
    url,
    '/ops?series=cpu&at=2026-10-15T00%3A00%3A00.000Z&n=1.5&host=web%2001',
  );
});

test('allows http, https, and site paths, and blocks other protocols', () => {
  assert.equal(isAllowedInteractionUrl('https://example.com/a?b=1'), true);
  assert.equal(isAllowedInteractionUrl('http://example.com'), true);
  assert.equal(isAllowedInteractionUrl('/cmdb/assetData?id=1'), true);
  assert.equal(isAllowedInteractionUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedInteractionUrl('data:text/html,hi'), false);
  assert.equal(isAllowedInteractionUrl('vbscript:msg'), false);
  assert.equal(isAllowedInteractionUrl('//evil.example'), false);
  assert.equal(isAllowedInteractionUrl('///evil.example'), false);
  assert.equal(isAllowedInteractionUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedInteractionUrl(' javascript:alert(1)'), false);
});

test('new tab plans noopener navigation and same tab keeps screen mode', () => {
  const external = prepareInteractionNavigation(
    'https://example.com/item',
    'newTab',
    '?screen=true',
  );
  assert.equal(external.ok, true);
  if (external.ok) {
    assert.equal(external.mode, 'newTab');
    assert.equal(external.href, 'https://example.com/item');
  }

  const internal = prepareInteractionNavigation('/cmdb/asset', 'sameTab', '?screen=true');
  assert.equal(internal.ok, true);
  if (internal.ok) {
    assert.equal(internal.mode, 'sameFrame');
    assert.equal(internal.href.includes('screen=true'), true);
  }

  assert.deepEqual(
    prepareInteractionNavigation('javascript:alert(1)', 'sameTab', ''),
    { ok: false, reason: 'blocked' },
  );
});

test('keeps only the first legacy action and turns mappings into a query', () => {
  const link = migrateActionsToInteraction([
    {
      columnKey: '__actions__',
      text: '查看',
      url: 'https://example.com/item',
      openMode: 'newTab',
      params: [
        { key: 'id', source: 'rowField', sourceKey: 'host_id' },
        { key: 'env', source: 'fixed', value: 'prod id' },
      ],
    },
    {
      columnKey: '__actions__',
      text: '第二条',
      url: 'https://example.com/other',
    },
  ]);

  assert.deepEqual(link, {
    kind: 'data',
    name: '查看',
    url: 'https://example.com/item?id=$__data.fields.host_id$&env=prod%20id',
    openMode: 'newTab',
  });
  assert.equal(
    readWidgetInteraction({
      chartType: 'table',
      actions: [
        {
          columnKey: '__actions__',
          text: '查看',
          url: '/cmdb',
          params: [{ key: 'id', source: 'rowField', sourceKey: 'id' }],
        },
      ],
    })?.url,
    '/cmdb?id=$__data.fields.id$',
  );
});

test('stored interaction wins over legacy actions and title-only widgets drop data links', () => {
  const stored = readWidgetInteraction({
    chartType: 'line',
    interaction: {
      kind: 'title',
      name: '详情',
      url: '/ops?env=$env$',
      openMode: 'sameTab',
    },
    actions: [{ columnKey: 'op', text: '旧', url: '/old' }],
  });
  assert.equal(stored?.kind, 'title');
  assert.equal(stored?.url, '/ops?env=$env$');
  assert.equal(
    readWidgetInteraction({
      chartType: 'topologyMap',
      interaction: { kind: 'data', name: '点', url: '/x', openMode: 'sameTab' },
    }),
    undefined,
  );
});

test('edit shows the entry without navigation and share hides it', () => {
  assert.equal(shouldShowInteractionEntry('edit', true), true);
  assert.equal(shouldNavigateInteraction('edit'), false);
  assert.equal(shouldShowInteractionEntry('view', true), true);
  assert.equal(shouldNavigateInteraction('view'), true);
  assert.equal(shouldShowInteractionEntry('share', true), false);
  assert.equal(shouldShowInteractionEntry('view', false), false);
});

test('line points keep the original timestamp, row, and label without changing plotted values', () => {
  const chart = ChartDataTransformer.transformToLineBarData([
    { name: 1760486400, value: 3, host: 'web-01' },
    { name: 1760486460, value: 4, host: 'web-02' },
  ]);

  assert.deepEqual(chart.values, [3, 4]);
  assert.equal(chart.points?.[0]?.time, '2025-10-15T00:00:00.000Z');
  assert.equal(chart.points?.[0]?.numeric, 3);
  assert.equal(chart.points?.[0]?.fields?.host, 'web-01');
  assert.equal(chart.points?.[0]?.raw, 3);
  assert.equal(chart.categories[0]?.includes('10-15'), true);
});

test('dropdown lists only fields that exist for the chart and the rows', () => {
  const chart = ChartDataTransformer.transformToLineBarData({
    cpu: [{ name: 'a', value: 1 }],
  });
  const points = chart.series?.[0]?.points ?? [];
  const variables = listPresentDataVariables('line', { cpu: [] }, {
    valueGroup: '值',
    fieldGroup: '字段',
    fieldLabel: (field) => field,
    seriesName: '系列',
    numeric: '数值',
    raw: '原始值',
  }, points);

  assert.equal(variables.some((item) => item.token === '$__series.name$'), true);
  assert.equal(variables.some((item) => item.token === '$__data.fields.name$'), true);
  assert.equal(variables.some((item) => item.token === '$__value.time$'), false);

  const tableVariables = listTableFieldVariables(
    [{ host: 'web-01', cpu: 1 }],
    { fieldGroup: '字段', fieldLabel: (field) => field },
  );
  assert.deepEqual(
    tableVariables.map((item) => item.token),
    ['$__data.fields.cpu$', '$__data.fields.host$'],
  );

  const room = listPresentDataVariables('room3D', {
    racks: [{ rack_id: 'r1', rack_name: 'A', devices: [{ device_id: 'd1', device_name: 'srv' }] }],
  }, {
    valueGroup: '值',
    fieldGroup: '字段',
    fieldLabel: (field) => field,
    cabinetId: '机柜 ID',
    cabinetName: '机柜名称',
    deviceId: '设备 ID',
    deviceName: '设备名称',
  });
  assert.deepEqual(room.map((item) => item.token), [
    '$__data.fields.cabinet.id$',
    '$__data.fields.cabinet.name$',
    '$__data.fields.device.id$',
    '$__data.fields.device.name$',
  ]);
});

test('filter variable list adds start and end only for time filters', () => {
  const variables = listInteractionVariables({
    definitions: [
      filter({ id: 'env', key: 'env', type: 'string', name: '环境' }),
      filter({ id: 'time', key: 'time', type: 'timeRange', name: '时间' }),
    ],
    dataVariables: [],
    filterGroup: '筛选',
    timeStartLabel: (name) => `${name}开始`,
    timeEndLabel: (name) => `${name}结束`,
  });

  assert.deepEqual(variables.map((item) => item.token), [
    '$env$',
    '$time$',
    '$time.start$',
    '$time.end$',
  ]);
});

test('chart clicks expose the fields that exist on each widget', () => {
  const single = buildInteractionPoints('single', { cpu: 12, host: 'web' }, {
    selectedFields: ['cpu'],
  });
  assert.equal(single[0]?.numeric, 12);
  assert.equal(single[0]?.fields?.host, 'web');

  const gauge = buildInteractionPoints('gauge', { value: 40 }, {
    selectedFields: ['value'],
  });
  assert.equal(gauge[0]?.numeric, 40);

  const topN = buildInteractionPoints('topN', [
    { name: 'a', value: 3 },
  ], { topNLabelField: 'name', topNValueField: 'value' });
  assert.equal(topN[0]?.seriesName, 'a');
  assert.equal(topN[0]?.numeric, 3);
  assert.equal(topN[0]?.fields?.name, 'a');

  const pie = buildInteractionPoints('pie', [
    { name: 'up', value: 2 },
  ], { dimensionField: 'name', valueField: 'value' });
  assert.equal(pie[0]?.seriesName, 'up');
  assert.equal(pie[0]?.numeric, 2);

  const radarPoint = readChartClickPoint({
    data: { __links: [{ seriesName: 'cpu', numeric: 1 }, { seriesName: 'mem', numeric: 2 }] },
    event: { target: { __dimIdx: 1 } },
  });
  assert.equal(radarPoint?.seriesName, 'mem');

  const tableColumns = withInteractionActionColumn(
    [{ key: 'host', columnType: 'data' }],
    { kind: 'data', name: '查看', url: '/host', openMode: 'sameTab' },
    'view',
    { key: '__interaction', columnType: 'actions' },
  );
  assert.equal(isFirstActionColumn(tableColumns, 1), true);
  assert.equal(withInteractionActionColumn(
    tableColumns,
    { kind: 'data', name: '查看', url: '/host', openMode: 'sameTab' },
    'share',
    { key: 'extra', columnType: 'actions' },
  ).some((column) => column.key === 'extra'), false);

  const systems = listPresentDataVariables('application3D', {
    items: [{ id: 'sys-1', name: '门户' }],
  }, {
    valueGroup: '值',
    fieldGroup: '字段',
    fieldLabel: (field) => field,
    systemId: '系统 ID',
    systemName: '系统名称',
  });
  assert.deepEqual(systems.map((item) => item.token), [
    '$__data.fields.system.id$',
    '$__data.fields.system.name$',
  ]);
});

test('event table and event timeline expose the clicked row fields', () => {
  const labels = {
    valueGroup: '值',
    fieldGroup: '字段',
    fieldLabel: (field: string) => field,
  };
  const rows = [{ id: 'evt-1', title: 'CPU', severity: 'critical' }];
  const eventTable = listPresentDataVariables(
    'eventTable',
    rows,
    labels,
    buildInteractionPoints('eventTable', rows),
  );
  assert.deepEqual(eventTable.map((item) => item.token), [
    '$__data.fields.id$',
    '$__data.fields.severity$',
    '$__data.fields.title$',
  ]);

  const events = [{
    time: '2026-08-01 10:15:00',
    title: 'CPU usage reached 95%',
    host: 'web-01',
    link: '/monitor/view/detail?id=1',
  }];
  const timelinePoints = buildInteractionPoints('eventTimeline', events);
  assert.equal(timelinePoints[0]?.text, 'CPU usage reached 95%');
  assert.equal(Date.parse(timelinePoints[0]?.time || ''), Date.parse('2026-08-01 10:15:00'));
  assert.equal(timelinePoints[0]?.fields?.host, 'web-01');
  const timeline = listPresentDataVariables('eventTimeline', events, labels, timelinePoints);
  assert.equal(timeline.some((item) => item.token === '$__value.time$'), true);
  assert.equal(timeline.some((item) => item.token === '$__value.text$'), true);
  assert.equal(timeline.some((item) => item.token === '$__data.fields.host$'), true);
  assert.equal(timeline.some((item) => item.token === '$__data.fields.title$'), true);

  const dataLink = {
    kind: 'data' as const,
    name: '查看',
    url: '/ops/event?title=$__value.text$',
    openMode: 'sameTab' as const,
  };
  assert.equal(shouldRenderEventTimelineFieldLink(dataLink, '/monitor/view/detail?id=1'), false);
  assert.equal(shouldRenderEventTimelineFieldLink(undefined, '/monitor/view/detail?id=1'), true);
  assert.equal(shouldRenderInteractionActionButton(dataLink, 'view', true), true);
  assert.equal(shouldRenderInteractionActionButton(dataLink, 'edit', true), true);
  assert.equal(shouldRenderInteractionActionButton(dataLink, 'share', true), false);
  assert.equal(shouldShowInteractionEntry('share', true), false);
  assert.equal(shouldNavigateInteraction('edit'), false);
});
