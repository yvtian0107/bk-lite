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
  path?: number[];
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
  children: ConditionNode[];
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

const visitNodes = (node: ConditionNode, visit: (node: ConditionNode, isRoot: boolean) => void, isRoot = true) => {
  visit(node, isRoot);
  if (isConditionGroup(node)) node.children.forEach((child) => visitNodes(child, visit, false));
};

const modelIdsIn = (node: ConditionNode): string[] => {
  const ids = new Set<string>();
  visitNodes(node, (current) => {
    if (!isConditionGroup(current) && current.scope && current.scope !== 'global') ids.add(current.scope);
  });
  return [...ids];
};

export const hasConditionLeaves = (node: unknown): boolean => {
  if (!node || typeof node !== 'object') return false;
  if (!isConditionGroup(node)) return true;
  return node.children.some((child) => hasConditionLeaves(child));
};

/**
 * 全局叶子，或同一个非根组里混了多个模型，保持原树。
 * 同一模型内部的嵌套组是有效模型条件，可以继续编辑。
 */
export const isLegacyConditionTree = (value: unknown): boolean => {
  if (!isConditionGroup(value) || value.children.length === 0) return false;
  let legacy = false;
  visitNodes(value, (node, isRoot) => {
    if (!isConditionGroup(node)) {
      if (leafIsGlobal(node)) legacy = true;
      return;
    }
    if (!isRoot && modelIdsIn(node).length > 1) legacy = true;
  });
  return legacy;
};

export const readConditionCards = (value: unknown): ConditionCard[] => {
  if (!isConditionGroup(value) || isLegacyConditionTree(value)) return [];
  return value.children.flatMap((child) => {
    if (isConditionGroup(child)) {
      const models = modelIdsIn(child);
      const declared = typeof child.model_id === 'string' ? child.model_id : '';
      const modelId = declared || models[0] || '';
      return [{ modelId, logic: child.logic === 'or' ? 'or' as const : 'and' as const, children: child.children }];
    }
    if (child.scope && child.scope !== 'global') {
      return [{ modelId: child.scope, logic: 'and' as const, children: [child] }];
    }
    return [];
  });
};

const rewriteModelNode = (node: ConditionNode, modelId: string): ConditionNode => {
  if (isConditionGroup(node)) {
    return {
      logic: node.logic === 'or' ? 'or' : 'and',
      children: node.children.map((child) => rewriteModelNode(child, modelId)),
    };
  }
  const next: ConditionLeaf = {
    scope: modelId,
    attr_id: node.attr_id,
    operator: node.operator,
    value: node.value,
  };
  if (node.attr_id) next.field_ref = `${modelId}:${node.attr_id}`;
  return next;
};

export const writeConditionCards = (
  cards: ConditionCard[],
  selectedIds?: readonly string[],
): ConditionGroup => ({
  logic: 'and',
  children: cards.flatMap((card) => {
    if (!card.modelId) return [];
    const children = card.children.map((child) => rewriteModelNode(child, card.modelId));
    const node: ConditionGroup = {
      logic: card.logic === 'or' ? 'or' : 'and',
      model_id: card.modelId,
      children,
    };
    const outside = selectedIds ? !selectedIds.includes(card.modelId) : false;
    if (!hasConditionLeaves(node) && !outside) return [];
    return [node];
  }),
});

const ORDER_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 与服务端 `_metric_key` 相同。显式 key 合法时保留，否则用函数和来源拼出来。 */
export const metricOrderKey = (row: { key?: unknown; func?: unknown; sources?: unknown }): string => {
  const explicit = typeof row.key === 'string' ? row.key.trim() : '';
  const func = typeof row.func === 'string' ? row.func.trim() : '';
  const parts = Array.isArray(row.sources)
    ? row.sources.flatMap((source) => {
      const text = String(source);
      const split = text.indexOf(':');
      if (split <= 0) return [];
      const modelId = text.slice(0, split);
      const attrId = text.slice(split + 1);
      if (!ORDER_KEY.test(modelId) || !ORDER_KEY.test(attrId)) return [];
      return [`${modelId}_${attrId}`];
    })
    : [];
  const computed = func && ORDER_KEY.test(func) && parts.length ? `${func}_${parts.join('__')}` : '';
  if (explicit && ORDER_KEY.test(explicit)) return explicit;
  return computed;
};

