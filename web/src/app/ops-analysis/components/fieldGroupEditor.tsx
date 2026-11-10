'use client';

import React, { useState } from 'react';
import { Button, Input, Select, Space } from 'antd';
import { useTranslation } from '@/utils/i18n';
import {
  describeFieldGroupIssue,
  inspectFieldGroup,
  type QueryFieldCatalogItem,
} from '@/app/ops-analysis/utils/conditionTree';

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

const modelIdsOf = (catalog: QueryFieldCatalogItem[], sources: string[]) => new Set(
  sources.flatMap((source) => {
    const field = catalog.find((item) => item.key === source);
    return field?.modelId ? [field.modelId] : [];
  }),
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
  const [mergeError, setMergeError] = useState('');
  const rows = rowsOf(value);
  const replace = (next: FieldGroupRow[]) => onChange?.(next);
  const models = Array.from(new Map(
    catalog.filter((item) => item.modelId).map((item) => [item.modelId, item.modelName || item.modelId]),
  ).entries());
  const mergedRows = rows.filter((row) => modelIdsOf(catalog, row.sources).size > 1);
  const covered = new Set(mergedRows.flatMap((row) => [...modelIdsOf(catalog, row.sources)]));
  const singleOf = (modelId: string) => rows.find((row) => {
    const owners = modelIdsOf(catalog, row.sources);
    return owners.size === 1 && owners.has(modelId);
  });
  const issue = inspectFieldGroup(value, catalog, catalogReady, variant);
  const issueText = issue
    ? describeFieldGroupIssue(issue, {
      invalid: t('fieldGroup.issue.invalid'),
      required: t('fieldGroup.issue.required'),
      stale: t('fieldGroup.issue.stale'),
      incompatible: t('fieldGroup.issue.incompatible'),
      incompatibleNamed: t('fieldGroup.issue.incompatibleNamed', '{left} 和 {right} 的类型或单位不一致，不能合并'),
      enumConflict: t('fieldGroup.issue.enumConflict'),
    })
    : '';
  const filledSingles = models.flatMap(([modelId]) => {
    const row = singleOf(modelId);
    return row && row.sources.length === 1 ? [row] : [];
  });

  const writeModel = (modelId: string, source: string | undefined) => {
    const kept = rows.filter((row) => {
      const owners = modelIdsOf(catalog, row.sources);
      if (owners.size !== 1) return true;
      return !owners.has(modelId);
    });
    if (!source) {
      replace(kept);
      return;
    }
    const previous = singleOf(modelId);
    replace([...kept, {
      label: previous?.label || '',
      func: previous?.func,
      sources: [source],
    }]);
  };

  const mergeFilled = () => {
    if (filledSingles.length < 2) return;
    const candidate = {
      label: filledSingles.map((row) => row.label).find(Boolean) || '',
      func: filledSingles.find((row) => row.func)?.func,
      sources: filledSingles.flatMap((row) => row.sources),
    };
    const merged = [
      ...rows.filter((row) => modelIdsOf(catalog, row.sources).size > 1),
      candidate,
    ];
    const problem = inspectFieldGroup(merged, catalog, catalogReady, variant);
    if (problem && (problem.code === 'incompatible' || problem.code === 'enumConflict')) {
      setMergeError(describeFieldGroupIssue(
        { ...problem, names: problem.names && problem.names.length >= 2 ? problem.names : filledSingles.flatMap((row) => {
          const field = catalog.find((item) => item.key === row.sources[0]);
          return field ? [field.label] : [];
        }).slice(0, 2) },
        {
          invalid: t('fieldGroup.issue.invalid'),
          required: t('fieldGroup.issue.required'),
          stale: t('fieldGroup.issue.stale'),
          incompatible: t('fieldGroup.issue.incompatible'),
          incompatibleNamed: t('fieldGroup.issue.incompatibleNamed', '{left} 和 {right} 的类型或单位不一致，不能合并'),
          enumConflict: t('fieldGroup.issue.enumConflict'),
        },
      ));
      return;
    }
    setMergeError('');
    const singles = new Set(filledSingles);
    replace([...rows.filter((row) => !singles.has(row)), candidate]);
  };

  const renderRow = (row: FieldGroupRow, title: string, onSources: (sources: string[]) => void, onRemove?: () => void) => {
    const selected = catalog.filter((item) => row.sources.includes(item.key));
    const funcs = selected[0]?.funcs || [];
    const multiple = row.sources.length > 1;
    const rowIndex = rows.indexOf(row);
    const rowIssue = issue && issue.index === rowIndex;
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-[var(--color-text-2)]">{title}</div>
        <Space wrap className="w-full">
          <Select
            disabled={disabled}
            mode={multiple ? 'multiple' : undefined}
            showSearch
            optionFilterProp="label"
            className="min-w-56"
            placeholder={t('fieldGroup.sources')}
            value={multiple ? row.sources : (row.sources[0] || undefined)}
            options={catalog.map((item) => ({ value: item.key, label: item.label }))}
            onChange={(next) => onSources(Array.isArray(next) ? next.map(String) : (next ? [String(next)] : []))}
          />
          {variant === 'metrics' && (
            <Select
              disabled={disabled}
              className="min-w-28"
              placeholder={t('fieldGroup.func')}
              value={row.func}
              options={funcs.map((item) => ({ value: item.value, label: item.label }))}
              onChange={(func) => {
                const next = rows.slice();
                const index = rows.indexOf(row);
                if (index >= 0) next[index] = { ...row, func };
                replace(next);
              }}
            />
          )}
          <Input
            disabled={disabled}
            className="min-w-32"
            placeholder={t('fieldGroup.label')}
            value={row.label}
            onChange={(event) => {
              const next = rows.slice();
              const index = rows.indexOf(row);
              if (index >= 0) next[index] = { ...row, label: event.target.value };
              replace(next);
            }}
          />
          {onRemove ? (
            <Button disabled={disabled} onClick={onRemove}>{t('conditionBuilder.remove')}</Button>
          ) : null}
        </Space>
        {rowIssue ? <p className="m-0 text-xs text-[var(--color-fail)]">{issueText}</p> : null}
      </div>
    );
  };

  const showMergeHint = mergedRows.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {catalogReady ? null : <span className="text-xs text-[var(--color-text-3)]">{t('conditionBuilder.loading')}</span>}
      {models.length === 0 ? (
        <p className="m-0 text-xs text-[var(--color-text-3)]">{t('conditionBuilder.needModel')}</p>
      ) : (
        <p className="m-0 text-xs text-[var(--color-text-3)]">{t('fieldGroup.perModel')}</p>
      )}
      {showMergeHint ? (
        <p className="m-0 text-xs text-[var(--color-text-3)]">{t(variant === 'metrics' ? 'fieldGroup.mergeHint' : 'fieldGroup.groupMergeHint')}</p>
      ) : null}
      {catalogReady ? rows.filter((row) => row.sources.length > 0 && modelIdsOf(catalog, row.sources).size === 0).map((row, index) => (
        <div key={`stale-${index}`}>
          {renderRow(
            row,
            row.sources.join('、'),
            (sources) => {
              const next = rows.slice();
              const at = rows.indexOf(row);
              if (at >= 0) next[at] = { ...row, sources };
              replace(next.filter((item) => item.sources.length > 0));
            },
            () => replace(rows.filter((item) => item !== row)),
          )}
        </div>
      )) : null}
      {mergedRows.map((row, index) => {
        const names = row.sources.map((source) => catalog.find((item) => item.key === source)?.label || source);
        return (
          <div key={`merged-${index}`}>
            {renderRow(
              row,
              names.join('、'),
              (sources) => {
                const next = rows.slice();
                const at = rows.indexOf(row);
                if (at >= 0) next[at] = { ...row, sources };
                replace(next.filter((item) => item.sources.length > 0));
              },
              () => replace(rows.filter((item) => item !== row)),
            )}
          </div>
        );
      })}
      {models.filter(([modelId]) => !covered.has(modelId)).map(([modelId, name]) => {
        const row = singleOf(modelId) || { label: '', sources: [] };
        const fields = catalog.filter((item) => item.modelId === modelId);
        return (
          <div key={modelId} className="flex flex-col gap-1">
            <div className="text-xs text-[var(--color-text-2)]">{name}</div>
            <Space wrap className="w-full">
              <Select
                disabled={disabled}
                allowClear
                showSearch
                optionFilterProp="label"
                className="min-w-56"
                placeholder={t('fieldGroup.sources')}
                value={row.sources[0] || undefined}
                options={fields.map((item) => ({ value: item.key, label: item.label }))}
                onChange={(next) => writeModel(modelId, next ? String(next) : undefined)}
              />
              {variant === 'metrics' && (
                <Select
                  disabled={disabled || !row.sources[0]}
                  className="min-w-28"
                  placeholder={t('fieldGroup.func')}
                  value={row.func}
                  options={(fields.find((item) => item.key === row.sources[0])?.funcs || []).map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                  onChange={(func) => {
                    const next = rows.slice();
                    const at = rows.indexOf(row);
                    if (at >= 0) next[at] = { ...row, func };
                    else next.push({ ...row, func, sources: row.sources });
                    replace(next);
                  }}
                />
              )}
              <Input
                disabled={disabled || !row.sources[0]}
                className="min-w-32"
                placeholder={t('fieldGroup.label')}
                value={row.label}
                onChange={(event) => {
                  const next = rows.slice();
                  const at = rows.indexOf(row);
                  if (at >= 0) next[at] = { ...row, label: event.target.value };
                  replace(next);
                }}
              />
            </Space>
            {issue && rows.indexOf(row) === issue.index ? (
              <p className="m-0 text-xs text-[var(--color-fail)]">{issueText}</p>
            ) : null}
          </div>
        );
      })}
      {filledSingles.length >= 2 ? (
        <Button disabled={disabled} onClick={mergeFilled}>{t('fieldGroup.merge')}</Button>
      ) : null}
      {mergeError ? <p className="m-0 text-xs text-[var(--color-fail)]">{mergeError}</p> : null}
    </div>
  );
};

export default FieldGroupEditor;
