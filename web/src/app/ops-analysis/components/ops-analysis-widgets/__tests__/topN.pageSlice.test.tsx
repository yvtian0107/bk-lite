/**
 * 默认排名按数量取全范围前几名。信封只有 count 和 items 时不再提示名次只在页内。
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import OpsAnalysisTopN from '@/app/ops-analysis/components/ops-analysis-widgets/top-n';

afterEach(() => {
  cleanup();
});

describe('OpsAnalysisTopN page notice', () => {
  it('does not mark a default count envelope as a page-local rank', () => {
    render(
      <OpsAnalysisTopN
        rawData={{
          count: 20,
          items: [{ model_id: 'host', count: 8 }],
        }}
        config={{ topNLabelField: 'model_id', topNValueField: 'count' }}
      />,
    );
    expect(screen.getByText('host')).toBeTruthy();
    expect(screen.queryByTestId('page-slice-notice')).toBeNull();
  });
});
