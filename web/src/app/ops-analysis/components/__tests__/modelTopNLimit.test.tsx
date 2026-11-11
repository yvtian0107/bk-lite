import React, { useEffect, useState } from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button, Form } from 'antd';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import DataSourceParamsConfig from '@/app/ops-analysis/components/paramsConfig';
import type { DatasourceItem, ParamItem } from '@/app/ops-analysis/types/dataSource';

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => ({
    getDataSourceList: vi.fn(async () => []),
    getSourceDataByApiId: vi.fn(async () => ({ data: [] })),
  }),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) => {
      const template = fallback || key;
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values?.[name] ?? ''));
    },
  }),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(cleanup);

const source = {
  id: 54,
  name: 'CMDB 模型通用查询',
  params: [
    {
      name: 'analysis_mode',
      alias_name: '分析方式',
      type: 'string',
      filterType: 'params',
      value: 'detail',
      hidden: true,
      inputConfig: {
        control: 'select',
        optionsSource: {
          type: 'static',
          staticItems: [
            { label: '明细', value: 'detail', charts: ['table'], result: { structure: 'table' } },
            { label: '计数', value: 'count', charts: ['single'], result: { structure: 'value' } },
            { label: '分布', value: 'distribution', charts: ['bar', 'pie', 'topN'], result: { structure: 'category' } },
          ],
        },
      },
    },
    {
      name: 'top_n',
      alias_name: '展示前几名',
      type: 'number',
      filterType: 'params',
      value: 10,
      integer: true,
      maximum: 500,
      required: true,
      visible_modes: ['distribution'],
      visible_charts: ['topN'],
    },
  ] as ParamItem[],
} as DatasourceItem;

const Harness = () => {
  const [form] = Form.useForm();
  const [message, setMessage] = useState('');
  const [stored, setStored] = useState('');
  useEffect(() => {
    form.setFieldsValue({ chartType: 'topN', params: { analysis_mode: 'detail', top_n: 10 } });
  }, [form]);
  return (
    <Form form={form} layout="vertical">
      <DataSourceParamsConfig selectedDataSource={source} />
      <Button onClick={() => form.setFieldValue('chartType', 'bar')}>切到柱状图</Button>
      <Button onClick={() => form.setFieldValue('chartType', 'topN')}>切回排行榜</Button>
      <Button
        onClick={() => {
          setStored(String(form.getFieldValue(['params', 'top_n'])));
        }}
      >
        读取名次
      </Button>
      <Button
        onClick={async () => {
          try {
            await form.validateFields();
            setMessage('ok');
          } catch (error) {
            const fields = (error as { errorFields?: Array<{ errors?: string[] }> }).errorFields;
            setMessage(fields?.[0]?.errors?.[0] || 'failed');
          }
        }}
      >
        校验名次
      </Button>
      <div data-testid="stored">{stored}</div>
      <div data-testid="message">{message}</div>
    </Form>
  );
};

describe('model ranking limit control', () => {
  it('shows the limit only on the ranking chart and keeps the value across switches', async () => {
    render(<Harness />);
    const input = await screen.findByRole('spinbutton');
    expect((input as HTMLInputElement).value).toBe('10');
    expect(screen.getByText('展示前几名')).toBeTruthy();

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '切到柱状图' }));
    await waitFor(() => {
      expect(screen.queryByRole('spinbutton')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: '读取名次' }));
    expect(screen.getByTestId('stored').textContent).toBe('5');

    fireEvent.click(screen.getByRole('button', { name: '切回排行榜' }));
    const restored = await screen.findByRole('spinbutton');
    expect((restored as HTMLInputElement).value).toBe('5');
  });

  it('rejects zero, decimals and values above the group limit', async () => {
    render(<Harness />);
    const input = await screen.findByRole('spinbutton');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '校验名次' }));
    await waitFor(() => {
      expect(screen.getByTestId('message').textContent).toBe('展示前几名必须是 1 到 500 的正整数');
    });

    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '校验名次' }));
    await waitFor(() => {
      expect(screen.getByTestId('message').textContent).toBe('展示前几名必须是 1 到 500 的正整数');
    });

    fireEvent.change(input, { target: { value: '501' } });
    fireEvent.click(screen.getByRole('button', { name: '校验名次' }));
    await waitFor(() => {
      expect(screen.getByTestId('message').textContent).toBe('展示前几名必须是 1 到 500 的正整数');
    });

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '校验名次' }));
    await waitFor(() => {
      expect(screen.getByTestId('message').textContent).toBe('ok');
    });
  });
});
