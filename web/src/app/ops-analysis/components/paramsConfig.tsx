import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useDebouncedOptionsQueryValues } from '@/app/ops-analysis/hooks/useDebouncedOptionsQueryValues';
import { isFreeTextOptionsParam } from '@/app/ops-analysis/utils/optionsQueryTextDebounce';
import TimeSelector from '@/components/time-selector';
import { Form, Input, Select, DatePicker, InputNumber, Button, Tooltip, Collapse } from 'antd';
import type { FormInstance } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useTranslation } from '@/utils/i18n';
import type {
  FilterBindings,
  FilterValue,
  UnifiedFilterDefinition,
} from '@/app/ops-analysis/types/dashBoard';
import type {
  DatasourceItem,
  InputControlConfig,
  InputOption,
  ParamItem,
} from '@/app/ops-analysis/types/dataSource';
import CompactEmptyState from '@/components/compact-empty-state';
import { ParamInputControl } from '@/app/ops-analysis/components/paramInputControl';
import { CatalogParamEditor } from '@/app/ops-analysis/components/catalogParamEditor';
import { isCatalogControl, normalizeInputConfig } from '@/app/ops-analysis/utils/paramInputConfigUtils';
import { isParamConditionallyRequired, isParamVisible } from '@/app/ops-analysis/utils/paramVisibility';
import {
  describeFieldGroupIssue,
  inspectCondition,
  inspectFieldGroup,
  inspectOrder,
  readFieldCatalog,
  readOrderChoices,
} from '@/app/ops-analysis/utils/conditionTree';
import { getDataSourceFormParamInitialValue } from '@/app/ops-analysis/utils/dataSourceFormParams';
import { readComponentOptionsQueryUpstream } from '@/app/ops-analysis/utils/optionsQueryCandidates';
import {
  dynamicQueryParamsOf,
  resolveOptionsQueryParams,
  stableStringify,
  type ResolvedOptionsQuery,
} from '@/app/ops-analysis/utils/optionsQueryParamRefs';
import DateRangeSelector from './dateRangeSelector';
import {
  getTimeSelectorDefaultValue,
  getTimeSelectorKey,
  type TimeValue,
} from './paramsConfigTimeRange';

const FormTimeSelector: React.FC<{
  value?: TimeValue | null;
  disabled?: boolean;
  onChange?: (value: TimeValue | null) => void;
}> = ({ value, disabled = false, onChange }) => {
  const handleChange = (range: number[], originValue: number | null) => {
    if (originValue == null) {
      onChange?.(null);
    } else if (originValue === 0 && range.length === 2) {
      const tupleRange: [number, number] = [range[0], range[1]];
      onChange?.(tupleRange);
    } else {
      onChange?.(originValue);
    }
  };

  const defaultValue = getTimeSelectorDefaultValue(value);

  return (
    <div
      className="w-full"
      style={disabled ? { pointerEvents: 'none', opacity: 0.6 } : undefined}
    >
      <TimeSelector
        key={getTimeSelectorKey(value)}
        onlyTimeSelect
        clearable={!disabled}
        className="w-full"
        defaultValue={defaultValue}
        onChange={handleChange}
      />
    </div>
  );
};

const NullableBooleanSelect: React.FC<{
  value?: boolean | null;
  disabled?: boolean;
  yesLabel: string;
  noLabel: string;
  onChange?: (value: boolean | null) => void;
}> = ({ value, disabled = false, yesLabel, noLabel, onChange }) => (
  <Select<number>
    value={value == null ? undefined : value ? 1 : 0}
    disabled={disabled}
    allowClear={!disabled}
    placeholder="--"
    className="w-full"
    options={[
      { label: yesLabel, value: 1 },
      { label: noLabel, value: 0 },
    ]}
    onChange={(nextValue) =>
      onChange?.(nextValue == null ? null : nextValue === 1)
    }
  />
);

interface DataSourceParamsConfigProps {
  selectedDataSource?: DatasourceItem;
  readonly?: boolean;
  includeFilterTypes?: string[];
  fieldPrefix?: string;
  form?: FormInstance;
  preserveValues?: boolean;
  /** 传入后按组件配置表单解析选项查询引用；缺省则保持原请求。 */
  globalFilters?: UnifiedFilterDefinition[];
  filterBindings?: FilterBindings | null;
  globalFilterValues?: Record<string, FilterValue>;
  onEditInputConfig?: (param: ParamItem) => void;
  onParamOptionsResolved?: (param: ParamItem, options: InputOption[]) => void;
  resultEmpty?: boolean;
}

