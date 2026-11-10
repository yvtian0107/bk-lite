'use client';

import React, { useEffect, useState } from 'react';
import type { OrderFieldOption } from '@/app/ops-analysis/types/dataSource';
import { useDataSourceApi } from '@/app/ops-analysis/api/dataSource';
import OrderInput from '@/app/ops-analysis/components/orderInput';
import { loadConditionModelFields } from '@/app/ops-analysis/components/conditionFilterControl';

interface OrderControlProps {
  value?: unknown;
  onChange?: (value: string) => void;
  fields: OrderFieldOption[];
  modelParam?: string;
  includeModelAttrsInModes?: string[];
  formParams?: Record<string, unknown>;
  analysisMode?: string;
  queryObject?: string;
  disabled?: boolean;
}

const OrderControl: React.FC<OrderControlProps> = ({
  value,
  onChange,
  fields,
  modelParam,
  includeModelAttrsInModes,
  formParams,
  analysisMode,
  queryObject = '',
  disabled = false,
}) => {
  const api = useDataSourceApi();
  const [modelFields, setModelFields] = useState<OrderFieldOption[]>([]);
  const visible = fields.filter((field) => {
    if (field.modes?.length && analysisMode && !field.modes.includes(analysisMode)) return false;
    if (field.query_objects?.length && queryObject && !field.query_objects.includes(queryObject)) return false;
    return true;
  });

  useEffect(() => {
    const modelId = modelParam ? formParams?.[modelParam] : '';
    const shouldLoad = Boolean(
      modelParam
      && modelId
      && (!includeModelAttrsInModes?.length || (analysisMode && includeModelAttrsInModes.includes(analysisMode))),
    );
    if (!shouldLoad) {
      setModelFields([]);
      return undefined;
    }
    let cancelled = false;
    void loadConditionModelFields(api, String(modelId)).then((loaded) => {
      if (!cancelled) {
        setModelFields(loaded.map((field) => ({ value: field.value, label: field.label })));
      }
    }).catch(() => {
      if (!cancelled) setModelFields([]);
    });
    return () => {
      cancelled = true;
    };
  }, [analysisMode, api, formParams, includeModelAttrsInModes, modelParam]);

  const merged = [...visible];
  modelFields.forEach((field) => {
    if (!merged.some((item) => item.value === field.value)) merged.push(field);
  });

  return (
    <OrderInput
      value={value}
      onChange={onChange}
      fields={merged}
      disabled={disabled}
    />
  );
};

export default OrderControl;
