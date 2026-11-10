'use client';

import React, { useEffect, useRef } from 'react';
import type { InputControlConfig, InputOption } from '@/app/ops-analysis/types/dataSource';
import { useParamInputOptions } from '@/app/ops-analysis/hooks/useParamInputOptions';
import { readFieldCatalog, readOrderChoices } from '@/app/ops-analysis/utils/conditionTree';
import ConditionTreeEditor from '@/app/ops-analysis/components/conditionTreeEditor';
import FieldGroupEditor from '@/app/ops-analysis/components/fieldGroupEditor';
import OrderParamEditor from '@/app/ops-analysis/components/orderParamEditor';

interface CatalogParamEditorProps {
  inputConfig: Extract<InputControlConfig, { control: 'condition' | 'fieldGroup' | 'order' }>;
  value?: unknown;
  onChange?: (value: unknown) => void;
  disabled?: boolean;
  resolvedQueryParams?: Record<string, unknown>;
  optionsBlocked?: boolean;
  optionsBlockReason?: 'empty' | 'invalid';
  optionsQuerySignature?: string;
  onOptionsResolved?: (options: InputOption[]) => void;
  selectedModelIds?: string[];
  analysisMode?: string;
  metrics?: unknown;
  resultEmpty?: boolean;
  onFocusModels?: () => void;
}

export const CatalogParamEditor: React.FC<CatalogParamEditorProps> = ({
  inputConfig,
  value,
  onChange,
  disabled,
  resolvedQueryParams,
  optionsBlocked = false,
  optionsBlockReason,
  optionsQuerySignature = '',
  onOptionsResolved,
  selectedModelIds = [],
  analysisMode = '',
  metrics,
  resultEmpty = false,
  onFocusModels,
}) => {
  const state = useParamInputOptions(inputConfig, undefined, {
    reloadKey: optionsQuerySignature,
    resolvedQueryParams,
    optionsBlocked,
    optionsBlockReason,
  });
  const onOptionsResolvedRef = useRef(onOptionsResolved);
  onOptionsResolvedRef.current = onOptionsResolved;

  useEffect(() => {
    if (state.status === 'success' || (state.status === 'error' && !state.errorMessage)) {
      onOptionsResolvedRef.current?.(state.options);
    }
  }, [state.options, state.status, state.status === 'error' ? state.errorMessage : '']);

  const catalogReady = state.status === 'success' || (state.status === 'error' && !('errorMessage' in state && state.errorMessage));
  const catalog = readFieldCatalog(state.status === 'success' ? state.options : []);

  if (inputConfig.control === 'order') {
    return (
      <OrderParamEditor
        value={value}
        onChange={onChange}
        disabled={disabled}
        choices={readOrderChoices(state.status === 'success' ? state.options : [], analysisMode, metrics)}
        catalogReady={catalogReady && !optionsBlocked}
      />
    );
  }

  if (inputConfig.control === 'condition') {
    return (
      <ConditionTreeEditor
        value={value}
        onChange={onChange}
        disabled={disabled}
        catalog={catalog}
        catalogReady={catalogReady && !optionsBlocked}
        selectedModelIds={selectedModelIds}
        resultEmpty={resultEmpty}
        onFocusModels={onFocusModels}
      />
    );
  }

  return (
    <FieldGroupEditor
      value={value}
      onChange={onChange}
      disabled={disabled}
      variant={inputConfig.variant}
      catalog={catalog}
      catalogReady={catalogReady && !optionsBlocked}
    />
  );
};
