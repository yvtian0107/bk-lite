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
  field_ref?: string;
  sources?: string[];
}

export interface ConditionGroup {
  logic: 'and' | 'or';
  children: ConditionNode[];
  /** 一张卡片对应一个模型。编译时忽略，空 children 表示该模型不筛选。 */
  model_id?: string;
}

export type ConditionNode = ConditionLeaf | ConditionGroup;

export type ConditionIssueCode =
  | 'invalid'
  | 'legacy'
  | 'staleField'
  | 'ambiguousField'
  | 'staleScope'
  | 'missingValue'
  | 'unsupportedOperator'
  | 'incompatible';

export interface ConditionIssue {
  code: ConditionIssueCode;
  cardIndex?: number;
  leafIndex?: number;
}

export interface FieldGroupItem {
  label?: string;
  func?: string;
  sources: string[];
}

export type FieldGroupIssueCode = 'invalid' | 'required' | 'stale' | 'incompatible' | 'enumConflict';

export interface FieldGroupIssue {
  code: FieldGroupIssueCode;
  index?: number;
  names?: string[];
}

export interface ConditionCard {
  modelId: string;
  logic: 'and' | 'or';
  children: ConditionLeaf[];
}

export interface OrderChoice {
  key: string;
  label: string;
}

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

export const isEmptyConditionValue = (value: unknown): boolean => {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (!isRecord(value)) return false;
  if (Object.keys(value).length === 0) return true;
  return isConditionGroup(value) && value.children.length === 0;
};

const leafIsGlobal = (leaf: ConditionLeaf) => !leaf.scope || leaf.scope === 'global';

/** 含全局范围或更深嵌套的旧树保持原样，不在编辑时改写成卡片。 */
export const isLegacyConditionTree = (value: unknown): boolean => {
  if (!isConditionGroup(value) || value.children.length === 0) return false;
  return value.children.some((child) => {
    if (isConditionGroup(child)) {
      if (child.children.some((item) => isConditionGroup(item))) return true;
      return child.children.some((item) => !isConditionGroup(item) && leafIsGlobal(item));
    }
    return leafIsGlobal(child);
  });
};

export const readConditionCards = (value: unknown): ConditionCard[] => {
  if (!isConditionGroup(value) || isLegacyConditionTree(value)) return [];
  return value.children.flatMap((child) => {
    if (isConditionGroup(child)) {
      const leaves = child.children.filter((item): item is ConditionLeaf => !isConditionGroup(item));
      const scoped = leaves.find((leaf) => leaf.scope && leaf.scope !== 'global')?.scope || '';
      const modelId = typeof child.model_id === 'string' ? child.model_id : scoped;
      return [{ modelId, logic: child.logic, children: leaves }];
    }
    if (child.scope && child.scope !== 'global') {
      return [{ modelId: child.scope, logic: 'and' as const, children: [child] }];
    }
    return [];
  });
};

export const writeConditionCards = (cards: ConditionCard[]): ConditionGroup => ({
  logic: 'and',
  children: cards.map((card) => ({
    logic: card.logic,
    model_id: card.modelId,
    children: card.children.map((leaf) => ({
      ...leaf,
      scope: card.modelId || leaf.scope,
    })),
  })),
});

export const readOrderChoices = (options: InputOption[] | undefined, mode: string): OrderChoice[] => (
  (options || []).flatMap((option) => {
    const extra = option.extra;
    if (!isRecord(extra) || extra.orderable !== true) return [];
    const modes = Array.isArray(extra.order_modes) ? extra.order_modes.map(String) : [];
    if (mode && modes.length > 0 && !modes.includes(mode)) return [];
    const key = String(option.value ?? '');
    if (!key) return [];
    return [{ key, label: option.label || key }];
  })
);

export const inspectOrder = (
  value: unknown,
  choices: OrderChoice[],
  catalogReady: boolean,
): 'stale' | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return 'stale';
  const text = value.trim();
  if (!text) return null;
  const name = text.startsWith('-') ? text.slice(1) : text;
  if (!name || text.includes(',') || text.includes(' ')) return 'stale';
  if (!catalogReady) return null;
  return choices.some((item) => item.key === name) ? null : 'stale';
};

