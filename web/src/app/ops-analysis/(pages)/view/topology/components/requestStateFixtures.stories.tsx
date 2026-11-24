import type { Meta, StoryObj } from '@storybook/nextjs';
import { Graph } from '@antv/x6';
import { message } from 'antd';
import React, { useEffect, useRef } from 'react';
import zhOps from '@/app/ops-analysis/locales/zh.json';
import { formatRequiredParamWaitMessage } from '@/app/ops-analysis/utils/requiredParamGate';
import { createNodeByType, registerNodes } from '../utils/registerNode';

const translate = (id: string, _defaultMessage?: string, values?: Record<string, string>) => {
  if (id === 'dashboard.requiredParamListSeparator') return zhOps.dashboard.requiredParamListSeparator;
  if (id === 'dashboard.selectRequiredParam') {
    return zhOps.dashboard.selectRequiredParam.replace('{label}', values?.label ?? '');
  }
  if (id === 'dashboard.fillRequiredParams') {
    return zhOps.dashboard.fillRequiredParams.replace('{labels}', values?.labels ?? '');
  }
  return id;
};

const singleValueNode = (id: string, x: number) => createNodeByType({
  id,
  type: 'single-value',
  name: 'CPU',
  position: { x, y: 48 },
  valueConfig: {
    dataSource: 120,
    selectedFields: ['cpu'],
    chartType: 'single',
  },
  styleConfig: {},
});

const SingleValueWaitAndRestore = () => {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return undefined;
    registerNodes();
    const graph = new Graph({
      container,
      width: 640,
      height: 180,
      interacting: false,
      background: { color: 'transparent' },
    });
    const waiting = graph.addNode(singleValueNode('waiting', 36));
    const restored = graph.addNode(singleValueNode('restored', 280));
    waiting.setAttrByPath('label/text', translate('dashboard.selectRequiredParam', undefined, { label: '机房' }));
    restored.setAttrByPath('label/text', '42');
    return () => {
      graph.dispose();
    };
  }, []);

  return (
    <div className="bg-[var(--color-bg)] p-4 text-[var(--color-text-1)]">
      <div className="mb-2 text-sm">隔离夹具。单值等待后恢复。不是 screen_11 业务验收。</div>
      <div ref={host} className="h-[180px] w-[640px]" />
    </div>
  );
};

const ProbeHints = () => {
  const [api, holder] = message.useMessage();

  useEffect(() => {
    api.warning(formatRequiredParamWaitMessage(
      [{ name: 'server_room_id', label: '机房' }],
      translate,
    ), 0);
    api.error(zhOps.dashboard.dataSourceParamsInvalid, 0);
    api.warning(zhOps.dashboard.reProbeNoFields, 0);
    api.info(zhOps.dashboard.fieldProbePreparing, 0);
  }, [api]);

  return (
    <div className="bg-[var(--color-bg)] p-4 text-[var(--color-text-1)]">
      <div className="relative h-[220px] w-[560px]">
        {holder}
      </div>
      <div className="text-sm">隔离夹具。探列等待、目录非法、真实无字段、参数还在准备。不是 screen_11 业务验收。</div>
    </div>
  );
};

const meta: Meta = {
  title: 'OpsAnalysis/RequestStateFixtures',
};
export default meta;

export const SingleValue: StoryObj = {
  render: () => <SingleValueWaitAndRestore />,
};

export const Probe: StoryObj = {
  render: () => <ProbeHints />,
};
