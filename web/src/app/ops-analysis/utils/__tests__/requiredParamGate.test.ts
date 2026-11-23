import { describe, expect, it } from 'vitest';
import { processDataSourceFormParamsForSubmit } from '@/app/ops-analysis/utils/dataSourceFormParams';
import {
  formatRequiredParamWaitMessage,
  isMissingRequiredParamValue,
  listMissingRequiredParams,
} from '@/app/ops-analysis/utils/requiredParamGate';
import {
  buildWidgetRequestParams,
  planWidgetRequest,
} from '@/app/ops-analysis/utils/widgetDataTransform';
import { normalizeParams } from '@/app/ops-analysis/(pages)/settings/dataSource/operateModalUtils';

const room = {
  name: 'server_room_id',
  alias_name: '机房',
  type: 'string' as const,
  filterType: 'filter' as const,
  value: '',
  required: true,
};

const target = {
  name: 'monitor_object_id',
  alias_name: '监控对象',
  type: 'string' as const,
  filterType: 'params' as const,
  value: '',
  required: true,
};

const t = (id: string, _defaultMessage?: string, values?: Record<string, string>) => {
  if (id === 'dashboard.selectRequiredParam') return `请选择${values?.label ?? ''}`;
  if (id === 'dashboard.fillRequiredParams') return `请补充：${values?.labels ?? ''}`;
  return id;
};

describe('required parameter gate', () => {
  it('treats blank strings and empty arrays as missing, and keeps 0 and false', () => {
    expect(isMissingRequiredParamValue(undefined)).toBe(true);
    expect(isMissingRequiredParamValue(null)).toBe(true);
    expect(isMissingRequiredParamValue('')).toBe(true);
    expect(isMissingRequiredParamValue('   ')).toBe(true);
    expect(isMissingRequiredParamValue([])).toBe(true);
    expect(isMissingRequiredParamValue(0)).toBe(false);
    expect(isMissingRequiredParamValue(false)).toBe(false);
    expect(isMissingRequiredParamValue('room-1')).toBe(false);
  });

  it('lists every missing required label and ignores optional parameters', () => {
    const missing = listMissingRequiredParams(
      [room, target, { name: 'limit', alias_name: '条数', required: false }],
      { server_room_id: '  ', monitor_object_id: [], limit: '' },
    );
    expect(missing).toEqual([
      { name: 'server_room_id', label: '机房' },
      { name: 'monitor_object_id', label: '监控对象' },
    ]);
    expect(formatRequiredParamWaitMessage(missing, t)).toBe('请补充：机房、监控对象');
    expect(formatRequiredParamWaitMessage([missing[0]], t)).toBe('请选择机房');
  });

  it('keeps a request when the effective value is 0 or false', () => {
    const zero = buildWidgetRequestParams({
      config: {
        dataSourceParams: [{ ...target, type: 'number', value: null, filterType: 'params' }],
      },
      dataSource: {
        params: [{ ...target, type: 'number', value: null, filterType: 'params' }],
      },
      extraParams: { monitor_object_id: 0 },
    });
    expect(zero).toMatchObject({ monitor_object_id: 0 });

    const flag = buildWidgetRequestParams({
      config: {
        dataSourceParams: [{ ...target, type: 'boolean', value: null, filterType: 'params' }],
      },
      dataSource: {
        params: [{ ...target, type: 'boolean', value: null, filterType: 'params' }],
      },
      extraParams: { monitor_object_id: false },
    });
    expect(flag).toMatchObject({ monitor_object_id: false });
  });

  it('waits per widget from the live catalog, including after the catalog gains required', () => {
    const widgetParams = [{ ...room, required: false, value: '' }];
    const waiting = planWidgetRequest({
      config: { dataSourceParams: widgetParams, filterBindings: { 'server_room_id__string': true } },
      dataSource: { params: [room] },
      unifiedFilterValues: { 'server_room_id__string': '' },
      filterBindings: { 'server_room_id__string': true },
      filterDefinitions: [{
        id: 'server_room_id__string',
        key: 'server_room_id',
        name: '机房',
        type: 'string',
        enabled: true,
      }] as never,
    });
    expect(waiting).toMatchObject({
      status: 'waiting',
      missing: [{ name: 'server_room_id', label: '机房' }],
    });

    const neighbor = planWidgetRequest({
      config: { dataSourceParams: [{ name: 'limit', type: 'number', filterType: 'fixed', value: 5 }] },
      dataSource: { params: [{ name: 'limit', type: 'number', filterType: 'fixed', value: 5 }] },
    });
    expect(neighbor.status).toBe('ready');

    const staleCopy = planWidgetRequest({
      config: { dataSourceParams: [{ ...room, required: true }] },
      dataSource: { params: [{ ...room, required: undefined }] },
    });
    expect(staleCopy.status).toBe('ready');
  });

  it('treats a resolved null catalog as parameterless and fails an illegal catalog', () => {
    expect(planWidgetRequest({
      config: { dataSourceParams: [{ ...room, required: true, value: '' }] },
      dataSource: { params: null },
    }).status).toBe('ready');
    expect(buildWidgetRequestParams({
      config: { dataSourceParams: [{ name: 'limit', type: 'number', filterType: 'fixed', value: 1 }] },
      dataSource: { params: [] },
    })).toEqual({ limit: 1 });
    expect(planWidgetRequest({
      config: { dataSourceParams: [room] },
      dataSource: {},
    })).toMatchObject({ status: 'failed', reason: 'invalid' });
    expect(buildWidgetRequestParams({
      config: { dataSourceParams: [room] },
      dataSource: { params: { name: 'server_room_id' } },
    })).toBeNull();
    expect(planWidgetRequest({
      config: { dataSourceParams: [room] },
      catalogPhase: 'pending',
    }).status).toBe('pending');
    expect(planWidgetRequest({
      config: { dataSourceParams: [room] },
      catalogPhase: 'failed',
    })).toMatchObject({ status: 'failed', reason: 'lookup' });
    expect(buildWidgetRequestParams({
      config: { dataSourceParams: [{ name: 'limit', type: 'number', filterType: 'fixed', value: 2 }] },
    })).toEqual({ limit: 2 });
  });

  it('saves a required flag without requiring a default, including a hidden filter parameter', () => {
    const saved = normalizeParams([
      { ...room, id: 'p1', value: '', required: true },
      { ...target, id: 'p2', required: false, value: '' },
    ]);
    expect(saved[0].required).toBe(true);
    expect(saved[0].value).toBe('');
    expect(saved[1].required).toBe(false);

    const submitted = processDataSourceFormParamsForSubmit({}, [
      { ...room, value: '' },
      { ...target, filterType: 'params', value: '' },
    ]);
    expect(submitted.find((param) => param.name === 'server_room_id')).toMatchObject({
      required: true,
      filterType: 'filter',
      value: '',
    });
  });
});
