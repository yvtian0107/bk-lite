'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  FilterDisplayLabelLoaders,
  useFilterDisplayLabels,
} from '@/app/ops-analysis/hooks/useFilterDisplayLabels';
import type {
  FilterValue,
  UnifiedFilterDefinition,
} from '@/app/ops-analysis/types/dashBoard';
import {
  resolveFilterTemplate,
  type FilterTemplateLabels,
} from '@/app/ops-analysis/utils/filterTemplate';

interface FilterTemplateContextValue {
  definitions: UnifiedFilterDefinition[];
  resolveDefinitions: UnifiedFilterDefinition[];
  appliedValues: Record<string, FilterValue>;
  resolveEnabled: boolean;
  labels: FilterTemplateLabels;
}

const FilterTemplateContext = createContext<FilterTemplateContextValue | null>(null);

export const FilterTemplateProvider = ({
  definitions,
  resolveDefinitions,
  appliedValues,
  resolveEnabled,
  children,
}: {
  definitions: UnifiedFilterDefinition[];
  resolveDefinitions?: UnifiedFilterDefinition[];
  appliedValues: Record<string, FilterValue>;
  resolveEnabled: boolean;
  children: ReactNode;
}) => {
  const source = resolveDefinitions ?? definitions;
  const { labels, reportDynamicLabels } = useFilterDisplayLabels(source, resolveEnabled);
  const value = useMemo<FilterTemplateContextValue>(() => ({
    definitions,
    resolveDefinitions: source,
    appliedValues,
    resolveEnabled,
    labels,
  }), [appliedValues, definitions, labels, resolveEnabled, source]);

  return (
    <FilterTemplateContext.Provider value={value}>
      <FilterDisplayLabelLoaders
        definitions={source}
        enabled={resolveEnabled}
        onUpdate={reportDynamicLabels}
      />
      {children}
    </FilterTemplateContext.Provider>
  );
};

export const useFilterTemplateVariables = () => {
  const context = useContext(FilterTemplateContext);
  return context?.definitions ?? [];
};

/** 查看态替换已应用筛选；编辑态、表单和没有提供方时保持模板原文。 */
export const useFilterTemplateText = (text?: string | null) => {
  const context = useContext(FilterTemplateContext);
  if (!text) return '';
  if (!context?.resolveEnabled) return text;
  return resolveFilterTemplate(
    text,
    context.resolveDefinitions,
    context.appliedValues,
    context.labels,
  );
};