export const readOrderChoices = (
  options: InputOption[] | undefined,
  mode: string,
  metrics?: unknown,
): OrderChoice[] => {
  const choices: OrderChoice[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    choices.push({ key, label: label || key });
  };
  (options || []).forEach((option) => {
    const extra = option.extra;
    if (!isRecord(extra) || extra.orderable !== true) return;
    const modes = Array.isArray(extra.order_modes) ? extra.order_modes.map(String) : [];
    if (mode && modes.length > 0 && !modes.includes(mode)) return;
    add(String(option.value ?? ''), option.label || String(option.value ?? ''));
  });
  if (mode === 'aggregate' && Array.isArray(metrics)) {
    metrics.forEach((item) => {
      if (!isRecord(item)) return;
      const key = metricOrderKey(item);
      const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : key;
      add(key, label);
    });
  }
  return choices;
};

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
  path?: number[],
): ConditionIssue => (
  path && path.length
    ? { code, cardIndex, path, leafIndex: path[path.length - 1] }
    : { code, cardIndex }
);

const inspectLeaf = (
  node: ConditionLeaf,
  catalog: QueryFieldCatalogItem[],
  catalogReady: boolean,
  models: Set<string>,
  cardIndex: number,
  path: number[],
): ConditionIssue | null => {
  if (!isRecord(node)) return locate('invalid', cardIndex, path);
  const scope = typeof node.scope === 'string' ? node.scope : '';
  const attrId = typeof node.attr_id === 'string' ? node.attr_id : '';
  const operator = typeof node.operator === 'string' ? node.operator : '';
  const named = explicitKeys(node).length > 0 || Boolean(attrId);
  if (!scope || !named || !operator) return locate('invalid', cardIndex, path);
  if (!catalogReady) return null;
  if (scope !== 'global' && models.size > 0 && !models.has(scope)) return locate('staleScope', cardIndex, path);
  if (scope === 'global' && explicitKeys(node).length === 0) {
    const matches = catalog.filter((item) => item.attrId === attrId);
    if (matches.length > 1) return locate('ambiguousField', cardIndex, path);
  }
  const fields = leafFields(catalog, node);
  const requested = explicitKeys(node);
  if (requested.length && fields.length !== requested.length) return locate('staleField', cardIndex, path);
  if (!fields.length) return locate('staleField', cardIndex, path);
  if (fields.length > 1) {
    const signatures = new Set(fields.map(signatureOf));
    if (signatures.size > 1) return locate('incompatible', cardIndex, path);
  }
  const choice = fields[0].operators.find((item) => item.value === operator);
  if (!choice || fields.some((field) => !field.operators.some((item) => item.value === operator))) {
    return locate('unsupportedOperator', cardIndex, path);
  }
  if (choice.valueKind === 'enum' && Array.isArray(node.value)) {
    if (fields.some((field) => {
      const allowed = new Set(field.options.map((item) => item.value));
      return (node.value as unknown[]).some((item) => !allowed.has(String(item)));
    })) return locate('staleField', cardIndex, path);
  }
  if (valueMissing(choice.valueKind, node.value)) return locate('missingValue', cardIndex, path);
  return null;
};

