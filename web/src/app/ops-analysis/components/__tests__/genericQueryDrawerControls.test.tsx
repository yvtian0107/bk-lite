import React, { useEffect } from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Form } from 'antd';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import DataSourceParamsConfig from '@/app/ops-analysis/components/paramsConfig';
import type { DatasourceItem, ParamItem } from '@/app/ops-analysis/types/dataSource';
import { getDataSourceFormParamInitialValue } from '@/app/ops-analysis/utils/dataSourceFormParams';

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => ({
    getDataSourceList: vi.fn(async () => []),
    getSourceDataByApiId: vi.fn(async () => ({ data: [] })),
  }),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
  rest_api: 'cmdb/query_cmdb_models',
  params: [
    {
      name: 'analysis_mode',
      alias_name: '分析方式',
      type: 'string',
      filterType: 'params',
      value: 'detail',
      required: true,
      inputConfig: {
        control: 'select',
        optionsSource: {
          type: 'static',
          staticItems: [
            { label: '明细', value: 'detail', charts: ['table'], result: { structure: 'table' } },
            { label: '计数', value: 'count', charts: ['single'], result: { structure: 'value' } },
          ],
        },
      },
    },
    {
      name: 'result_filter',
      alias_name: '实例数筛选',
      type: 'conditionFilter',
      filterType: 'params',
      value: { logic: 'AND', items: [] },
      inputConfig: {
        control: 'conditionFilter',
        fields: {
          kind: 'static',
          items: [{ value: 'instance_count', label: '实例数', valueType: 'number', options: [] }],
        },
      },
      visible_modes: ['detail', 'count', 'distribution'],
    },
    {
      name: 'order',
      alias_name: '排序',
      type: 'order',
      filterType: 'params',
      value: '',
      visible_modes: ['detail', 'distribution'],
      inputConfig: {
        control: 'order',
        fields: [
          { value: 'instance_count', label: '实例数', modes: ['detail'] },
          { value: 'model_name', label: '模型名称', modes: ['detail'] },
        ],
      },
    },
    {
      name: 'page',
      alias_name: '页码',
      type: 'number',
      filterType: 'params',
      value: 1,
      visible_modes: ['detail'],
    },
    {
      name: 'page_size',
      alias_name: '每页条数',
      type: 'number',
      filterType: 'params',
      value: 20,
      visible_modes: ['detail'],
    },
  ] as ParamItem[],
} as DatasourceItem;

const Drawer = () => {
  const [form] = Form.useForm();
  useEffect(() => {
    const params: Record<string, unknown> = {};
    source.params?.forEach((param) => {
      params[param.name] = getDataSourceFormParamInitialValue(param);
    });
    form.setFieldsValue({ chartType: 'table', params });
  }, [form]);
  return (
    <div style={{ width: 320 }}>
      <Form form={form} layout="vertical">
        <DataSourceParamsConfig selectedDataSource={source} />
      </Form>
    </div>
  );
};

describe('generic query config drawer', () => {
  it('shows paging defaults and a complete condition row in a narrow form', async () => {
    render(<Drawer />);
    await waitFor(() => {
      const numbers = screen.getAllByRole('spinbutton').map((node) => (node as HTMLInputElement).value);
      expect(numbers).toEqual(expect.arrayContaining(['1', '20']));
    });
    expect(screen.getByTestId('order-field')).toBeTruthy();
    expect(screen.getByTestId('order-direction')).toBeTruthy();
    expect(screen.getByTestId('order-direction').classList.contains('ant-select-disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'dashboard.conditionFilter.add' }));
    const row = screen.getByTestId('condition-row-0');
    expect(within(row).getByText('实例数')).toBeTruthy();
    expect(within(row).getByText('dashboard.conditionFilter.gt')).toBeTruthy();
    expect(within(row).getByTestId('condition-value')).toBeTruthy();
    expect(screen.getByText('dashboard.conditionFilter.matchAll')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'dashboard.conditionFilter.or' })).toBeNull();
  });
});
