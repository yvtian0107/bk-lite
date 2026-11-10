export type ParamVisibilityRule =
  | { all: ParamVisibilityRule[] }
  | { any: ParamVisibilityRule[] }
  | { param: string; in?: unknown[]; notIn?: unknown[]; eq?: unknown };

const matches = (current: unknown, expected: unknown) => current === expected;

/** 渲染、校验和提交共用。没有规则时视为成立。无法识别的规则不成立，避免把字段偷偷放开。 */
export const isParamRuleActive = (
  rule: ParamVisibilityRule | undefined,
  values: Record<string, unknown>,
): boolean => {
  if (!rule) return true;
  if ('all' in rule && Array.isArray(rule.all)) {
    return rule.all.every((item) => isParamRuleActive(item, values));
  }
  if ('any' in rule && Array.isArray(rule.any)) {
    return rule.any.some((item) => isParamRuleActive(item, values));
  }
  if (!('param' in rule) || typeof rule.param !== 'string' || !rule.param) return false;
  const current = values[rule.param];
  if (Array.isArray(rule.in)) return rule.in.some((item) => matches(current, item));
  if (Array.isArray(rule.notIn)) return !rule.notIn.some((item) => matches(current, item));
  if ('eq' in rule) return matches(current, rule.eq);
  return false;
};

export const isParamVisible = (
  param: { visibleWhen?: ParamVisibilityRule },
  values: Record<string, unknown>,
): boolean => isParamRuleActive(param.visibleWhen, values);

const valueMissing = (value: unknown) => (
  value == null
  || value === ''
  || (Array.isArray(value) && value.length === 0)
);

/** 必填项还空着时，不要先打主查询。 */
export const sourceQueryBlockedByRequired = (
  params: Array<{ name?: string; required?: boolean; requiredWhen?: ParamVisibilityRule; visibleWhen?: ParamVisibilityRule }>,
  values: Record<string, unknown>,
): boolean => params.some((param) => {
  if (!param.name || !isParamVisible(param, values)) return false;
  if (!isParamConditionallyRequired(param, values)) return false;
  return valueMissing(values[param.name]);
});

export const isParamConditionallyRequired = (
  param: { required?: boolean; requiredWhen?: ParamVisibilityRule },
  values: Record<string, unknown>,
): boolean => {
  if (param.required) return true;
  if (!param.requiredWhen) return false;
  return isParamRuleActive(param.requiredWhen, values);
};
