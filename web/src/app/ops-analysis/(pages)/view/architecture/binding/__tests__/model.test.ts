import { describe, expect, it } from 'vitest';
import {
  bindingDisplay,
  filterBindingSearchHits,
  findSelectionBinding,
  flattenModelOptions,
  normalizeBindingSearchHits,
} from '../model';

const views = [
  {
    id: 'view-1',
    items: [
      { id: 'node-1', tile: { x: 1, y: 1 }, bkBinding: { inst_uuid: 'uuid-host', model_id: 'host' } },
      { id: 'node-2', tile: { x: 2, y: 2 } },
    ],
    rectangles: [
      {
        id: 'rect-1',
        from: { x: 0, y: 0 },
        to: { x: 4, y: 4 },
        bkBinding: { inst_uuid: 'uuid-room', model_id: 'room' },
        bkFollowAlert: true,
      },
      { id: 'rect-2', from: { x: 5, y: 5 }, to: { x: 6, y: 6 } },
    ],
  },
];

describe('architecture binding model', () => {
  it('reads icon and rectangle bindings and ignores other shapes', () => {
    expect(findSelectionBinding(views, { type: 'ITEM', id: 'node-1' })).toEqual({
      binding: { inst_uuid: 'uuid-host', model_id: 'host' },
      followAlert: false,
    });
    expect(findSelectionBinding(views, { type: 'ITEM', id: 'node-2' })?.binding).toBeNull();
    expect(findSelectionBinding(views, { type: 'RECTANGLE', id: 'rect-1' })).toEqual({
      binding: { inst_uuid: 'uuid-room', model_id: 'room' },
      followAlert: true,
    });
    expect(findSelectionBinding(views, { type: 'RECTANGLE', id: 'rect-2' })?.followAlert).toBe(false);
    expect(findSelectionBinding(views, { type: 'CONNECTOR', id: 'line-1' })).toBeNull();
  });

  it('filters search hits by resource type after normalizing name and ip', () => {
    const hits = normalizeBindingSearchHits([
      { inst_uuid: 'u1', model_id: 'host', inst_name: 'web-01', ip_addr: '10.0.0.1' },
      { inst_uuid: 'u2', model_id: 'switch', inst_name: 'sw-01', ip_addr: '10.0.0.2' },
      { inst_name: 'missing-id' },
    ]);
    expect(filterBindingSearchHits(hits, 'host')).toEqual([
      { inst_uuid: 'u1', model_id: 'host', inst_name: 'web-01', ip_addr: '10.0.0.1' },
    ]);
    expect(filterBindingSearchHits(hits, '').map((hit) => hit.inst_uuid)).toEqual(['u1', 'u2']);
  });

  it('hides stale names for invalid and forbidden resources', () => {
    expect(bindingDisplay({
      inst_uuid: 'u1',
      status: 'invalid',
      alert_count: 0,
      max_level: null,
      monitor_id: '',
      model_id: 'host',
      inst_name: 'old-name',
    }, '主机').blocked).toBe('invalid');
    expect(bindingDisplay({
      inst_uuid: 'u1',
      status: 'forbidden',
      alert_count: 0,
      max_level: null,
      monitor_id: '',
      model_id: 'host',
      inst_name: 'old-name',
    }, '主机').name).toBe('');
    expect(bindingDisplay({
      inst_uuid: 'u1',
      status: 'normal',
      alert_count: 0,
      max_level: null,
      monitor_id: 'm1',
      model_id: 'host',
      inst_name: 'web-01',
    }, '主机')).toEqual({ name: 'web-01', typeName: '主机', blocked: null });
  });

  it('flattens grouped model lists', () => {
    expect(flattenModelOptions([
      { model_id: 'host', model_name: '主机' },
      { list: [{ model_id: 'switch', model_name: '交换机' }] },
    ])).toEqual([
      { model_id: 'host', model_name: '主机' },
      { model_id: 'switch', model_name: '交换机' },
    ]);
  });
});
