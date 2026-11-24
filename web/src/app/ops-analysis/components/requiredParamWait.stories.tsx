import type { Meta, StoryObj } from '@storybook/nextjs';
import React from 'react';
import { IntlProvider } from 'react-intl';
import { Button } from 'antd';
import ParamTable from '@/app/ops-analysis/(pages)/settings/dataSource/paramTable';
import WidgetState from '@/app/ops-analysis/components/widget-state';
import { useThemeMode } from '@/theme';
import zhOps from '@/app/ops-analysis/locales/zh.json';
import type { ParamItem } from '@/app/ops-analysis/types/dataSource';

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

const messages = flatten(zhOps as LocaleJson);

const roomParam: ParamItem = {
  id: 'room',
  name: 'server_room_id',
  alias_name: '机房',
  type: 'string',
  filterType: 'filter',
  value: '',
  required: true,
};

const objectParam: ParamItem = {
  id: 'object',
  name: 'monitor_object_id',
  alias_name: '监控对象',
  type: 'string',
  filterType: 'params',
  value: '',
  required: false,
};

const Fixture = () => {
  const { mode, setMode } = useThemeMode();
  const [params, setParams] = React.useState<ParamItem[]>([roomParam, objectParam]);
  const saved = params
    .map((item) => `${item.alias_name} ${item.required ? '必填' : '非必填'}`)
    .join('，');
  return (
    <IntlProvider locale="zh" messages={messages}>
      <div
        className="min-h-screen bg-[var(--color-bg)] p-6 text-[var(--color-text-1)]"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="text-sm">隔离夹具。不是 screen_11 业务验收。</div>
          <Button onClick={() => setMode('light')}>浅色</Button>
          <Button onClick={() => setMode('dark')}>暗色</Button>
          <div className="text-sm">{mode}</div>
        </div>
        <div className="grid grid-cols-[640px_1fr] gap-4">
          <section className="rounded border border-[var(--color-border)] bg-[var(--color-bg-container)] p-3">
            <div className="mb-2 text-sm font-medium">数据源参数配置</div>
            <ParamTable params={params} onChange={setParams} />
            <div className="mt-3 text-sm" data-testid="saved-required">已保存：{saved}</div>
            <div className="mb-2 mt-4 text-sm font-medium">内置源只读</div>
            <ParamTable params={[roomParam]} onChange={() => undefined} readOnly />
          </section>
          <section className="grid gap-3">
            <div
              className="h-40 rounded border border-[var(--color-border)] bg-[var(--color-bg-container)]"
            >
              <WidgetState description="请选择机房" />
            </div>
            <div
              className="h-40 rounded border border-[var(--color-border)] bg-[var(--color-bg-container)]"
            >
              <WidgetState description="请补充：机房、监控对象" />
            </div>
          </section>
        </div>
      </div>
    </IntlProvider>
  );
};

const meta = {
  title: 'OpsAnalysis/RequiredParamWaitFixture',
  component: Fixture,
} satisfies Meta<typeof Fixture>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LightAndDark: Story = {};
