import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UnifiedFilterBar from '@/app/ops-analysis/components/unifiedFilter/unifiedFilterBar';
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
    t: (key: string) => (
      key === 'paramInput.dynamic.upstreamRequired' ? '请先选择上游' : key
    ),
  }),
}));

const room: UnifiedFilterDefinition = {
  id: 'site_id__string',
  key: 'site_id',
  name: '机房',
  type: 'string',
  defaultValue: null,
  order: 0,
  enabled: true,
  inputConfig: {
    control: 'select',
    optionsSource: {
      type: 'static',
      staticItems: [{ label: '一号机房', value: 'room-1' }],
    },
  },
};

const device: UnifiedFilterDefinition = {
  id: 'device_id__string',
  key: 'device_id',
  name: '设备',
  type: 'string',
  defaultValue: 'missing',
  order: 1,
  enabled: true,
  inputConfig: {
    control: 'select',
    optionsSource: {
      type: 'dynamic',
      sourceId: 9,
      valueField: 'id',
      labelField: 'name',
      queryParams: { room_id: { ref: 'site_id' } },
    },
  },
};

describe('option query cascade', () => {
  afterEach(() => {
    cleanup();
    getSourceDataByApiId.mockReset();
  });

  it('reloads downstream options from the draft and does not search when the old value is cleared', async () => {
    const onSearch = vi.fn();
    getSourceDataByApiId.mockResolvedValue({
      data: [{ id: 'dev-2', name: '设备2' }],
      warnings: [],
    });

    render(
      <UnifiedFilterBar
        definitions={[room, device]}
        values={{
          [room.id]: 'room-1',
          [device.id]: 'missing',
        }}
        onSearch={onSearch}
      />,
    );

    await waitFor(() => {
      expect(getSourceDataByApiId).toHaveBeenCalledWith(9, { room_id: 'room-1' }, undefined);
    });
    await waitFor(() => {
      expect(document.querySelector('.ant-spin')).toBeNull();
    });
    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.queryByText('请先选择上游')).toBeNull();
  });

  it('does not request downstream options while the upstream draft is empty', async () => {
    const onSearch = vi.fn();
    render(
      <UnifiedFilterBar
        definitions={[room, device]}
        values={{
          [room.id]: null,
          [device.id]: 'dev-2',
        }}
        onSearch={onSearch}
      />,
    );

    expect(await screen.findByText('请先选择上游')).not.toBeNull();
    expect(getSourceDataByApiId).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
  });
});
