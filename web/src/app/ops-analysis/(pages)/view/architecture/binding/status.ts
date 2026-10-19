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
}

export interface IconOverlay {
  level: ArchitectureNodeStatusItem['status'];
  count?: number;
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

interface BoundIcon {
  id: string;
  tile: { x: number; y: number };
  instUuid: string;
  modelId: string;
}

const boundIcons = (view: Record<string, unknown>): BoundIcon[] => {
  if (!Array.isArray(view.items)) return [];
  const icons: BoundIcon[] = [];
  for (const entry of view.items) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const tile = readCoord(entry.tile);
    const binding = readBinding(entry.bkBinding);
    if (!tile || !binding) continue;
    icons.push({
      id: entry.id,
      tile,
      instUuid: binding.inst_uuid,
      modelId: binding.model_id,
    });
  }
  return icons;
};

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
      if (
        (status.status === 'warning' || status.status === 'critical')
        && Number.isFinite(status.alert_count)
      ) {
        overlay.count = status.alert_count;
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
  options: { followBorders: boolean },
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
        if (title.type !== 'pending') overlay.label = title;
      }
      if (options.followBorders && entry.bkFollowAlert === true && from && to) {
        const inside = icons.filter((icon) => tileInside(icon.tile, from, to));
        let border: RectangleBorderLevel | null = null;
        let badge = 0;
        for (const icon of inside) {
          const status = statusByUuid[icon.instUuid];
          if (!status) continue;
          const contribution = borderContribution(status.status);
          if (contribution && (!border || BORDER_RANK[contribution] > BORDER_RANK[border])) {
            border = contribution;
          }
          if (status.status === 'warning' || status.status === 'critical') badge += 1;
        }
        if (border) overlay.borderLevel = border;
        if (badge > 0) overlay.badgeCount = badge;
      }
      if (overlay.label || overlay.borderLevel || overlay.badgeCount) {
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

export function regionResourceLines(
  views: unknown,
  rectangleId: string,
  statusByUuid: Record<string, ArchitectureNodeStatusItem>,
  modelNames: Record<string, string>,
): ResourceLine[] {
  const found = findEntry(views, 'rectangles', rectangleId);
  if (!found) return [];
  const lines: ResourceLine[] = [];
  const binding = readBinding(found.entry.bkBinding);
  if (binding) {
    lines.push(lineFromBinding('self', binding, statusByUuid, modelNames));
  }
  const from = readCoord(found.entry.from);
  const to = readCoord(found.entry.to);
  if (!from || !to) return lines;
  const icons = boundIcons(found.view)
    .filter((icon) => tileInside(icon.tile, from, to))
    .sort((left, right) => left.tile.y - right.tile.y || left.tile.x - right.tile.x || left.id.localeCompare(right.id));
  for (const icon of icons) {
    lines.push(lineFromBinding(icon.id, {
      inst_uuid: icon.instUuid,
      model_id: icon.modelId,
    }, statusByUuid, modelNames, icon.id));
  }
  return lines;
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