export const countConditionLeaves = (node: ConditionNode): number => {
  if (!isConditionGroup(node)) return 1;
  return node.children.reduce((total, child) => total + countConditionLeaves(child), 0);
};

export const conditionDepth = (node: ConditionNode): number => {
  if (!isConditionGroup(node)) return 1;
  if (!node.children.length) return 1;
  return 1 + Math.max(...node.children.map((child) => conditionDepth(child)));
};

const explicitKeys = (node: ConditionLeaf): string[] => {
  if (Array.isArray(node.sources) && node.sources.length) return node.sources.map(String);
  if (typeof node.field_ref === 'string' && node.field_ref.includes(':')) return [node.field_ref];
  return [];
};

export const leafFields = (catalog: QueryFieldCatalogItem[], node: ConditionLeaf): QueryFieldCatalogItem[] => {
  const keys = explicitKeys(node);
  if (keys.length) {
    return keys.flatMap((key) => {
      const found = catalog.find((item) => item.key === key);
      return found ? [found] : [];
    });
  }
  if (node.scope !== 'global') {
    const found = catalog.find((item) => item.modelId === node.scope && item.attrId === node.attr_id);
    return found ? [found] : [];
  }
  const matches = catalog.filter((item) => item.attrId === node.attr_id);
  return matches.length === 1 ? matches : [];
};

const valueMissing = (kind: string, value: unknown) => {
  if (kind === 'none') return false;
  if (kind === 'range') {
    return !isRecord(value) || typeof value.start !== 'string' || !value.start || typeof value.end !== 'string' || !value.end;
  }
  if (kind === 'enum') return !Array.isArray(value) || value.length === 0;
  return value === undefined || value === null || value === '';
};

const locate = (
  code: ConditionIssueCode,
  cardIndex: number,
  leafIndex?: number,
): ConditionIssue => (
  leafIndex === undefined ? { code, cardIndex } : { code, cardIndex, leafIndex }
);

const inspectLeaf = (
  node: ConditionLeaf,
  catalog: QueryFieldCatalogItem[],
  catalogReady: boolean,
  models: Set<string>,
  cardIndex: number,
  leafIndex: number,
): ConditionIssue | null => {
  if (!isRecord(node)) return locate('invalid', cardIndex, leafIndex);
  const scope = typeof node.scope === 'string' ? node.scope : '';
  const attrId = typeof node.attr_id === 'string' ? node.attr_id : '';
  const operator = typeof node.operator === 'string' ? node.operator : '';
  const named = explicitKeys(node).length > 0 || Boolean(attrId);
  if (!scope || !named || !operator) return locate('invalid', cardIndex, leafIndex);
  if (!catalogReady) return null;
  if (scope !== 'global' && models.size > 0 && !models.has(scope)) return locate('staleScope', cardIndex, leafIndex);
  if (scope === 'global' && explicitKeys(node).length === 0) {
    const matches = catalog.filter((item) => item.attrId === attrId);
    if (matches.length > 1) return locate('ambiguousField', cardIndex, leafIndex);
  }
  const fields = leafFields(catalog, node);
  const requested = explicitKeys(node);
  if (requested.length && fields.length !== requested.length) return locate('staleField', cardIndex, leafIndex);
  if (!fields.length) return locate('staleField', cardIndex, leafIndex);
  if (fields.length > 1) {
    const signatures = new Set(fields.map(signatureOf));
    if (signatures.size > 1) return locate('incompatible', cardIndex, leafIndex);
  }
  const choice = fields[0].operators.find((item) => item.value === operator);
  if (!choice || fields.some((field) => !field.operators.some((item) => item.value === operator))) {
    return locate('unsupportedOperator', cardIndex, leafIndex);
  }
  if (choice.valueKind === 'enum' && Array.isArray(node.value)) {
    if (fields.some((field) => {
      const allowed = new Set(field.options.map((item) => item.value));
      return (node.value as unknown[]).some((item) => !allowed.has(String(item)));
    })) return locate('staleField', cardIndex, leafIndex);
  }
  if (valueMissing(choice.valueKind, node.value)) return locate('missingValue', cardIndex, leafIndex);
  return null;
};

