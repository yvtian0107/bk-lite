// @vitest-environment jsdom

import React, { StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NetworkTopology from '@/app/ops-analysis/(pages)/view/networkTopology';
import type { DirItem } from '@/app/ops-analysis/types';

const api = vi.hoisted(() => ({
  getNetworkTopologyDetail: vi.fn(),
  getViewSets: vi.fn(),
  getMetricValues: vi.fn(),
  getLinkRuntime: vi.fn(),
  getNodeModels: vi.fn(),
  getNodes: vi.fn(),
}));

vi.mock('@/app/ops-analysis/api/networkTopology', () => ({
  useNetworkTopologyApi: () => api,
  readPlaybackNetworkViewSets: () => undefined,
}));

vi.mock('@/app/ops-analysis/api', () => ({
  useDirectoryApi: () => ({ updateItem: vi.fn() }),
}));

vi.mock('@/hooks/usePermissions', () => ({
  default: () => ({ hasPermission: () => false }),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/app/ops-analysis/hooks/useCanvasShareAction', () => ({
  useCanvasShareAction: () => ({ shareLoading: false, openShare: vi.fn() }),
}));

vi.mock('@/app/ops-analysis/hooks/useCanvasDraft', () => ({
  useCanvasDraft: () => ({
    status: 'idle',
    save: vi.fn(),
    restore: vi.fn(),
    discard: vi.fn(),
  }),
}));

vi.mock('@/app/ops-analysis/(pages)/view/components/viewWorkspace', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../components/networkCanvas', () => ({
  default: () => null,
  buildDraftLinkId: () => 'draft-link',
}));

vi.mock('../components/networkToolbar', () => ({ default: () => null }));
vi.mock('../components/networkLibrary', () => ({
  default: () => null,
  getModelTagStyle: () => ({}),
}));
vi.mock('../components/networkNodeDrawer', () => ({ default: () => null }));
vi.mock('../components/networkEdgeDrawer', () => ({ default: () => null }));
vi.mock('../components/modals/monitorSourcePickerModal', () => ({ default: () => null }));
vi.mock('../components/modals/confirmDeleteModal', () => ({ default: () => null }));

const node = {
  id: 'node-1',
  bk_obj_id: 'bk_switch',
  bk_inst_id: 1,
  bk_inst_name: 'sw-1',
  network_collect_task_id: 1,
  network_collect_instance_id: 1,
  plugin_template_id: 1,
  position: { x: 0, y: 0 },
  metrics: [{
    metric_field: 'in_bps',
    result_table_id: 'rt',
    display_name: '入流量',
    unit: 'bps',
  }],
};

const link = {
  id: 'link-1',
  source_node_id: 'node-1',
  target_node_id: 'node-1',
  port_pairs: [{
    source_interface: { bk_obj_id: 'bk_interface' as const, bk_inst_id: 1, interface_name: 'eth0' },
    target_interface: { bk_obj_id: 'bk_interface' as const, bk_inst_id: 2, interface_name: 'eth1' },
  }],
};

const canvas = (id: string): DirItem => ({
  id,
  data_id: id,
  name: id,
  desc: '',
  type: 'networkTopology',
});

const signalOf = (calls: unknown[][], index: number) => calls.at(-1)?.[index] as AbortSignal;

afterEach(() => {
  cleanup();
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('network topology reads', () => {
  it('aborts detail, config, metric and link reads from the old canvas and keeps the new ones', async () => {
    api.getNetworkTopologyDetail.mockImplementation(() => new Promise(() => undefined));
    api.getViewSets.mockResolvedValue({ nodes: [node], links: [link] });
    api.getMetricValues.mockImplementation(() => new Promise(() => undefined));
    api.getLinkRuntime.mockImplementation(() => new Promise(() => undefined));

    const view = render(
      <StrictMode>
        <NetworkTopology key="net-a" selectedNetworkTopology={canvas('net-a')} shareMode />
      </StrictMode>,
    );

    await vi.waitFor(() => {
      expect(api.getMetricValues).toHaveBeenCalled();
      expect(api.getLinkRuntime).toHaveBeenCalled();
    });
    const firstDetail = signalOf(api.getNetworkTopologyDetail.mock.calls, 1);
    const firstConfig = signalOf(api.getViewSets.mock.calls, 1);
    const firstMetric = signalOf(api.getMetricValues.mock.calls, 2);
    const firstLink = signalOf(api.getLinkRuntime.mock.calls, 2);
    expect(firstDetail.aborted).toBe(false);
    expect(firstMetric).toBe(firstLink);
    expect(firstMetric.aborted).toBe(false);

    view.rerender(
      <StrictMode>
        <NetworkTopology key="net-b" selectedNetworkTopology={canvas('net-b')} shareMode />
      </StrictMode>,
    );
    await vi.waitFor(() => {
      const latest = signalOf(api.getMetricValues.mock.calls, 2);
      expect(latest).not.toBe(firstMetric);
      expect(latest.aborted).toBe(false);
    });
    const secondDetail = signalOf(api.getNetworkTopologyDetail.mock.calls, 1);
    const secondMetric = signalOf(api.getMetricValues.mock.calls, 2);
    expect(firstDetail.aborted).toBe(true);
    expect(firstConfig.aborted).toBe(true);
    expect(firstMetric.aborted).toBe(true);
    expect(secondDetail.aborted).toBe(false);
    expect(secondMetric.aborted).toBe(false);
    expect(api.getNetworkTopologyDetail.mock.calls.at(-1)?.[0]).toBe('net-b');

    view.unmount();
    expect(secondDetail.aborted).toBe(true);
    expect(secondMetric.aborted).toBe(true);
  });
});
