import { describe, expect, it } from 'vitest';
import type { DatasourceItem, InputControlConfig } from '@/app/ops-analysis/types/dataSource';
import type { UnifiedFilterDefinition } from '@/app/ops-analysis/types/dashBoard';
import { processDataSourceParams } from '@/app/ops-analysis/utils/widgetDataTransform';
import { scanDataSourceFilterParams } from '@/app/ops-analysis/utils/scanUnifiedFilterParams';

const roomSource = (restApi = 'cmdb/get_room_list'): InputControlConfig => ({
  control: 'select',
  optionsSource: {
    type: 'dynamic',
    sourceRef: { type: 'rest_api', value: restApi },
    valueField: 'inst_uuid',
    labelField: 'inst_name',
  },
});

const source = (
  id: number,
  name: string,
  params: DatasourceItem['params'],
): DatasourceItem => ({
  id,
  name,
  rest_api: name,
  desc: '',
  params: params ?? [],
  chart_type: ['single'],
  namespaces: [],
} as DatasourceItem);

const layout = (ids: number[]) => ids.map((id) => ({
  valueConfig: { dataSource: id },
}));

describe('scan unified filter params', () => {
  it('keeps one room filter when heterogeneous sources share cmdb/get_room_list', () => {
    const scanned = scanDataSourceFilterParams(layout([1, 2, 3]), [
      source(1, 'room-a', [{
        name: 'server_room_id',
        alias_name: '机房',
        type: 'string',
        filterType: 'filter',
        value: null,
        inputConfig: roomSource(),
      }]),
      source(2, 'room-b', [{
        name: 'server_room_id',
        alias_name: '机房',
        type: 'string',
        filterType: 'filter',
        value: null,
        inputConfig: roomSource(),
      }]),
      source(3, 'room-c', [{
        name: 'server_room_id',
        alias_name: '机房',
        type: 'string',
        filterType: 'filter',
        value: null,
        inputConfig: roomSource(),
      }]),
    ]);

    expect(scanned).toHaveLength(1);
    expect(scanned[0]?.id).toBe('server_room_id__string');
    expect(scanned[0]?.componentCount).toBe(3);
  });

  it('splits same-name params whose option universes differ, and keeps the legacy id on the stored match', () => {
    const stored: UnifiedFilterDefinition[] = [{
      id: 'server_room_id__string',
      key: 'server_room_id',
      name: '机房',
      type: 'string',
      defaultValue: null,
      order: 0,
      enabled: true,
      inputConfig: roomSource(),
    }];
    const scanned = scanDataSourceFilterParams(layout([1, 2]), [
      source(1, 'cmdb/get_room_list', [{
        name: 'server_room_id',
        alias_name: '机房',
        type: 'string',
        filterType: 'filter',
        value: null,
        inputConfig: roomSource(),
      }]),
      source(2, 'monitor/get_rooms', [{
        name: 'server_room_id',
        alias_name: '机房',
        type: 'string',
        filterType: 'filter',
        value: null,
        inputConfig: roomSource('monitor/get_rooms'),
      }]),
    ], stored);

    const ids = scanned.map((item) => item.id);
    expect(ids).toContain('server_room_id__string');
    const splitId = ids.find((id) => id !== 'server_room_id__string');
    expect(splitId).toMatch(/^server_room_id__string__[0-9a-f]{8}$/);
    expect(scanned.find((item) => item.id === 'server_room_id__string')?.sourceHint)
      .toContain('cmdb/get_room_list');
    expect(scanned.find((item) => item.id !== 'server_room_id__string')?.suggestedName)
      .toContain('monitor/get_rooms');
  });

  it('keeps the legacy id on one split row when the stored identity matches none', () => {
    const stored: UnifiedFilterDefinition[] = [{
      id: 'device_id__string',
      key: 'device_id',
      name: '设备',
      type: 'string',
      defaultValue: null,
      order: 0,
      enabled: true,
      inputConfig: roomSource('retired/api'),
    }];
    const scanned = scanDataSourceFilterParams(layout([1, 2]), [
      source(1, 'cmdb/devices', [{
        name: 'device_id', alias_name: '设备', type: 'string', filterType: 'filter', value: null,
        inputConfig: roomSource('cmdb/devices'),
      }]),
      source(2, 'monitor/devices', [{
        name: 'device_id', alias_name: '设备', type: 'string', filterType: 'filter', value: null,
        inputConfig: roomSource('monitor/devices'),
      }]),
    ], stored);
    expect(scanned.map((item) => item.id)).toContain('device_id__string');
    expect(scanned.filter((item) => item.id.startsWith('device_id__string__'))).toHaveLength(1);
  });

  it('does not merge different option sources just because they reference the same upstream', () => {
    const withRef = (restApi: string): InputControlConfig => ({
      control: 'select',
      optionsSource: {
        type: 'dynamic',
        sourceRef: { type: 'rest_api', value: restApi },
        valueField: 'id',
        labelField: 'name',
        queryParams: { room_id: { ref: 'server_room_id' } },
      },
    });
    const scanned = scanDataSourceFilterParams(layout([1, 2]), [
      source(1, 'cmdb/devices', [{
        name: 'device_id', alias_name: '设备', type: 'string', filterType: 'filter', value: null,
        inputConfig: withRef('cmdb/devices'),
      }]),
      source(2, 'monitor/devices', [{
        name: 'device_id', alias_name: '设备', type: 'string', filterType: 'filter', value: null,
        inputConfig: withRef('monitor/devices'),
      }]),
    ]);
    expect(scanned).toHaveLength(2);
  });

  it('still merges time range and organization by name and type only', () => {
    const scanned = scanDataSourceFilterParams(layout([1, 2]), [
      source(1, 'a', [
        { name: 'time', alias_name: '时间', type: 'timeRange', filterType: 'filter', value: 15 },
        {
          name: 'organization', alias_name: '组织', type: 'string', filterType: 'filter', value: null,
          inputConfig: { control: 'organization' },
        },
      ]),
      source(2, 'b', [
        { name: 'time', alias_name: '时间', type: 'timeRange', filterType: 'filter', value: 60 },
        {
          name: 'organization', alias_name: '组织', type: 'string', filterType: 'filter', value: null,
          inputMode: 'organization',
        },
      ]),
    ]);
    expect(scanned.map((item) => item.id).sort()).toEqual(['organization__string', 'time__timeRange']);
    expect(scanned.every((item) => item.componentCount === 2)).toBe(true);
  });

  it('feeds a chart only the filter row whose option source matches its parameter', () => {
    const room = roomSource();
    const other = roomSource('monitor/get_rooms');
    const definitions: UnifiedFilterDefinition[] = [
      {
        id: 'server_room_id__string',
        key: 'server_room_id',
        name: '机房',
        type: 'string',
        defaultValue: null,
        order: 0,
        enabled: true,
        inputConfig: room,
      },
      {
        id: 'server_room_id__string__abcd1234',
        key: 'server_room_id',
        name: '机房 · monitor',
        type: 'string',
        defaultValue: null,
        order: 1,
        enabled: true,
        inputConfig: other,
      },
    ];
    const params = processDataSourceParams({
      sourceParams: [{
        name: 'server_room_id',
        alias_name: '机房',
        type: 'string',
        filterType: 'filter',
        value: 'local-default',
        inputConfig: other,
      }],
      unifiedFilterValues: {
        'server_room_id__string': 'room-a',
        'server_room_id__string__abcd1234': 'room-b',
      },
      filterBindings: {
        'server_room_id__string': true,
        'server_room_id__string__abcd1234': true,
      },
      filterDefinitions: definitions,
    });
    expect(params.server_room_id).toBe('room-b');
  });
});