export const inspectCondition = (
  value: unknown,
  catalog: QueryFieldCatalogItem[],
  catalogReady: boolean,
  selectedModelIds?: readonly string[],
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
      return inspectLeaf(node, catalog, catalogReady, models, cardIndex, [0]);
    };
    return walk(value, 0);
  }
  const selectedIds = selectedModelIds ? new Set(selectedModelIds.filter(Boolean)) : null;
  const walkEditable = (node: ConditionNode, cardIndex: number, path: number[]): ConditionIssue | null => {
    if (isConditionGroup(node)) {
      for (let index = 0; index < node.children.length; index += 1) {
        const issue = walkEditable(node.children[index], cardIndex, [...path, index]);
        if (issue) return issue;
      }
      return null;
    }
    return inspectLeaf(node, catalog, catalogReady, models, cardIndex, path);
  };
  for (let cardIndex = 0; cardIndex < value.children.length; cardIndex += 1) {
    const child = value.children[cardIndex];
    if (isConditionGroup(child)) {
      const modelId = typeof child.model_id === 'string' ? child.model_id : '';
      if (selectedIds && modelId && !selectedIds.has(modelId)) {
        return locate('staleScope', cardIndex);
      }
      if (catalogReady && modelId && models.size > 0 && !models.has(modelId) && hasConditionLeaves(child)) {
        return locate('staleScope', cardIndex);
      }
      const issue = walkEditable(child, cardIndex, []);
      if (issue) return issue;
      continue;
    }
    const issue = inspectLeaf(child, catalog, catalogReady, models, cardIndex, [0]);
    if (issue) return issue;
  }
  return null;
};

