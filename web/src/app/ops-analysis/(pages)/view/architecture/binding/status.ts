import {
  readBinding,
  type ArchitectureNodeStatusItem,
} from './model';

export const ARCHITECTURE_STATUS_POLL_MS = 60_000;

export type OverlayLabel =
  | { type: 'text'; value: string }
  | { type: 'invalid' }
  | { type: 'forbidden' }
  | { type: 'unknown' }
  | { type: 'empty' }
  | { type: 'pending' };

export type RectangleBorderLevel = 'warning' | 'critical' | 'unknown';

export interface RectangleOverlay {
  label?: OverlayLabel;
  borderLevel?: RectangleBorderLevel;
  badgeCount?: number;
  summary?: boolean;
}

export interface IconOverlay {
  level: ArchitectureNodeStatusItem['status'];
  count?: number;
  hint?: 'unmonitored' | 'unknown' | 'forbidden' | 'invalid';
  badgeName?: string;
  badgeLevel?: string;
}

export interface IconBindingStats {
  bound: number;
  total: number;
  boundIds: string[];
  unboundIds: string[];
}

export interface RegionListSummary {
  total: number;
  alert: number;
  normal: number;
  other: number;
}

export interface RegionList {
  summary: RegionListSummary;
  self: ResourceLine | null;
  icons: ResourceLine[];
}

export interface ResourceLine {
  key: string;
  instUuid: string;
  modelId: string;
  highlightId?: string;
  clickable: boolean;
  title: OverlayLabel;
  level: ArchitectureNodeStatusItem['status'] | null;
  alertCount: number | null;
}

export type DiagramClickAction =
  | { type: 'close' }
  | { type: 'toast'; reason: 'unbound' | 'invalid' | 'forbidden' }
  | { type: 'resource'; instUuid: string; modelId: string; highlightId?: string }
  | { type: 'region'; rectangleId: string }
  | { type: 'connector'; connectorId: string };

const STATUS_LEVELS = new Set<ArchitectureNodeStatusItem['status']>([
  'normal',
  'warning',
  'critical',
  'unmonitored',
  'unknown',
  'invalid',
  'forbidden',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const asViews = (views: unknown): Record<string, unknown>[] =>
  Array.isArray(views) ? views.filter(isRecord) : [];

const readCoord = (value: unknown): { x: number; y: number } | null => {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    return null;
  }
  return { x: value.x, y: value.y };
};

export function architectureStatusRequestMode(input: {
  shareMode: boolean;
  editMode: boolean;
}): 'off' | 'once' | 'poll' {
  if (input.shareMode) return 'off';
  if (input.editMode) return 'once';
  return 'poll';
}

export function shouldPauseArchitectureStatusRefresh(hidden: boolean): boolean {
  return hidden;
}

export function unknownStatusItem(instUuid: string): ArchitectureNodeStatusItem {
  return {
    inst_uuid: instUuid,
    status: 'unknown',
    alert_count: 0,
    max_level: null,
    monitor_id: '',
    model_id: '',
    inst_name: '',
  };
}

export function unknownStatusMap(uuids: string[]): Record<string, ArchitectureNodeStatusItem> {
  return Object.fromEntries(uuids.map((uuid) => [uuid, unknownStatusItem(uuid)]));
}

const coerceStatusItem = (raw: unknown): ArchitectureNodeStatusItem | null => {
  if (!isRecord(raw) || typeof raw.inst_uuid !== 'string' || !raw.inst_uuid.trim()) {
    return null;
  }
  const status = STATUS_LEVELS.has(raw.status as ArchitectureNodeStatusItem['status'])
    ? raw.status as ArchitectureNodeStatusItem['status']
    : 'unknown';
  const alertCount = typeof raw.alert_count === 'number' && Number.isFinite(raw.alert_count)
    ? raw.alert_count
    : 0;
  return {
    inst_uuid: raw.inst_uuid.trim(),
    status,
    alert_count: alertCount,
    max_level: typeof raw.max_level === 'string' ? raw.max_level : null,
    monitor_id: typeof raw.monitor_id === 'string' ? raw.monitor_id : '',
    model_id: typeof raw.model_id === 'string' ? raw.model_id : '',
    inst_name: typeof raw.inst_name === 'string' ? raw.inst_name : '',
  };
};

export function mergeStatusResponse(
  uuids: string[],
  items: unknown,
): Record<string, ArchitectureNodeStatusItem> {
  const indexed: Record<string, ArchitectureNodeStatusItem> = {};
  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    const row = coerceStatusItem(item);
    if (row) indexed[row.inst_uuid] = row;
  }
  return Object.fromEntries(uuids.map((uuid) => [uuid, indexed[uuid] ?? unknownStatusItem(uuid)]));
}

