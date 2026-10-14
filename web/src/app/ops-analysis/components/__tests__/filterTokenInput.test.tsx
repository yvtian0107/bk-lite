import React, { useState } from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FilterTokenInput } from '@/app/ops-analysis/components/filterTokenInput';
import type { UnifiedFilterDefinition } from '@/app/ops-analysis/types/dashBoard';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

const biz: UnifiedFilterDefinition = {
  id: 'biz__string',
  key: 'biz',
  name: '业务',
  type: 'string',
  order: 1,
  enabled: true,
};

const disabledBiz: UnifiedFilterDefinition = {
  ...biz,
  id: 'biz__number',
  type: 'number',
  name: '业务数',
  enabled: false,
  order: 2,
};

const translate = (
  key: string,
  fallback?: string,
  values?: Record<string, string | number>,
) => {
  if (key === 'dashboard.filterTokenOption' && values) {
    return `${values.name}（${values.token} · ${values.type}）`;
  }
  if (key === 'dashboard.filterTokenTypeString') return '文本';
  if (key === 'dashboard.filterTokenHint') return '输入 $ 插入筛选';
  return fallback ?? key;
};

const Harness = () => {
  const [value, setValue] = useState('');
  return (
    <FilterTokenInput
      t={translate}
      value={value}
      onChange={setValue}
      definitions={[biz, disabledBiz]}
    />
  );
};

describe('FilterTokenInput', () => {
  it('输入 $ 后插入启用筛选的变量，并显示提示', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText('输入 $ 插入筛选')).toBeTruthy();
    await user.type(screen.getByRole('textbox'), '$');

    const option = await screen.findByRole('option', { name: '业务（$biz$ · 文本）' });
    expect(screen.queryByRole('option', { name: /业务数/ })).toBeNull();
    await user.click(option);

    expect(screen.getByRole('textbox')).toHaveProperty('value', '$biz$');
  });
});
