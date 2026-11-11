import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { ParamItem } from '@/app/ops-analysis/types/dataSource';
import {
  filterChartTypesForAnalysisMode,
  isParamVisibleForAnalysisMode,
  resolveAnalysisModeValue,
} from '@/app/ops-analysis/utils/analysisMode';
import { processDataSourceParams } from '@/app/ops-analysis/utils/widgetDataTransform';

const modeParam = (items: Array<{
  label: string;
  value: string;
  charts: string[];
  result: { structure: 'table' | 'value' | 'category' | 'series' };
}>): ParamItem => ({
  name: 'analysis_mode',
  alias_name: '分析方式',
  type: 'string',
  filterType: 'params',
  value: 'detail',
  inputConfig: {
    control: 'select',
    optionsSource: { type: 'static', staticItems: items },
  },
});

const catalog = (): ParamItem[] => [
  modeParam([
    { label: '明细', value: 'detail', charts: ['table', 'topN'], result: { structure: 'table' } },
    { label: '计数', value: 'count', charts: ['single'], result: { structure: 'value' } },
    { label: '分布', value: 'distribution', charts: ['bar', 'pie'], result: { structure: 'category' } },
  ]),
  { name: 'model_id', alias_name: '模型', type: 'string', filterType: 'params', value: 'host' },
  { name: 'group_by', alias_name: '分组', type: 'string', filterType: 'params', value: 'os_type', visible_modes: ['distribution'] },
  { name: 'page', alias_name: '页码', type: 'number', filterType: 'params', value: null, visible_modes: ['detail'] },
  { name: 'page_size', alias_name: '每页', type: 'number', filterType: 'params', value: null, visible_modes: ['detail'] },
  {
    name: 'organization',
    alias_name: '组织',
    type: 'string',
    filterType: 'filter',
    value: '',
    inputConfig: { control: 'organization' },
  },
];

describe('analysis mode visibility and request', () => {
  it('hides params that do not belong to the selected mode', () => {
    const params = catalog();
    assert.equal(isParamVisibleForAnalysisMode(params[2], 'detail', params), false);
    assert.equal(isParamVisibleForAnalysisMode(params[2], 'distribution', params), true);
    assert.equal(isParamVisibleForAnalysisMode(params[1], 'count', params), true);
    assert.equal(isParamVisibleForAnalysisMode(params[0], 'count', params), true);
  });

  it('filters charts from the latest catalog options, not a stale widget copy', () => {
    const latest = catalog();
    const stale = catalog();
    const staleMode = stale[0];
    if (staleMode.inputConfig && staleMode.inputConfig.control === 'select') {
      staleMode.inputConfig = {
        control: 'select',
        optionsSource: {
          type: 'static',
          staticItems: [{ label: '旧明细', value: 'detail' }],
        },
      };
    }
    stale[2] = { ...stale[2], visible_modes: ['detail'] };
    const charts = filterChartTypesForAnalysisMode(
      [{ value: 'table' }, { value: 'single' }, { value: 'bar' }, { value: 'pie' }],
      latest,
      'distribution',
    );
    assert.deepEqual(charts.map((item) => item.value), ['table', 'single', 'bar', 'pie']);
    assert.deepEqual(
      filterChartTypesForAnalysisMode(
        [{ value: 'table' }, { value: 'line' }],
        stale,
        'detail',
      ).map((item) => item.value),
      ['table', 'line'],
    );
  });

  it('omits hidden params and keeps the selected mode when the widget copy is stale', () => {
    const latest = catalog();
    const stale = catalog();
    stale[2] = { ...stale[2], visible_modes: undefined };
    const request = processDataSourceParams({
      sourceParams: stale,
      definitionParams: latest,
      userParams: {
        analysis_mode: 'count',
        model_id: 'host',
        group_by: 'os_type',
        page: 1,
        page_size: 20,
      },
      chartType: 'single',
    });
    assert.equal(request.analysis_mode, 'count');
    assert.equal(request.model_id, 'host');
    assert.equal(request.group_by, undefined);
    assert.equal(request.page, undefined);
    assert.equal(request.page_size, undefined);
  });

  it('replaces the seed mode when the chart does not allow it', () => {
    const params = catalog();
    assert.equal(resolveAnalysisModeValue({
      params,
      selected: 'detail',
      chartType: 'pie',
    }), 'distribution');
    assert.equal(resolveAnalysisModeValue({
      params,
      selected: 'count',
      chartType: 'single',
    }), 'count');
  });

  it('picks a chart-compatible mode when the widget has no selection', () => {
    const params = catalog();
    assert.equal(resolveAnalysisModeValue({
      params,
      selected: '',
      chartType: 'pie',
    }), 'distribution');
    const request = processDataSourceParams({
      sourceParams: params.map((param) => (
        param.name === 'analysis_mode' ? { ...param, value: '' } : param
      )),
      definitionParams: params,
      chartType: 'pie',
    });
    assert.equal(request.analysis_mode, 'distribution');
    assert.equal(request.group_by, 'os_type');
    assert.equal(request.page, undefined);
  });

  it('uses paging defaults on detail and drops them for statistics', () => {
    const params = catalog().map((param) => {
      if (param.name === 'page') return { ...param, value: 1 };
      if (param.name === 'page_size') return { ...param, value: 20 };
      return param;
    });
    const detail = processDataSourceParams({
      sourceParams: params,
      definitionParams: params,
      chartType: 'table',
    });
    assert.equal(detail.page, 1);
    assert.equal(detail.page_size, 20);
    const custom = processDataSourceParams({
      sourceParams: params,
      definitionParams: params,
      userParams: { analysis_mode: 'detail', page: 3, page_size: 50 },
      chartType: 'table',
    });
    assert.equal(custom.page, 3);
    assert.equal(custom.page_size, 50);
    const cleared = processDataSourceParams({
      sourceParams: params,
      definitionParams: params,
      userParams: { analysis_mode: 'detail', page: null, page_size: null },
      chartType: 'table',
    });
    assert.equal(cleared.page, undefined);
    assert.equal(cleared.page_size, undefined);
    const counted = processDataSourceParams({
      sourceParams: params,
      definitionParams: params,
      userParams: { analysis_mode: 'count', page: 1, page_size: 20 },
      chartType: 'single',
    });
    assert.equal(counted.page, undefined);
    assert.equal(counted.page_size, undefined);
  });

  it('leaves a datasource without analysis_mode unchanged', () => {
    const params: ParamItem[] = [
      { name: 'query', alias_name: '查询', type: 'string', filterType: 'params', value: 'up' },
      { name: 'step', alias_name: '步长', type: 'string', filterType: 'params', value: '5m' },
    ];
    assert.equal(resolveAnalysisModeValue({ params, selected: undefined, chartType: 'line' }), undefined);
    assert.deepEqual(processDataSourceParams({ sourceParams: params }), {
      query: 'up',
      step: '5m',
    });
    assert.deepEqual(
      filterChartTypesForAnalysisMode([{ value: 'line' }, { value: 'bar' }], params, undefined),
      [{ value: 'line' }, { value: 'bar' }],
    );
  });
});