export function collectBoundUuids(views: unknown): string[] {
  const found: string[] = [];
  for (const view of asViews(views)) {
    for (const collection of [view.items, view.rectangles]) {
      if (!Array.isArray(collection)) continue;
      for (const entry of collection) {
        const binding = isRecord(entry) ? readBinding(entry.bkBinding) : null;
        if (binding) found.push(binding.inst_uuid);
      }
    }
  }
  return Array.from(new Set(found)).sort();
}

export function resourceTitle(
  status: ArchitectureNodeStatusItem | undefined,
  modelNames: Record<string, string>,
): OverlayLabel {
  if (!status) return { type: 'pending' };
  if (status.status === 'invalid') return { type: 'invalid' };
  if (status.status === 'forbidden') return { type: 'forbidden' };
  if (!status.inst_name) return { type: 'unknown' };
  const typeName = modelNames[status.model_id] || status.model_id;
  return {
    type: 'text',
    value: typeName ? `${status.inst_name} · ${typeName}` : status.inst_name,
  };
}

export function resourceClickable(status: ArchitectureNodeStatusItem | undefined): boolean {
  if (!status) return true;
  return status.status !== 'invalid' && status.status !== 'forbidden';
}

const tileInside = (
  tile: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  return tile.x >= minX && tile.x <= maxX && tile.y >= minY && tile.y <= maxY;
};

interface PlacedIcon {
  id: string;
  tile: { x: number; y: number } | null;
  instUuid: string | null;
  modelId: string | null;
}

interface BoundIcon {
  id: string;
  tile: { x: number; y: number };
  instUuid: string;
  modelId: string;
}

const placedIcons = (view: Record<string, unknown>): PlacedIcon[] => {
  if (!Array.isArray(view.items)) return [];
  const icons: PlacedIcon[] = [];
  for (const entry of view.items) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const binding = readBinding(entry.bkBinding);
    icons.push({
      id: entry.id,
      tile: readCoord(entry.tile),
      instUuid: binding?.inst_uuid ?? null,
      modelId: binding?.model_id ?? null,
    });
  }
  return icons;
};

const boundIcons = (view: Record<string, unknown>): BoundIcon[] => {
  const icons: BoundIcon[] = [];
  for (const icon of placedIcons(view)) {
    if (!icon.tile || !icon.instUuid || !icon.modelId) continue;
    icons.push({
      id: icon.id,
      tile: icon.tile,
      instUuid: icon.instUuid,
      modelId: icon.modelId,
    });
  }
  return icons;
};

export function iconBindingStats(views: unknown): IconBindingStats {
  const boundIds: string[] = [];
  const unboundIds: string[] = [];
  for (const view of asViews(views)) {
    for (const icon of placedIcons(view)) {
      if (icon.instUuid && icon.modelId) boundIds.push(icon.id);
      else unboundIds.push(icon.id);
    }
  }
  return {
    bound: boundIds.length,
    total: boundIds.length + unboundIds.length,
    boundIds,
    unboundIds,
  };
}

export function rectangleIconCounts(
  views: unknown,
  rectangleId: string,
): { total: number; bound: number } {
  const found = findEntry(views, 'rectangles', rectangleId);
  if (!found) return { total: 0, bound: 0 };
  const from = readCoord(found.entry.from);
  const to = readCoord(found.entry.to);
  if (!from || !to) return { total: 0, bound: 0 };
  const inside = placedIcons(found.view).filter((icon) => icon.tile && tileInside(icon.tile, from, to));
  return {
    total: inside.length,
    bound: inside.filter((icon) => Boolean(icon.instUuid && icon.modelId)).length,
  };
}

const borderContribution = (
  level: ArchitectureNodeStatusItem['status'] | undefined,
): RectangleBorderLevel | null => {
  if (level === 'critical') return 'critical';
  if (level === 'warning') return 'warning';
  if (level === 'unknown' || level === 'invalid' || level === 'forbidden') return 'unknown';
  return null;
};

const BORDER_RANK: Record<RectangleBorderLevel, number> = {
  unknown: 1,
  warning: 2,
  critical: 3,
};

