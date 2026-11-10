'use client';

import React, { useEffect, useState } from 'react';
import type {
  ConditionFieldOption,
  ConditionFieldSource,
} from '@/app/ops-analysis/types/dataSource';
import { useDataSourceApi } from '@/app/ops-analysis/api/dataSource';
import ConditionFilterInput from '@/app/ops-analysis/components/conditionFilterInput';
import { extractDataSourceItems, resolveDynamicSourceId } from '@/app/ops-analysis/utils/paramInputConfigUtils';
import {
  parseConditionGroup,
  reconcileConditionRows,
  type ConditionGroup,
} from '@/app/ops-analysis/utils/conditionFilter';

const sourceIds = new Map<string, number>();

const readParam = (formParams: Record<string, unknown> | undefined, name?: string) => {
  if (!name || !formParams) return '';
  const value = formParams[name];
  return value === undefined || value === null ? '' : String(value);
};

const staticFields = (
  source: ConditionFieldSource | undefined,
  queryObject: string,
): ConditionFieldOption[] => {
  const items = source?.items || [];
  return items.filter((item) => {
    if (!queryObject || !item.query_objects?.length) return true;
    return item.query_objects.includes(queryObject);
  });
};

interface ConditionFilterControlProps {
  value?: unknown;
  onChange?: (value: ConditionGroup) => void;
  source?: ConditionFieldSource;
  formParams?: Record<string, unknown>;
  queryObject?: string;
  disabled?: boolean;
}

const ConditionFilterControl: React.FC<ConditionFilterControlProps> = ({
  value,
  onChange,
  source,
  formParams,
  queryObject = '',
  disabled = false,
}) => {
  const api = useDataSourceApi();
  const [dynamicFields, setDynamicFields] = useState<ConditionFieldOption[]>([]);
  const [loadedOptions, setLoadedOptions] = useState<Record<string, ConditionFieldOption['options']>>({});
  const [ready, setReady] = useState(source?.kind === 'static' || !source);
  const baseFields = source?.kind === 'static' || !source ? staticFields(source, queryObject) : dynamicFields;
  const fields = baseFields.map((field) => (
    loadedOptions[field.value] ? { ...field, options: loadedOptions[field.value] } : field
  ));

  useEffect(() => {
    if (!source || source.kind === 'static') {
      setReady(true);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      setReady(false);
      const modelId = source.kind === 'modelAttrs'
        ? readParam(formParams, source.modelParam)
        : await resolveEndModel(api, source, formParams);
      if (!modelId) {
        if (!cancelled) {
          setDynamicFields([]);
          setReady(true);
        }
        return;
      }
      const loaded = await loadConditionModelFields(api, modelId);
      if (!cancelled) {
        setDynamicFields(loaded);
        setReady(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, formParams, source]);

  useEffect(() => {
    const pending = (source?.items || []).filter(
      (field) => field.optionsSource?.type === 'dynamic' && field.optionsSource.sourceRef?.type === 'rest_api',
    );
    if (!pending.length) return undefined;
    let cancelled = false;
    void (async () => {
      const next: Record<string, ConditionFieldOption['options']> = {};
      for (const field of pending) {
        const restApi = field.optionsSource?.sourceRef?.type === 'rest_api' ? field.optionsSource.sourceRef.value : '';
        const valueField = field.optionsSource?.type === 'dynamic' ? field.optionsSource.valueField : '';
        const labelField = field.optionsSource?.type === 'dynamic' ? field.optionsSource.labelField : '';
        if (!restApi) continue;
        const sourceId = await resolveSourceId(api, restApi);
        if (!sourceId) continue;
        const { data } = await api.getSourceDataByApiId(sourceId, {});
        next[field.value] = extractDataSourceItems(data).map((item) => ({
          label: String(item[labelField] || item[valueField] || ''),
          value: String(item[valueField] || ''),
        })).filter((option) => option.value);
      }
      if (!cancelled) setLoadedOptions(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, source]);

  useEffect(() => {
    if (!ready || !onChange) return;
    const group = parseConditionGroup(value);
    const next = reconcileConditionRows(group, fields);
    if (JSON.stringify(next) !== JSON.stringify(group)) onChange(next);
  }, [fields, onChange, ready, value]);

  return (
    <ConditionFilterInput
      value={value}
      onChange={onChange}
        fields={fields}
        queryObject={queryObject}
        disabled={disabled}
    />
  );
};

const resolveSourceId = async (
  api: ReturnType<typeof useDataSourceApi>,
  restApi: string,
) => {
  const cached = sourceIds.get(restApi);
  if (cached) return cached;
  const response = await api.getDataSourceList({ page_size: -1 });
  const items = extractDataSourceItems(response) as Array<{ id?: number; name?: string; rest_api?: string }>;
  items.forEach((item) => {
    if (typeof item.id === 'number' && item.rest_api) sourceIds.set(item.rest_api, item.id);
  });
  return resolveDynamicSourceId(
    { type: 'dynamic', sourceRef: { type: 'rest_api', value: restApi }, valueField: 'id', labelField: 'name' },
    items.filter((item): item is { id: number; name?: string; rest_api?: string } => typeof item.id === 'number'),
  );
};

export const loadConditionModelFields = async (
  api: ReturnType<typeof useDataSourceApi>,
  modelId: string,
): Promise<ConditionFieldOption[]> => {
  const sourceId = await resolveSourceId(api, 'cmdb/list_cmdb_attr_options');
  if (!sourceId) return [];
  const { data } = await api.getSourceDataByApiId(sourceId, { model_id: modelId });
  return extractDataSourceItems(data).map((item) => ({
    value: String(item.attr_id || ''),
    label: String(item.attr_name || item.attr_id || ''),
    valueType: (item.value_type === 'number' || item.value_type === 'enum' ? item.value_type : 'string') as ConditionFieldOption['valueType'],
    options: Array.isArray(item.options)
      ? item.options.filter((option) => option && typeof option === 'object').map((option) => {
        const record = option as { label?: unknown; value?: unknown };
        return { label: String(record.label || record.value || ''), value: String(record.value || '') };
      })
      : [],
  })).filter((item) => item.value);
};

const resolveEndModel = async (
  api: ReturnType<typeof useDataSourceApi>,
  source: ConditionFieldSource,
  formParams: Record<string, unknown> | undefined,
) => {
  const startModel = readParam(formParams, source.startModelParam);
  const association = readParam(formParams, source.associationParam);
  if (!startModel || !association) return '';
  const sourceId = await resolveSourceId(api, 'cmdb/get_model_association_options');
  if (!sourceId) return '';
  const { data } = await api.getSourceDataByApiId(sourceId, { model_id: startModel });
  const row = extractDataSourceItems(data).find((item) => String(item.model_asst_id || '') === association);
  if (!row) return '';
  const src = String(row.src_model_id || '');
  const dst = String(row.dst_model_id || '');
  return src === startModel ? dst : src;
};

export default ConditionFilterControl;
