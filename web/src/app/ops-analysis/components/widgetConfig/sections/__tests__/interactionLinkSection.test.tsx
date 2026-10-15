import React from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, Form } from 'antd';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import InteractionLinkSection from '@/app/ops-analysis/components/widgetConfig/sections/interactionLinkSection';

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

const translate = (key: string, fallback?: string) => fallback ?? key;

const KindValue = () => {
  const form = Form.useFormInstance();
  const kind = Form.useWatch(['interaction', 'kind'], form);
  return <div data-testid="kind">{kind}</div>;
};

const renderSection = (chartType: string, kind = 'title') => {
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Form
        layout="vertical"
        initialValues={{
          interaction: { kind, name: '', url: '', openMode: 'sameTab' },
        }}
      >
        <InteractionLinkSection
          t={translate}
          chartType={chartType}
          definitions={[]}
          rawData={null}
        />
        <KindValue />
      </Form>
    </ConfigProvider>,
  );
};

describe('InteractionLinkSection', () => {
  it('数据链接组件用分段选择器，说明只出现在问号提示里', async () => {
    const user = userEvent.setup();
    renderSection('line');

    expect(screen.queryByRole('heading', { name: '交互' })).toBeNull();
    expect(screen.getByText('链接类型')).toBeTruthy();
    expect(screen.queryByText('在标题旁显示图标。')).toBeNull();
    expect(screen.queryByText('输入 $ 选择要带上的值')).toBeNull();
    expect(screen.queryByText('输入 $ 插入筛选')).toBeNull();

    expect(screen.getByRole('radio', { name: '标题链接' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '数据链接' })).toBeTruthy();
    const groups = document.querySelectorAll('.ant-segmented');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.className).not.toContain('ant-segmented-sm');
    expect(groups[1]?.className).toContain('ant-segmented-sm');

    const labels = [...document.querySelectorAll('.ant-form-item-label')].map((node) => node.textContent);
    expect(labels).toEqual(['名称', '目标 URL', '打开方式']);
    const urlLabel = screen.getByText('目标 URL').closest('label');
    expect(urlLabel?.className).toContain('ant-form-item-required');
    expect(screen.getByText('名称').closest('label')?.className).not.toContain('ant-form-item-required');
    expect(screen.getByPlaceholderText('输入 URL，键入 $ 插入变量')).toBeTruthy();

    await user.click(screen.getByText('数据链接'));
    await waitFor(() => {
      expect(screen.getByTestId('kind').textContent).toBe('data');
    });

    await user.hover(screen.getByRole('img', { name: 'question-circle' }));
    expect(await screen.findByText('标题链接：标题旁显示图标')).toBeTruthy();
    expect(screen.getByText('数据链接：点击数据点、柱、扇区或数字打开')).toBeTruthy();
  });

  it('只支持标题链接的组件不显示分段选择器，并把 kind 固定为 title', async () => {
    const user = userEvent.setup();
    renderSection('text', 'data');

    expect(screen.getByText('标题链接')).toBeTruthy();
    expect(screen.queryByText('链接类型')).toBeNull();
    expect(screen.queryByRole('radio', { name: '数据链接' })).toBeNull();
    expect(screen.queryByRole('radio', { name: '标题链接' })).toBeNull();
    expect(document.querySelectorAll('.ant-segmented')).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByTestId('kind').textContent).toBe('title');
    });

    await user.hover(screen.getByRole('img', { name: 'question-circle' }));
    expect(await screen.findByText('该组件仅支持标题链接，点击标题旁图标打开')).toBeTruthy();
  });
});
