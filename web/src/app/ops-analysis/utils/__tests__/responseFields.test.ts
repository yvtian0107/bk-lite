import { describe, expect, it } from 'vitest';

import { reconcileComponentParamValue } from '@/app/ops-analysis/utils/componentParamSwitch';
import { processDataSourceParams } from '@/app/ops-analysis/utils/widgetDataTransform';
import { resolveTableLikeColumns } from '@/app/ops-analysis/utils/tableLikeData';
import { buildTreeData, preferredInstanceCountKey } from '@/app/ops-analysis/(pages)/view/topology/utils/dataTreeUtils';
import { getValueByPath } from '@/app/ops-analysis/utils/objectPath';

describe('query response fields and hidden params', () => {
  it('keeps a retained stale option and still drops one by default', () => {
    const options = [{ label: '主机', value: 'host' }];
    expect(reconcileComponentParamValue(['host', 'gone'], options, 'retain')).toEqual(['host', 'gone']);
    expect(reconcileComponentParamValue(['host', 'gone'], options)).toEqual(['host']);
  });

  it('omits a hidden param from the request and keeps an object condition', () => {
    const sourceParams = [
      { name: 'analysis_mode', type: 'string', value: 'list', filterType: 'params' },
      {
        name: 'group_by',
        type: 'object',
        value: [{ sources: ['host:os_type'] }],
        filterType: 'params',
        visibleWhen: { param: 'analysis_mode', in: ['distribution'] },
      },
      {
        name: 'conditions',
        type: 'object',
        value: { logic: 'and', children: [] },
        filterType: 'params',
      },
    ];
    const params = processDataSourceParams({
      sourceParams,
      userParams: {
        analysis_mode: 'list',
        group_by: [{ sources: ['host:os_type'] }],
        conditions: { logic: 'and', children: [{ scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] }] },
      },
    });
    expect(params.group_by).toBeUndefined();
    expect(params.conditions).toEqual({
      logic: 'and',
      children: [{ scope: 'host', attr_id: 'os_type', operator: 'list_any[]', value: ['2'] }],
    });
  });

  it('lets response fields replace a static schema and reach a single-value path', () => {
    const columns = resolveTableLikeColumns({
      schemaFields: [{ key: 'group_value', title: '分组值', value_type: 'string' }],
      responseFields: [{ key: 'host:ip_addr', title: '主机 · 内网IP', value_type: 'string' }],
      rows: [{ 'host:ip_addr': '10.0.0.8' }],
    });
    expect(columns.map((column) => column.key)).toEqual(['host:ip_addr']);

    const payload = {
      count: 1,
      items: [{ scope_count: 9, count: 4 }],
      fields: [{ key: 'scope_count', title: '范围内数量', value_type: 'number' }],
    };
    const tree = buildTreeData(payload, payload.fields);
    const scope = tree.flatMap((node) => node.children || []).find((node) => String(node.key).endsWith('scope_count'));
    expect(scope?.key).toBe('items.scope_count');
    expect(getValueByPath(payload, 'items.scope_count')).toBe(9);
    expect(getValueByPath(payload, 'count')).toBe(1);

    const labeled = buildTreeData({
      count: 1,
      items: [{ scope_count: 9, count: 4 }],
      fields: [
        { key: 'scope_count', title: '实例数量', value_type: 'number' },
        { key: 'count', title: '数量', value_type: 'number' },
      ],
    }, [
      { key: 'scope_count', title: '实例数量', value_type: 'number' },
      { key: 'count', title: '数量', value_type: 'number' },
    ], { envelopeCountLabel: '结果行数' });
    const titleText = (node: { title?: unknown; children?: Array<{ title?: unknown; key?: unknown }> } | undefined): string => {
      const title = node?.title;
      if (typeof title === 'string') return title;
      if (title && typeof title === 'object' && 'props' in title) {
        const children = (title as { props?: { children?: unknown } }).props?.children;
        return Array.isArray(children)
          ? children.map((child) => titleText({ title: child })).join('')
          : titleText({ title: children });
      }
      return '';
    };
    expect(titleText(labeled.find((node) => node.key === 'count'))).toContain('结果行数');
    const itemCount = labeled.find((node) => node.key === 'items')?.children?.find((node) => String(node.key).endsWith('count'));
    const scopeCount = labeled.find((node) => node.key === 'items')?.children?.find((node) => String(node.key).endsWith('scope_count'));
    expect(titleText(itemCount)).toContain('数量');
    expect(titleText(itemCount)).not.toContain('结果行数');
    expect(titleText(scopeCount)).toContain('实例数量');
    expect(preferredInstanceCountKey(labeled)).toBe('items.scope_count');
    expect(preferredInstanceCountKey([{ key: 'count' }, { key: 'scope_count' }])).toBe('scope_count');
  });
});
