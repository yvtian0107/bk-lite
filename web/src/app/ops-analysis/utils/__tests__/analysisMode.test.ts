import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { ParamItem } from '@/app/ops-analysis/types/dataSource';
import {
  filterChartTypesForAnalysisMode,
  isParamVisibleForAnalysisMode,
  resolveAnalysisModeValue,
} from '@/app/ops-analysis/utils/analysisMode';
import { mergeDetectedFieldsWithSchema } from '@/app/ops-analysis/components/widgetConfig/utils/columnProbing';
import { resolveTableLikeColumns } from '@/app/ops-analysis/utils/tableLikeData';
import { buildCompareRequestParams } from '@/app/ops-analysis/utils/compareQuery';
import { processDataSourceFormParamsForSubmit } from '@/app/ops-analysis/utils/dataSourceFormParams';
import {
  buildWidgetRequestParams,
  fetchWidgetData,
  processDataSourceParams,
} from '@/app/ops-analysis/utils/widgetDataTransform';

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
    assert.deepEqual(processDataSourceParams({ sourceParams: params, chartType: 'bar' }), {
      query: 'up',
      step: '5m',
    });
    const legacyPaging = processDataSourceParams({
      sourceParams: [
        ...params,
        { name: 'page', alias_name: '页码', type: 'number', filterType: 'params', value: 2 },
        { name: 'page_size', alias_name: '每页', type: 'number', filterType: 'params', value: 15 },
      ],
      chartType: 'bar',
    });
    assert.equal(legacyPaging.page, 2);
    assert.equal(legacyPaging.page_size, 15);
    assert.deepEqual(
      filterChartTypesForAnalysisMode([{ value: 'line' }, { value: 'bar' }], params, undefined),
      [{ value: 'line' }, { value: 'bar' }],
    );
  });
});

const modelCatalog = (): ParamItem[] => [
  modeParam([
    { label: '明细', value: 'detail', charts: ['table'], result: { structure: 'table' } },
    { label: '计数', value: 'count', charts: ['single'], result: { structure: 'value' } },
    { label: '分布', value: 'distribution', charts: ['bar', 'pie', 'topN'], result: { structure: 'category' } },
  ]),
  { name: 'model_id', alias_name: '模型', type: 'string', filterType: 'params', value: 'host' },
  { name: 'page', alias_name: '页码', type: 'number', filterType: 'params', value: 1, visible_modes: ['detail'] },
  { name: 'page_size', alias_name: '每页', type: 'number', filterType: 'params', value: 20, visible_modes: ['detail'] },
];

const withPaging = (page: number, pageSize: number): ParamItem[] =>
  modelCatalog().map((param) => {
    if (param.name === 'page') return { ...param, value: page };
    if (param.name === 'page_size') return { ...param, value: pageSize };
    if (param.name === 'analysis_mode') return { ...param, value: 'detail' };
    return param;
  });

describe('chart requests drop paging outside detail', () => {
  it('omits page for bar, pie, ranking and single even when the saved mode is still detail', () => {
    const params = withPaging(3, 50);
    for (const chartType of ['bar', 'pie', 'topN', 'single']) {
      const request = buildWidgetRequestParams({
        config: { chartType, dataSourceParams: params },
        dataSource: { params: modelCatalog() },
        extraParams: { page: 3, page_size: 50 },
      });
      assert.equal(request.page, undefined, chartType);
      assert.equal(request.page_size, undefined, chartType);
      assert.equal(
        request.analysis_mode,
        chartType === 'single' ? 'count' : 'distribution',
      );
    }
  });

  it('keeps the saved page when the chart returns to the table', () => {
    const params = withPaging(4, 50);
    const request = buildCompareRequestParams({
      config: { chartType: 'table', dataSourceParams: params },
      dataSource: { params: modelCatalog() },
    });
    assert.equal(request.currentParams.analysis_mode, 'detail');
    assert.equal(request.currentParams.page, 4);
    assert.equal(request.currentParams.page_size, 50);
  });

  it('uses the saved chart type for run and compare when the caller omits chartType', async () => {
    const params = withPaging(1, 20);
    const compared = buildCompareRequestParams({
      config: { chartType: 'topN', dataSourceParams: params, dataSource: 8 },
      dataSource: { params: modelCatalog() },
    });
    assert.equal(compared.currentParams.page, undefined);
    assert.equal(compared.currentParams.analysis_mode, 'distribution');

    let captured: Record<string, unknown> | undefined;
    await fetchWidgetData({
      config: { dataSource: 8, chartType: 'pie', dataSourceParams: params },
      dataSource: { params: modelCatalog() },
      getSourceDataByApiId: async (_id, request) => {
        captured = request;
        return { data: { structure: 'category', items: [] } };
      },
    });
    assert.equal(captured?.page, undefined);
    assert.equal(captured?.page_size, undefined);
    assert.equal(captured?.analysis_mode, 'distribution');
  });

  it('keeps four model columns when the table is empty and a re-probe sees no aliases', () => {
    const schema = [
      { key: 'classification_name', title: '分类', value_type: 'string' as const },
      { key: 'model_name', title: '模型名称', value_type: 'string' as const },
      { key: 'model_id', title: '模型标识', value_type: 'string' as const },
      { key: 'instance_count', title: '实例数', value_type: 'number' as const },
    ];
    const headers = resolveTableLikeColumns({ schemaFields: schema, rows: [] });
    assert.deepEqual(headers.map((column) => column.key), schema.map((field) => field.key));
    const probed = mergeDetectedFieldsWithSchema(schema.map((field) => field.key), schema);
    assert.deepEqual(probed.map((column) => column.key), schema.map((field) => field.key));
    assert.equal(probed.some((column) => column.key === 'name' || column.key === 'value'), false);
  });
});

