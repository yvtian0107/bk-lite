import React from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Form } from 'antd';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import DataSourceParamsConfig from '@/app/ops-analysis/components/paramsConfig';
import type { DatasourceItem, ParamItem } from '@/app/ops-analysis/types/dataSource';
import { reconcileComponentParamValue } from '@/app/ops-analysis/utils/componentParamSwitch';

const api = vi.hoisted(() => ({
  getDataSourceList: vi.fn(async () => [
    { id: 3, rest_api: 'cmdb/list_cmdb_attr_options', name: '属性' },
    { id: 4, rest_api: 'cmdb/get_model_association_options', name: '关系' },
  ]),
  getSourceDataByApiId: vi.fn(),
}));

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => api,
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'dashboard.selectClassificationFirst') return '请先选择分类';
      return key;
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

afterEach(() => {
  cleanup();
  api.getSourceDataByApiId.mockReset();
});

const classification = (name = 'classification_id'): ParamItem => ({
  name,
  alias_name: '模型分类',
  type: 'string',
  filterType: 'params',
  value: '',
  inputConfig: {
    control: 'select',
    optionsSource: {
      type: 'dynamic',
      sourceId: 1,
      valueField: 'classification_id',
      labelField: 'classification_name',
    },
  },
});

const modelSelect = (name: string, alias: string): ParamItem => ({
  name,
  alias_name: alias,
  type: 'string',
  filterType: 'params',
  value: '',
  required: true,
  inputConfig: {
    control: 'select',
    optionsSource: {
      type: 'dynamic',
      sourceId: 2,
      valueField: 'model_id',
      labelField: 'model_name',
      queryParams: { classification_id: { ref: 'classification_id' } },
      emptyUpstreamHintKey: 'dashboard.selectClassificationFirst',
    },
  },
});

const analysisMode = (): ParamItem => ({
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
      ],
    },
  },
});

const QueryForm = ({
  source,
  initialParams,
}: {
  source: DatasourceItem;
  initialParams: Record<string, unknown>;
}) => {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={{ chartType: 'table', params: initialParams }}>
      <DataSourceParamsConfig
        selectedDataSource={source}
        includeFilterTypes={['params', 'fixed']}
        globalFilters={[]}
        onParamOptionsResolved={(param, options) => {
          const current = form.getFieldValue(['params', param.name]);
          const next = reconcileComponentParamValue(current, options);
          if (next !== current) form.setFieldValue(['params', param.name], next);
        }}
      />
      <Form.Item shouldUpdate noStyle>
        {() => (
          <pre data-testid="form-params">{JSON.stringify(form.getFieldsValue(true)?.params ?? {})}</pre>
        )}
      </Form.Item>
    </Form>
  );
};

const readParams = () => JSON.parse(screen.getByTestId('form-params').textContent || '{}') as Record<string, unknown>;

const openSelect = (index: number) => {
  const select = screen.getAllByRole('combobox')[index];
  fireEvent.mouseDown(select);
};

