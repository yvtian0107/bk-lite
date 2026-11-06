/**
 * 排名收到的行数少于信封 count 时，说明名次按当前返回计算。
 * 这句话也用于默认的全范围前几名，不把名次说成一定不真实。完整数组不提示。
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zh from '@/app/ops-analysis/locales/zh.json';

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import OpsAnalysisTopN from '@/app/ops-analysis/components/ops-analysis-widgets/top-n';
import ComTopN from '@/app/ops-analysis/components/widgets/comTopN';

afterEach(() => {
  cleanup();
});

const page = {
  count: 5,
  items: [
    { model_id: 'host', count: 8 },
    { model_id: 'vm', count: 3 },
  ],
};

const expectRankNotice = () => {
  const notice = screen.getByTestId('page-slice-notice');
  expect(notice.getAttribute('data-message-key')).toBe('dashboard.topNSliceNotice');
  expect(notice.textContent).toBe('dashboard.topNSliceNotice');
  expect(notice.textContent).not.toContain('百分比');
  expect(notice.getAttribute('data-shown')).toBe('2');
  expect(notice.getAttribute('data-total')).toBe('5');
};

describe('TopN returned-row notice', () => {
  it('uses a rank sentence instead of the pie percent sentence', () => {
    expect(zh.dashboard.topNSliceNotice).toBe('当前返回 {shown} 条，共 {total} 条；名次根据当前返回数据计算。');
    expect(zh.dashboard.pageSliceNotice).toContain('百分比');
    expect(zh.dashboard.topNSliceNotice).not.toContain('百分比');
  });

  it('shows the notice for a short page and hides it for a complete array', () => {
    const config = { topNLabelField: 'model_id', topNValueField: 'count' };
    const view = render(<OpsAnalysisTopN rawData={page} config={config} />);
    expect(screen.getByText('host')).toBeTruthy();
    expectRankNotice();
    view.unmount();

    render(<ComTopN rawData={page} config={config} />);
    expectRankNotice();
    cleanup();

    render(<OpsAnalysisTopN rawData={page.items} config={config} />);
    expect(screen.queryByTestId('page-slice-notice')).toBeNull();
  });
});
