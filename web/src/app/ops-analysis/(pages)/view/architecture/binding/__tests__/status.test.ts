import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_STATUS_POLL_MS,
  architectureStatusRequestMode,
  blockResourceOpen,
  buildIconPlates,
  buildNodeStatus,
  buildRectangleOverlays,
  canvasLegendSignal,
  buildRegionList,
  collectBoundUuids,
  connectorEndpointNames,
  connectorResourceLines,
  decideDiagramClick,
  iconBindingStats,
  mergeStatusResponse,
  rectangleIconCounts,
  resourceTitle,
  shouldPauseArchitectureStatusRefresh,
  unknownStatusMap,
} from '../status';
import type { ArchitectureNodeStatusItem } from '../model';

const status = (
  instUuid: string,
  level: ArchitectureNodeStatusItem['status'],
  extra: Partial<ArchitectureNodeStatusItem> = {},
): ArchitectureNodeStatusItem => ({
  inst_uuid: instUuid,
  status: level,
  alert_count: 0,
  max_level: null,
  monitor_id: level === 'unmonitored' || level === 'invalid' || level === 'forbidden' ? '' : `mon-${instUuid}`,
  model_id: 'host',
  inst_name: level === 'invalid' || level === 'forbidden' ? '' : instUuid,
  ...extra,
});

const views = [
  {
    id: 'view-1',
    items: [
      { id: 'web', tile: { x: 1, y: 1 }, bkBinding: { inst_uuid: 'uuid-web', model_id: 'host' } },
      { id: 'db', tile: { x: 2, y: 1 }, bkBinding: { inst_uuid: 'uuid-db', model_id: 'mysql' } },
      { id: 'cache', tile: { x: 5, y: 5 }, bkBinding: { inst_uuid: 'uuid-cache', model_id: 'redis' } },
      { id: 'plain', tile: { x: 1, y: 2 } },
      { id: 'edge', tile: { x: 0, y: 3 }, bkBinding: { inst_uuid: 'uuid-edge', model_id: 'host' } },
    ],
    rectangles: [
      {
        id: 'zone',
        from: { x: 3, y: 3 },
        to: { x: 0, y: 0 },
        bkBinding: { inst_uuid: 'uuid-zone', model_id: 'room' },
        bkFollowAlert: true,
      },
      {
        id: 'overlap',
        from: { x: 1, y: 1 },
        to: { x: 2, y: 2 },
        bkFollowAlert: true,
      },
      {
        id: 'quiet',
        from: { x: 8, y: 8 },
        to: { x: 9, y: 9 },
        bkBinding: { inst_uuid: 'uuid-quiet', model_id: 'room' },
      },
    ],
    connectors: [
      {
        id: 'line-item',
        anchors: [
          { id: 'a1', ref: { item: 'web' } },
          { id: 'a2', ref: { item: 'plain' } },
        ],
      },
      {
        id: 'line-tile',
        anchors: [
          { id: 'b1', ref: { tile: { x: 0, y: 0 } } },
          { id: 'b2', ref: { anchor: 'b3' } },
          { id: 'b3', ref: { item: 'db' } },
        ],
      },
      {
        id: 'line-cycle',
        anchors: [
          { id: 'c1', ref: { anchor: 'c2' } },
          { id: 'c2', ref: { anchor: 'c1' } },
        ],
      },
    ],
  },
];

const names = { host: '主机', mysql: '数据库', room: '机房' };