export function buildNodeStatus(
  views: unknown,
  statusByUuid: Record<string, ArchitectureNodeStatusItem>,
): Record<string, IconOverlay> {
  const overlays: Record<string, IconOverlay> = {};
  for (const view of asViews(views)) {
    for (const icon of boundIcons(view)) {
      const status = statusByUuid[icon.instUuid];
      if (!status) continue;
      const overlay: IconOverlay = { level: status.status };
      if (status.status === 'warning' || status.status === 'critical') {
        if (Number.isFinite(status.alert_count)) overlay.count = status.alert_count;
        overlay.badgeName = status.inst_name || status.inst_uuid;
        overlay.badgeLevel = status.max_level || status.status;
      } else if (
        status.status === 'unmonitored'
        || status.status === 'unknown'
        || status.status === 'forbidden'
        || status.status === 'invalid'
      ) {
        overlay.hint = status.status;
      }
      overlays[icon.id] = overlay;
    }
  }
  return overlays;
}

export function buildRectangleOverlays(
  views: unknown,
  statusByUuid: Record<string, ArchitectureNodeStatusItem>,
  modelNames: Record<string, string>,
  options: { followBorders: boolean; markSummary?: boolean },
): Record<string, RectangleOverlay> {
  const overlays: Record<string, RectangleOverlay> = {};
  for (const view of asViews(views)) {
    if (!Array.isArray(view.rectangles)) continue;
    const icons = boundIcons(view);
    for (const entry of view.rectangles) {
      if (!isRecord(entry) || typeof entry.id !== 'string') continue;
      const from = readCoord(entry.from);
      const to = readCoord(entry.to);
      const binding = readBinding(entry.bkBinding);
      const overlay: RectangleOverlay = {};
      if (binding) {
        const title = resourceTitle(statusByUuid[binding.inst_uuid], modelNames);
        if (options.followBorders) {
          if (title.type !== 'pending') overlay.label = title;
        } else if (title.type === 'text') {
          overlay.label = title;
        }
      }
      if (options.markSummary && entry.bkFollowAlert === true) {
        overlay.summary = true;
      }
      if (options.followBorders && entry.bkFollowAlert === true && from && to) {
        const inside = icons.filter((icon) => tileInside(icon.tile, from, to));
        let border: RectangleBorderLevel | null = null;
        const alertingResources = new Set<string>();
        for (const icon of inside) {
          const status = statusByUuid[icon.instUuid];
          if (!status) continue;
          const contribution = borderContribution(status.status);
          if (contribution && (!border || BORDER_RANK[contribution] > BORDER_RANK[border])) {
            border = contribution;
          }
          if (status.status === 'warning' || status.status === 'critical') {
            alertingResources.add(icon.instUuid);
          }
        }
        if (border) overlay.borderLevel = border;
        if (alertingResources.size > 0) overlay.badgeCount = alertingResources.size;
      }
      if (overlay.label || overlay.borderLevel || overlay.badgeCount || overlay.summary) {
        overlays[entry.id] = overlay;
      }
    }
  }
  return overlays;
}

const findEntry = (
  views: unknown,
  collection: 'items' | 'rectangles' | 'connectors',
  id: string,
): { view: Record<string, unknown>; entry: Record<string, unknown> } | null => {
  for (const view of asViews(views)) {
    if (!Array.isArray(view[collection])) continue;
    const entry = view[collection].find((item) => isRecord(item) && item.id === id);
    if (isRecord(entry)) return { view, entry };
  }
  return null;
};

const lineFromBinding = (
  key: string,
  binding: { inst_uuid: string; model_id: string },
  statusByUuid: Record<string, ArchitectureNodeStatusItem>,
  modelNames: Record<string, string>,
  highlightId?: string,
): ResourceLine => {
  const status = statusByUuid[binding.inst_uuid];
  return {
    key,
    instUuid: binding.inst_uuid,
    modelId: binding.model_id || status?.model_id || '',
    highlightId,
    clickable: resourceClickable(status),
    title: resourceTitle(status, modelNames),
    level: status?.status ?? null,
    alertCount: status ? status.alert_count : null,
  };
};

const emptyLine = (key: string): ResourceLine => ({
  key,
  instUuid: '',
  modelId: '',
  clickable: false,
  title: { type: 'empty' },
  level: null,
  alertCount: null,
});

