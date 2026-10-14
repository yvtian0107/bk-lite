import React from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import UnifiedFilterBar from '@/app/ops-analysis/components/unifiedFilter/unifiedFilterBar';
import {
  FilterTemplateProvider,
  useFilterTemplateText,
} from '@/app/ops-analysis/context/filterTemplate';
import type { UnifiedFilterDefinition } from '@/app/ops-analysis/types/dashBoard';

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
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const biz: UnifiedFilterDefinition = {
  id: 'biz__string',
  key: 'biz',
  name: '业务',
  type: 'string',
  order: 1,
  enabled: true,
  inputConfig: {
    control: 'select',
    optionsSource: {
      type: 'dynamic',
      sourceRef: { type: 'rest_api', value: 'cmdb/biz_list' },
      valueField: 'id',
      labelField: 'name',
    },
  },
};

const room: UnifiedFilterDefinition = {
  id: 'room__string',
  key: 'room',
  name: '机房',
  type: 'string',
  order: 2,
  enabled: true,
  inputConfig: {
    control: 'select',
    optionsSource: {
      type: 'dynamic',
      sourceRef: { type: 'rest_api', value: 'cmdb/room_list' },
      valueField: 'id',
      labelField: 'name',
    },
  },
};

const Probe = ({ text }: { text: string }) => {
  const resolved = useFilterTemplateText(text);
  return <span data-testid="resolved">{resolved}</span>;
};

const renderCanvas = ({
  withBar,
  nested = false,
}: {
  withBar: boolean;
  nested?: boolean;
}) => {
  const applied = { 'biz__string': '42', 'room__string': '7' };
  const probe = <Probe text="$biz$ / $room$" />;
  const canvas = nested ? (
    <FilterTemplateProvider definitions={[biz, room]} appliedValues={applied} resolveEnabled>
      {probe}
    </FilterTemplateProvider>
  ) : probe;

  return render(
    <FilterTemplateProvider
      definitions={[biz, room]}
      appliedValues={applied}
      resolveEnabled={!nested}
    >
      {withBar && (
        <UnifiedFilterBar
          definitions={[biz]}
          values={{ 'biz__string': '42' }}
          onSearch={vi.fn()}
        />
      )}
      {canvas}
    </FilterTemplateProvider>,
  );
};

describe('筛选标题复用筛选栏选项', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    getDataSourceList.mockReset();
    getSourceDataByApiId.mockReset();
    getDataSourceList.mockImplementation(async () => ({
      items: [
        { id: 9, name: '业务列表', rest_api: 'cmdb/biz_list' },
        { id: 8, name: '机房列表', rest_api: 'cmdb/room_list' },
      ],
    }));
    getSourceDataByApiId.mockImplementation(async (id: number) => ({
      data: {
        items: id === 9
          ? [{ id: '42', name: '蓝鲸' }]
          : [{ id: '7', name: '一号机房' }],
      },
      warnings: [],
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('筛选栏已渲染的筛选用栏里的选项，未渲染的才自己加载', async () => {
    renderCanvas({ withBar: true, nested: true });

    await waitFor(() => {
      expect(screen.getByTestId('resolved').textContent).toBe('蓝鲸 / 一号机房');
    });

    const sourceIds = getSourceDataByApiId.mock.calls.map((call) => call[0]);
    expect(sourceIds.filter((id) => id === 9)).toEqual([9]);
    expect(sourceIds.filter((id) => id === 8)).toEqual([8]);
    expect(getDataSourceList).toHaveBeenCalledTimes(2);
  });

  it('筛选栏不在画布上时，每个动态筛选只加载一次', async () => {
    renderCanvas({ withBar: false });

    await waitFor(() => {
      expect(screen.getByTestId('resolved').textContent).toBe('蓝鲸 / 一号机房');
    });

    const sourceIds = getSourceDataByApiId.mock.calls.map((call) => call[0]).sort();
    expect(sourceIds).toEqual([8, 9]);
    expect(getDataSourceList).toHaveBeenCalledTimes(2);
  });
});
