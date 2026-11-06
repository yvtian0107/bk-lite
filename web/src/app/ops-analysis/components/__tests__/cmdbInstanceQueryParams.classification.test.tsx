/**
 * 夹具：真实 DataSourceParamsConfig，加上组件配置里同一套 retain 对齐。
 * 选项来自测试桩，不是运行中的业务页，也不是 Neo4j / NATS。
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Form } from 'antd';

import DataSourceParamsConfig from '@/app/ops-analysis/components/paramsConfig';
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

afterEach(() => {
  cleanup();
  getSourceDataByApiId.mockReset();
  getDataSourceList.mockReset();
});

const classificationParam: ParamItem = {
  name: 'classification_ids',
  alias_name: '分类',
  type: 'string',
  filterType: 'params',
  value: [],
  inputConfig: {
    control: 'select',
    multiple: true,
    missingOptionPolicy: 'retain',
    optionsSource: {
      type: 'dynamic',
      sourceRef: { type: 'rest_api', value: 'cmdb/get_model_classification_options' },
      valueField: 'classification_id',
      labelField: 'classification_name',
    },
  },
};

const modelParam: ParamItem = {
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
      type: 'dynamic',
      sourceRef: { type: 'rest_api', value: 'cmdb/get_model_options' },
      valueField: 'model_id',
      labelField: 'label',
      queryParams: {
        classification_ids: { ref: 'classification_ids', whenEmpty: 'omit' },
      },
    },
  },
};

const fixtureSource = {
  id: INSTANCE_QUERY_ID,
  name: 'CMDB 实例查询',
  rest_api: 'cmdb/query_model_instances',
  params: [classificationParam, modelParam],
} as DatasourceItem;

const QueryForm = () => {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={{ params: { classification_ids: [], model_ids: ['app'] } }}>
      <DataSourceParamsConfig
        selectedDataSource={fixtureSource}
        includeFilterTypes={['params']}
        globalFilters={[]}
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

describe('CMDB classification narrows model options without clearing a retained model', () => {
  it('rejects the old model after options shrink and does not query instances', async () => {
    getDataSourceList.mockResolvedValue([
      { id: CLASSIFICATION_SOURCE_ID, name: '模型分类选项', rest_api: 'cmdb/get_model_classification_options' },
      { id: MODEL_SOURCE_ID, name: '模型选项', rest_api: 'cmdb/get_model_options' },
    ]);
    getSourceDataByApiId.mockImplementation(async (sourceId: number, params: Record<string, unknown>) => {
      if (sourceId === CLASSIFICATION_SOURCE_ID) {
        return {
          data: [
            { classification_id: 'compute', classification_name: '计算' },
            { classification_id: 'biz', classification_name: '业务' },
          ],
        };
      }
      if (sourceId === MODEL_SOURCE_ID) {
        const selected = params?.classification_ids;
        const computeOnly = Array.isArray(selected) && selected.length === 1 && selected[0] === 'compute';
        return {
          data: computeOnly
            ? [{ model_id: 'host', label: '计算 / 主机 · host' }]
            : [
              { model_id: 'host', label: '计算 / 主机 · host' },
              { model_id: 'app', label: '业务 / 应用 · app' },
            ],
        };
      }
      throw new Error(`unexpected source ${sourceId}`);
    });

    render(<QueryForm />);

    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(MODEL_SOURCE_ID, {}, undefined);
    });
    expect(readParams().model_ids).toEqual(['app']);

    const user = userEvent.setup();
    const [classification] = screen.getAllByRole('combobox');
    await user.click(classification);
    await user.click(await screen.findByText('计算', { selector: '.ant-select-item-option-content' }));

    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(
        MODEL_SOURCE_ID,
        { classification_ids: ['compute'] },
        undefined,
      );
    });
    expect(readParams().classification_ids).toEqual(['compute']);
    expect(readParams().model_ids).toEqual(['app']);
    expect(readParams().model_ids).not.toEqual([]);

    const callsBeforeValidate = getSourceDataByApiId.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '校验' }));
    expect(await screen.findByText('paramInput.staleOption')).toBeTruthy();
    expect(getSourceDataByApiId.mock.calls.length).toBe(callsBeforeValidate);
    expect(getSourceDataByApiId.mock.calls.map((call) => call[0])).not.toContain(INSTANCE_QUERY_ID);
  });
});
