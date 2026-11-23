import type { Meta, StoryObj } from '@storybook/nextjs';
import React from 'react';
import type { Node } from '@antv/x6';
import zhOps from '@/app/ops-analysis/locales/zh.json';
import ChartNode from './chartNode';
import { setLocaleData } from '../utils/localeStore';

type LocaleJson = Record<string, unknown>;

const flatten = (obj: LocaleJson, prefix = '', out: Record<string, string> = {}) => {
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as LocaleJson, next, out);
      return;
    }
    out[next] = String(value);
  });
  return out;
};

setLocaleData('zh', flatten(zhOps as LocaleJson));

const stubNode = (data: Record<string, unknown>): Node => {
  const node = {
    id: 'room-chart',
    on: () => node,
    off: () => node,
    getData: () => data,
    getAttrByPath: () => '',
    setAttrByPath: () => undefined,
  };
  return node as unknown as Node;
};

const base = {
  name: '机房设备类型分布',
  description: '拓扑图表节点',
  valueConfig: {
    chartType: 'pie',
    chartThemeMode: 'light',
  },
  styleConfig: { width: 400, height: 280 },
};

const ChartFrame = ({
  caption,
  data,
}: {
  caption: string;
  data: Record<string, unknown>;
}) => (
  <div className="flex w-[420px] flex-col gap-2">
    <div className="text-sm text-[var(--color-text-2)]">{caption}</div>
    <ChartNode node={stubNode({ ...base, ...data })} />
  </div>
);

const TopologyChartRequest = () => (
  <div className="flex flex-col gap-4 bg-[var(--color-bg-1)] p-6">
    <div className="text-sm text-[var(--color-text-3)]">
      真实 ChartNode。不是 screen_11 业务页。节点状态由夹具写入，取数门闩由运行时测试覆盖。
    </div>
    <div className="flex flex-wrap items-start gap-6">
      <ChartFrame
        caption="缺必填，等待"
        data={{
          isLoading: false,
          hasError: false,
          chartRequestState: 'waiting',
          waitMessage: '请选择机房',
          rawData: null,
        }}
      />
      <ChartFrame
        caption="补齐后恢复"
        data={{
          isLoading: false,
          hasError: false,
          chartRequestState: 'ready',
          rawData: [
            { name: '服务器', value: 12 },
            { name: '网络设备', value: 5 },
          ],
        }}
      />
      <ChartFrame
        caption="目录加载失败"
        data={{
          isLoading: false,
          hasError: true,
          chartRequestState: 'error',
          errorMessage: '数据源加载失败',
          rawData: null,
        }}
      />
    </div>
  </div>
);

const meta = {
  title: 'OpsAnalysis/TopologyChartRequest',
  component: TopologyChartRequest,
} satisfies Meta<typeof TopologyChartRequest>;

export default meta;

type Story = StoryObj<typeof meta>;

export const NodeStates: Story = {};
