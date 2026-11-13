'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { ConditionFieldOption } from '@/app/ops-analysis/types/dataSource';
import { useDataSourceApi } from '@/app/ops-analysis/api/dataSource';
import ConditionFilterInput from '@/app/ops-analysis/components/conditionFilterInput';
import {
  loadModelAttrCatalog,
  type ModelAttrCatalogRow,
} from '@/app/ops-analysis/components/conditionFilterControl';
import {
  parseModelConditionFilter,
  selectedModelIds,
  type ModelConditionFilterValue,
} from '@/app/ops-analysis/utils/modelConditionFilter';
import { reconcileConditionRows } from '@/app/ops-analysis/utils/conditionFilter';
import { useTranslation } from '@/utils/i18n';

interface ModelConditionFilterControlProps {
  value?: unknown;
  onChange?: (value: ModelConditionFilterValue) => void;
  modelParam?: string;
  formParams?: Record<string, unknown>;
  disabled?: boolean;
}

const fieldsFor = (rows: ModelAttrCatalogRow[], modelId: string): ConditionFieldOption[] => rows
  .filter((row) => row.modelId === modelId)
  .map((row) => ({
    value: row.attrId,
    label: row.label,
    valueType: row.valueType,
    options: row.options,
  }));

const ModelConditionFilterControl: React.FC<ModelConditionFilterControlProps> = ({
  value,
  onChange,
  modelParam,
  formParams,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const api = useDataSourceApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const modelIds = selectedModelIds(modelParam ? formParams?.[modelParam] : undefined);
  const modelKey = modelIds.join('\0');
  const [loaded, setLoaded] = useState<{ key: string; rows: ModelAttrCatalogRow[] }>({ key: '', rows: [] });
  const ready = loaded.key === modelKey;

  useEffect(() => {
    let cancelled = false;
    const key = modelKey;
    const ids = key ? key.split('\0') : [];
    if (!ids.length) {
      setLoaded({ key, rows: [] });
      return undefined;
    }
    void loadModelAttrCatalog(apiRef.current, ids).then((rows) => {
      if (!cancelled) setLoaded({ key, rows });
    }).catch(() => {
      if (!cancelled) setLoaded({ key, rows: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [modelKey]);

  useEffect(() => {
    if (!ready || !onChange) return;
    const ids = modelKey ? modelKey.split('\0') : [];
    const current = parseModelConditionFilter(value);
    const next: ModelConditionFilterValue = { by_model: {} };
    ids.forEach((modelId) => {
      const group = current.by_model[modelId] ?? { logic: 'AND', items: [] };
      next.by_model[modelId] = reconcileConditionRows(group, fieldsFor(loaded.rows, modelId));
    });
    if (JSON.stringify(next) !== JSON.stringify(current)) onChange(next);
  }, [loaded.rows, modelKey, onChange, ready, value]);

  if (!modelIds.length) {
    return <span className="text-sm text-(--color-text-3)">{t('dashboard.selectModel')}</span>;
  }

  const current = parseModelConditionFilter(value);
  const names = new Map<string, string>();
  loaded.rows.forEach((row) => {
    if (!names.has(row.modelId)) names.set(row.modelId, row.modelName);
  });

  return (
    <div className="flex flex-col gap-3">
      {modelIds.map((modelId) => (
        <div key={modelId} className="rounded border border-solid border-(--color-border-2) p-3">
          <div className="mb-2 text-sm text-(--color-text-1)">{names.get(modelId) || modelId}</div>
          <ConditionFilterInput
            value={current.by_model[modelId] ?? { logic: 'AND', items: [] }}
            fields={fieldsFor(loaded.rows, modelId)}
            disabled={disabled || !ready}
            onChange={(group) => {
              const latest = parseModelConditionFilter(value);
              onChange?.({
                by_model: {
                  ...latest.by_model,
                  [modelId]: group,
                },
              });
            }}
          />
        </div>
      ))}
    </div>
  );
};

export default ModelConditionFilterControl;
