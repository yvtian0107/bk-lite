import { describe, expect, it } from 'vitest';

import { ChartDataTransformer } from '@/app/ops-analysis/utils/chartDataTransform';
import { readPageSlice } from '@/app/ops-analysis/utils/pageSlice';
import { validateTopNPayload } from '@/app/ops-analysis/utils/topNData';

const page = {
  count: 5,
  items: [
    { group_value: '四', count: 4 },
    { group_value: '三', count: 3 },
  ],
};

describe('page slice and chart contracts', () => {
  it('notices a page without treating a complete result as truncated', () => {
    expect(readPageSlice(page)).toEqual({ shown: 2, total: 5 });
    expect(readPageSlice({ count: 2, items: page.items })).toBeNull();
    expect(readPageSlice(page.items)).toBeNull();
  });

  it('accepts a mapped distribution page and rejects a payload the chart cannot read', () => {
    const mapping = { dimensionField: 'group_value', valueField: 'count' };
    expect(ChartDataTransformer.validatePieData(page, 'dashboard.dataFormatMismatch', mapping).isValid).toBe(true);
    expect(ChartDataTransformer.validateLineBarData(page, 'dashboard.dataFormatMismatch', mapping).isValid).toBe(true);
    expect(validateTopNPayload(page, { labelField: 'group_value', valueField: 'count' })).toBe(true);
    expect(ChartDataTransformer.validatePieData({ nope: true }, 'dashboard.dataFormatMismatch').isValid).toBe(false);
    expect(ChartDataTransformer.validateLineBarData({ nope: true }, 'dashboard.dataFormatMismatch').message)
      .toBe('dashboard.dataFormatMismatch');
    expect(validateTopNPayload({ nope: true }, { labelField: 'group_value', valueField: 'count' })).toBe(false);
  });
});
