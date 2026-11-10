'use client';

import React, { useMemo } from 'react';
import { Button, Input, InputNumber, Select } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { ConditionFieldOption } from '@/app/ops-analysis/types/dataSource';
import {
  addConditionRow,
  operatorsForFieldType,
  parseConditionGroup,
  removeConditionRow,
  toggleConditionLogic,
  updateConditionRow,
  type ConditionGroup,
} from '@/app/ops-analysis/utils/conditionFilter';
import { useTranslation } from '@/utils/i18n';

interface ConditionFilterInputProps {
  value?: unknown;
  onChange?: (value: ConditionGroup) => void;
  fields: ConditionFieldOption[];
  queryObject?: string;
  disabled?: boolean;
}

const operatorLabel = (op: string, t: (key: string) => string) => {
  if (op === 'eq') return t('dashboard.conditionFilter.eq');
  if (op === 'ne') return t('dashboard.conditionFilter.ne');
  if (op === 'contains') return t('dashboard.conditionFilter.contains');
  if (op === 'empty') return t('dashboard.conditionFilter.empty');
  if (op === 'gt') return t('dashboard.conditionFilter.gt');
  if (op === 'gte') return t('dashboard.conditionFilter.gte');
  if (op === 'lt') return t('dashboard.conditionFilter.lt');
  if (op === 'lte') return t('dashboard.conditionFilter.lte');
  if (op === 'in') return t('dashboard.conditionFilter.in');
  return op;
};

const ConditionFilterInput: React.FC<ConditionFilterInputProps> = ({
  value,
  onChange,
  fields,
  queryObject = '',
  disabled = false,
}) => {
  const { t } = useTranslation();
  const group = useMemo(() => parseConditionGroup(value), [value]);
  const fieldMap = useMemo(
    () => new Map(fields.map((field) => [field.value, field])),
    [fields],
  );
  const emit = (next: ConditionGroup) => onChange?.(next);

  return (
    <div className="flex w-full flex-col gap-2">
      {group.items.map((item, index) => {
        const field = fieldMap.get(String(item.field || ''));
        const valueType = field?.valueType || 'string';
        const operators = operatorsForFieldType(valueType);
        const multiple = item.op === 'in';
        return (
          <div key={`${item.field || 'row'}-${index}`} className="flex flex-col gap-2">
            {index > 0 && (
              <button
                type="button"
                className="self-start text-xs text-[var(--color-primary)]"
                disabled={disabled}
                onClick={() => emit(toggleConditionLogic(group))}
              >
                {group.logic === 'OR'
                  ? t('dashboard.conditionFilter.or')
                  : t('dashboard.conditionFilter.and')}
              </button>
            )}
            <div className="flex items-center gap-2">
              <Select
                className="min-w-0 flex-1"
                disabled={disabled || fields.length <= 1}
                placeholder={t('dashboard.conditionFilter.field')}
                value={item.field || undefined}
                options={fields.map((option) => ({ label: option.label, value: option.value }))}
                onChange={(nextField) => {
                  const next = fieldMap.get(String(nextField));
                  const nextOps = operatorsForFieldType(next?.valueType);
                  emit(updateConditionRow(group, index, {
                    field: String(nextField),
                    op: nextOps[0],
                    value: undefined,
                  }));
                }}
              />
              <Select
                className="w-[108px]"
                disabled={disabled}
                value={item.op || undefined}
                options={operators.map((op) => ({ label: operatorLabel(op, t), value: op }))}
                onChange={(op) => emit(updateConditionRow(group, index, { op, value: undefined }))}
              />
              {item.op === 'empty' ? <div className="min-w-0 flex-1" /> : null}
              {item.op !== 'empty' && valueType === 'number' ? (
                <InputNumber
                  className="min-w-0 flex-1"
                  disabled={disabled}
                  value={typeof item.value === 'number' ? item.value : undefined}
                  onChange={(next) => emit(updateConditionRow(group, index, { value: next }))}
                />
              ) : null}
              {item.op !== 'empty' && valueType === 'enum' ? (
                <Select
                  className="min-w-0 flex-1"
                  disabled={disabled}
                  mode={multiple ? 'multiple' : undefined}
                  value={multiple ? (Array.isArray(item.value) ? item.value : []) : item.value}
                  options={(field?.options || []).filter((option) => (
                    !queryObject || !option.query_objects?.length || option.query_objects.includes(queryObject)
                  )).map((option) => ({
                    label: option.label,
                    value: option.value,
                  }))}
                  onChange={(next) => emit(updateConditionRow(group, index, { value: next }))}
                />
              ) : null}
              {item.op !== 'empty' && valueType === 'string' ? (
                <Input
                  className="min-w-0 flex-1"
                  disabled={disabled}
                  value={item.value === undefined || item.value === null ? '' : String(item.value)}
                  onChange={(event) => emit(updateConditionRow(group, index, { value: event.target.value }))}
                />
              ) : null}
              <Button
                type="text"
                aria-label={t('dashboard.conditionFilter.delete')}
                icon={<DeleteOutlined />}
                disabled={disabled}
                onClick={() => emit(removeConditionRow(group, index))}
              />
            </div>
          </div>
        );
      })}
      <Button
        type="dashed"
        className="self-start"
        icon={<PlusOutlined />}
        disabled={disabled}
        onClick={() => emit(addConditionRow(group, fields.length === 1 ? fields[0] : undefined))}
      >
        {t('dashboard.conditionFilter.add')}
      </Button>
    </div>
  );
};

export default ConditionFilterInput;
