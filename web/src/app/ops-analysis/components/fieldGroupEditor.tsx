'use client';

import React from 'react';
import { Button, Input, Select, Space } from 'antd';
import { useTranslation } from '@/utils/i18n';
import type { QueryFieldCatalogItem } from '@/app/ops-analysis/utils/conditionTree';

interface FieldGroupRow {
  label?: string;
  func?: string;
  sources: string[];
}

interface FieldGroupEditorProps {
  value?: unknown;
  onChange?: (value: FieldGroupRow[]) => void;
  disabled?: boolean;
  variant: 'group' | 'metrics';
  catalog: QueryFieldCatalogItem[];
  catalogReady: boolean;
}

const rowsOf = (value: unknown): FieldGroupRow[] => (
  Array.isArray(value)
    ? value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as FieldGroupRow;
      return [{
        label: typeof record.label === 'string' ? record.label : '',
        func: typeof record.func === 'string' ? record.func : undefined,
        sources: Array.isArray(record.sources) ? record.sources.map(String) : [],
      }];
    })
    : []
);

const FieldGroupEditor: React.FC<FieldGroupEditorProps> = ({
  value,
  onChange,
  disabled = false,
  variant,
  catalog,
  catalogReady,
}) => {
  const { t } = useTranslation();
  const rows = rowsOf(value);
  const replace = (next: FieldGroupRow[]) => onChange?.(next);
  const options = catalog.map((item) => ({ value: item.key, label: item.label }));

  return (
    <div className="flex flex-col gap-2">
      {catalogReady ? null : <span className="text-[var(--color-text-3)]">{t('conditionBuilder.loading')}</span>}
      {rows.map((row, index) => {
        const selected = catalog.filter((item) => row.sources.includes(item.key));
        const funcs = selected[0]?.funcs || [];
        const update = (patch: Partial<FieldGroupRow>) => {
          const next = rows.slice();
          next[index] = { ...row, ...patch };
          replace(next);
        };
        return (
          <Space key={`${index}-${row.sources.join(',')}`} wrap className="w-full">
            <Select
              disabled={disabled}
              mode="multiple"
              showSearch
              optionFilterProp="label"
              className="min-w-56"
              placeholder={t('fieldGroup.sources')}
              value={row.sources}
              options={options}
              onChange={(sources) => update({ sources })}
            />
            {variant === 'metrics' && (
              <Select
                disabled={disabled}
                className="min-w-28"
                placeholder={t('fieldGroup.func')}
                value={row.func}
                options={funcs.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(func) => update({ func })}
              />
            )}
            <Input
              disabled={disabled}
              className="min-w-32"
              placeholder={t('fieldGroup.label')}
              value={row.label}
              onChange={(event) => update({ label: event.target.value })}
            />
            <Button
              disabled={disabled}
              onClick={() => replace(rows.filter((_, rowIndex) => rowIndex !== index))}
            >
              {t('conditionBuilder.remove')}
            </Button>
          </Space>
        );
      })}
      <Button disabled={disabled} onClick={() => replace([...rows, { label: '', sources: [] }])}>
        {t('fieldGroup.add')}
      </Button>
    </div>
  );
};

export default FieldGroupEditor;