const emptyRegionSummary = (): RegionListSummary => ({
  total: 0,
  alert: 0,
  normal: 0,
  other: 0,
});

const regionBucket = (
  level: ArchitectureNodeStatusItem['status'] | null,
): keyof Omit<RegionListSummary, 'total'> => {
  if (level === 'warning' || level === 'critical') return 'alert';
  if (level === 'normal') return 'normal';
  return 'other';
};

const ALERT_SEVERITY_RANK: Record<string, number> = {
  fatal: 60,
  severity: 50,
  critical: 40,
  error: 30,
  warning: 20,
  remain: 10,
};

const alertSeverityRank = (
  level: ArchitectureNodeStatusItem['status'] | null,
  maxLevel: string | null,
): number => {
  if (level !== 'warning' && level !== 'critical') return 0;
  const named = maxLevel ? ALERT_SEVERITY_RANK[maxLevel.trim().toLowerCase()] : undefined;
  if (typeof named === 'number') return named;
  return level === 'critical' ? 40 : 20;
};

const BUCKET_RANK = { alert: 0, normal: 1, other: 2 };

export function buildRegionList(
  views: unknown,
  rectangleId: string,
  statusByUuid: Record<string, ArchitectureNodeStatusItem>,
  modelNames: Record<string, string>,
): RegionList {
  const found = findEntry(views, 'rectangles', rectangleId);
  if (!found) return { summary: emptyRegionSummary(), self: null, icons: [] };
  const binding = readBinding(found.entry.bkBinding);
  const self = binding ? lineFromBinding('self', binding, statusByUuid, modelNames) : null;
  const from = readCoord(found.entry.from);
  const to = readCoord(found.entry.to);
  if (!from || !to) return { summary: emptyRegionSummary(), self, icons: [] };
  const icons = boundIcons(found.view)
    .filter((icon) => tileInside(icon.tile, from, to))
    .sort((left, right) => {
      const leftStatus = statusByUuid[left.instUuid];
      const rightStatus = statusByUuid[right.instUuid];
      const leftBucket = regionBucket(leftStatus?.status ?? null);
      const rightBucket = regionBucket(rightStatus?.status ?? null);
      const bucketDelta = BUCKET_RANK[leftBucket] - BUCKET_RANK[rightBucket];
      if (bucketDelta) return bucketDelta;
      const severityDelta = alertSeverityRank(rightStatus?.status ?? null, rightStatus?.max_level ?? null)
        - alertSeverityRank(leftStatus?.status ?? null, leftStatus?.max_level ?? null);
      if (severityDelta) return severityDelta;
      return left.tile.y - right.tile.y || left.tile.x - right.tile.x || left.id.localeCompare(right.id);
    });
  const lines = icons.map((icon) => lineFromBinding(icon.id, {
    inst_uuid: icon.instUuid,
    model_id: icon.modelId,
  }, statusByUuid, modelNames, icon.id));
  const summary = emptyRegionSummary();
  summary.total = lines.length;
  for (const line of lines) summary[regionBucket(line.level)] += 1;
  return { summary, self, icons: lines };
}

export function regionResourceLines(
  views: unknown,
  rectangleId: string,
  statusByUuid: Record<string, ArchitectureNodeStatusItem>,
  modelNames: Record<string, string>,
): ResourceLine[] {
  const list = buildRegionList(views, rectangleId, statusByUuid, modelNames);
  return list.self ? [list.self, ...list.icons] : list.icons;
}

interface ResolvedAnchor {
  binding: { inst_uuid: string; model_id: string } | null;
  itemId?: string;
}

const findAnchor = (view: Record<string, unknown>, anchorId: string): Record<string, unknown> | null => {
  if (!Array.isArray(view.connectors)) return null;
  for (const connector of view.connectors) {
    if (!isRecord(connector) || !Array.isArray(connector.anchors)) continue;
    const anchor = connector.anchors.find((item) => isRecord(item) && item.id === anchorId);
    if (isRecord(anchor)) return anchor;
  }
  return null;
};

