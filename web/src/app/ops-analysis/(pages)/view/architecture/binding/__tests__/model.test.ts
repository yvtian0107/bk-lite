import { describe, expect, it } from 'vitest';
import {
  BINDING_SEARCH_LIMIT,
  bindingDisplay,
  bindingModelLabel,
  bindingSearchMode,
  capBindingSearchHits,
  filterBindingSearchHits,
  findSelectionBinding,
  flattenModelOptions,
  normalizeBindingSearchHits,
  normalizeFulltextModelPage,
  normalizeInstanceSearchPage,
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

  it('lists a selected type without a keyword and caps the returned page', () => {
    expect(BINDING_SEARCH_LIMIT).toBe(100);
    expect(bindingSearchMode('', '')).toBe('idle');
    expect(bindingSearchMode('  ', 'host')).toBe('by-type');
    expect(bindingSearchMode('web', 'host')).toBe('by-model-text');
    expect(bindingSearchMode('web', '')).toBe('fulltext');

    const listed = normalizeInstanceSearchPage({
      count: 120,
      insts: [
        { inst_uuid: 'u1', model_id: 'host', inst_name: 'web-01', ip_addr: '10.0.0.1' },
        { inst_name: 'skip' },
      ],
    });
    expect(listed.total).toBe(120);
    expect(capBindingSearchHits(listed.hits, BINDING_SEARCH_LIMIT, listed.total)).toEqual({
      hits: listed.hits,
      limit: listed.hits.length,
      truncated: true,
    });

    const page = normalizeFulltextModelPage({
      total: 140,
      page_size: 100,
      data: [{ inst_uuid: 'u1', model_id: 'host', inst_name: 'web-01', ip_addr: '10.0.0.1' }],
    }, BINDING_SEARCH_LIMIT);
    expect(capBindingSearchHits(page.hits, page.limit, page.total)).toMatchObject({
      truncated: true,
      limit: 1,
    });
    const exact = capBindingSearchHits(page.hits, 100, 1);
    expect(exact.truncated).toBe(false);
    expect(exact.limit).toBe(100);
  });

  it('uses the model list display name on search rows', () => {
    const models = flattenModelOptions([
      { model_id: 'host', model_name: '主机' },
      { model_id: 'switch', model_name: '  ' },
    ]);
    expect(bindingModelLabel(models, 'host')).toBe('主机');
    expect(bindingModelLabel(models, 'switch')).toBe('switch');
    expect(bindingModelLabel(models, 'missing')).toBe('missing');
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