describe('architecture view status', () => {
  it('polls only in view mode and pauses while hidden', () => {
    expect(ARCHITECTURE_STATUS_POLL_MS).toBe(60_000);
    expect(architectureStatusRequestMode({ shareMode: true, editMode: false })).toBe('off');
    expect(architectureStatusRequestMode({ shareMode: true, editMode: true })).toBe('off');
    expect(architectureStatusRequestMode({ shareMode: false, editMode: true })).toBe('once');
    expect(architectureStatusRequestMode({ shareMode: false, editMode: false })).toBe('poll');
    expect(shouldPauseArchitectureStatusRefresh(true)).toBe(true);
    expect(shouldPauseArchitectureStatusRefresh(false)).toBe(false);
  });

  it('collects icon uuids and ignores rectangle bindings', () => {
    expect(collectBoundUuids(views)).toEqual([
      'uuid-cache',
      'uuid-db',
      'uuid-edge',
      'uuid-web',
    ]);
  });

  it('replaces a failed response with unknown rows and empty names', () => {
    const failed = unknownStatusMap(['uuid-web']);
    expect(failed['uuid-web']).toMatchObject({ status: 'unknown', inst_name: '', monitor_id: '' });
    expect(mergeStatusResponse(['uuid-web', 'uuid-db'], [
      status('uuid-web', 'normal', { inst_name: 'web-01' }),
    ])['uuid-db'].status).toBe('unknown');
  });

  it('hides stale names for invalid and forbidden resources', () => {
    expect(resourceTitle(status('uuid-web', 'invalid', { inst_name: 'old' }), names)).toEqual({ type: 'invalid' });
    expect(resourceTitle(status('uuid-web', 'forbidden', { inst_name: 'old' }), names)).toEqual({ type: 'forbidden' });
    expect(resourceTitle(status('uuid-web', 'normal', { inst_name: 'web-01' }), names)).toEqual({
      type: 'text',
      value: 'web-01 · 主机',
    });
    expect(blockResourceOpen(status('uuid-web', 'invalid'))).toBe('invalid');
    expect(blockResourceOpen(status('uuid-web', 'normal'))).toBeNull();
  });

  it('paints icon status and counts only alerting levels', () => {
    const byUuid = {
      'uuid-web': status('uuid-web', 'critical', { alert_count: 4, max_level: 'error' }),
      'uuid-db': status('uuid-db', 'normal'),
      'uuid-cache': status('uuid-cache', 'unmonitored'),
    };
    expect(buildNodeStatus(views, byUuid)).toEqual({
      web: { level: 'critical', count: 4, badgeName: 'uuid-web', badgeLevel: 'error' },
      db: { level: 'normal' },
      cache: { level: 'unmonitored', hint: 'unmonitored' },
    });
  });

  it('aggregates rectangle borders without using the rectangle binding', () => {
    const byUuid = {
      'uuid-web': status('uuid-web', 'warning', { alert_count: 2 }),
      'uuid-db': status('uuid-db', 'critical', { alert_count: 9, max_level: 'error' }),
      'uuid-edge': status('uuid-edge', 'unknown'),
      'uuid-cache': status('uuid-cache', 'normal'),
      'uuid-zone': status('uuid-zone', 'critical', { alert_count: 7, inst_name: '核心区', model_id: 'room' }),
      'uuid-quiet': status('uuid-quiet', 'critical', { inst_name: '空区', model_id: 'room' }),
    };
    const overlays = buildRectangleOverlays(views, byUuid, { followBorders: true });
    expect(overlays.zone).toEqual({
      borderLevel: 'critical',
      resourceCount: 3,
      alertTotal: 11,
    });
    expect(overlays.zone?.label).toBeUndefined();
    expect(overlays.overlap).toEqual({ borderLevel: 'critical', resourceCount: 2, alertTotal: 11 });
    expect(overlays.quiet).toBeUndefined();
    expect(buildRectangleOverlays(views, byUuid, { followBorders: false }).zone).toBeUndefined();
    expect(buildRectangleOverlays(views, byUuid, { followBorders: false, markSummary: true }).zone).toEqual({
      summary: true,
    });
    expect(buildRectangleOverlays(views, {
      'uuid-zone': status('uuid-zone', 'unknown', { inst_name: '' }),
    }, { followBorders: false, markSummary: true }).zone).toEqual({ summary: true });
  });

  it('counts unique resources and sums each alerting resource once', () => {
    const duplicated = [{
      items: [
        { id: 'a', tile: { x: 1, y: 1 }, bkBinding: { inst_uuid: 'same', model_id: 'host' } },
        { id: 'b', tile: { x: 2, y: 1 }, bkBinding: { inst_uuid: 'same', model_id: 'host' } },
        { id: 'c', tile: { x: 1, y: 2 }, bkBinding: { inst_uuid: 'other', model_id: 'host' } },
        { id: 'outside', tile: { x: 9, y: 9 }, bkBinding: { inst_uuid: 'far', model_id: 'host' } },
      ],
      rectangles: [{ id: 'zone', from: { x: 0, y: 0 }, to: { x: 3, y: 3 }, bkFollowAlert: true }],
    }];
    const byUuid = {
      same: status('same', 'critical', { alert_count: 4, max_level: 'critical' }),
      other: status('other', 'warning', { alert_count: 1, max_level: 'warning' }),
      far: status('far', 'critical', { alert_count: 8, max_level: 'fatal' }),
    };
    expect(buildRectangleOverlays(duplicated, byUuid, { followBorders: true }).zone).toMatchObject({
      resourceCount: 2,
      alertTotal: 5,
    });
    const onlyDuplicate = [{
      items: [
        { id: 'a', tile: { x: 1, y: 1 }, bkBinding: { inst_uuid: 'same', model_id: 'host' } },
        { id: 'b', tile: { x: 2, y: 1 }, bkBinding: { inst_uuid: 'same', model_id: 'host' } },
      ],
      rectangles: [{ id: 'zone', from: { x: 0, y: 0 }, to: { x: 3, y: 3 }, bkFollowAlert: true }],
    }];
    expect(buildRectangleOverlays(onlyDuplicate, byUuid, { followBorders: true }).zone).toEqual({
      borderLevel: 'critical',
      resourceCount: 1,
      alertTotal: 4,
    });
  });

  it('ignores normal, unmonitored and unbound icons when coloring a border', () => {
    const byUuid = {
      'uuid-web': status('uuid-web', 'normal'),
      'uuid-db': status('uuid-db', 'unmonitored'),
      'uuid-edge': status('uuid-edge', 'forbidden'),
    };
    expect(buildRectangleOverlays(views, byUuid, { followBorders: true }).zone).toEqual({
      borderLevel: 'unknown',
      resourceCount: 3,
      alertTotal: 0,
    });
  });

  it('builds a two-line name plate and keeps one line when the names match or the icon is untitled', () => {
    const byUuid = {
      'uuid-web': status('uuid-web', 'warning', {
        alert_count: 6,
        max_level: 'critical',
        inst_name: 'mysql-master-02-very-long',
      }),
      'uuid-db': status('uuid-db', 'normal', { inst_name: '数据库', model_id: 'mysql' }),
      'uuid-cache': status('uuid-cache', 'unknown', { inst_name: '缓存-01' }),
      'uuid-edge': status('uuid-edge', 'forbidden', { inst_name: 'hidden-edge' }),
    };
    const plates = buildIconPlates(views, byUuid, names, {
      web: '接入层',
      db: '数据库',
      cache: 'Untitled',
      edge: '边缘',
    });
    expect(plates.web).toMatchObject({
      subtitle: 'mysql-master-02-…',
      hoverName: 'mysql-master-02-very-long',
      hoverModel: '主机',
      alertCount: 6,
      alertLevel: 'critical',
    });
    expect(plates.web?.title).toBeUndefined();
    expect(plates.db).toEqual({
      hoverName: '数据库',
      hoverModel: '数据库',
    });
    expect(plates.cache).toMatchObject({
      title: '缓存-01',
      hoverName: '缓存-01',
    });
    expect(plates.cache?.subtitle).toBeUndefined();
    expect(plates.edge).toMatchObject({ line: 'forbidden', hoverName: 'hidden-edge' });
    expect(plates.plain).toBeUndefined();

    const invalidViews = [{
      items: [
        { id: 'gone', tile: { x: 0, y: 0 }, bkBinding: { inst_uuid: 'uuid-gone', model_id: 'host' } },
      ],
    }];
    expect(buildIconPlates(invalidViews, {
      'uuid-gone': status('uuid-gone', 'invalid', { inst_name: '' }),
    }, names, { gone: '旧图标' }).gone).toMatchObject({
      line: 'invalid',
      hoverName: '',
      hoverModel: '主机',
    });
    expect(canvasLegendSignal(['normal', 'unmonitored'])).toBe('gray');
    expect(canvasLegendSignal(['warning', 'unknown'])).toBe('warning');
    expect(canvasLegendSignal(['critical', 'warning'])).toBe('critical');
    expect(canvasLegendSignal(['normal'])).toBeNull();
  });

  it('lists bound icons inside a rectangle and both connector ends', () => {
    const byUuid = {
      'uuid-web': status('uuid-web', 'warning', { alert_count: 1, inst_name: 'web-01' }),
      'uuid-db': status('uuid-db', 'invalid', { inst_name: 'old-db' }),
      'uuid-edge': status('uuid-edge', 'normal', { inst_name: 'edge-01' }),
      'uuid-zone': status('uuid-zone', 'forbidden', { inst_name: 'old-zone' }),
    };
    const lines = buildRegionList(views, 'zone', byUuid, names).icons;
    expect(lines.map((line) => line.key)).toEqual(['web', 'edge', 'db']);
    expect(lines[0]).toMatchObject({
      clickable: true,
      highlightId: 'web',
      alertCount: 1,
      title: { type: 'text', value: 'web-01 · 主机' },
    });
    expect(lines[1]).toMatchObject({
      clickable: true,
      title: { type: 'text', value: 'edge-01 · 主机' },
    });
    expect(lines[2]).toMatchObject({ clickable: false, title: { type: 'invalid' } });

    const direct = connectorResourceLines(views, 'line-item', byUuid, names);
    expect(direct[0].title).toEqual({ type: 'text', value: 'web-01 · 主机' });
    expect(direct[1].title).toEqual({ type: 'empty' });

    const chained = connectorResourceLines(views, 'line-tile', byUuid, names);
    expect(chained[0].title).toEqual({ type: 'empty' });
    expect(chained[1].title).toEqual({ type: 'invalid' });

    const cycled = connectorResourceLines(views, 'line-cycle', byUuid, names);
    expect(cycled.map((line) => line.title)).toEqual([{ type: 'empty' }, { type: 'empty' }]);
  });

  it('routes icon, rectangle and connector clicks', () => {
    const byUuid = {
      'uuid-web': status('uuid-web', 'normal', { inst_name: 'web-01' }),
      'uuid-zone': status('uuid-zone', 'invalid'),
      'uuid-quiet': status('uuid-quiet', 'forbidden'),
    };
    expect(decideDiagramClick({ hit: null, views, statusByUuid: byUuid })).toEqual({ type: 'close' });
    expect(decideDiagramClick({ hit: { type: 'ITEM', id: 'plain' }, views, statusByUuid: byUuid })).toEqual({
      type: 'toast',
      reason: 'unbound',
    });
    expect(decideDiagramClick({ hit: { type: 'ITEM', id: 'web' }, views, statusByUuid: byUuid })).toEqual({
      type: 'resource',
      instUuid: 'uuid-web',
      modelId: 'host',
      highlightId: 'web',
    });
    expect(decideDiagramClick({
      hit: { type: 'ITEM', id: 'web' },
      views,
      statusByUuid: { 'uuid-web': status('uuid-web', 'forbidden') },
    })).toEqual({ type: 'toast', reason: 'forbidden' });
    expect(decideDiagramClick({ hit: { type: 'RECTANGLE', id: 'zone' }, views, statusByUuid: byUuid })).toEqual({
      type: 'region',
      rectangleId: 'zone',
    });
    expect(decideDiagramClick({ hit: { type: 'RECTANGLE', id: 'quiet' }, views, statusByUuid: byUuid })).toEqual({
      type: 'close',
    });
    expect(decideDiagramClick({ hit: { type: 'RECTANGLE', id: 'overlap' }, views, statusByUuid: byUuid })).toEqual({
      type: 'region',
      rectangleId: 'overlap',
    });
    expect(decideDiagramClick({ hit: { type: 'CONNECTOR', id: 'line-tile' }, views, statusByUuid: byUuid })).toEqual({
      type: 'connector',
      connectorId: 'line-tile',
    });
  });

  it('sorts a region list by alert, normal, then other, and by severity inside alerts', () => {
    const diagram = [{
      items: [
        { id: 'normal-icon', tile: { x: 1, y: 0 }, bkBinding: { inst_uuid: 'u-normal', model_id: 'host' } },
        { id: 'warning-icon', tile: { x: 1, y: 1 }, bkBinding: { inst_uuid: 'u-warning', model_id: 'host' } },
        { id: 'error-icon', tile: { x: 1, y: 2 }, bkBinding: { inst_uuid: 'u-error', model_id: 'host' } },
        { id: 'critical-icon', tile: { x: 1, y: 3 }, bkBinding: { inst_uuid: 'u-critical', model_id: 'host' } },
        { id: 'plain-icon', tile: { x: 1, y: 4 }, bkBinding: { inst_uuid: 'u-plain', model_id: 'host' } },
        { id: 'unknown-icon', tile: { x: 2, y: 4 }, bkBinding: { inst_uuid: 'u-unknown', model_id: 'host' } },
      ],
      rectangles: [{
        id: 'zone',
        from: { x: 0, y: 0 },
        to: { x: 3, y: 4 },
        bkBinding: { inst_uuid: 'u-zone', model_id: 'room' },
      }],
    }];
    const byUuid = {
      'u-normal': status('u-normal', 'normal', { inst_name: 'normal' }),
      'u-warning': status('u-warning', 'warning', { alert_count: 1, max_level: 'warning', inst_name: 'warning' }),
      'u-error': status('u-error', 'critical', { alert_count: 2, max_level: 'error', inst_name: 'error' }),
      'u-critical': status('u-critical', 'critical', { alert_count: 3, max_level: 'critical', inst_name: 'critical' }),
      'u-plain': status('u-plain', 'unmonitored', { inst_name: 'plain' }),
      'u-unknown': status('u-unknown', 'unknown', { inst_name: '' }),
      'u-zone': status('u-zone', 'normal', { inst_name: 'zone', model_id: 'room' }),
    };
    const list = buildRegionList(diagram, 'zone', byUuid, names);
    expect(list.summary).toEqual({ total: 6, alert: 3, normal: 1, other: 2 });
    expect(list).not.toHaveProperty('self');
    expect(list.icons.map((line) => line.key)).toEqual([
      'critical-icon',
      'error-icon',
      'warning-icon',
      'normal-icon',
      'plain-icon',
      'unknown-icon',
    ]);
    const named = buildRegionList(diagram, 'zone', byUuid, names, [
      { id: 'unknown-icon', name: '支付网关' },
      { id: 'plain-icon', name: '  未接入主机  ' },
    ]);
    expect(named.icons.find((line) => line.key === 'unknown-icon')).toMatchObject({
      title: { type: 'unknown' },
      iconName: '支付网关',
    });
    expect(named.icons.find((line) => line.key === 'plain-icon')?.iconName).toBe('未接入主机');
    expect(named.icons.find((line) => line.key === 'normal-icon')?.iconName).toBeUndefined();
  });

  it('counts bound icons and detects unbound ones without treating the count as status', () => {
    expect(iconBindingStats(views)).toEqual({
      bound: 4,
      total: 5,
      boundIds: ['web', 'db', 'cache', 'edge'],
      unboundIds: ['plain'],
    });
    expect(rectangleIconCounts(views, 'zone')).toEqual({ total: 4, bound: 3 });
    expect(rectangleIconCounts(views, 'missing')).toEqual({ total: 0, bound: 0 });
    expect(connectorEndpointNames(views, [
      { id: 'web', name: '接入层' },
      { id: 'db', name: '  数据库  ' },
      { id: 'plain', name: '' },
    ], 'line-item')).toEqual({ start: '接入层', end: '' });
    expect(connectorEndpointNames(views, [{ id: 'db', name: '数据库' }], 'line-tile')).toEqual({
      start: '',
      end: '数据库',
    });
  });
});