const formParamValue = (
  formParams: Record<string, unknown> | undefined,
  name: string,
  fallback: ParamItem['value'],
) => (
  formParams && Object.prototype.hasOwnProperty.call(formParams, name)
    ? formParams[name]
    : fallback
);

const resolveParamOptionsQuery = ({
  inputConfig,
  enabled,
  formParams,
  sourceParams,
  globalFilters,
  filterBindings,
  globalFilterValues,
}: {
  inputConfig?: InputControlConfig;
  enabled: boolean;
  formParams: Record<string, unknown> | undefined;
  sourceParams: ParamItem[];
  globalFilters?: UnifiedFilterDefinition[];
  filterBindings?: FilterBindings | null;
  globalFilterValues?: Record<string, FilterValue>;
}): { resolution: ResolvedOptionsQuery; signature: string } | undefined => {
  if (!enabled) return undefined;
  const resolution = resolveOptionsQueryParams(
    dynamicQueryParamsOf(inputConfig),
    (ref) => readComponentOptionsQueryUpstream({
      ref,
      componentParams: sourceParams.map((param) => ({
        name: param.name,
        type: param.type,
        filterType: param.filterType,
        inputConfig: param.inputConfig,
        inputMode: param.inputMode,
        value: formParamValue(formParams, param.name, param.value),
      })),
      definitions: globalFilters ?? [],
      filterBindings,
      readFilterValue: (id) => (
        globalFilterValues && Object.prototype.hasOwnProperty.call(globalFilterValues, id)
          ? globalFilterValues[id]
          : undefined
      ),
    }),
  );
  return {
    resolution,
    signature: stableStringify({
      blocked: resolution.blocked,
      blockReason: resolution.blockReason ?? null,
      params: resolution.params,
    }),
  };
};