const countMetricParam = (value: string = 'model_count'): ParamItem => ({
  name: 'count_metric',
  alias_name: '统计内容',
  type: 'string',
  filterType: 'params',
  value,
  visible_modes: ['count'],
  inputConfig: {
    control: 'select',
    optionsSource: {
      type: 'static',
      staticItems: [
        { label: '模型数量', value: 'model_count' },
        { label: '实例总数', value: 'instance_total' },
      ],
    },
  },
});

describe('model single-value count metric stays on the count request', () => {
  it('sends the default only for single and drops it for bar, pie, ranking and table', () => {
    const params = [...modelCatalog(), countMetricParam('instance_total')];
    const single = buildWidgetRequestParams({
      config: { chartType: 'single', dataSourceParams: params },
      dataSource: { params: modelCatalog().concat(countMetricParam()) },
    });
    assert.equal(single.analysis_mode, 'count');
    assert.equal(single.count_metric, 'instance_total');
    assert.equal(single.page, undefined);
    assert.equal(single.page_size, undefined);

    for (const chartType of ['bar', 'pie', 'topN', 'table']) {
      const request = buildWidgetRequestParams({
        config: { chartType, dataSourceParams: params },
        dataSource: { params },
      });
      assert.equal(request.count_metric, undefined, chartType);
      assert.equal(request.page, chartType === 'table' ? 1 : undefined, chartType);
      assert.equal(request.page_size, chartType === 'table' ? 20 : undefined, chartType);
    }
  });

  it('keeps a saved metric while the request follows visible modes', () => {
    const definition = [...modelCatalog(), countMetricParam()];
    const saved = processDataSourceFormParamsForSubmit(
      { count_metric: 'instance_total', analysis_mode: 'distribution', page: 2, page_size: 20 },
      definition,
    );
    assert.equal(saved.find((param) => param.name === 'count_metric')?.value, 'instance_total');
    const request = buildWidgetRequestParams({
      config: { chartType: 'pie', dataSourceParams: saved },
      dataSource: { params: definition },
    });
    assert.equal(request.analysis_mode, 'distribution');
    assert.equal(request.count_metric, undefined);
    assert.equal(request.page, undefined);
    const back = buildWidgetRequestParams({
      config: { chartType: 'single', dataSourceParams: saved },
      dataSource: { params: definition },
    });
    assert.equal(back.analysis_mode, 'count');
    assert.equal(back.count_metric, 'instance_total');
    assert.equal(back.page, undefined);
  });
});

const rankingCatalog = (): ParamItem[] => [
  ...modelCatalog(),
  {
    name: 'order',
    alias_name: '排序',
    type: 'order',
    filterType: 'params',
    value: 'name',
    visible_modes: ['detail', 'distribution'],
    visible_charts: ['table', 'bar', 'pie'],
  },
  {
    name: 'top_n',
    alias_name: '展示前几名',
    type: 'number',
    filterType: 'params',
    value: 10,
    integer: true,
    maximum: 500,
    visible_modes: ['distribution'],
    visible_charts: ['topN'],
  },
];

