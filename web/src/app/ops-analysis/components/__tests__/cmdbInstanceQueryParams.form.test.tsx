/**
 * 夹具：运营分析组件配置里真实使用的 DataSourceParamsConfig。
 * 选项是静态夹具，不是 Neo4j / NATS 的真实模型。
 */
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Form } from 'antd';

import DataSourceParamsConfig from '@/app/ops-analysis/components/paramsConfig';
import type { DatasourceItem, InputOption } from '@/app/ops-analysis/types/dataSource';
import { processDataSourceParams } from '@/app/ops-analysis/utils/widgetDataTransform';

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => ({
    getDataSourceList: vi.fn(async () => []),
    getSourceDataByApiId: vi.fn(),
  }),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, string>) => {
      const template = fallback || key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? '');
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
});

const capacity = (modelId: string, modelName: string, unit: string): InputOption => ({
  value: `${modelId}:capacity`,
  label: `${modelName} · 容量`,
  extra: {
    kind: 'attribute',
    model_id: modelId,
    model_name: modelName,
    attr_id: 'capacity',
    attr_type: 'int',
    unit,
    operators: [{ value: 'int>', label: '大于', value_kind: 'number' }],
    options: [],
    funcs: [{ value: 'sum', label: '求和' }, { value: 'avg', label: '平均' }],
  },
});

const fixtureSource = {
  id: 48,
  name: 'CMDB 实例查询',
  rest_api: 'cmdb/query_model_instances',
  params: [
    {
      name: 'analysis_mode',
      alias_name: '分析方式',
      type: 'string',
      filterType: 'params',
      value: 'list',
      required: true,
      inputConfig: {
        control: 'select',
        optionsSource: {
          type: 'static',
          staticItems: [
            { label: '明细', value: 'list' },
            { label: '数值聚合', value: 'aggregate' },
          ],
        },
      },
    },
    {
      name: 'classification_ids',
      alias_name: '分类',
      type: 'string',
      filterType: 'params',
      value: [],
      inputConfig: {
        control: 'select',
        multiple: true,
        optionsSource: {
          type: 'static',
          staticItems: [
            { label: '计算', value: 'compute' },
            { label: '业务', value: 'biz' },
          ],
        },
      },
    },
    {
      name: 'model_ids',
      alias_name: '模型',
      type: 'string',
      filterType: 'params',
      value: [],
      inputConfig: {
        control: 'select',
        multiple: true,
        missingOptionPolicy: 'retain',
        optionsSource: {
          type: 'static',
          staticItems: [
            { label: '计算 / 主机 · host', value: 'host' },
            { label: '业务 / 应用 · app', value: 'app' },
          ],
        },
      },
    },
    {
      name: 'conditions',
      alias_name: '条件',
      type: 'object',
      filterType: 'params',
      value: { logic: 'and', children: [] },
      inputConfig: {
        control: 'condition',
        optionsSource: {
          type: 'static',
          staticItems: [capacity('host', '主机', 'GB'), capacity('app', '应用', '个')],
        },
      },
    },
    {
      name: 'order',
      alias_name: '排序',
      type: 'string',
      filterType: 'params',
      value: '',
      formSection: 'more',
      inputConfig: {
        control: 'order',
        optionsSource: {
          type: 'static',
          staticItems: [
            { label: '实例名', value: 'inst_name', extra: { orderable: true, order_modes: ['list'], kind: 'order' } },
            { label: '数量', value: 'count', extra: { orderable: true, order_modes: ['distribution'], kind: 'order' } },
          ],
        },
      },
    },
    {
      name: 'metrics',
      alias_name: '聚合指标',
      type: 'object',
      filterType: 'params',
      value: [],
      visibleWhen: { param: 'analysis_mode', in: ['aggregate'] },
      requiredWhen: { param: 'analysis_mode', in: ['aggregate'] },
      inputConfig: {
        control: 'fieldGroup',
        variant: 'metrics',
        optionsSource: {
          type: 'static',
          staticItems: [capacity('host', '主机', 'GB'), capacity('app', '应用', '个')],
        },
      },
    },
  ],
} as DatasourceItem;

const savedParams = {
  analysis_mode: 'list',
  classification_ids: ['compute', 'biz'],
  model_ids: [],
  conditions: {
    logic: 'and',
    children: [{
      scope: 'global',
      sources: ['host:capacity'],
      attr_id: 'capacity',
      operator: 'int>',
      value: 1,
    }],
  },
  metrics: [{ sources: ['host:capacity', 'app:capacity'], func: 'sum', label: '容量' }],
};

const QueryForm = ({ initialParams }: { initialParams: Record<string, unknown> }) => {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={{ params: initialParams }}>
      <DataSourceParamsConfig
        selectedDataSource={fixtureSource}
        includeFilterTypes={['params']}
      />
      <button type="button" onClick={() => form.validateFields()}>
        validate
      </button>
      <Form.Item shouldUpdate noStyle>
        {() => (
          <pre data-testid="form-params">{JSON.stringify(form.getFieldsValue(true)?.params ?? {})}</pre>
        )}
      </Form.Item>
    </Form>
  );
};

