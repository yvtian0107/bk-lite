import { describe, expect, it } from 'vitest';

import { reconcileComponentParamValue } from '@/app/ops-analysis/utils/componentParamSwitch';
import { processDataSourceParams } from '@/app/ops-analysis/utils/widgetDataTransform';
import { resolveTableLikeColumns } from '@/app/ops-analysis/utils/tableLikeData';
import { buildTreeData } from '@/app/ops-analysis/(pages)/view/topology/utils/dataTreeUtils';
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
  });
});
