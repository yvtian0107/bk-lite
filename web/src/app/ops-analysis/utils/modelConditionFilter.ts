import {
  parseConditionGroup,
  type ConditionGroup,
} from '@/app/ops-analysis/utils/conditionFilter';

export interface ModelConditionFilterValue {
  by_model: Record<string, ConditionGroup>;
}

/** 每个已选模型一块条件。没有公共条件，空块表示这个模型不过滤。 */
export const parseModelConditionFilter = (value: unknown): ModelConditionFilterValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { by_model: {} };
  }
  const raw = (value as { by_model?: unknown }).by_model;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { by_model: {} };
  }
  const byModel: Record<string, ConditionGroup> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([modelId, group]) => {
    const key = modelId.trim();
    if (!key) return;
    byModel[key] = parseConditionGroup(group);
  });
  return { by_model: byModel };
};

export const selectedModelIds = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    const found: string[] = [];
    value.forEach((item) => {
      const text = String(item ?? '').trim();
      if (text && !found.includes(text)) found.push(text);
    });
    return found;
  }
  const text = String(value ?? '').trim();
  return text ? [text] : [];
};
