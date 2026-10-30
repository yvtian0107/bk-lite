import type { OptionsQueryParamValue } from '@/app/ops-analysis/types/dataSource';
import { isBindableDataSourceParamType } from '@/app/ops-analysis/utils/dataSourceParamContract';

/** 依赖链最多 3 个参数（A→B→C）。A→B→C→D 拒绝。 */
export const MAX_OPTIONS_QUERY_CHAIN_NODES = 3;

const WHOLE_TOKEN = /^\$([A-Za-z_][\w-]*)(?::(string|number|boolean|date|timeRange|dateRange))?\$/;

export interface OptionsQueryParamRef {
  ref: string;
}

export type OptionsQueryValidationIssue =
  | { code: 'concat'; param: string }
  | { code: 'invalid'; param: string }
  | { code: 'self'; name: string }
  | { code: 'missing'; name: string; ref: string }
  | { code: 'type'; name: string; ref: string }
  | { code: 'cycle'; path: string[] }
  | { code: 'depth'; path: string[] };

export interface OptionsQueryKnownName {
  name: string;
  type?: string;
}

export interface OptionsQueryNode {
  name: string;
  queryParams?: Record<string, unknown>;
}

export interface ResolvedOptionsQuery {
  blocked: boolean;
  params: Record<string, unknown>;
  missingRefs: string[];
}

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
};

export const isOptionsQueryParamRef = (value: unknown): value is OptionsQueryParamRef => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.ref === 'string' && record.ref.trim().length > 0 && Object.keys(record).length === 1;
};

export const parseWholeOptionsQueryToken = (value: string): OptionsQueryParamRef | null => {
  const match = WHOLE_TOKEN.exec(value);
  if (!match || match[0] !== value) return null;
  return { ref: match[1] };
};

export const isUpstreamValueEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
};

type NormalizedQueryParam =
  | { ok: true; value: OptionsQueryParamValue }
  | { ok: false; reason: 'concat' | 'invalid' };

type StoredQueryParams =
  | { ok: true; queryParams?: Record<string, OptionsQueryParamValue> }
  | { ok: false; issue: OptionsQueryValidationIssue };

const isRejectedQueryParam = (
  result: NormalizedQueryParam,
): result is { ok: false; reason: 'concat' | 'invalid' } => result.ok === false;

export const isRejectedQueryParams = (
  result: StoredQueryParams,
): result is { ok: false; issue: OptionsQueryValidationIssue } => result.ok === false;

export const normalizeOptionsQueryParamValue = (
  value: unknown,
): NormalizedQueryParam => {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return { ok: true, value: value as OptionsQueryParamValue };
  }
  if (isOptionsQueryParamRef(value)) return { ok: true, value: { ref: value.ref } };
  if (typeof value === 'string') {
    if (value.includes('$')) {
      const token = parseWholeOptionsQueryToken(value);
      if (!token) return { ok: false, reason: 'concat' };
      return { ok: true, value: token };
    }
    return { ok: true, value };
  }
  return { ok: false, reason: 'invalid' };
};

export const normalizeQueryParamsForStorage = (
  queryParams?: Record<string, unknown>,
): StoredQueryParams => {
  if (!queryParams) return { ok: true };
  const next: Record<string, OptionsQueryParamValue> = {};
  for (const [name, raw] of Object.entries(queryParams)) {
    if (!name.trim()) continue;
    const normalized = normalizeOptionsQueryParamValue(raw);
    if (isRejectedQueryParam(normalized)) {
      return {
        ok: false,
        issue: { code: normalized.reason, param: name },
      };
    }
    next[name] = normalized.value;
  }
  return { ok: true, queryParams: Object.keys(next).length ? next : undefined };
};

export const collectQueryParamRefs = (
  queryParams?: Record<string, unknown>,
): string[] => {
  if (!queryParams) return [];
  const refs = new Set<string>();
  Object.values(queryParams).forEach((raw) => {
    const normalized = normalizeOptionsQueryParamValue(raw);
    if (normalized.ok && isOptionsQueryParamRef(normalized.value)) refs.add(normalized.value.ref);
  });
  return Array.from(refs).sort();
};

export const collectQueryParamLiterals = (
  queryParams?: Record<string, unknown>,
): Record<string, string | number | boolean | null> => {
  if (!queryParams) return {};
  const literals: Record<string, string | number | boolean | null> = {};
  Object.entries(queryParams).forEach(([name, raw]) => {
    const normalized = normalizeOptionsQueryParamValue(raw);
    if (!normalized.ok) {
      if (typeof raw === 'string') literals[name] = raw;
      return;
    }
    if (!isOptionsQueryParamRef(normalized.value)) literals[name] = normalized.value;
  });
  return literals;
};

