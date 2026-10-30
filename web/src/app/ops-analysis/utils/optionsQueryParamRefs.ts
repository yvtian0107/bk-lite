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
  | { code: 'ambiguous'; name: string; ref: string }
  | { code: 'cycle'; path: string[] }
  | { code: 'depth'; path: string[] };

export interface OptionsQueryKnownName {
  name: string;
  type?: string;
}

export interface OptionsQueryNode {
  /** 图节点。同名多行时用 definition.id，唯一行可用参数名。 */
  name: string;
  /** 参数名。多个节点共用同一个别名时，按参数名引用会被拒绝。 */
  aliases?: string[];
  queryParams?: Record<string, unknown>;
}

export type OptionsQueryBlockReason = 'empty' | 'invalid';

export interface ResolvedOptionsQuery {
  blocked: boolean;
  blockReason?: OptionsQueryBlockReason;
  params: Record<string, unknown>;
  missingRefs: string[];
}

/** lookup 返回这个标记表示引用无法对应到唯一上游，而不是上游值为空。 */
export const OPTIONS_QUERY_INVALID = Symbol('optionsQueryInvalid');

export interface OptionsQueryRefTarget {
  id: string;
  key: string;
  label?: string;
  type?: string;
  sourceHint?: string;
}

export interface OptionsQueryRefChoice {
  ref: string;
  label: string;
  type?: string;
}

export const buildOptionsQueryRefChoices = (
  targets: OptionsQueryRefTarget[],
): OptionsQueryRefChoice[] => {
  const counts = new Map<string, number>();
  targets.forEach((target) => {
    counts.set(target.key, (counts.get(target.key) ?? 0) + 1);
  });
  return targets.map((target) => {
    const ambiguous = (counts.get(target.key) ?? 0) > 1;
    const hint = target.sourceHint?.trim();
    const base = target.label && target.label !== target.key
      ? `${target.label} (${target.key})`
      : target.key;
    return {
      ref: ambiguous ? target.id : target.key,
      label: ambiguous && hint ? `${base} · ${hint}` : base,
      type: target.type,
    };
  });
};

export const readOptionsQueryUpstream = (
  ref: string,
  definitions: Array<{ id: string; key: string; enabled?: boolean }>,
  readValue: (id: string) => unknown,
): { found: true; invalid: true } | { found: true; invalid: false; value: unknown } | { found: false } => {
  const enabled = definitions.filter((item) => item.enabled !== false);
  const byId = enabled.find((item) => item.id === ref);
  if (byId) return { found: true, invalid: false, value: readValue(byId.id) };
  const byKey = enabled.filter((item) => item.key === ref);
  if (byKey.length > 1) return { found: true, invalid: true };
  if (byKey.length === 1) return { found: true, invalid: false, value: readValue(byKey[0].id) };
  return { found: false };
};

/** 已经命中某一行时：同名裸引用返回非法标记，否则返回该行的值。 */
export const valueOfFoundOptionsQueryUpstream = (
  upstream: { invalid: true } | { invalid: false; value: unknown },
): unknown => (upstream.invalid === true ? OPTIONS_QUERY_INVALID : upstream.value);

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

const nodesForRef = (nodes: OptionsQueryNode[], ref: string): OptionsQueryNode[] => {
  const direct = nodes.filter((node) => node.name === ref);
  const aliased = nodes.filter((node) => node.aliases?.includes(ref) && node.name !== ref);
  return [...direct, ...aliased];
};

const graphFromNodes = (
  nodes: OptionsQueryNode[],
): { graph: Map<string, string[]>; issue: OptionsQueryValidationIssue | null } => {
  const graph = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.name) continue;
    const edges = new Set(graph.get(node.name) ?? []);
    for (const ref of collectQueryParamRefs(node.queryParams)) {
      const targets = nodesForRef(nodes, ref);
      if (targets.length > 1) {
        return { graph, issue: { code: 'ambiguous', name: node.name, ref } };
      }
      if (targets.length === 1) {
        if (targets[0].name === node.name) {
          return { graph, issue: { code: 'self', name: node.name } };
        }
        edges.add(targets[0].name);
        continue;
      }
      edges.add(ref);
    }
    graph.set(node.name, Array.from(edges));
  }
  return { graph, issue: null };
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
        const targets = nodesForRef(nodes, ref);
        if (targets.length > 1) return { code: 'ambiguous', name: node.name, ref };
        if (targets.length === 1 && targets[0].name === node.name) {
          return { code: 'self', name: node.name };
        }
        const knownRef = targets.length === 1 ? targets[0].name : ref;
        if (!known.has(ref) && !known.has(knownRef) && targets.length === 0) {
          return { code: 'missing', name: node.name, ref };
        }
        const targetType = known.get(ref) || known.get(knownRef);
        if (targetType && !isBindableDataSourceParamType(targetType)) {
          return { code: 'type', name: node.name, ref };
        }
      }
    }
  }

  const built = graphFromNodes(nodes);
  if (built.issue) return built.issue;
  const graph = built.graph;
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

export const validateUnifiedFilterQueryGraph = (
  definitions: Array<{
    id: string;
    key: string;
    type?: string;
    inputConfig?: { control?: string; optionsSource?: { type?: string; queryParams?: Record<string, unknown> } };
  }>,
): OptionsQueryValidationIssue | null => validateOptionsQueryParams(
  definitions.map((item) => ({
    name: item.id,
    aliases: item.key && item.key !== item.id ? [item.key] : undefined,
    queryParams: dynamicQueryParamsOf(item.inputConfig),
  })),
  definitions.flatMap((item) => [
    { name: item.id, type: item.type },
    ...(item.key ? [{ name: item.key, type: item.type }] : []),
  ]),
);

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
    if (isRejectedQueryParam(normalized)) {
      return { blocked: true, blockReason: 'invalid', params: {}, missingRefs: [] };
    }
    if (isOptionsQueryParamRef(normalized.value)) {
      const upstream = lookup(normalized.value.ref);
      if (upstream === OPTIONS_QUERY_INVALID) {
        return { blocked: true, blockReason: 'invalid', params: {}, missingRefs: [] };
      }
      if (isUpstreamValueEmpty(upstream)) missingRefs.push(normalized.value.ref);
      else params[name] = upstream;
    } else {
      params[name] = normalized.value;
    }
  }
  if (missingRefs.length) {
    return { blocked: true, blockReason: 'empty', params: {}, missingRefs };
  }
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
