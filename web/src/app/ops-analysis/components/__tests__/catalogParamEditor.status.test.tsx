/**
 * 夹具：目录控件的拦住和失败状态。不打真实数据源。
 */
import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CatalogParamEditor } from '@/app/ops-analysis/components/catalogParamEditor';

const getSourceDataByApiId = vi.fn();
const getDataSourceList = vi.fn(async () => [
  { id: 154, name: 'CMDB 实例查询字段（选项）', rest_api: 'cmdb/get_instance_query_fields' },
]);

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => ({ getDataSourceList, getSourceDataByApiId }),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
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
});

const orderConfig = {
  control: 'order' as const,
  optionsSource: {
    type: 'dynamic' as const,
    sourceRef: { type: 'rest_api' as const, value: 'cmdb/get_instance_query_fields' },
    valueField: 'key',
    labelField: 'label',
    queryParams: { model_ids: { ref: 'model_ids' } },
  },
};

describe('catalog param status', () => {
  it('shows select a model and does not request when the model ref is empty', () => {
    render(
      <CatalogParamEditor
        inputConfig={orderConfig}
        optionsBlocked
        optionsBlockReason="empty"
        optionsMissingRefs={['model_ids']}
      />,
    );
    expect(screen.getByText('请先选择模型')).toBeTruthy();
    expect(screen.queryByText('正在加载属性')).toBeNull();
    expect(getSourceDataByApiId).not.toHaveBeenCalled();
  });

  it('stops loading after a catalog failure and retries without a toast path', async () => {
    const user = userEvent.setup();
    getSourceDataByApiId.mockRejectedValue(new Error('请选择模型'));
    render(
      <CatalogParamEditor
        inputConfig={orderConfig}
        resolvedQueryParams={{ model_ids: ['host'] }}
        optionsQuerySignature="host"
      />,
    );
    expect(await screen.findByText('属性加载失败')).toBeTruthy();
    expect(screen.queryByText('正在加载属性')).toBeNull();
    expect(getSourceDataByApiId).toHaveBeenCalledWith(
      154,
      { model_ids: ['host'] },
      { suppressErrorNotification: true },
    );
    getSourceDataByApiId.mockResolvedValueOnce({ data: { items: [] } });
    await user.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(getSourceDataByApiId).toHaveBeenCalledTimes(2));
  });
});
