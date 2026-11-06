'use client';

import React from 'react';
import { Button, DatePicker, Input, InputNumber, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from '@/utils/i18n';
import {
  emptyConditionGroup,
  isConditionGroup,
  leafFields,
  previewCondition,
  type ConditionGroup,
  type ConditionLeaf,
  type ConditionNode,
  type QueryFieldCatalogItem,
} from '@/app/ops-analysis/utils/conditionTree';

const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

interface ConditionTreeEditorProps {
  value?: unknown;
  onChange?: (value: ConditionGroup) => void;
  disabled?: boolean;
  catalog: QueryFieldCatalogItem[];
  catalogReady: boolean;
}

const ConditionTreeEditor: React.FC<ConditionTreeEditorProps> = ({
  value,
  onChange,
  disabled = false,
  catalog,
  catalogReady,
}) => {
  const { t } = useTranslation();
  const group = isConditionGroup(value) ? value : null;
  const models = Array.from(new Map(
    catalog.filter((item) => item.modelId).map((item) => [item.modelId, item.modelName || item.modelId]),
  ).entries());

  const update = (next: ConditionGroup) => onChange?.(next);

  const renderLeaf = (node: ConditionLeaf, onLeaf: (next: ConditionLeaf) => void) => {
    const fields = node.scope === 'global'
      ? catalog
      : catalog.filter((item) => item.modelId === node.scope);
    const selected = leafFields(catalog, node);
    const field = selected[0];
    const operators = selected.length
      ? selected[0].operators.filter((item) => selected.every((candidate) => candidate.operators.some((choice) => choice.value === item.value)))
      : [];
    const operator = operators.find((item) => item.value === node.operator);
    const globalValue = node.scope === 'global' ? selected.map((item) => item.key) : [];
    const scopeOptions = [
      { value: 'global', label: t('conditionBuilder.global') },
      ...models.map(([id, name]) => ({ value: id, label: name })),
    ];
    if (node.scope && node.scope !== 'global' && !models.some(([id]) => id === node.scope)) {
      scopeOptions.push({ value: node.scope, label: node.scope });
    }
    return (
      <Space wrap className="w-full">
        <Select
          disabled={disabled}
          className="min-w-28"
          value={node.scope}
          options={scopeOptions}
          onChange={(scope) => onLeaf({ scope, attr_id: '', operator: '', value: undefined })}
        />
        <Select
          disabled={disabled}
          showSearch
          optionFilterProp="label"
          mode={node.scope === 'global' ? 'multiple' : undefined}
          className="min-w-44"
          placeholder={t('conditionBuilder.field')}
          value={node.scope === 'global' ? globalValue : (node.attr_id || undefined)}
          options={fields.map((item) => ({
            value: node.scope === 'global' ? item.key : item.attrId,
            label: item.label,
          }))}
          onChange={(nextValue) => {
            if (node.scope === 'global') {
              const keys = Array.isArray(nextValue) ? nextValue.map(String) : [];
              const nextFields = catalog.filter((item) => keys.includes(item.key));
              onLeaf({
                scope: 'global',
                sources: keys,
                field_ref: keys.length === 1 ? keys[0] : undefined,
                attr_id: nextFields[0]?.attrId || '',
                operator: nextFields[0]?.operators[0]?.value || '',
                value: undefined,
              });
              return;
            }
            const attrId = String(nextValue);
            const nextField = fields.find((item) => item.attrId === attrId);
            onLeaf({
              scope: node.scope,
              attr_id: attrId,
              field_ref: nextField ? nextField.key : undefined,
              sources: undefined,
              operator: nextField?.operators[0]?.value || '',
              value: undefined,
            });
          }}
        />
        <Select
          disabled={disabled || !field}
          className="min-w-28"
          placeholder={t('conditionBuilder.operator')}
          value={node.operator || undefined}
          options={operators.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(nextOperator) => onLeaf({ ...node, operator: nextOperator, value: undefined })}
        />
        {renderValue(node, operator?.valueKind || 'text', field, onLeaf)}
      </Space>
    );
  };

  const renderValue = (
    node: ConditionLeaf,
    kind: string,
    field: QueryFieldCatalogItem | undefined,
    onLeaf: (next: ConditionLeaf) => void,
  ) => {
    if (!field || kind === 'none') return null;
    if (kind === 'number') {
      return (
        <InputNumber
          disabled={disabled}
          className="min-w-28"
          value={typeof node.value === 'number' ? node.value : undefined}
          onChange={(next) => onLeaf({ ...node, value: next ?? undefined })}
        />
      );
    }
    if (kind === 'bool') {
      return (
        <Select
          disabled={disabled}
          className="min-w-24"
          value={typeof node.value === 'boolean' ? String(node.value) : undefined}
          options={[
            { value: 'true', label: t('common.yes') },
            { value: 'false', label: t('common.no') },
          ]}
          onChange={(next) => onLeaf({ ...node, value: next === 'true' })}
        />
      );
    }
    if (kind === 'enum') {
      return (
        <Select
          disabled={disabled}
          mode="multiple"
          className="min-w-40"
          value={Array.isArray(node.value) ? node.value.map(String) : []}
          options={field.options}
          onChange={(next) => onLeaf({ ...node, value: next })}
        />
      );
    }
    if (kind === 'time' || kind === 'range') {
      const start = kind === 'range' && node.value && typeof node.value === 'object'
        ? (node.value as { start?: string }).start
        : typeof node.value === 'string' ? node.value : undefined;
      const end = kind === 'range' && node.value && typeof node.value === 'object'
        ? (node.value as { end?: string }).end
        : undefined;
      return (
        <Space>
          <DatePicker
            disabled={disabled}
            showTime
            value={start ? dayjs(start) : null}
            onChange={(next) => {
              const text = next ? next.format(TIME_FORMAT) : '';
              onLeaf({
                ...node,
                value: kind === 'range' ? { start: text, end: end || '' } : text,
              });
            }}
          />
          {kind === 'range' && (
            <DatePicker
              disabled={disabled}
              showTime
              value={end ? dayjs(end) : null}
              onChange={(next) => onLeaf({
                ...node,
                value: { start: start || '', end: next ? next.format(TIME_FORMAT) : '' },
              })}
            />
          )}
        </Space>
      );
    }
    return (
      <Input
        disabled={disabled}
        className="min-w-36"
        value={typeof node.value === 'string' ? node.value : ''}
        onChange={(event) => onLeaf({ ...node, value: event.target.value })}
      />
    );
  };

  const renderGroup = (node: ConditionGroup, onGroup: (next: ConditionGroup) => void, depth: number) => (
    <div className="flex flex-col gap-2 rounded border border-[var(--color-border-2)] p-2">
      <Space wrap>
        <Select
          disabled={disabled}
          value={node.logic}
          options={[
            { value: 'and', label: t('conditionBuilder.and') },
            { value: 'or', label: t('conditionBuilder.or') },
          ]}
          onChange={(logic) => onGroup({ ...node, logic })}
        />
        <Button
          disabled={disabled}
          onClick={() => onGroup({
            ...node,
            children: [...node.children, { scope: 'global', attr_id: '', operator: '', value: undefined }],
          })}
        >
          {t('conditionBuilder.addCondition')}
        </Button>
        {depth < 4 && (
          <Button
            disabled={disabled}
            onClick={() => onGroup({
              ...node,
              children: [...node.children, emptyConditionGroup()],
            })}
          >
            {t('conditionBuilder.addGroup')}
          </Button>
        )}
      </Space>
      {node.children.map((child, index) => {
        const replace = (next: ConditionNode) => {
          const children = node.children.slice();
          children[index] = next;
          onGroup({ ...node, children });
        };
        return (
          <div key={`${depth}-${index}`} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {isConditionGroup(child)
                ? renderGroup(child, replace, depth + 1)
                : renderLeaf(child, replace)}
            </div>
            <Button
              disabled={disabled}
              onClick={() => onGroup({ ...node, children: node.children.filter((_, childIndex) => childIndex !== index) })}
            >
              {t('conditionBuilder.remove')}
            </Button>
          </div>
        );
      })}
    </div>
  );

  if (!group) {
    return (
      <Button disabled={disabled} onClick={() => update(emptyConditionGroup())}>
        {t('conditionBuilder.reset')}
      </Button>
    );
  }

  const labels = {
    and: t('conditionBuilder.and'),
    or: t('conditionBuilder.or'),
    global: t('conditionBuilder.global'),
    missing: t('conditionBuilder.missing'),
  };

  return (
    <div className="flex flex-col gap-2">
      {catalogReady ? null : <span className="text-[var(--color-text-3)]">{t('conditionBuilder.loading')}</span>}
      <span className="text-xs text-[var(--color-text-3)]">{t('conditionBuilder.globalIdentity')}</span>
      {renderGroup(group, update, 1)}
      <Input.TextArea
        readOnly
        value={previewCondition(group, catalog, labels)}
        placeholder={t('conditionBuilder.preview')}
        autoSize={{ minRows: 1, maxRows: 4 }}
      />
    </div>
  );
};

export default ConditionTreeEditor;