describe('cmdb classification cascade', () => {
  it('blocks the model request until a classification is chosen', async () => {
    api.getSourceDataByApiId.mockImplementation(async (id: number) => {
      if (id === 1) {
        return { data: [{ classification_id: 'compute', classification_name: '计算' }], warnings: [] };
      }
      return { data: [{ model_id: 'host', model_name: '主机' }], warnings: [] };
    });
    render(
      <QueryForm
        source={{
          id: 21,
          name: 'CMDB 实例通用查询',
          params: [classification(), modelSelect('model_id', '模型'), analysisMode()],
        } as DatasourceItem}
        initialParams={{ classification_id: null, model_id: 'host', analysis_mode: 'detail' }}
      />,
    );

    expect(await screen.findByText('请先选择分类')).toBeTruthy();
    await waitFor(() => {
      expect(readParams().model_id).toBeNull();
    });
    expect(api.getSourceDataByApiId.mock.calls.some(([id]) => id === 2)).toBe(false);
  });

  it('lists models in the classification and clears attrs, conditions and sort when it changes', async () => {
    api.getSourceDataByApiId.mockImplementation(async (id: number, params?: { classification_id?: string; model_id?: string }) => {
      if (id === 1) {
        return {
          data: [
            { classification_id: 'compute', classification_name: '计算' },
            { classification_id: 'space', classification_name: '空间' },
          ],
          warnings: [],
        };
      }
      if (id === 2) {
        const rows = params?.classification_id === 'compute'
          ? [{ model_id: 'host', model_name: '主机' }]
          : [{ model_id: 'room', model_name: '机房' }];
        return { data: rows, warnings: [] };
      }
      if (params?.model_id === 'host') {
        return { data: [{ attr_id: 'cpu', attr_name: 'CPU', value_type: 'number', options: [] }], warnings: [] };
      }
      return { data: [], warnings: [] };
    });
    render(
      <QueryForm
        source={{
          id: 22,
          name: 'CMDB 实例通用查询',
          params: [
            classification(),
            modelSelect('model_id', '模型'),
            analysisMode(),
            {
              name: 'filters',
              alias_name: '条件过滤',
              type: 'conditionFilter',
              filterType: 'params',
              value: { logic: 'AND', items: [] },
              inputConfig: {
                control: 'conditionFilter',
                fields: { kind: 'modelAttrs', modelParam: 'model_id' },
              },
            },
            {
              name: 'order',
              alias_name: '排序',
              type: 'order',
              filterType: 'params',
              value: '',
              visible_modes: ['detail'],
              inputConfig: {
                control: 'order',
                modelParam: 'model_id',
                includeModelAttrsInModes: ['detail'],
                fields: [{ value: 'inst_name', label: '实例名', modes: ['detail'] }],
              },
            },
          ],
        } as DatasourceItem}
        initialParams={{
          classification_id: 'compute',
          model_id: 'host',
          analysis_mode: 'detail',
          filters: { logic: 'AND', items: [{ field: 'cpu', op: 'gt', value: 2 }] },
          order: '-cpu',
        }}
      />,
    );

    await waitFor(() => {
      expect(api.getSourceDataByApiId).toHaveBeenCalledWith(2, { classification_id: 'compute' }, undefined);
      expect(readParams().model_id).toBe('host');
      expect(readParams().order).toBe('-cpu');
      expect((readParams().filters as { items: unknown[] }).items).toHaveLength(1);
    });

    openSelect(0);
    fireEvent.click(await screen.findByText('空间'));
    await waitFor(() => {
      const next = readParams();
      expect(next.classification_id).toBe('space');
      expect(next.model_id).toBeNull();
      expect(next.order).toBe('');
      expect((next.filters as { items: unknown[] }).items).toEqual([]);
    });
    expect(api.getSourceDataByApiId).toHaveBeenCalledWith(2, { classification_id: 'space' }, undefined);
  });

  it('loads associations from the start model and clears them with the classification', async () => {
    api.getSourceDataByApiId.mockImplementation(async (id: number, params?: { classification_id?: string; model_id?: string }) => {
      if (id === 1) {
        return {
          data: [
            { classification_id: 'compute', classification_name: '计算' },
            { classification_id: 'space', classification_name: '空间' },
          ],
          warnings: [],
        };
      }
      if (id === 2) {
        return {
          data: params?.classification_id === 'space'
            ? [{ model_id: 'room', model_name: '机房' }]
            : [{ model_id: 'host', model_name: '主机' }],
          warnings: [],
        };
      }
      if (id === 4) {
        return {
          data: [{
            model_asst_id: 'host_belong_app',
            label: '属于应用',
            src_model_id: 'host',
            dst_model_id: 'app',
          }],
          warnings: [],
        };
      }
      if (params?.model_id === 'app') {
        return { data: [{ attr_id: 'port', attr_name: '端口', value_type: 'string', options: [] }], warnings: [] };
      }
      if (params?.model_id === 'host') {
        return { data: [{ attr_id: 'cpu', attr_name: 'CPU', value_type: 'number', options: [] }], warnings: [] };
      }
      return { data: [], warnings: [] };
    });
    render(
      <QueryForm
        source={{
          id: 23,
          name: 'CMDB 一跳关联通用查询',
          params: [
            classification(),
            modelSelect('start_model_id', '起点模型'),
            {
              name: 'model_asst_id',
              alias_name: '关系',
              type: 'string',
              filterType: 'params',
              value: '',
              required: true,
              inputConfig: {
                control: 'select',
                optionsSource: {
                  type: 'dynamic',
                  sourceId: 4,
                  valueField: 'model_asst_id',
                  labelField: 'label',
                  queryParams: { model_id: { ref: 'start_model_id' } },
                },
              },
            },
            analysisMode(),
            {
              name: 'filters',
              alias_name: '起点条件',
              type: 'conditionFilter',
              filterType: 'params',
              value: { logic: 'AND', items: [] },
              inputConfig: {
                control: 'conditionFilter',
                fields: { kind: 'modelAttrs', modelParam: 'start_model_id' },
              },
            },
            {
              name: 'end_filters',
              alias_name: '终点条件',
              type: 'conditionFilter',
              filterType: 'params',
              value: { logic: 'AND', items: [] },
              inputConfig: {
                control: 'conditionFilter',
                fields: {
                  kind: 'endModelAttrs',
                  startModelParam: 'start_model_id',
                  associationParam: 'model_asst_id',
                  directionParam: 'direction',
                },
              },
            },
          ],
        } as DatasourceItem}
        initialParams={{
          classification_id: 'compute',
          start_model_id: 'host',
          model_asst_id: 'host_belong_app',
          direction: 'out',
          analysis_mode: 'detail',
          filters: { logic: 'AND', items: [{ field: 'cpu', op: 'gt', value: 1 }] },
          end_filters: { logic: 'AND', items: [{ field: 'port', op: 'eq', value: '80' }] },
        }}
      />,
    );

    await waitFor(() => {
      expect(api.getSourceDataByApiId).toHaveBeenCalledWith(4, { model_id: 'host' }, undefined);
      expect(readParams().model_asst_id).toBe('host_belong_app');
      expect((readParams().end_filters as { items: unknown[] }).items).toHaveLength(1);
    });

    openSelect(0);
    fireEvent.click(await screen.findByText('空间'));
    await waitFor(() => {
      const next = readParams();
      expect(next.start_model_id).toBeNull();
      expect(next.model_asst_id).toBeNull();
      expect((next.filters as { items: unknown[] }).items).toEqual([]);
      expect((next.end_filters as { items: unknown[] }).items).toEqual([]);
    });
  });
});
