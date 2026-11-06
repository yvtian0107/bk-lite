import type { InputOption } from '@/app/ops-analysis/types/dataSource';

export interface QueryFieldChoice {
  value: string;
  label: string;
}

export interface QueryFieldCatalogItem {
  key: string;
  label: string;
  kind: string;
  modelId: string;
  modelName: string;
  attrId: string;
  attrType: string;
  unit: string;
  operators: Array<QueryFieldChoice & { valueKind: string }>;
  options: QueryFieldChoice[];
  funcs: QueryFieldChoice[];
}

export interface ConditionLeaf {
  scope: string;
  attr_id: string;
  operator: string;
  value?: unknown;
}

export interface ConditionGroup {
  logic: 'and' | 'or';
  children: ConditionNode[];
}

export type ConditionNode = ConditionLeaf | ConditionGroup;

export type ConditionIssueCode =
  | 'invalid'
  | 'staleField'
  | 'staleScope'
  | 'missingValue'
  | 'unsupportedOperator';

export interface ConditionIssue {
  code: ConditionIssueCode;
}

export interface FieldGroupItem {
  label?: string;
  func?: string;
  sources: string[];
}

export type FieldGroupIssueCode = 'invalid' | 'required' | 'stale' | 'incompatible';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asChoices = (value: unknown): QueryFieldChoice[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || (typeof item.value !== 'string' && typeof item.value !== 'number')) return [];
    return [{ value: String(item.value), label: String(item.label ?? item.value) }];
  });
};

export const readFieldCatalog = (options: InputOption[] | undefined): QueryFieldCatalogItem[] =>
  (options || []).flatMap((option) => {
    const extra = option.extra;
    if (!isRecord(extra) || extra.kind !== 'attribute') return [];
    const attrId = typeof extra.attr_id === 'string' ? extra.attr_id : '';
    if (!attrId) return [];
    return [{
      key: String(option.value),
      label: option.label || String(option.value),
      kind: 'attribute',
      modelId: typeof extra.model_id === 'string' ? extra.model_id : '',
      modelName: typeof extra.model_name === 'string' ? extra.model_name : '',
      attrId,
      attrType: typeof extra.attr_type === 'string' ? extra.attr_type : '',
      unit: typeof extra.unit === 'string' ? extra.unit : '',
      operators: Array.isArray(extra.operators)
        ? extra.operators.flatMap((item) => {
          if (!isRecord(item) || typeof item.value !== 'string') return [];
          return [{
            value: item.value,
            label: String(item.label ?? item.value),
            valueKind: typeof item.value_kind === 'string' ? item.value_kind : 'text',
          }];
        })
        : [],
      options: asChoices(extra.options),
      funcs: asChoices(extra.funcs),
    }];
  });

export const isConditionGroup = (value: unknown): value is ConditionGroup =>
  isRecord(value) && (value.logic === 'and' || value.logic === 'or') && Array.isArray(value.children);

export const emptyConditionGroup = (): ConditionGroup => ({ logic: 'and', children: [] });

export const countConditionLeaves = (node: ConditionNode): number => {
  if (!isConditionGroup(node)) return 1;
  return node.children.reduce((total, child) => total + countConditionLeaves(child), 0);
};

export const conditionDepth = (node: ConditionNode): number => {
  if (!isConditionGroup(node)) return 1;
  if (!node.children.length) return 1;
  return 1 + Math.max(...node.children.map((child) => conditionDepth(child)));
};

const fieldFor = (catalog: QueryFieldCatalogItem[], scope: string, attrId: string) => {
  if (scope === 'global') return catalog.find((item) => item.attrId === attrId);
  return catalog.find((item) => item.modelId === scope && item.attrId === attrId);
};

const valueMissing = (kind: string, value: unknown) => {
  if (kind === 'none') return false;
  if (kind === 'range') {
    return !isRecord(value) || typeof value.start !== 'string' || !value.start || typeof value.end !== 'string' || !value.end;
  }
  if (kind === 'enum') return !Array.isArray(value) || value.length === 0;
  return value === undefined || value === null || value === '';
};

