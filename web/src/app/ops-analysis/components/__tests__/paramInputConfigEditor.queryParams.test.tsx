import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ParamInputConfigEditor } from '@/app/ops-analysis/components/paramInputConfigEditor';

const { getDataSourceList, getSourceDataByApiId } = vi.hoisted(() => ({
  getDataSourceList: vi.fn(),
  getSourceDataByApiId: vi.fn(),
}));

vi.mock('@/app/ops-analysis/api/dataSource', () => ({
  useDataSourceApi: () => ({
    getDataSourceList,
    getSourceDataByApiId,
  }),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, _fallback?: string, values?: Record<string, string>) => {
      const text: Record<string, string> = {
        'paramInput.title': '参数输入配置',
        'paramInput.dynamic.queryParams': '选项查询参数',
        'paramInput.dynamic.queryParamName': '入参名',
        'paramInput.dynamic.valueMode': '取值方式',
        'paramInput.dynamic.valueOrRef': '值/引用',
        'paramInput.dynamic.fixedValue': '固定值',
        'paramInput.dynamic.dollarRef': '$引用',
        'paramInput.dynamic.selectUpstream': '选择上游筛选',
        'paramInput.dynamic.noRefCandidates': '暂无其它可引用的筛选',
        'paramInput.dynamic.originGlobalFilter': '全局筛选',
        'paramInput.dynamic.originComponentParam': '组件参数',
        'paramInput.dynamic.refChoice': '{origin} · {name}',
        'paramInput.dynamic.previewSkippedForRef': '引用入参需运行时上游值，配置态不预览',
        'paramInput.dynamic.queryParamValue': '填写固定值',
        'paramInput.dynamic.preview': '预览',
        'common.confirm': '确认',
        'common.cancel': '取消',
      };
      return (text[key] || key).replace(/\{(\w+)\}/g, (_, name) => values?.[name] ?? '');
    },
  }),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

describe('param input query params', () => {
  afterEach(() => {
    cleanup();
    getDataSourceList.mockReset();
    getSourceDataByApiId.mockReset();
  });

  it('expands declared source params and does not ask for a sample value', async () => {
    const user = userEvent.setup();
    getDataSourceList.mockResolvedValue([
      {
        id: 9,
        name: '设备列表',
        rest_api: 'cmdb/devices',
        params: [
          { name: 'room_id', type: 'string', alias_name: '机房' },
          { name: 'zone_id', type: 'string', alias_name: '区域' },
        ],
      },
    ]);
    render(
      <ParamInputConfigEditor
        open
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        value={{
          control: 'select',
          optionsSource: {
            type: 'dynamic',
            sourceId: 9,
            valueField: 'id',
            labelField: 'name',
            queryParams: { room_id: { ref: 'site_id' } },
          },
        }}
        optionsQueryContext={{
          scope: 'globalFilter',
          self: { id: 'device_id__string', key: 'device_id' },
          globalFilters: [
            { id: 'site_id__string', key: 'site_id', label: '监控对象', type: 'string', enabled: true },
          ],
          componentParams: [
            { name: 'secret', label: '别的组件', type: 'string' },
          ],
        }}
      />,
    );

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('zone_id')).not.toBeNull();
    expect(within(dialog).getByText('room_id')).not.toBeNull();
    expect(within(dialog).getByText('入参名')).not.toBeNull();
    expect(within(dialog).getByText('取值方式')).not.toBeNull();
    expect(within(dialog).getByText('值/引用')).not.toBeNull();
    expect(within(dialog).queryByText('示例值')).toBeNull();
    expect(within(dialog).queryByPlaceholderText('示例值')).toBeNull();
    expect(within(dialog).getByText('引用入参需运行时上游值，配置态不预览')).not.toBeNull();
    expect(within(dialog).getByText('全局筛选 · 监控对象')).not.toBeNull();
    expect(getSourceDataByApiId).not.toHaveBeenCalled();

    await user.click(within(dialog).getByText('全局筛选 · 监控对象'));
    await waitFor(() => {
      expect(screen.queryByText('组件参数 · 别的组件')).toBeNull();
    });
  });
});