const DataSourceParamsConfig: React.FC<DataSourceParamsConfigProps> = ({
  selectedDataSource,
  readonly = false,
  includeFilterTypes = ['params', 'fixed', 'filter'],
  fieldPrefix = 'params',
  preserveValues = false,
  globalFilters,
  filterBindings,
  globalFilterValues,
  onEditInputConfig,
  onParamOptionsResolved,
  resultEmpty = false,
}) => {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const resolvedOptionsRef = useRef(new Map<string, InputOption[]>());
  const form = Form.useFormInstance();
  // useWatch 负责在未注册字段变化时重渲染；当次渲染读 store，避免订阅值晚一拍。
  const watchedParams = Form.useWatch(fieldPrefix, { form, preserve: true }) as Record<string, unknown> | undefined;
  const storedParams = form.getFieldsValue(true)?.[fieldPrefix] as Record<string, unknown> | undefined;
  const formParams = storedParams ?? watchedParams;
  const resolveOptionsQuery = globalFilters !== undefined;

  useEffect(() => {
    setMounted(true);
  }, []);

  const sourceParams = useMemo(
    () => (Array.isArray(selectedDataSource?.params) ? selectedDataSource.params : []),
    [selectedDataSource?.params],
  );
  const typedParamNames = useMemo(
    () => sourceParams.filter(isFreeTextOptionsParam).map((param) => param.name),
    [sourceParams],
  );
  // 表单控件仍读 form 的即时值。选项查询只吃防抖后的文本/数字。
  const optionsQueryFormParams = useDebouncedOptionsQueryValues(formParams ?? {}, typedParamNames);
  const configParams = sourceParams.filter(
    (param: ParamItem) => includeFilterTypes.includes(param.filterType || 'fixed'),
  );

  if (configParams.length === 0) {
    return (
      <CompactEmptyState description={t('dashboard.noParamSettings')} />
    );
  }

  const renderParamInput = (param: ParamItem) => {
    const { type = 'string', filterType, options } = param;
    const isDisabled = readonly || filterType === 'fixed';
    const inputConfig = normalizeInputConfig(param);

    const fallbackInput = (() => {
      if (options && options.length > 0) {
        return (
          <Select
            placeholder={t('common.selectTip')}
            className="w-full"
            disabled={isDisabled}
            allowClear={!isDisabled}
            options={options}
          />
        );
      }

      switch (type) {
        case 'timeRange':
          return <FormTimeSelector disabled={isDisabled} />;
        case 'dateRange':
          return <DateRangeSelector disabled={isDisabled} allowClear className="w-full" />;
        case 'date':
          return (
            <DatePicker
              showTime
              placeholder={t('common.selectTip')}
              className="w-full"
              format="YYYY-MM-DD HH:mm:ss"
              disabled={isDisabled}
            />
          );
        case 'boolean':
          return (
            <NullableBooleanSelect
              disabled={isDisabled}
              yesLabel={t('common.yes')}
              noLabel={t('common.no')}
            />
          );
        case 'number':
          return (
            <InputNumber
              placeholder={t('common.inputTip')}
              className="w-full"
              disabled={isDisabled}
            />
          );
        case 'string':
        default:
          if (param.name === 'query') {
            return (
              <Input.TextArea
                rows={4}
                placeholder={t('common.inputTip')}
                className="w-full"
                disabled={isDisabled}
              />
            );
          }
          return (
            <Input
              placeholder={t('common.inputTip')}
              className="w-full"
              disabled={isDisabled}
            />
          );
      }
    })();

    if (!inputConfig) {
      return fallbackInput;
    }

    const optionsQuery = resolveParamOptionsQuery({
      inputConfig,
      enabled: resolveOptionsQuery,
      formParams: optionsQueryFormParams,
      sourceParams,
      globalFilters,
      filterBindings,
      globalFilterValues,
    });

    const rememberOptions = (resolvedOptions: InputOption[]) => {
      resolvedOptionsRef.current.set(param.name, resolvedOptions);
      onParamOptionsResolved?.(param, resolvedOptions);
    };

    if (inputConfig.control === 'condition' || inputConfig.control === 'fieldGroup' || inputConfig.control === 'order') {
      const modelValue = formParams?.model_ids;
      const selectedModelIds = Array.isArray(modelValue) ? modelValue.map(String) : [];
      return (
        <CatalogParamEditor
          inputConfig={inputConfig}
          disabled={isDisabled}
          resolvedQueryParams={optionsQuery?.resolution.params}
          optionsBlocked={optionsQuery?.resolution.blocked}
          optionsBlockReason={optionsQuery?.resolution.blockReason}
          optionsQuerySignature={optionsQuery?.signature}
          onOptionsResolved={rememberOptions}
          selectedModelIds={selectedModelIds}
          analysisMode={typeof formParams?.analysis_mode === 'string' ? formParams.analysis_mode : ''}
          metrics={formParams?.metrics}
          resultEmpty={resultEmpty}
          onFocusModels={() => form.scrollToField([fieldPrefix, 'model_ids'])}
        />
      );
    }

    return (
      <ParamInputControl
        inputConfig={inputConfig}
        fallback={fallbackInput}
        disabled={isDisabled}
        placeholder={t('common.selectTip')}
        resolvedQueryParams={optionsQuery?.resolution.params}
        optionsBlocked={optionsQuery?.resolution.blocked}
        optionsBlockReason={optionsQuery?.resolution.blockReason}
        optionsQuerySignature={optionsQuery?.signature}
        onOptionsResolved={rememberOptions}
      />
    );
  };

  const foldInputGears = configParams.some((param) => param.formSection === 'more');
  const canEditInput = (param: ParamItem) => Boolean(
    onEditInputConfig
    && (param.type || 'string') === 'string'
    && param.filterType !== 'fixed'
    && !readonly
    && !isCatalogControl(normalizeInputConfig(param)),
  );
  const renderParamItem = (param: ParamItem, gear: 'inline' | 'hidden') => {
        const fieldName = [fieldPrefix, param.name];
        const initialValue = getDataSourceFormParamInitialValue(param);
        const labelText = param.alias_name || param.name;
        const isLongText = labelText.length > 18;
        const isVeryLongText = labelText.length > 30;
        const showInputConfigButton = gear === 'inline' && canEditInput(param);

        const getLabelStyle = (): React.CSSProperties => {
          const baseStyle = {
            lineHeight: '1.4',
            width: '100%',
          };

          if (isVeryLongText) {
            return {
              ...baseStyle,
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              textAlign: 'left',
            };
          }
          if (isLongText) {
            return {
              ...baseStyle,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'left',
            };
          }
          return {
            ...baseStyle,
            whiteSpace: 'nowrap',
            overflow: 'visible',
            textAlign: 'left',
          };
        };

        const visible = isParamVisible(param, formParams || {});
        const required = visible && isParamConditionallyRequired(param, formParams || {});
        const inputConfig = normalizeInputConfig(param);
        return (
          <Form.Item
            key={`${selectedDataSource?.id || 'default'}-${param.name}`}
            hidden={!visible}
            label={
              <div className="flex items-center justify-start gap-1">
                <div style={getLabelStyle()} title={labelText}>
                  {labelText}
                </div>
                {showInputConfigButton && (
                  <Tooltip title={t('paramInput.editButton')}>
                    <Button
                      type="text"
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditInputConfig!(param);
                      }}
                      className="shrink-0 text-[var(--color-text-2)] hover:text-[var(--color-primary)]"
                    />
                  </Tooltip>
                )}
              </div>
            }
            name={fieldName}
            initialValue={!preserveValues && mounted ? initialValue : undefined}
            tooltip={param.descPlacement === 'extra' ? undefined : (param.desc || undefined)}
            extra={param.descPlacement === 'extra' ? param.desc : undefined}
            style={{ marginBottom: isVeryLongText ? 20 : 16 }}
            rules={visible ? [
              { required, message: t('dataSource.paramRequired', '请配置{label}', { label: labelText }) },
              {
                validator: async (_rule, current) => {
                  if (inputConfig?.control === 'select' && inputConfig.missingOptionPolicy === 'retain') {
                    const options = resolvedOptionsRef.current.get(param.name);
                    if (!options) return;
                    const selected = Array.isArray(current) ? current : current == null || current === '' ? [] : [current];
                    const stale = selected.some((item) => !options.some((option) => String(option.value) === String(item)));
                    if (stale) throw new Error(t('paramInput.staleOption'));
                  }
                  if (inputConfig?.control === 'condition') {
                    const options = resolvedOptionsRef.current.get(param.name);
                    const modelValue = formParams?.model_ids;
                    const selectedModelIds = Array.isArray(modelValue) ? modelValue.map(String) : [];
                    const issue = inspectCondition(
                      current,
                      readFieldCatalog(options),
                      options !== undefined,
                      selectedModelIds,
                    );
                    if (issue) throw new Error(t(`conditionBuilder.issue.${issue.code}`));
                  }
                  if (inputConfig?.control === 'order') {
                    const options = resolvedOptionsRef.current.get(param.name);
                    const mode = typeof formParams?.analysis_mode === 'string' ? formParams.analysis_mode : '';
                    const issue = inspectOrder(
                      current,
                      readOrderChoices(options, mode, formParams?.metrics),
                      options !== undefined,
                    );
                    if (issue) throw new Error(t('orderBuilder.stale'));
                  }
                  if (inputConfig?.control === 'fieldGroup' && inputConfig.variant) {
                    const options = resolvedOptionsRef.current.get(param.name);
                    const issue = inspectFieldGroup(current, readFieldCatalog(options), options !== undefined, inputConfig.variant);
                    if (issue) {
                      throw new Error(describeFieldGroupIssue(issue, {
                        invalid: t('fieldGroup.issue.invalid'),
                        required: t('fieldGroup.issue.required'),
                        stale: t('fieldGroup.issue.stale'),
                        incompatible: t('fieldGroup.issue.incompatible'),
                        incompatibleNamed: t('fieldGroup.issue.incompatibleNamed', '{left} 和 {right} 的类型或单位不一致，不能合并'),
                        enumConflict: t('fieldGroup.issue.enumConflict'),
                      }));
                    }
                  }
                },
              },
            ] : []}
          >
            {visible ? renderParamInput(param) : null}
          </Form.Item>
        );
  };
  const primaryParams = configParams.filter((param) => param.formSection !== 'more');
  const advancedParams = configParams.filter((param) => param.formSection === 'more');
  const gearParams = foldInputGears ? primaryParams.filter((param) => canEditInput(param)) : [];

  return (
    <>
      {primaryParams.map((param) => renderParamItem(param, foldInputGears ? 'hidden' : 'inline'))}
      {advancedParams.length > 0 ? (
        <Collapse
          ghost
          items={[{
            key: 'more',
            forceRender: true,
            label: t('paramInput.more', '更多'),
            children: (
              <div className="flex flex-col gap-2">
                {advancedParams.map((param) => renderParamItem(param, 'inline'))}
                {gearParams.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-[var(--color-text-3)]">{t('paramInput.inputMethod', '取值方式')}</div>
                    <div className="flex flex-wrap gap-2">
                      {gearParams.map((param) => (
                        <Button
                          key={param.name}
                          icon={<SettingOutlined />}
                          onClick={() => onEditInputConfig?.(param)}
                        >
                          {param.alias_name || param.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ),
          }]}
        />
      ) : null}
    </>
  );
};

export default DataSourceParamsConfig;
