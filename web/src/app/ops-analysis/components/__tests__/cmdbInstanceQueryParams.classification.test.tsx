/**
 * 夹具：source_api.json 里的分类/模型参数，经 WidgetQueryFields 挂上。
 * jsdom 里的选项来自测试桩，不是运行中的业务页，也不是浏览器验收。
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Form } from 'antd';

import { WidgetQueryFields } from '@/app/ops-analysis/components/widgetConfig/sections/widgetDatasourceChartTypeFields';
import type { DatasourceItem, ParamItem } from '@/app/ops-analysis/types/dataSource';
import {
  missingOptionPolicyOf,
  reconcileComponentParamValue,
} from '@/app/ops-analysis/utils/componentParamSwitch';

const INSTANCE_QUERY_ID = 48;
const CLASSIFICATION_SOURCE_ID = 21;
const MODEL_SOURCE_ID = 22;

const { getSourceDataByApiId, getDataSourceList } = vi.hoisted(() => ({
  getSourceDataByApiId: vi.fn(),
  getDataSourceList: vi.fn(),
}));

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => ({
    getDataSourceList,
    getSourceDataByApiId,
  }),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, string>) => {
      const template = key === 'dataSource.paramRequired' ? '请配置{label}' : (fallback || key);
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
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
  getSourceDataByApiId.mockReset();
  getDataSourceList.mockReset();
});

const sources = JSON.parse(readFileSync(
  '/workspace/server/apps/operation_analysis/support-files/source_api.json',
  'utf8',
)) as Array<{ name?: string; rest_api?: string; params?: ParamItem[] }>;
const instanceSource = sources.find((item) => item.rest_api === 'cmdb/query_model_instances');
const classificationParam = instanceSource?.params?.find((item) => item.name === 'classification_ids');
const modelParam = instanceSource?.params?.find((item) => item.name === 'model_ids');

const source = {
  id: INSTANCE_QUERY_ID,
  name: instanceSource?.name,
  rest_api: 'cmdb/query_model_instances',
  params: [classificationParam, modelParam],
} as DatasourceItem;

const QueryForm = ({ initialParams }: { initialParams?: Record<string, unknown> }) => {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={{ params: initialParams ?? {} }}>
      <WidgetQueryFields
        t={(key: string) => key}
        selectedDataSource={source}
        effectiveDataSource={source}
        hasQueryParams
        shouldShowUnifiedFilterSection={false}
        hasUnifiedFilterBindings={false}
        previewFilterDefinitions={[]}
        filterBindings={{}}
        globalFilters={[]}
        globalFilterValues={{}}
        onFilterBindingsChange={() => undefined}
        onEditInputConfig={() => undefined}
        onParamOptionsResolved={(param, options) => {
          const current = form.getFieldValue(['params', param.name]);
          const next = reconcileComponentParamValue(current, options, missingOptionPolicyOf(param));
          if (next !== current) {
            form.setFieldValue(['params', param.name], next);
          }
        }}
      />
      <button type="button" onClick={() => { form.validateFields().catch(() => undefined); }}>
        校验
      </button>
      <Form.Item shouldUpdate noStyle>
        {() => (
          <pre data-testid="form-params">{JSON.stringify(form.getFieldsValue(true)?.params ?? {})}</pre>
        )}
      </Form.Item>
    </Form>
  );
};

const readParams = () => JSON.parse(screen.getByTestId('form-params').textContent || '{}') as {
  classification_ids?: string[];
  model_ids?: string[];
};

const installOptionApi = () => {
  getDataSourceList.mockResolvedValue([
    { id: CLASSIFICATION_SOURCE_ID, rest_api: 'cmdb/get_model_classification_options' },
    { id: MODEL_SOURCE_ID, rest_api: 'cmdb/get_model_options' },
  ]);
  getSourceDataByApiId.mockImplementation(async (sourceId: number, params: Record<string, unknown>) => {
    if (sourceId === CLASSIFICATION_SOURCE_ID) {
      return {
        data: [
          { classification_id: 'host_manage', classification_name: '逻辑主机' },
          { classification_id: 'aws', classification_name: 'AWS' },
        ],
      };
    }
    if (sourceId === MODEL_SOURCE_ID) {
      const selected = Array.isArray(params?.classification_ids) ? params.classification_ids : [];
      const rows = [
        { model_id: 'host', label: '主机 · host', classification_id: 'host_manage' },
        { model_id: 'aws_cf', label: 'AWS CloudFront分配 · aws_cf', classification_id: 'aws' },
      ];
      return {
        data: selected.length
          ? rows.filter((row) => selected.includes(row.classification_id))
          : rows,
      };
    }
    throw new Error(`unexpected source ${sourceId}`);
  });
};

const openSelect = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  const item = screen.getByText(label).closest('.ant-form-item');
  if (!item) throw new Error(label);
  await user.click(within(item).getByRole('combobox'));
};

describe('CMDB classification narrows model options and model stays required', () => {
  it('uses the source query ref, keeps a stale model, and does not query instances', async () => {
    expect(classificationParam?.inputConfig?.optionsSource).toMatchObject({
      valueField: 'classification_id',
      labelField: 'classification_name',
    });
    expect(modelParam?.required).toBe(true);
    expect(modelParam?.inputConfig?.missingOptionPolicy).toBe('retain');
    expect(modelParam?.inputConfig?.optionsSource?.queryParams).toEqual({
      classification_ids: { ref: 'classification_ids', whenEmpty: 'omit' },
    });

    installOptionApi();
    render(<QueryForm initialParams={{ classification_ids: [], model_ids: ['host'] }} />);

    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(MODEL_SOURCE_ID, {}, undefined);
    });
    expect(readParams().model_ids).toEqual(['host']);

    const user = userEvent.setup();
    await openSelect(user, '分类');
    await user.click(await screen.findByText('AWS', { selector: '.ant-select-item-option-content' }));

    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(
        MODEL_SOURCE_ID,
        { classification_ids: ['aws'] },
        undefined,
      );
    });
    expect(readParams().classification_ids).toEqual(['aws']);
    expect(readParams().model_ids).toEqual(['host']);

    const callsBeforeValidate = getSourceDataByApiId.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '校验' }));
    expect(await screen.findByText('paramInput.staleOption')).toBeTruthy();
    expect(getSourceDataByApiId.mock.calls.length).toBe(callsBeforeValidate);
    expect(getSourceDataByApiId.mock.calls.map((call) => call[0])).not.toContain(INSTANCE_QUERY_ID);
  });

  it('does not auto-select a model and blocks an empty model with a plain message', async () => {
    installOptionApi();
    render(<QueryForm />);

    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(MODEL_SOURCE_ID, {}, undefined);
    });
    expect(readParams().model_ids ?? []).toEqual([]);

    const user = userEvent.setup();
    await openSelect(user, '分类');
    await user.click(await screen.findByText('逻辑主机', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(
        MODEL_SOURCE_ID,
        { classification_ids: ['host_manage'] },
        undefined,
      );
    });
    expect(readParams().model_ids ?? []).toEqual([]);

    await user.click(screen.getByRole('button', { name: '校验' }));
    expect(await screen.findByText('请配置模型')).toBeTruthy();
    expect(getSourceDataByApiId.mock.calls.map((call) => call[0])).not.toContain(INSTANCE_QUERY_ID);
  });

  it('sends every selected classification to the model options request', async () => {
    installOptionApi();
    render(<QueryForm />);
    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(MODEL_SOURCE_ID, {}, undefined);
    });

    const user = userEvent.setup();
    await openSelect(user, '分类');
    await user.click(await screen.findByText('逻辑主机', { selector: '.ant-select-item-option-content' }));
    await openSelect(user, '分类');
    await user.click(await screen.findByText('AWS', { selector: '.ant-select-item-option-content' }));

    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(
        MODEL_SOURCE_ID,
        { classification_ids: ['host_manage', 'aws'] },
        undefined,
      );
    });
    expect(readParams().model_ids ?? []).toEqual([]);
  });
});
