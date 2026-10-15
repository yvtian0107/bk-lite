import React, { createRef } from 'react';
import '@ant-design/v5-patch-for-react-19';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, Form, type FormInstance } from 'antd';
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
  const formRef = createRef<FormInstance>();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Form
        ref={formRef}
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
  return formRef;
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

    expect(screen.getByRole('radio', { name: '无' })).toBeTruthy();
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
    expect(await screen.findByText('无：不设置跳转')).toBeTruthy();
    expect(screen.getByText('标题链接：标题旁显示图标')).toBeTruthy();
    expect(screen.getByText('数据链接：点击数据点、柱、扇区或数字打开')).toBeTruthy();
  });

  it('只支持标题链接的组件用同一分段选择器，并把数据链接收成标题链接', async () => {
    const user = userEvent.setup();
    renderSection('text', 'data');

    expect(screen.getByText('链接类型')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '无' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '标题链接' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '数据链接' })).toBeNull();
    expect(document.querySelectorAll('.ant-segmented')).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getByTestId('kind').textContent).toBe('title');
    });

    await user.hover(screen.getByRole('img', { name: 'question-circle' }));
    expect(await screen.findByText('无：不设置跳转')).toBeTruthy();
    expect(screen.getByText('该组件仅支持标题链接，点击标题旁图标打开')).toBeTruthy();
  });

  it('选无时只留提示，切回后保留已填的 URL，并可以清空输入', async () => {
    const user = userEvent.setup();
    renderSection('line', 'none');

    expect(screen.getByText('未设置交互，组件不可点击跳转')).toBeTruthy();
    expect(screen.queryByText('名称')).toBeNull();
    expect(screen.queryByText('目标 URL')).toBeNull();
    expect(screen.queryByText('打开方式')).toBeNull();
    expect(document.querySelectorAll('.ant-segmented')).toHaveLength(1);
    expect(screen.getByTestId('kind').textContent).toBe('none');

    await user.click(screen.getByText('标题链接'));
    const url = await screen.findByPlaceholderText('输入 URL，键入 $ 插入变量');
    await user.type(url, '/ops/detail');
    expect(document.querySelector('.ant-input-clear-icon')).toBeTruthy();

    await user.click(screen.getByText('无'));
    await waitFor(() => {
      expect(screen.getByText('未设置交互，组件不可点击跳转')).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText('输入 URL，键入 $ 插入变量')).toBeNull();
    expect(screen.getByTestId('kind').textContent).toBe('none');

    await user.click(screen.getByText('标题链接'));
    const restored = await screen.findByPlaceholderText('输入 URL，键入 $ 插入变量');
    expect((restored as HTMLInputElement).value).toBe('/ops/detail');

    await user.click(document.querySelector('.ant-input-clear-icon') as HTMLElement);
    await waitFor(() => {
      expect((screen.getByPlaceholderText('输入 URL，键入 $ 插入变量') as HTMLInputElement).value).toBe('');
    });
  });

  it('标题链接和数据链接必须填写 URL，选无时不拦截保存', async () => {
    const user = userEvent.setup();
    const formRef = renderSection('line', 'title');

    await act(async () => {
      await expect(formRef.current?.validateFields()).rejects.toBeTruthy();
    });
    expect(await screen.findByText('请输入 URL')).toBeTruthy();

    await user.click(screen.getByText('数据链接'));
    await user.type(screen.getByPlaceholderText('输入 URL，键入 $ 插入变量'), '   ');
    await act(async () => {
      await expect(formRef.current?.validateFields()).rejects.toBeTruthy();
    });

    await user.type(screen.getByPlaceholderText('输入 URL，键入 $ 插入变量'), '/ops');
    await act(async () => {
      await expect(formRef.current?.validateFields()).resolves.toMatchObject({
        interaction: { kind: 'data', url: '   /ops' },
      });
    });

    await user.click(screen.getByText('无'));
    await act(async () => {
      await expect(formRef.current?.validateFields()).resolves.toMatchObject({
        interaction: { kind: 'none' },
      });
    });
  });
});
