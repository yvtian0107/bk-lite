import { describe, expect, it } from 'vitest';

import type { InputOption } from '@/app/ops-analysis/types/dataSource';
import {
  appendCopiedCondition,
  copyModelCondition,
  describeFieldGroupIssue,
  explainFieldCopy,
  inspectCondition,
  inspectFieldGroup,
  inspectOrder,
  isLegacyConditionTree,
  metricOrderKey,
  previewCondition,
  readConditionCards,
  readFieldCatalog,
  readOrderChoices,
  summarizeConditionCards,
  writeConditionCards,
} from '@/app/ops-analysis/utils/conditionTree';

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
      funcs: [{ value: 'count', label: '数量' }],
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
      funcs: [{ value: 'sum', label: '求和' }],
    },
  },
];

const catalog = readFieldCatalog(options);
const labels = { and: 'AND', or: 'OR', global: 'Global', missing: 'missing' };

describe('condition tree', () => {
  it('previews scope and keeps a stale field from being accepted', () => {
    const tree = {
      logic: 'and' as const,
      children: [
        { scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] },
        { scope: 'global', attr_id: 'missing', operator: 'str=', value: 'x' },
      ],
    };
    expect(previewCondition(tree, catalog, labels)).toContain('主机 · 系统类型');
    expect(previewCondition(tree, catalog, labels)).toContain('Global');
    expect(inspectCondition(tree, catalog, true)?.code).toBe('staleField');
    const sameName = {
      logic: 'and' as const,
      children: [{ scope: 'global', attr_id: 'capacity', operator: 'int>', value: 1 }],
    };
    const withHost = [
      ...catalog,
      {
        ...catalog[1],
        key: 'host:capacity',
        label: '主机 · 容量',
        modelId: 'host',
        modelName: '主机',
      },
    ];
    expect(inspectCondition(sameName, withHost, true)?.code).toBe('ambiguousField');
    expect(inspectCondition({
      logic: 'and',
      children: [{
        scope: 'global',
        sources: ['host:capacity'],
        attr_id: 'capacity',
        operator: 'int>',
        value: 1,
      }],
    }, withHost, true)).toBeNull();
    expect(previewCondition({
      logic: 'and',
      children: [{
        scope: 'global',
        sources: ['host:capacity'],
        attr_id: 'capacity',
        operator: 'int>',
        value: 1,
      }],
    }, withHost, labels)).toContain('主机 · 容量');
    expect(previewCondition({
      logic: 'and',
      children: [{
        scope: 'global',
        sources: ['host:capacity'],
        attr_id: 'capacity',
        operator: 'int>',
        value: 1,
      }],
    }, withHost, labels)).not.toContain('应用 · 容量');
    expect(inspectCondition({ logic: 'and', children: [] }, catalog, true)).toBeNull();
    expect(inspectCondition(undefined, catalog, true)).toBeNull();
    expect(inspectCondition(null, catalog, true)).toBeNull();
    expect(inspectCondition('', catalog, true)).toBeNull();
    expect(inspectCondition([], catalog, true)).toBeNull();
    expect(inspectCondition({}, catalog, true)).toBeNull();
    expect(inspectCondition({
      logic: 'and',
      children: [{ logic: 'and', model_id: 'host', children: [] }],
    }, catalog, true)).toBeNull();
    expect(inspectCondition({
      logic: 'and',
      children: [{
        logic: 'and',
        model_id: 'host',
        children: [{ scope: 'host', attr_id: '', operator: '' }],
      }],
    }, catalog, true)).toMatchObject({ code: 'invalid', cardIndex: 0, leafIndex: 0 });
  });

  it('rejects an incompatible field merge and accepts separate metrics', () => {
    const incompatible = inspectFieldGroup(
      [{ sources: ['host:os_type', 'app:capacity'], func: 'sum' }],
      catalog,
      true,
      'metrics',
    );
    expect(incompatible).toMatchObject({
      code: 'incompatible',
      names: ['主机 · 系统类型', '应用 · 容量'],
    });
    expect(describeFieldGroupIssue(incompatible!, {
      invalid: '',
      required: '',
      stale: '',
      incompatible: '不能合并',
      incompatibleNamed: '{left} 和 {right} 的类型或单位不一致，不能合并',
      enumConflict: '',
    })).toBe('主机 · 系统类型 和 应用 · 容量 的类型或单位不一致，不能合并');
    expect(inspectFieldGroup(
      [{ sources: ['host:os_type'], func: 'count' }, { sources: ['app:capacity'], func: 'sum' }],
      catalog,
      true,
      'metrics',
    )).toBeNull();
    expect(summarizeConditionCards(
      [{ id: 'host', name: '主机' }, { id: 'app', name: '应用' }],
      [{
        modelId: 'app',
        logic: 'and',
        children: [{ scope: 'app', attr_id: 'capacity', operator: 'int>', value: 1 }],
      }],
      catalog,
      {
        and: '并且', or: '或者', all: '全部', unfinished: '未完成', stale: '已失效，不会按全部实例查询',
        match: '符合', lead: '返回', join: '，以及', of: '的',
      },
    )).toBe('返回全部主机，以及符合应用 · 容量 大于 1的应用');
  });

  it('rejects an enum group when the same stored value has two meanings', () => {
    const fields = readFieldCatalog([
      options[0],
      {
        value: 'vm:os_type',
        label: '虚拟机 · 系统类型',
        extra: {
          kind: 'attribute',
          model_id: 'vm',
          model_name: '虚拟机',
          attr_id: 'os_type',
          attr_type: 'enum',
          unit: '',
          options: [{ value: '2', label: 'Windows' }],
          funcs: [],
        },
      },
    ]);
    expect(inspectFieldGroup([{ sources: ['host:os_type', 'vm:os_type'] }], fields, true, 'group')?.code).toBe('enumConflict');
    const compatible = readFieldCatalog([
      options[0],
      {
        value: 'vm:os_type',
        label: '虚拟机 · 系统类型',
        extra: {
          kind: 'attribute',
          model_id: 'vm',
          model_name: '虚拟机',
          attr_id: 'os_type',
          attr_type: 'enum',
          unit: '',
          options: [{ value: '2', label: 'Linux' }, { value: '9', label: 'Linux' }],
          funcs: [],
        },
      },
    ]);
    expect(inspectFieldGroup([{ sources: ['host:os_type', 'vm:os_type'] }], compatible, true, 'group')).toBeNull();
  });

  it('marks an unselected empty card as stale and keeps a selected empty card as all instances', () => {
    const labels = {
      and: '并且', or: '或者', all: '全部', unfinished: '未完成', stale: '已失效，不会按全部实例查询',
      match: '符合', lead: '返回', join: '，以及', of: '的',
    };
    const cards = [
      { modelId: 'host', logic: 'and' as const, children: [] },
      { modelId: 'app', logic: 'and' as const, children: [] },
    ];
    expect(summarizeConditionCards(
      [{ id: 'host', name: '主机' }],
      cards,
      catalog,
      labels,
    )).toBe('返回全部主机，以及应用（已失效，不会按全部实例查询）');
    const tree = writeConditionCards(cards, ['host']);
    expect(tree.children.map((child) => ('model_id' in child ? child.model_id : ''))).toEqual(['app']);
    expect(inspectCondition(tree, catalog, true, ['host'])).toMatchObject({ code: 'staleScope', cardIndex: 0 });
    const hostOnly = writeConditionCards([{ modelId: 'host', logic: 'and', children: [] }]);
    expect(inspectCondition(hostOnly, catalog, true, ['host'])).toBeNull();
    expect(summarizeConditionCards([{ id: 'host', name: '主机' }], [{ modelId: 'host', logic: 'and', children: [] }], catalog, labels)).toBe('返回全部主机');
  });

  it('keeps a saved aggregate metric order and a count scope_count order', () => {
    const choices = readOrderChoices([
      { value: 'model_id', label: '模型', extra: { orderable: true, order_modes: ['aggregate', 'count'], kind: 'order' } },
      { value: 'scope_count', label: '实例数量', extra: { orderable: true, order_modes: ['count'], kind: 'order' } },
    ], 'aggregate', [{ key: 'cpu_avg', func: 'avg', sources: ['host:cpu'], label: 'CPU 平均' }]);
    expect(choices.map((item) => item.key)).toEqual(['model_id', 'cpu_avg']);
    expect(inspectOrder('-cpu_avg', choices, true)).toBeNull();
    expect(metricOrderKey({ func: 'sum', sources: ['host:capacity'] })).toBe('sum_host_capacity');
    const countChoices = readOrderChoices([
      { value: 'model_id', label: '模型', extra: { orderable: true, order_modes: ['count'], kind: 'order' } },
      { value: 'scope_count', label: '实例数量', extra: { orderable: true, order_modes: ['count'], kind: 'order' } },
      { value: 'host:ip_addr', label: '内网IP', extra: { orderable: true, order_modes: ['list'], kind: 'attribute' } },
    ], 'count');
    expect(countChoices.map((item) => item.key)).toEqual(['model_id', 'scope_count']);
    expect(inspectOrder('scope_count', countChoices, true)).toBeNull();
    expect(inspectOrder('-scope_count', countChoices, true)).toBeNull();
  });

  it('keeps an empty order and rejects a field that is not in the catalog', () => {
    const choices = readOrderChoices([
      { value: 'inst_name', label: '实例名', extra: { orderable: true, order_modes: ['list'], kind: 'order' } },
      { value: 'count', label: '数量', extra: { orderable: true, order_modes: ['distribution'], kind: 'order' } },
    ], 'list');
    expect(choices.map((item) => item.key)).toEqual(['inst_name']);
    expect(inspectOrder('', choices, true)).toBeNull();
    expect(inspectOrder('-inst_name', choices, true)).toBeNull();
    expect(inspectOrder('inst_name / -count', choices, true)).toBe('stale');
  });

  it('keeps a nested model condition editable and leaves a global tree unchanged', () => {
    const nested = {
      logic: 'and' as const,
      children: [{
        logic: 'and' as const,
        model_id: 'host',
        children: [
          { scope: 'host', attr_id: 'ip_addr', operator: 'str=', value: '10.' },
          {
            logic: 'or' as const,
            children: [
              { scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] },
              { scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['3'] },
            ],
          },
        ],
      }],
    };
    expect(isLegacyConditionTree(nested)).toBe(false);
    const again = readConditionCards(writeConditionCards(readConditionCards(nested), ['host']));
    expect(again[0].modelId).toBe('host');
    expect(again[0].children[1]).toMatchObject({ logic: 'or' });
    const globalTree = {
      logic: 'and' as const,
      children: [{ scope: 'global', sources: ['host:os_type'], attr_id: 'os_type', operator: 'list_any[]', value: ['2'] }],
    };
    expect(isLegacyConditionTree(globalTree)).toBe(true);
    expect(readConditionCards(globalTree)).toEqual([]);
    const mixed = {
      logic: 'or' as const,
      children: [{
        logic: 'and' as const,
        children: [
          { scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] },
          { scope: 'app', attr_id: 'capacity', operator: 'int>', value: 1 },
        ],
      }],
    };
    expect(isLegacyConditionTree(mixed)).toBe(true);
  });

  it('refuses a copy when type, unit, or enum meaning does not match and appends without dropping existing leaves', () => {
    const hostOs = catalog[0];
    const appCapacity = catalog[1];
    const vmOs = {
      ...hostOs,
      key: 'vm:os_type',
      modelId: 'vm',
      modelName: '虚拟机',
      label: '虚拟机 · 系统类型',
      options: [{ value: '2', label: 'Windows' }],
    };
    const vmSame = { ...vmOs, options: [{ value: '2', label: 'Linux' }] };
    expect(explainFieldCopy(hostOs, appCapacity, 'list_any[]', ['2'])).toBe('type');
    expect(explainFieldCopy(hostOs, { ...vmSame, unit: '台' }, 'list_any[]', ['2'])).toBe('unit');
    expect(explainFieldCopy(hostOs, { ...vmSame, operators: [{ value: 'str=', label: '等于', valueKind: 'text' }] }, 'list_any[]', ['2'])).toBe('operator');
    expect(explainFieldCopy(hostOs, vmOs, 'list_any[]', ['2'])).toBe('enum-meaning');
    expect(explainFieldCopy(hostOs, { ...vmSame, options: [] }, 'list_any[]', ['2'])).toBe('enum-unknown');
    const source = {
      modelId: 'host',
      logic: 'and' as const,
      children: [{ scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] }],
    };
    expect(copyModelCondition(source, 'app', { os_type: 'capacity' }, catalog).ok).toBe(false);
    expect(copyModelCondition(source, 'vm', {}, [hostOs, vmSame]).ok).toBe(false);
    const copied = copyModelCondition(source, 'vm', { os_type: 'os_type' }, [hostOs, vmSame]);
    expect(copied.ok).toBe(true);
    const appended = appendCopiedCondition({
      modelId: 'vm',
      logic: 'or',
      children: [{ scope: 'vm', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] }],
    }, copied.ok ? copied.node : { logic: 'and', children: [] });
    expect(appended.ok).toBe(true);
    if (appended.ok) {
      expect(appended.card.logic).toBe('and');
      expect(appended.card.children).toHaveLength(2);
    }
  });
});
