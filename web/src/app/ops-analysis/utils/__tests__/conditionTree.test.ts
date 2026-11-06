import { describe, expect, it } from 'vitest';

import type { InputOption } from '@/app/ops-analysis/types/dataSource';
import {
  inspectCondition,
  inspectFieldGroup,
  previewCondition,
  readFieldCatalog,
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
  });

  it('rejects an incompatible field merge and accepts separate metrics', () => {
    expect(inspectFieldGroup(
      [{ sources: ['host:os_type', 'app:capacity'], func: 'sum' }],
      catalog,
      true,
      'metrics',
    )).toBe('incompatible');
    expect(inspectFieldGroup(
      [{ sources: ['host:os_type'], func: 'count' }, { sources: ['app:capacity'], func: 'sum' }],
      catalog,
      true,
      'metrics',
    )).toBeNull();
  });
});
