import React, { useEffect } from 'react';
import type { ValueConfig } from '@/app/ops-analysis/components/ops-analysis-widgets';
import ChartEmptyState from '@/components/chart-empty-state';
import MarkdownRenderer from '@/components/markdown';
import AutoScrollRegion from '@/app/ops-analysis/components/widgets/shared/AutoScrollRegion';

export interface OpsAnalysisTextPanelProps {
  rawData?: unknown;
  loading?: boolean;
  config?: ValueConfig;
  onReady?: (ready: boolean) => void;
}

const OpsAnalysisTextPanel: React.FC<OpsAnalysisTextPanelProps> = ({ config, onReady }) => {
  const content = config?.content || '';

  useEffect(() => {
    onReady?.(true);
  }, [onReady]);

  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center">
        <ChartEmptyState compact />
      </div>
    );
  }

  return (
    <AutoScrollRegion
      config={config}
      scrollPort
      className="h-full w-full overflow-auto px-3 py-2 text-sm leading-relaxed text-(--color-text-1)"
    >
      <MarkdownRenderer content={content} />
    </AutoScrollRegion>
  );
};

export default OpsAnalysisTextPanel;