describe('model ranking top N stays on the ranking chart', () => {
  it('sends the saved rank limit for topN and omits it for bar, pie, table and single', () => {
    const saved = rankingCatalog().map((param) => (
      param.name === 'top_n' ? { ...param, value: 5 } : param
    ));
    const ranking = buildCompareRequestParams({
      config: { chartType: 'topN', dataSourceParams: saved },
      dataSource: { params: rankingCatalog() },
    });
    assert.equal(ranking.currentParams.top_n, 5);
    assert.equal(ranking.currentParams.page, undefined);
    assert.equal(ranking.currentParams.order, undefined);
    assert.equal(ranking.currentParams.analysis_mode, 'distribution');

    for (const chartType of ['bar', 'pie', 'table', 'single']) {
      const request = buildWidgetRequestParams({
        config: { chartType, dataSourceParams: saved },
        dataSource: { params: rankingCatalog() },
      });
      assert.equal(request.top_n, undefined, chartType);
    }

    const bar = buildWidgetRequestParams({
      config: { chartType: 'bar', dataSourceParams: saved },
      dataSource: { params: rankingCatalog() },
    });
    assert.equal(bar.order, 'name');
    assert.equal(bar.page, undefined);
    const table = buildWidgetRequestParams({
      config: { chartType: 'table', dataSourceParams: saved },
      dataSource: { params: rankingCatalog() },
    });
    assert.equal(table.page, 1);
    assert.equal(table.order, 'name');
  });

  it('uses the catalog default of 10 when an older ranking widget has no saved limit', () => {
    const saved = rankingCatalog().filter((param) => param.name !== 'top_n');
    const ranking = processDataSourceParams({
      sourceParams: saved,
      definitionParams: rankingCatalog(),
      userParams: Object.fromEntries(saved.map((param) => [param.name, param.value])),
      chartType: 'topN',
    });
    const bar = processDataSourceParams({
      sourceParams: saved,
      definitionParams: rankingCatalog(),
      userParams: Object.fromEntries(saved.map((param) => [param.name, param.value])),
      chartType: 'bar',
    });
    assert.equal(ranking.top_n, 10);
    assert.equal(ranking.page, undefined);
    assert.equal(bar.top_n, undefined);
    assert.equal(bar.page, undefined);
  });

  it('keeps paging for a source that has no analysis mode', () => {
    const request = processDataSourceParams({
      sourceParams: [
        { name: 'query', alias_name: '查询', type: 'string', filterType: 'params', value: 'up' },
        { name: 'page', alias_name: '页码', type: 'number', filterType: 'params', value: 2 },
        { name: 'page_size', alias_name: '每页', type: 'number', filterType: 'params', value: 15 },
      ],
      chartType: 'topN',
    });
    assert.equal(request.page, 2);
    assert.equal(request.page_size, 15);
    assert.equal(request.top_n, undefined);
  });
});

describe('single value metric and ranking limit stay on their own charts', () => {
  it('does not carry the other chart’s hidden params or paging', () => {
    const catalog = [...rankingCatalog(), countMetricParam('instance_total')];
    const single = buildWidgetRequestParams({
      config: { chartType: 'single', dataSourceParams: catalog },
      dataSource: { params: catalog },
    });
    assert.equal(single.analysis_mode, 'count');
    assert.equal(single.count_metric, 'instance_total');
    assert.equal(single.top_n, undefined);
    assert.equal(single.page, undefined);
    assert.equal(single.page_size, undefined);
    assert.equal(single.order, undefined);

    const ranking = buildWidgetRequestParams({
      config: { chartType: 'topN', dataSourceParams: catalog },
      dataSource: { params: catalog },
    });
    assert.equal(ranking.analysis_mode, 'distribution');
    assert.equal(ranking.top_n, 10);
    assert.equal(ranking.count_metric, undefined);
    assert.equal(ranking.page, undefined);
    assert.equal(ranking.page_size, undefined);
    assert.equal(ranking.order, undefined);

    const bar = buildWidgetRequestParams({
      config: { chartType: 'bar', dataSourceParams: catalog },
      dataSource: { params: catalog },
    });
    assert.equal(bar.analysis_mode, 'distribution');
    assert.equal(bar.top_n, undefined);
    assert.equal(bar.count_metric, undefined);
    assert.equal(bar.page, undefined);
    assert.equal(bar.order, 'name');

    const table = buildWidgetRequestParams({
      config: { chartType: 'table', dataSourceParams: catalog },
      dataSource: { params: catalog },
    });
    assert.equal(table.analysis_mode, 'detail');
    assert.equal(table.page, 1);
    assert.equal(table.page_size, 20);
    assert.equal(table.count_metric, undefined);
    assert.equal(table.top_n, undefined);
  });
});
