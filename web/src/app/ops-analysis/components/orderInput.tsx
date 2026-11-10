'use client';

import React, { useMemo } from 'react';
import { Select } from 'antd';
import type { OrderFieldOption } from '@/app/ops-analysis/types/dataSource';
import { parseOrderValue, serializeOrderValue } from '@/app/ops-analysis/utils/orderValue';
import { useTranslation } from '@/utils/i18n';

interface OrderInputProps {
  value?: unknown;
  onChange?: (value: string) => void;
  fields: OrderFieldOption[];
  disabled?: boolean;
}

const OrderInput: React.FC<OrderInputProps> = ({
  value,
  onChange,
  fields,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const parsed = parseOrderValue(value);
  const options = useMemo(() => {
    const known = fields.map((field) => ({ label: field.label, value: field.value }));
    if (parsed.field && !known.some((item) => item.value === parsed.field)) {
      known.unshift({ label: parsed.field, value: parsed.field });
    }
    return known;
  }, [fields, parsed.field]);

  return (
    <div className="flex w-full items-center gap-2">
      <Select
        className="min-w-0 flex-1"
        allowClear
        disabled={disabled}
        placeholder={t('dashboard.order.field')}
        value={parsed.field || undefined}
        options={options}
        onChange={(field) => onChange?.(serializeOrderValue(String(field || ''), parsed.descending))}
      />
      <Select
        className="w-[96px]"
        disabled={disabled || !parsed.field}
        value={parsed.descending ? 'desc' : 'asc'}
        options={[
          { label: t('dashboard.order.asc'), value: 'asc' },
          { label: t('dashboard.order.desc'), value: 'desc' },
        ]}
        onChange={(direction) => onChange?.(serializeOrderValue(parsed.field, direction === 'desc'))}
      />
    </div>
  );
};

export default OrderInput;
