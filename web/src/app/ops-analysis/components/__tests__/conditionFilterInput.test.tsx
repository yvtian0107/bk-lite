import React, { useState } from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConditionFilterInput from '@/app/ops-analysis/components/conditionFilterInput';
import type { ConditionFieldOption } from '@/app/ops-analysis/types/dataSource';
import {
  parseConditionGroup,
  removeConditionRow,
  toggleConditionLogic,
} from '@/app/ops-analysis/utils/conditionFilter';
import { processDataSourceFormParamsForSubmit } from '@/app/ops-analysis/utils/dataSourceFormParams';
import { processDataSourceParams } from '@/app/ops-analysis/utils/widgetDataTransform';
import { parseOrderValue, serializeOrderValue } from '@/app/ops-analysis/utils/orderValue';

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(cleanup);

const fields: ConditionFieldOption[] = [
  { value: 'name', label: '名称', valueType: 'string' },
  { value: 'cpu', label: '核数', valueType: 'number' },
  { value: 'os', label: '系统', valueType: 'enum', options: [{ label: 'Linux', value: 'linux' }] },
];

const saved = {
  logic: 'OR' as const,
  items: [
    { field: 'name', op: 'eq', value: 'web' },
    { field: 'cpu', op: 'gt', value: 4 },
    { field: 'os', op: 'eq', value: 'linux' },
  ],
};

const Harness = ({ initial }: { initial: unknown }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ConditionFilterInput value={value} onChange={setValue} fields={fields} />
      <pre data-testid="stored">{JSON.stringify(value)}</pre>
    </>
  );
};

const stored = () => JSON.parse(screen.getByTestId('stored').textContent || '{}');

describe('condition filter rows can be deleted', () => {
  it('deletes a middle row and keeps the group logic and the other rows', () => {
    render(<Harness initial={saved} />);
    const buttons = screen.getAllByRole('button', { name: 'dashboard.conditionFilter.delete' });
    fireEvent.click(buttons[1]);
    const next = stored();
    expect(next.logic).toBe('OR');
    expect(next.items).toEqual([
      { field: 'name', op: 'eq', value: 'web' },
      { field: 'os', op: 'eq', value: 'linux' },
    ]);
  });

  it('submits an empty condition group after the last row is deleted', () => {
    render(<Harness initial={saved} />);
    while (screen.queryAllByRole('button', { name: 'dashboard.conditionFilter.delete' }).length > 0) {
      fireEvent.click(screen.getAllByRole('button', { name: 'dashboard.conditionFilter.delete' })[0]);
    }
    expect(stored()).toEqual({ logic: 'OR', items: [] });
    const submitted = processDataSourceFormParamsForSubmit(
      { filters: stored() },
      [{
        name: 'filters',
        alias_name: '条件过滤',
        type: 'conditionFilter',
        filterType: 'params',
        value: null,
      }],
    );
    expect(submitted[0].value).toEqual({ logic: 'OR', items: [] });
    const request = processDataSourceParams({
      sourceParams: submitted,
      chartType: 'table',
    });
    expect(request.filters).toEqual({ logic: 'OR', items: [] });
  });

  it('deletes rows that were restored from a saved condition group', () => {
    const restored = parseConditionGroup(JSON.parse(JSON.stringify(saved)));
    const withoutMiddle = removeConditionRow(restored, 1);
    expect(withoutMiddle.logic).toBe('OR');
    expect(withoutMiddle.items.map((item) => item.field)).toEqual(['name', 'os']);
    expect(toggleConditionLogic(withoutMiddle).logic).toBe('AND');
    render(<Harness initial={restored} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'dashboard.conditionFilter.delete' })[0]);
    expect(stored().items.map((item: { field: string }) => item.field)).toEqual(['cpu', 'os']);
  });
});

describe('order value', () => {
  it('serializes the field and direction and echoes an old plain value', () => {
    expect(serializeOrderValue('created_at', true)).toBe('-created_at');
    expect(serializeOrderValue('name', false)).toBe('name');
    expect(parseOrderValue('-inst_name')).toEqual({ field: 'inst_name', descending: true });
    expect(parseOrderValue('legacy_field')).toEqual({ field: 'legacy_field', descending: false });
  });
});
