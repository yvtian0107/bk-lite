'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from '@/utils/i18n';
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
  optionsMissingRefs?: string[];
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
  optionsMissingRefs = [],
  optionsQuerySignature = '',
  onOptionsResolved,
  selectedModelIds = [],
  analysisMode = '',
  metrics,
  resultEmpty = false,
  onFocusModels,
}) => {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const state = useParamInputOptions(inputConfig, { suppressErrorNotification: true }, {
    reloadKey: `${optionsQuerySignature}|${attempt}`,
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

  const blocked = optionsBlocked || state.status === 'blocked';
  const failed = state.status === 'error' && 'errorMessage' in state && Boolean(state.errorMessage);
  const catalogReady = !blocked && (
    state.status === 'success' || (state.status === 'error' && !('errorMessage' in state && state.errorMessage))
  );
  const catalog = readFieldCatalog(state.status === 'success' ? state.options : []);
  const needsModel = optionsMissingRefs.length === 0 || optionsMissingRefs.includes('model_ids');

  if (blocked) {
    return (
      <p className="m-0 text-xs text-[var(--color-text-3)]">
        {optionsBlockReason === 'invalid'
          ? t('paramInput.dynamic.invalidUpstream', '查询入参无法对应到唯一的上游筛选')
          : needsModel
            ? t('conditionBuilder.needModel', '请先选择模型')
            : t('paramInput.dynamic.upstreamRequired', '请先选择上游')}
      </p>
    );
  }
  if (failed) {
    return (
      <div className="flex items-center gap-2">
        <p className="m-0 text-xs text-[var(--color-fail)]">{t('conditionBuilder.loadFailed', '属性加载失败')}</p>
        <Button size="small" onClick={() => setAttempt((current) => current + 1)}>
          {t('conditionBuilder.retry', '重试')}
        </Button>
      </div>
    );
  }
  if (!catalogReady) {
    return <span className="text-xs text-[var(--color-text-3)]">{t('conditionBuilder.loading', '正在加载属性')}</span>;
  }

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