export const inspectCondition = (
  value: unknown,
  catalog: QueryFieldCatalogItem[],
  catalogReady: boolean,
): ConditionIssue | null => {
  if (isEmptyConditionValue(value)) return null;
  if (!isConditionGroup(value)) return { code: 'invalid' };
  if (conditionDepth(value) > 4 || countConditionLeaves(value) > 10) return { code: 'invalid' };
  const models = new Set(catalog.map((item) => item.modelId).filter(Boolean));
  if (isLegacyConditionTree(value)) {
    const walk = (node: ConditionNode, cardIndex: number): ConditionIssue | null => {
      if (isConditionGroup(node)) {
        for (let index = 0; index < node.children.length; index += 1) {
          const issue = walk(node.children[index], cardIndex);
          if (issue) return issue;
        }
        return null;
      }
      return inspectLeaf(node, catalog, catalogReady, models, cardIndex, 0);
    };
    return walk(value, 0);
  }
  for (let cardIndex = 0; cardIndex < value.children.length; cardIndex += 1) {
    const child = value.children[cardIndex];
    if (isConditionGroup(child)) {
      const modelId = typeof child.model_id === 'string' ? child.model_id : '';
      if (catalogReady && modelId && models.size > 0 && !models.has(modelId) && child.children.length > 0) {
        return locate('staleScope', cardIndex);
      }
      for (let leafIndex = 0; leafIndex < child.children.length; leafIndex += 1) {
        const leaf = child.children[leafIndex];
        if (isConditionGroup(leaf)) return locate('invalid', cardIndex, leafIndex);
        const issue = inspectLeaf(leaf, catalog, catalogReady, models, cardIndex, leafIndex);
        if (issue) return issue;
      }
      continue;
    }
    const issue = inspectLeaf(child, catalog, catalogReady, models, cardIndex, 0);
    if (issue) return issue;
  }
  return null;
};

export interface SummaryLabels {
  and: string;
  or: string;
  all: string;
  unfinished: string;
}

const summaryValue = (leaf: ConditionLeaf, field: QueryFieldCatalogItem | undefined): string => {
  const operator = field?.operators.find((item) => item.value === leaf.operator);
  if (!operator || operator.valueKind === 'none') return '';
  if (operator.valueKind === 'enum' && Array.isArray(leaf.value)) {
    return leaf.value.map((item) => field?.options.find((option) => option.value === String(item))?.label || String(item)).join(', ');
  }
  if (operator.valueKind === 'range' && isRecord(leaf.value)) {
    return `${String(leaf.value.start || '')} .. ${String(leaf.value.end || '')}`;
  }
  if (leaf.value !== undefined && leaf.value !== null && leaf.value !== '') return String(leaf.value);
  return '';
};

const summarizeLeaf = (
  leaf: ConditionLeaf,
  catalog: QueryFieldCatalogItem[],
  labels: SummaryLabels,
): string => {
  const field = leafFields(catalog, leaf)[0];
  const operator = field?.operators.find((item) => item.value === leaf.operator);
  const shown = summaryValue(leaf, field);
  if (operator?.valueKind === 'enum' && Array.isArray(leaf.value) && leaf.value.length === 1 && shown) {
    return shown;
  }
  const name = field?.label || leaf.attr_id || labels.unfinished;
  if (!operator) return labels.unfinished;
  return shown ? `${name} ${operator.label} ${shown}` : name;
};