/** 配置键用的查询入参结构：引用名和字面量，不含运行时上游值。 */
export const canonicalQueryParams = (
  queryParams?: Record<string, unknown>,
): { refs: string[]; literals: Record<string, string | number | boolean | null> } | null => {
  if (!queryParams || Object.keys(queryParams).length === 0) return null;
  return {
    refs: collectQueryParamRefs(queryParams),
    literals: collectQueryParamLiterals(queryParams),
  };
};

const graphFromNodes = (nodes: OptionsQueryNode[]): Map<string, string[]> => {
  const graph = new Map<string, string[]>();
  nodes.forEach((node) => {
    if (!node.name) return;
    const refs = collectQueryParamRefs(node.queryParams);
    const merged = new Set([...(graph.get(node.name) ?? []), ...refs]);
    graph.set(node.name, Array.from(merged));
  });
  return graph;
};

export const validateOptionsQueryParams = (
  nodes: OptionsQueryNode[],
  knownNames: Array<string | OptionsQueryKnownName>,
): OptionsQueryValidationIssue | null => {
  for (const node of nodes) {
    if (!node.queryParams) continue;
    for (const [param, raw] of Object.entries(node.queryParams)) {
      const normalized = normalizeOptionsQueryParamValue(raw);
      if (isRejectedQueryParam(normalized)) return { code: normalized.reason, param };
      if (isOptionsQueryParamRef(normalized.value) && normalized.value.ref === node.name) {
        return { code: 'self', name: node.name };
      }
    }
  }

  const known = new Map<string, string | undefined>();
  knownNames.forEach((entry) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      if (!known.has(entry)) known.set(entry, undefined);
      return;
    }
    if (!entry.name) return;
    const previous = known.get(entry.name);
    known.set(entry.name, entry.type || previous);
  });
  if (known.size > 0) {
    for (const node of nodes) {
      for (const ref of collectQueryParamRefs(node.queryParams)) {
        if (ref === node.name) return { code: 'self', name: node.name };
        if (!known.has(ref)) return { code: 'missing', name: node.name, ref };
        const targetType = known.get(ref);
        if (targetType && !isBindableDataSourceParamType(targetType)) {
          return { code: 'type', name: node.name, ref };
        }
      }
    }
  }

  const graph = graphFromNodes(nodes);
  const visit = (name: string, stack: string[]): OptionsQueryValidationIssue | null => {
    if (stack.includes(name)) return { code: 'cycle', path: [...stack, name] };
    const next = [...stack, name];
    if (next.length > MAX_OPTIONS_QUERY_CHAIN_NODES) return { code: 'depth', path: next };
    for (const ref of graph.get(name) ?? []) {
      const issue = visit(ref, next);
      if (issue) return issue;
    }
    return null;
  };

  for (const name of graph.keys()) {
    const issue = visit(name, []);
    if (issue) return issue;
  }
  return null;
};

export const resolveOptionsQueryParams = (
  queryParams: Record<string, unknown> | undefined,
  lookup: (ref: string) => unknown,
): ResolvedOptionsQuery => {
  if (!queryParams || Object.keys(queryParams).length === 0) {
    return { blocked: false, params: {}, missingRefs: [] };
  }
  const params: Record<string, unknown> = {};
  const missingRefs: string[] = [];
  for (const [name, raw] of Object.entries(queryParams)) {
    const normalized = normalizeOptionsQueryParamValue(raw);
    if (isRejectedQueryParam(normalized)) return { blocked: true, params: {}, missingRefs: [] };
    if (isOptionsQueryParamRef(normalized.value)) {
      const upstream = lookup(normalized.value.ref);
      if (isUpstreamValueEmpty(upstream)) missingRefs.push(normalized.value.ref);
      else params[name] = upstream;
    } else {
      params[name] = normalized.value;
    }
  }
  if (missingRefs.length) return { blocked: true, params: {}, missingRefs };
  return { blocked: false, params, missingRefs: [] };
};

export const dynamicQueryParamsOf = (
  inputConfig: { control?: string; optionsSource?: { type?: string; queryParams?: Record<string, unknown> } } | undefined,
): Record<string, unknown> | undefined => {
  if (!inputConfig || (inputConfig.control !== 'select' && inputConfig.control !== 'radio')) {
    return undefined;
  }
  const source = inputConfig.optionsSource;
  if (!source || source.type !== 'dynamic') return undefined;
  return source.queryParams;
};