export const inspectCondition = (
  value: unknown,
  catalog: QueryFieldCatalogItem[],
  catalogReady: boolean,
): ConditionIssue | null => {
  if (!isConditionGroup(value)) return { code: 'invalid' };
  if (conditionDepth(value) > 4 || countConditionLeaves(value) > 10) return { code: 'invalid' };
  const models = new Set(catalog.map((item) => item.modelId).filter(Boolean));
  const walk = (node: ConditionNode): ConditionIssue | null => {
    if (isConditionGroup(node)) {
      for (const child of node.children) {
        const issue = walk(child);
        if (issue) return issue;
      }
      return null;
    }
    if (!isRecord(node)) return { code: 'invalid' };
    const scope = typeof node.scope === 'string' ? node.scope : '';
    const attrId = typeof node.attr_id === 'string' ? node.attr_id : '';
    const operator = typeof node.operator === 'string' ? node.operator : '';
    if (!scope || !attrId || !operator) return { code: 'invalid' };
    if (!catalogReady) return null;
    if (scope !== 'global' && !models.has(scope)) return { code: 'staleScope' };
    const field = fieldFor(catalog, scope, attrId);
    if (!field) return { code: 'staleField' };
    const choice = field.operators.find((item) => item.value === operator);
    if (!choice) return { code: 'unsupportedOperator' };
    if (choice.valueKind === 'enum' && Array.isArray(node.value)) {
      const allowed = new Set(field.options.map((item) => item.value));
      if (node.value.some((item) => !allowed.has(String(item)))) return { code: 'staleField' };
    }
    if (valueMissing(choice.valueKind, node.value)) return { code: 'missingValue' };
    return null;
  };
  return walk(value);
};

export interface PreviewLabels {
  and: string;
  or: string;
  global: string;
  missing: string;
}

const previewNode = (
  node: ConditionNode,
  catalog: QueryFieldCatalogItem[],
  labels: PreviewLabels,
): string => {
  if (isConditionGroup(node)) {
    const joiner = node.logic === 'or' ? labels.or : labels.and;
    const body = node.children.map((child) => previewNode(child, catalog, labels)).join(` ${joiner} `);
    return node.children.length > 1 ? `(${body})` : body || '()';
  }
  const field = fieldFor(catalog, node.scope, node.attr_id);
  const scope = node.scope === 'global' ? labels.global : (field?.modelName || node.scope);
  const name = field?.label || `${node.attr_id} ${labels.missing}`;
  const operator = field?.operators.find((item) => item.value === node.operator);
  const operatorLabel = operator?.label || node.operator;
  if (!operator || operator.valueKind === 'none') return `(${scope} ${name} ${operatorLabel})`;
  let shown = '';
  if (operator.valueKind === 'enum' && Array.isArray(node.value)) {
    shown = node.value.map((item) => field?.options.find((option) => option.value === String(item))?.label || String(item)).join(', ');
  } else if (operator.valueKind === 'range' && isRecord(node.value)) {
    shown = `${String(node.value.start || '')} .. ${String(node.value.end || '')}`;
  } else if (node.value !== undefined && node.value !== null) {
    shown = String(node.value);
  }
  return `(${scope} ${name} ${operatorLabel} ${shown})`.trim();
};

export const previewCondition = (
  value: unknown,
  catalog: QueryFieldCatalogItem[],
  labels: PreviewLabels,
): string => (isConditionGroup(value) ? previewNode(value, catalog, labels) : '');

const signatureOf = (field: QueryFieldCatalogItem) => `${field.attrType}|${field.unit}`;

export const inspectFieldGroup = (
  value: unknown,
  catalog: QueryFieldCatalogItem[],
  catalogReady: boolean,
  variant: 'group' | 'metrics',
): FieldGroupIssueCode | null => {
  if (!Array.isArray(value)) return 'invalid';
  if (!value.length) return 'required';
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item.sources) || !item.sources.length) return 'required';
    const fields = item.sources.flatMap((source) => {
      const found = catalog.find((field) => field.key === String(source));
      return found ? [found] : [];
    });
    if (catalogReady && fields.length !== item.sources.length) return 'stale';
    if (variant === 'metrics' && (typeof item.func !== 'string' || !item.func)) return 'required';
    if (catalogReady && fields.length > 1 && item.func !== 'count') {
      const signatures = new Set(fields.map(signatureOf));
      if (signatures.size > 1) return 'incompatible';
    }
  }
  return null;
};