export const summarizeConditionCards = (
  selected: Array<{ id: string; name: string }>,
  cards: ConditionCard[],
  catalog: QueryFieldCatalogItem[],
  labels: SummaryLabels,
): string => {
  const listed = selected.map((model) => ({ ...model, card: cards.find((card) => card.modelId === model.id) }));
  cards.forEach((card) => {
    if (card.modelId && !listed.some((item) => item.id === card.modelId)) {
      const known = catalog.find((item) => item.modelId === card.modelId);
      listed.push({ id: card.modelId, name: known?.modelName || card.modelId, card });
    }
  });
  if (!listed.length) return '';
  return listed.map((model) => {
    const leaves = model.card?.children || [];
    if (!leaves.length) return `${model.name}（${labels.all}）`;
    const joiner = model.card?.logic === 'or' ? labels.or : labels.and;
    const body = leaves.map((leaf) => summarizeLeaf(leaf, catalog, labels)).join(joiner);
    return `${model.name}（${body}）`;
  }).join(' ∪ ');
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
  const fields = leafFields(catalog, node);
  const field = fields[0];
  const scope = node.scope === 'global' ? labels.global : (field?.modelName || node.scope);
  const name = fields.length
    ? fields.map((item) => item.label).join(', ')
    : `${node.attr_id || explicitKeys(node).join(', ')} ${labels.missing}`;
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

const enumValuesConflict = (fields: QueryFieldCatalogItem[]) => {
  const enums = fields.filter((field) => field.attrType === 'enum');
  if (enums.length < 2) return false;
  if (enums.some((field) => field.options.length === 0 || field.options.some((option) => !option.label))) {
    return true;
  }
  const labels = new Map<string, Set<string>>();
  enums.forEach((field) => {
    field.options.forEach((option) => {
      const known = labels.get(option.value) ?? new Set<string>();
      known.add(option.label);
      labels.set(option.value, known);
    });
  });
  return [...labels.values()].some((known) => known.size > 1);
};

const conflictNames = (fields: QueryFieldCatalogItem[]): string[] => {
  for (let left = 0; left < fields.length; left += 1) {
    for (let right = left + 1; right < fields.length; right += 1) {
      if (signatureOf(fields[left]) !== signatureOf(fields[right])) {
        return [fields[left].label, fields[right].label];
      }
    }
  }
  return fields.slice(0, 2).map((field) => field.label);
};

const groupIssue = (
  code: FieldGroupIssueCode,
  index: number,
  names?: string[],
): FieldGroupIssue => (names && names.length ? { code, index, names } : { code, index });

export const inspectFieldGroup = (
  value: unknown,
  catalog: QueryFieldCatalogItem[],
  catalogReady: boolean,
  variant: 'group' | 'metrics',
): FieldGroupIssue | null => {
  if (!Array.isArray(value)) return { code: 'invalid' };
  if (!value.length) return { code: 'required' };
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item) || !Array.isArray(item.sources) || !item.sources.length) return groupIssue('required', index);
    const fields = item.sources.flatMap((source) => {
      const found = catalog.find((field) => field.key === String(source));
      return found ? [found] : [];
    });
    if (catalogReady && fields.length !== item.sources.length) return groupIssue('stale', index);
    if (variant === 'metrics' && (typeof item.func !== 'string' || !item.func)) return groupIssue('required', index);
    if (catalogReady && fields.length > 1 && item.func !== 'count') {
      const signatures = new Set(fields.map(signatureOf));
      if (signatures.size > 1) return groupIssue('incompatible', index, conflictNames(fields));
    }
    if (catalogReady && variant === 'group' && enumValuesConflict(fields)) {
      return groupIssue('enumConflict', index, fields.map((field) => field.label));
    }
  }
  return null;
};

export const describeFieldGroupIssue = (
  issue: FieldGroupIssue,
  text: Record<FieldGroupIssueCode, string> & { incompatibleNamed?: string },
): string => {
  if (issue.code === 'incompatible' && issue.names && issue.names.length >= 2 && text.incompatibleNamed) {
    return text.incompatibleNamed
      .replace('{left}', issue.names[0])
      .replace('{right}', issue.names[1]);
  }
  return text[issue.code];
};
