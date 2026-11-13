'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';
import { useDataSourceApi } from '@/app/ops-analysis/api/dataSource';
import {
  loadModelAttrCatalog,
  type ModelAttrCatalogRow,
} from '@/app/ops-analysis/components/conditionFilterControl';
import { selectedModelIds } from '@/app/ops-analysis/utils/modelConditionFilter';
import { useTranslation } from '@/utils/i18n';

interface ModelColumnsControlProps {
  value?: unknown;
  onChange?: (value: string[]) => void;
  modelParam?: string;
  formParams?: Record<string, unknown>;
  disabled?: boolean;
}

const selectedKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  return text ? [text] : [];
};

const ModelColumnsControl: React.FC<ModelColumnsControlProps> = ({
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
  const chosen = selectedKeys(value);

  const chosenKey = chosen.join('\0');

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
    if (!ready || !onChange || !modelKey) return;
    const allowed = new Set(loaded.rows.map((row) => row.fieldKey));
    const current = chosenKey ? chosenKey.split('\0') : [];
    const next = current.filter((key) => allowed.has(key));
    if (next.length !== current.length) onChange(next);
  }, [chosenKey, loaded.rows, modelKey, onChange, ready]);

  if (!modelIds.length) {
    return <span className="text-sm text-(--color-text-3)">{t('dashboard.selectModel')}</span>;
  }

  const groups = new Map<string, { label: string; options: Array<{ label: string; value: string }> }>();
  loaded.rows.forEach((row) => {
    const current = groups.get(row.modelId) ?? { label: row.modelName, options: [] };
    current.options.push({ label: row.label, value: row.fieldKey });
    groups.set(row.modelId, current);
  });

  return (
    <Select
      mode="multiple"
      allowClear
      showSearch
      optionFilterProp="label"
      disabled={disabled || !ready}
      value={chosen}
      placeholder={t('common.selectTip')}
      style={{ width: '100%' }}
      options={(modelIds.length > 1
        ? [...groups.values()]
        : loaded.rows.map((row) => ({ label: row.label, value: row.fieldKey }))) as DefaultOptionType[]}
      onChange={(next) => onChange?.(Array.isArray(next) ? next.map(String) : [])}
    />
  );
};

export default ModelColumnsControl;
