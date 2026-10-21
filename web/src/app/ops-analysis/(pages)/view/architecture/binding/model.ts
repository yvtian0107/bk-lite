export interface ArchitectureBinding {
  inst_uuid: string;
  model_id: string;
}

export interface ArchitectureNodeStatusItem {
  inst_uuid: string;
  status:
    | 'normal'
    | 'warning'
    | 'critical'
    | 'unmonitored'
    | 'unknown'
    | 'invalid'
    | 'forbidden';
  alert_count: number;
  max_level: string | null;
  monitor_id: string;
  model_id: string;
  inst_name: string;
  /** Present when the status API split critical / error / warning. */
  level_counts?: { critical: number; error: number; warning: number };
  /** Alert id plus level, used to dedupe a region badge. info and other levels count as warning. */
  alerts?: Array<{ id: string; level: string }>;
}

export interface BindingSearchHit {
  inst_uuid: string;
  inst_name: string;
  ip_addr: string;
  model_id: string;
}

export interface ModelOption {
  model_id: string;
  model_name: string;
}

/** CMDB fulltext_search_by_model 的 page_size 上限。类型列表和关键字结果都只取这一页。 */
export const BINDING_SEARCH_LIMIT = 100;

export interface BindingSearchResult {
  hits: BindingSearchHit[];
  limit: number;
  truncated: boolean;
}

export type BindingSearchMode = 'idle' | 'by-type' | 'by-model-text' | 'fulltext';

export interface SelectionBinding {
  binding: ArchitectureBinding | null;
  followAlert: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

export function readBinding(value: unknown): ArchitectureBinding | null {
  if (!isRecord(value)) return null;
  const instUuid = typeof value.inst_uuid === 'string' ? value.inst_uuid.trim() : '';
  const modelId = typeof value.model_id === 'string' ? value.model_id.trim() : '';
  if (!instUuid || !modelId) return null;
  return { inst_uuid: instUuid, model_id: modelId };
}

export function findSelectionBinding(
  views: unknown,
  selection: { type: string; id: string } | null,
): SelectionBinding | null {
  if (!selection || (selection.type !== 'ITEM' && selection.type !== 'RECTANGLE')) {
    return null;
  }
  const viewList = Array.isArray(views) ? views : [];
  for (const view of viewList) {
    if (!isRecord(view)) continue;
    const collection = selection.type === 'ITEM' ? view.items : view.rectangles;
    const list = Array.isArray(collection) ? collection : [];
    const match = list.find((entry) => isRecord(entry) && entry.id === selection.id);
    if (!isRecord(match)) continue;
    return {
      binding: selection.type === 'ITEM' ? readBinding(match.bkBinding) : null,
      followAlert: selection.type === 'RECTANGLE' && match.bkFollowAlert === true,
    };
  }
  return null;
}

export function normalizeBindingSearchHits(raw: unknown): BindingSearchHit[] {
  const list = Array.isArray(raw) ? raw : [];
  const hits: BindingSearchHit[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const instUuid = typeof item.inst_uuid === 'string' ? item.inst_uuid.trim() : '';
    const modelId = typeof item.model_id === 'string' ? item.model_id.trim() : '';
    if (!instUuid || !modelId) continue;
    hits.push({
      inst_uuid: instUuid,
      inst_name: typeof item.inst_name === 'string' ? item.inst_name : '',
      ip_addr: typeof item.ip_addr === 'string' ? item.ip_addr : '',
      model_id: modelId,
    });
  }
  return hits;
}

export function bindingSearchMode(keyword: string, modelId: string): BindingSearchMode {
  const text = keyword.trim();
  const model = modelId.trim();
  if (!text && !model) return 'idle';
  if (!text) return 'by-type';
  if (model) return 'by-model-text';
  return 'fulltext';
}

export function capBindingSearchHits(
  hits: BindingSearchHit[],
  limit: number,
  total: number,
): BindingSearchResult {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  const shown = safeLimit > 0 ? hits.slice(0, safeLimit) : [];
  const knownTotal = Number.isFinite(total) ? total : shown.length;
  const truncated = knownTotal > shown.length;
  return {
    hits: shown,
    limit: truncated ? shown.length : safeLimit,
    truncated,
  };
}

export function normalizeInstanceSearchPage(raw: unknown): { hits: BindingSearchHit[]; total: number } {
  const record = isRecord(raw) ? raw : {};
  const hits = normalizeBindingSearchHits(record.insts);
  const total = typeof record.count === 'number' && Number.isFinite(record.count)
    ? record.count
    : hits.length;
  return { hits, total };
}

export function normalizeFulltextModelPage(
  raw: unknown,
  fallbackLimit: number,
): { hits: BindingSearchHit[]; total: number; limit: number } {
  const record = isRecord(raw) ? raw : {};
  const hits = normalizeBindingSearchHits(record.data);
  const total = typeof record.total === 'number' && Number.isFinite(record.total)
    ? record.total
    : hits.length;
  const pageSize = typeof record.page_size === 'number' && record.page_size > 0
    ? record.page_size
    : fallbackLimit;
  return { hits, total, limit: pageSize };
}

export function bindingModelLabel(models: ModelOption[], modelId: string): string {
  const name = models.find((model) => model.model_id === modelId)?.model_name.trim();
  return name || modelId;
}

export function flattenModelOptions(raw: unknown): ModelOption[] {
  const list = Array.isArray(raw) ? raw : [];
  const options: ModelOption[] = [];
  const visit = (entry: unknown) => {
    if (!isRecord(entry)) return;
    if (typeof entry.model_id === 'string' && entry.model_id) {
      options.push({
        model_id: entry.model_id,
        model_name: typeof entry.model_name === 'string' && entry.model_name
          ? entry.model_name
          : entry.model_id,
      });
    }
    if (Array.isArray(entry.list)) entry.list.forEach(visit);
    if (Array.isArray(entry.models)) entry.models.forEach(visit);
  };
  list.forEach(visit);
  return options;
}

export function bindingDisplay(
  status: ArchitectureNodeStatusItem | null | undefined,
  modelName: string,
): { name: string; typeName: string; blocked: 'invalid' | 'forbidden' | 'unknown' | null } {
  if (!status) {
    return { name: '', typeName: '', blocked: 'unknown' };
  }
  if (status.status === 'invalid') {
    return { name: '', typeName: '', blocked: 'invalid' };
  }
  if (status.status === 'forbidden') {
    return { name: '', typeName: '', blocked: 'forbidden' };
  }
  if (!status.inst_name) {
    return { name: '', typeName: '', blocked: 'unknown' };
  }
  return {
    name: status.inst_name,
    typeName: modelName || status.model_id,
    blocked: null,
  };
}
