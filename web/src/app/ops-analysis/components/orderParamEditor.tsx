'use client';

import React from 'react';
import { Select, Space, Switch } from 'antd';
import { useTranslation } from '@/utils/i18n';
import type { OrderChoice } from '@/app/ops-analysis/utils/conditionTree';

interface OrderParamEditorProps {
  value?: unknown;
  onChange?: (value: string) => void;
  disabled?: boolean;
  choices: OrderChoice[];
  catalogReady: boolean;
}

const OrderParamEditor: React.FC<OrderParamEditorProps> = ({
  value,
  onChange,
  disabled = false,
  choices,
  catalogReady,
}) => {
  const { t } = useTranslation();
  const text = typeof value === 'string' ? value.trim() : '';
  const descending = text.startsWith('-');
  const field = descending ? text.slice(1) : text;
  const known = choices.some((item) => item.key === field);
  const options = choices.map((item) => ({ value: item.key, label: item.label }));
  if (field && !known) {
    options.push({ value: field, label: `${field}（${t('orderBuilder.stale')}）` });
  }

  const write = (nextField: string, nextDescending: boolean) => {
    if (!nextField) {
      onChange?.('');
      return;
    }
    onChange?.(nextDescending ? `-${nextField}` : nextField);
  };

  return (
    <Space wrap className="w-full">
      <Select
        disabled={disabled}
        allowClear
        showSearch
        optionFilterProp="label"
        className="min-w-56"
        placeholder={t('orderBuilder.defaultOrder')}
        value={field || undefined}
        options={options}
        loading={!catalogReady}
        onChange={(next) => write(next ? String(next) : '', descending)}
      />
      <Switch
        disabled={disabled || !field}
        checked={Boolean(field) && descending}
        checkedChildren={t('orderBuilder.descending')}
        unCheckedChildren={t('orderBuilder.ascending')}
        aria-label={t('orderBuilder.direction')}
        onChange={(checked) => write(field, checked)}
      />
    </Space>
  );
};

export default OrderParamEditor;