const readParams = () => JSON.parse(screen.getByTestId('form-params').textContent || '{}') as Record<string, unknown>;

describe('CMDB instance query parameter form', () => {
  it('keeps a saved scope and one field identity, and omits metrics while the mode is list', async () => {
    const view = render(<QueryForm initialParams={savedParams} />);
    await waitFor(() => {
      expect(screen.getByText('conditionBuilder.legacyKept')).toBeTruthy();
    });
    expect(readParams().classification_ids).toEqual(['compute', 'biz']);
    expect(readParams().model_ids).toEqual([]);
    expect(screen.getByText(/主机 · 容量/)).toBeTruthy();
    expect(screen.queryByText(/应用 · 容量/)).toBeNull();

    view.unmount();
    render(<QueryForm initialParams={savedParams} />);
    await waitFor(() => {
      expect(readParams().conditions).toEqual(savedParams.conditions);
    });

    const submitted = processDataSourceParams({
      sourceParams: fixtureSource.params,
      userParams: readParams(),
    });
    expect(submitted.metrics).toBeUndefined();
    expect(submitted.conditions).toEqual(savedParams.conditions);
    expect(submitted.classification_ids).toEqual(['compute', 'biz']);

    const validateButton = screen.getByRole('button', { name: 'validate' });
    validateButton.click();
    await waitFor(() => {
      expect(screen.queryByText('conditionBuilder.issue.ambiguousField')).toBeNull();
    });
  });

  it('marks an ambiguous same-name global condition and does not submit hidden metrics', async () => {
    render(<QueryForm initialParams={{
      ...savedParams,
      conditions: {
        logic: 'and',
        children: [{ scope: 'global', attr_id: 'capacity', operator: 'int>', value: 1 }],
      },
    }} />);
    await waitFor(() => {
      expect(screen.getByText('conditionBuilder.legacyKept')).toBeTruthy();
    });
    screen.getByRole('button', { name: 'validate' }).click();
    await waitFor(() => {
      expect(screen.getByText('conditionBuilder.issue.ambiguousField')).toBeTruthy();
    });
    const submitted = processDataSourceParams({
      sourceParams: fixtureSource.params,
      userParams: {
        ...readParams(),
        analysis_mode: 'aggregate',
      },
    });
    expect(submitted.analysis_mode).toBe('aggregate');
    expect(submitted.metrics).toEqual(savedParams.metrics);
  });

  it('accepts empty conditions and explains the empty state before a model is chosen', async () => {
    const user = userEvent.setup();
    render(<QueryForm initialParams={{ ...savedParams, model_ids: [], conditions: undefined }} />);
    expect(screen.getByText('conditionBuilder.emptyHint')).toBeTruthy();
    await user.click(screen.getByText('conditionBuilder.emptyHint'));
    expect((screen.getByRole('button', { name: 'conditionBuilder.addCard' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('conditionBuilder.needModel')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'validate' }));
    await waitFor(() => {
      expect(screen.queryByText('conditionBuilder.issue.invalid')).toBeNull();
    });
  });

  it('does not pick the first model for a new filter card', async () => {
    const user = userEvent.setup();
    render(<QueryForm initialParams={{
      ...savedParams,
      model_ids: ['host', 'app'],
      conditions: { logic: 'and', children: [] },
    }} />);
    await user.click(screen.getByText(/conditionBuilder.allInstances/));
    await user.click(screen.getByRole('button', { name: 'conditionBuilder.addCard' }));
    expect(screen.getByText('conditionBuilder.pickModel')).toBeTruthy();
    expect(readParams().conditions).toEqual({
      logic: 'and',
      children: [{ logic: 'and', model_id: '', children: [] }],
    });
  });

  it('writes sort as a field and direction instead of free text', async () => {
    const user = userEvent.setup();
    render(<QueryForm initialParams={{ ...savedParams, conditions: { logic: 'and', children: [] }, order: '' }} />);
    await user.click(screen.getByText('更多'));
    expect(screen.queryByRole('textbox', { name: '排序' })).toBeNull();
    const orderItem = screen.getByText('排序').closest('.ant-form-item');
    if (!orderItem) throw new Error('排序');
    await user.click(within(orderItem).getByRole('combobox'));
    await user.click(await screen.findByText('实例名'));
    expect(readParams().order).toBe('inst_name');
    await user.click(screen.getByRole('switch', { name: 'orderBuilder.direction' }));
    expect(readParams().order).toBe('-inst_name');
  });

  it('names both fields when a metric merge is rejected', async () => {
    render(<QueryForm initialParams={{
      ...savedParams,
      analysis_mode: 'aggregate',
      model_ids: ['host', 'app'],
      conditions: { logic: 'and', children: [] },
      metrics: [{ sources: ['host:capacity', 'app:capacity'], func: 'sum', label: '容量' }],
    }} />);
    await waitFor(() => {
      expect(screen.getByText('主机 · 容量 和 应用 · 容量 的类型或单位不一致，不能合并')).toBeTruthy();
    });
  });
});