export interface SummaryLabels {
  and: string;
  or: string;
  all: string;
  unfinished: string;
  stale: string;
  match: string;
  lead: string;
  join: string;
  of: string;
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

const summarizeNode = (
  node: ConditionNode,
  catalog: QueryFieldCatalogItem[],
  labels: SummaryLabels,
): string => {
  if (isConditionGroup(node)) {
    const joiner = node.logic === 'or' ? labels.or : labels.and;
    const body = node.children.map((child) => summarizeNode(child, catalog, labels)).join(joiner);
    return node.children.length > 1 ? `(${body})` : body;
  }
  const field = leafFields(catalog, node)[0];
  const operator = field?.operators.find((item) => item.value === node.operator);
  const shown = summaryValue(node, field);
  if (operator?.valueKind === 'enum' && Array.isArray(node.value) && node.value.length === 1 && shown) {
    return shown;
  }
  const name = field?.label || node.attr_id || labels.unfinished;
  if (!operator) return labels.unfinished;
  return shown ? `${name} ${operator.label} ${shown}` : name;
};

export const summarizeConditionCards = (
  selected: Array<{ id: string; name: string }>,
  cards: ConditionCard[],
  catalog: QueryFieldCatalogItem[],
  labels: SummaryLabels,
): string => {
  const selectedIds = new Set(selected.map((model) => model.id));
  const listed = selected.map((model) => ({
    ...model,
    card: cards.find((card) => card.modelId === model.id),
    outside: false,
  }));
  cards.forEach((card) => {
    if (card.modelId && !selectedIds.has(card.modelId)) {
      const known = catalog.find((item) => item.modelId === card.modelId);
      listed.push({
        id: card.modelId,
        name: known?.modelName || card.modelId,
        card,
        outside: true,
      });
    }
  });
  if (!listed.length) return '';
  const parts = listed.map((model) => {
    if (model.outside) return `${model.name}（${labels.stale}）`;
    if (!model.card || !hasConditionLeaves(model.card)) return `${labels.all}${model.name}`;
    return `${labels.match}${summarizeNode(model.card, catalog, labels)}${labels.of}${model.name}`;
  });
  return `${labels.lead}${parts.join(labels.join)}`;
};

export type CopyBlockReason =
  | 'unmapped'
  | 'type'
  | 'unit'
  | 'operator'
  | 'enum-unknown'
  | 'enum-value'
  | 'enum-meaning'
  | 'incomplete'
  | 'depth'
  | 'too-many';

export const sourceAttrIds = (node: unknown): string[] => {
  const ids: string[] = [];
  if (!isConditionGroup(node) && !(node && typeof node === 'object' && 'logic' in node)) return ids;
  visitNodes(node as ConditionNode, (current) => {
    if (!isConditionGroup(current) && current.attr_id && !ids.includes(current.attr_id)) ids.push(current.attr_id);
  });
  return ids;
};

export const explainFieldCopy = (
  source: QueryFieldCatalogItem | undefined,
  target: QueryFieldCatalogItem | undefined,
  operator: string,
  value: unknown,
): CopyBlockReason | null => {
  if (!source || !target) return 'unmapped';
  if (!source.attrId || !operator) return 'incomplete';
  if (source.attrType !== target.attrType) return 'type';
  if (source.unit !== target.unit) return 'unit';
  const choice = source.operators.find((item) => item.value === operator);
  if (!choice || !target.operators.some((item) => item.value === operator)) return 'operator';
  if (choice.valueKind === 'enum' || source.attrType === 'enum' || target.attrType === 'enum') {
    if (!source.options.length || !target.options.length) return 'enum-unknown';
    const tokens = Array.isArray(value) ? value.map(String) : [];
    if (!tokens.length) return 'incomplete';
    for (const token of tokens) {
      const from = source.options.find((item) => item.value === token);
      const to = target.options.find((item) => item.value === token);
      if (!from || !to) return 'enum-value';
      if (from.label !== to.label) return 'enum-meaning';
    }
  }
  return null;
};

const cloneForModel = (
  node: ConditionNode,
  sourceModelId: string,
  targetModelId: string,
  mapping: Record<string, string>,
  catalog: QueryFieldCatalogItem[],
): ConditionNode => {
  if (isConditionGroup(node)) {
    return {
      logic: node.logic === 'or' ? 'or' : 'and',
      children: node.children.map((child) => cloneForModel(child, sourceModelId, targetModelId, mapping, catalog)),
    };
  }
  const targetAttr = mapping[node.attr_id] || '';
  const target = catalog.find((item) => item.modelId === targetModelId && item.attrId === targetAttr);
  return {
    scope: targetModelId,
    attr_id: targetAttr,
    operator: node.operator,
    value: node.value,
    field_ref: target ? target.key : undefined,
  };
};

export const copyModelCondition = (
  source: ConditionCard,
  targetModelId: string,
  mapping: Record<string, string>,
  catalog: QueryFieldCatalogItem[],
): { ok: true; node: ConditionGroup } | { ok: false; reasons: Array<{ attrId: string; reason: CopyBlockReason }> } => {
  const reasons: Array<{ attrId: string; reason: CopyBlockReason }> = [];
  visitNodes(source, (node) => {
    if (isConditionGroup(node) || !node.attr_id) return;
    const from = catalog.find((item) => item.modelId === source.modelId && item.attrId === node.attr_id);
    const targetAttr = mapping[node.attr_id];
    const to = catalog.find((item) => item.modelId === targetModelId && item.attrId === targetAttr);
    const reason = explainFieldCopy(from, to, node.operator, node.value);
    if (reason && !reasons.some((item) => item.attrId === node.attr_id && item.reason === reason)) {
      reasons.push({ attrId: node.attr_id, reason });
    }
  });
  if (reasons.length) return { ok: false, reasons };
  const cloned = cloneForModel(source, source.modelId, targetModelId, mapping, catalog);
  if (!isConditionGroup(cloned)) return { ok: false, reasons: [{ attrId: '', reason: 'incomplete' }] };
  return { ok: true, node: { ...cloned, model_id: targetModelId } };
};

export const appendCopiedCondition = (
  existing: ConditionCard | undefined,
  copied: ConditionGroup,
): { ok: true; card: ConditionCard } | { ok: false; reason: 'depth' | 'too-many' } => {
  const modelId = copied.model_id || existing?.modelId || '';
  let card: ConditionCard;
  if (!existing || !hasConditionLeaves(existing)) {
    card = { modelId, logic: copied.logic, children: copied.children };
  } else {
    card = {
      modelId,
      logic: 'and',
      children: [
        { logic: existing.logic, children: existing.children },
        { logic: copied.logic, children: copied.children },
      ],
    };
  }
  const stored = writeConditionCards([card], [modelId]);
  if (conditionDepth(stored) > 4) return { ok: false, reason: 'depth' };
  if (countConditionLeaves(stored) > 10) return { ok: false, reason: 'too-many' };
  return { ok: true, card };
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
