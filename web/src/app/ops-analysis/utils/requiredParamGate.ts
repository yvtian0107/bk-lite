export interface RequiredParamDeclaration {
  name?: string;
  alias_name?: string;
  required?: boolean;
}

export interface MissingRequiredParam {
  name: string;
  label: string;
}

type MessageFormatter = (
  id: string,
  defaultMessage?: string,
  values?: Record<string, string>,
) => string;

/** 必填缺值。0 和 false 是有效值。 */
export const isMissingRequiredParamValue = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

/** 只认目录上 required === true。组件快照里的 required 不是权威。 */
export const listMissingRequiredParams = (
  catalog: readonly RequiredParamDeclaration[] | null | undefined,
  params: Record<string, unknown>,
): MissingRequiredParam[] => {
  if (!Array.isArray(catalog)) return [];
  const missing: MissingRequiredParam[] = [];
  catalog.forEach((param) => {
    if (param?.required !== true || typeof param.name !== 'string' || param.name === '') return;
    if (!isMissingRequiredParamValue(params[param.name])) return;
    const alias = typeof param.alias_name === 'string' ? param.alias_name.trim() : '';
    missing.push({ name: param.name, label: alias || param.name });
  });
  return missing;
};

export const formatRequiredParamWaitMessage = (
  missing: readonly MissingRequiredParam[],
  t: MessageFormatter,
): string => {
  if (missing.length === 1) {
    return t('dashboard.selectRequiredParam', '请选择{label}', { label: missing[0].label });
  }
  return t('dashboard.fillRequiredParams', '请补充：{labels}', {
    labels: missing.map((item) => item.label).join('、'),
  });
};
