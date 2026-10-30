import { describe, expect, it } from 'vitest';
import { normalizeInputConfig } from '@/app/ops-analysis/utils/paramInputConfigUtils';
import {
  MAX_OPTIONS_QUERY_CHAIN_NODES,
  normalizeQueryParamsForStorage,
  resolveOptionsQueryParams,
  validateOptionsQueryParams,
} from '@/app/ops-analysis/utils/optionsQueryParamRefs';

const names = ['room', 'device', 'rack', 'port'];

describe('options query param refs', () => {
  it('normalizes a whole $name$ or $name:type$ token into { ref }', () => {
    expect(normalizeQueryParamsForStorage({
      room_id: '$server_room_id$',
      typed: '$server_room_id:string$',
      fixed: 'literal',
    })).toEqual({
      ok: true,
      queryParams: {
        room_id: { ref: 'server_room_id' },
        typed: { ref: 'server_room_id' },
        fixed: 'literal',
      },
    });
  });

  it('rejects concatenated tokens', () => {
    expect(normalizeQueryParamsForStorage({ x: 'pre-$id$' })).toEqual({
      ok: false,
      issue: { code: 'concat', param: 'x' },
    });
  });

  it('keeps a chain of three parameters and rejects the fourth', () => {
    expect(MAX_OPTIONS_QUERY_CHAIN_NODES).toBe(3);
    expect(validateOptionsQueryParams([
      { name: 'device', queryParams: { room_id: { ref: 'room' } } },
      { name: 'rack', queryParams: { device_id: { ref: 'device' } } },
    ], names)).toBeNull();
    expect(validateOptionsQueryParams([
      { name: 'device', queryParams: { room_id: { ref: 'room' } } },
      { name: 'rack', queryParams: { device_id: { ref: 'device' } } },
      { name: 'port', queryParams: { rack_id: { ref: 'rack' } } },
    ], names)?.code).toBe('depth');
  });

  it('rejects a reference to a parameter that cannot be passed as a filter', () => {
    expect(validateOptionsQueryParams([
      { name: 'device', queryParams: { raw: { ref: 'payload' } } },
    ], [
      { name: 'device', type: 'string' },
      { name: 'payload', type: 'object' },
    ])?.code).toBe('type');
  });

  it('rejects a cycle and a self reference', () => {
    expect(validateOptionsQueryParams([
      { name: 'room', queryParams: { device_id: { ref: 'device' } } },
      { name: 'device', queryParams: { room_id: { ref: 'room' } } },
    ], names)?.code).toBe('cycle');
    expect(validateOptionsQueryParams([
      { name: 'room', queryParams: { room_id: { ref: 'room' } } },
    ], names)?.code).toBe('self');
  });

  it('does not request downstream options when an upstream value is empty', () => {
    const query = { room_id: { ref: 'room' }, site: 'fixed' };
    expect(resolveOptionsQueryParams(query, () => null)).toEqual({
      blocked: true,
      params: {},
      missingRefs: ['room'],
    });
    expect(resolveOptionsQueryParams(query, () => [])).toMatchObject({ blocked: true });
    expect(resolveOptionsQueryParams(query, () => 'room-1')).toEqual({
      blocked: false,
      params: { room_id: 'room-1', site: 'fixed' },
      missingRefs: [],
    });
  });

  it('normalizes YAML whole-token query params when reading inputConfig', () => {
    const config = normalizeInputConfig({
      inputConfig: {
        control: 'select',
        optionsSource: {
          type: 'dynamic',
          sourceRef: { type: 'rest_api', value: 'cmdb/devices' },
          valueField: 'id',
          labelField: 'name',
          queryParams: { room_id: '$server_room_id:string$' },
        },
      },
    });
    expect(config && config.control === 'select' && config.optionsSource.type === 'dynamic'
      ? config.optionsSource.queryParams
      : undefined).toEqual({ room_id: { ref: 'server_room_id' } });
  });

  it('refuses a concatenated value at runtime instead of sending it', () => {
    expect(resolveOptionsQueryParams({ x: 'pre-$id$' }, () => 'id-1').blocked).toBe(true);
  });
});