const resolveAnchor = (
  anchor: Record<string, unknown> | null,
  view: Record<string, unknown>,
  visiting: Set<string>,
): ResolvedAnchor => {
  if (!anchor) return { binding: null };
  const anchorId = typeof anchor.id === 'string' ? anchor.id : '';
  if (anchorId && visiting.has(anchorId)) return { binding: null };
  const nextVisiting = new Set(visiting);
  if (anchorId) nextVisiting.add(anchorId);
  const ref = isRecord(anchor.ref) ? anchor.ref : {};
  if (typeof ref.item === 'string' && ref.item) {
    const item = Array.isArray(view.items)
      ? view.items.find((entry) => isRecord(entry) && entry.id === ref.item)
      : null;
    if (!isRecord(item) || typeof item.id !== 'string') return { binding: null };
    return { binding: readBinding(item.bkBinding), itemId: item.id };
  }
  if (typeof ref.anchor === 'string' && ref.anchor) {
    return resolveAnchor(findAnchor(view, ref.anchor), view, nextVisiting);
  }
  return { binding: null };
};

const modelItemName = (items: unknown, id: string | undefined): string => {
  if (!id || !Array.isArray(items)) return '';
  const match = items.find((entry) => isRecord(entry) && entry.id === id);
  if (!isRecord(match) || typeof match.name !== 'string') return '';
  return match.name.trim();
};

export function connectorEndpointNames(
  views: unknown,
  items: unknown,
  connectorId: string,
): { start: string; end: string } {
  const found = findEntry(views, 'connectors', connectorId);
  const anchors = found && Array.isArray(found.entry.anchors)
    ? found.entry.anchors.filter(isRecord)
    : [];
  const ends = [anchors[0] ?? null, anchors.length ? anchors[anchors.length - 1] : null];
  const names = ends.map((anchor) => {
    if (!found || !anchor) return '';
    return modelItemName(items, resolveAnchor(anchor, found.view, new Set()).itemId);
  });
  return { start: names[0] ?? '', end: names[1] ?? '' };
}

export function connectorResourceLines(
  views: unknown,
  connectorId: string,
  statusByUuid: Record<string, ArchitectureNodeStatusItem>,
  modelNames: Record<string, string>,
): ResourceLine[] {
  const found = findEntry(views, 'connectors', connectorId);
  const anchors = found && Array.isArray(found.entry.anchors)
    ? found.entry.anchors.filter(isRecord)
    : [];
  const ends = [anchors[0] ?? null, anchors.length ? anchors[anchors.length - 1] : null];
  return ends.map((anchor, index) => {
    const key = index === 0 ? 'start' : 'end';
    if (!found || !anchor) return emptyLine(key);
    const resolved = resolveAnchor(anchor, found.view, new Set());
    if (!resolved.binding) return emptyLine(key);
    return lineFromBinding(key, resolved.binding, statusByUuid, modelNames, resolved.itemId);
  });
}

const openBoundResource = (
  binding: { inst_uuid: string; model_id: string },
  statusByUuid: Record<string, ArchitectureNodeStatusItem>,
  highlightId?: string,
): DiagramClickAction => {
  const blocked = blockResourceOpen(statusByUuid[binding.inst_uuid]);
  if (blocked) return { type: 'toast', reason: blocked };
  return {
    type: 'resource',
    instUuid: binding.inst_uuid,
    modelId: binding.model_id,
    highlightId,
  };
};

export function decideDiagramClick(input: {
  hit: { type: string; id: string } | null;
  views: unknown;
  statusByUuid: Record<string, ArchitectureNodeStatusItem>;
}): DiagramClickAction {
  const hit = input.hit;
  if (!hit) return { type: 'close' };
  if (hit.type === 'CONNECTOR') return { type: 'connector', connectorId: hit.id };
  if (hit.type === 'ITEM') {
    const found = findEntry(input.views, 'items', hit.id);
    const binding = found ? readBinding(found.entry.bkBinding) : null;
    if (!binding) return { type: 'toast', reason: 'unbound' };
    return openBoundResource(binding, input.statusByUuid, hit.id);
  }
  if (hit.type === 'RECTANGLE') {
    const found = findEntry(input.views, 'rectangles', hit.id);
    if (!found) return { type: 'close' };
    if (found.entry.bkFollowAlert === true) {
      return { type: 'region', rectangleId: hit.id };
    }
    const binding = readBinding(found.entry.bkBinding);
    if (!binding) return { type: 'close' };
    return openBoundResource(binding, input.statusByUuid);
  }
  return { type: 'close' };
}

export function blockResourceOpen(
  status: ArchitectureNodeStatusItem | undefined,
): 'invalid' | 'forbidden' | null {
  if (!status) return null;
  if (status.status === 'invalid') return 'invalid';
  if (status.status === 'forbidden') return 'forbidden';
  return null;
}
