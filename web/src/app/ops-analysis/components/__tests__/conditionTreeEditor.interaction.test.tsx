/**
 * 夹具：直接渲染条件编辑器。目录是静态字段，不是 Neo4j / NATS。
 */
import '@ant-design/v5-patch-for-react-19';
import React, { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import ConditionTreeEditor from '@/app/ops-analysis/components/conditionTreeEditor';
import { readFieldCatalog } from '@/app/ops-analysis/utils/conditionTree';
import type { InputOption } from '@/app/ops-analysis/types/dataSource';

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, vars?: Record<string, string>) => {
      const template = fallback || key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? '');
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

afterEach(() => cleanup());

const options: InputOption[] = [
  {
    value: 'host:os_type',
    label: '主机 · 系统类型',
    extra: {
      kind: 'attribute',
      model_id: 'host',
      model_name: '主机',
      attr_id: 'os_type',
      attr_type: 'enum',
      unit: '',
      operators: [{ value: 'list_any[]', label: '包含任一', value_kind: 'enum' }],
      options: [{ value: '2', label: 'Linux' }],
      funcs: [],
    },
  },
  {
    value: 'app:capacity',
    label: '应用 · 容量',
    extra: {
      kind: 'attribute',
      model_id: 'app',
      model_name: '应用',
      attr_id: 'capacity',
      attr_type: 'int',
      unit: '个',
      operators: [{ value: 'int>', label: '大于', value_kind: 'number' }],
      options: [],
      funcs: [],
    },
  },
];
const catalog = readFieldCatalog(options);
const hostLeaf = {
  logic: 'and',
  children: [{
    logic: 'and',
    model_id: 'host',
    children: [{ scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] }],
  }],
};
const globalTree = {
  logic: 'and',
  children: [{ scope: 'global', sources: ['host:os_type'], attr_id: 'os_type', operator: 'list_any[]', value: ['2'] }],
};

const Harness = ({ initial, models }: { initial: unknown; models: string[] }) => {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <ConditionTreeEditor value={value} onChange={setValue} catalog={catalog} catalogReady selectedModelIds={models} />
      <pre data-testid="stored">{JSON.stringify(value)}</pre>
    </div>
  );
};

describe('condition editor interactions', () => {
  it('edits one selected model directly and keeps an empty condition', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ logic: 'and', children: [] }} models={['host']} />);
    expect(screen.getByText('返回全部主机')).toBeTruthy();
    expect(screen.getByText('未限制条件，返回该模型全部实例')).toBeTruthy();
    expect(screen.queryByText('选择模型')).toBeNull();
    await user.click(screen.getByRole('button', { name: '添加一条' }));
    expect(screen.getByTestId('stored').textContent).toContain('"model_id":"host"');
    expect(screen.getByTestId('stored').textContent).not.toContain('"scope":"global"');
  });

  it('keeps a global tree until rebuild is confirmed', async () => {
    const user = userEvent.setup();
    render(<Harness initial={globalTree} models={['host', 'app']} />);
    expect(screen.getByText(/已有筛选会原样保留/)).toBeTruthy();
    expect(screen.getByText(/主机 · 系统类型/)).toBeTruthy();
    const before = screen.getByTestId('stored').textContent;
    await user.click(screen.getByRole('button', { name: '按模型重新添加' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('这会替换当前条件');
    await user.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    expect(screen.getByTestId('stored').textContent).toBe(before);
    await user.click(screen.getByRole('button', { name: '按模型重新添加' }));
    const dialogs = await screen.findAllByRole('dialog');
    const confirm = dialogs[dialogs.length - 1];
    await user.click(within(confirm).getByRole('button', { name: '确认替换' }));
    expect(screen.getByTestId('stored').textContent).toBe(JSON.stringify({ logic: 'and', children: [] }));
  });

  it('keeps both enum values inside a nested group', () => {
    const nested = {
      logic: 'and',
      children: [{
        logic: 'and',
        model_id: 'host',
        children: [
          { scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] },
          {
            logic: 'or',
            children: [
              { scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] },
              { scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] },
            ],
          },
        ],
      }],
    };
    const seen: unknown[] = [];
    render(
      <ConditionTreeEditor
        value={nested}
        onChange={(next) => seen.push(next)}
        catalog={catalog}
        catalogReady
        selectedModelIds={['host']}
      />,
    );
    expect(screen.getAllByText('Linux').length).toBeGreaterThan(0);
    expect(screen.queryByText('请填写条件值')).toBeNull();
    expect(seen).toEqual([]);
  });

  it('shows why a copy is incompatible and does not change the stored tree', async () => {
    const user = userEvent.setup();
    render(<Harness initial={hostLeaf} models={['host', 'app']} />);
    await user.click(screen.getByText('主机'));
    await user.click(screen.getByRole('button', { name: '复制到其他模型' }));
    await user.click(screen.getByRole('checkbox', { name: '应用' }));
    expect(screen.getAllByText('请选择目标模型上的对应字段').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '复 制' }));
    expect(screen.getByTestId('stored').textContent).toBe(JSON.stringify(hostLeaf));
    const boxes = screen.getAllByRole('combobox');
    await user.click(boxes[boxes.length - 1]);
    await user.click(screen.getByText('应用 · 容量'));
    expect(screen.getByText('字段类型不一致，不能复制')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '复 制' }));
    expect(screen.getByTestId('stored').textContent).toBe(JSON.stringify(hostLeaf));
  });
});
