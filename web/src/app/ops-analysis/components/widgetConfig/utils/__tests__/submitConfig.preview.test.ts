import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParamItem } from '@/app/ops-analysis/types/dataSource';
import {
  buildWidgetDraftConfig,
  buildWidgetSubmitConfig,
} from '../submitConfig';

const baseInput = {
  showChartThemeMode: false,
  showTableFilterFields: false,
  selectedFields: [],
  thresholdColors: [],
  filterBindings: {},
  displayColumns: [],
  filterFields: [],
  actions: [],
};

const switchParam = (name: string): ParamItem => ({
  name,
  alias_name: name,
  type: 'string',
  filterType: 'params',
  value: 'a',
  inputConfig: {
    control: 'select',
    componentSwitch: true,
    optionsSource: { type: 'static', staticItems: [] },
  },
});

test('preview draft skips cardList title required that blocks save', () => {
  const input = {
    ...baseInput,
    chartType: 'cardList',
    values: {
      name: '卡片列表',
      chartType: 'cardList',
      cardList: { titleField: '   ' },
    },
  };

  const saved = buildWidgetSubmitConfig(input);
  assert.equal(saved.error, 'cardListTitleRequired');
  assert.equal(saved.config, undefined);

  const draft = buildWidgetDraftConfig(input);
  assert.ok(draft);
  assert.equal(draft.chartType, 'cardList');
  assert.equal('cardList' in draft, false);
});

test('preview draft skips empty leading field that blocks save', () => {
  const input = {
    ...baseInput,
    chartType: 'cardList',
    values: {
      name: '卡片列表',
      chartType: 'cardList',
      cardList: { titleField: 'title', leading: { type: 'field' as const, field: '  ' } },
    },
  };

  const saved = buildWidgetSubmitConfig(input);
  assert.equal(saved.error, 'cardListLeadingFieldRequired');
  assert.equal(saved.config, undefined);

  const draft = buildWidgetDraftConfig(input);
  assert.ok(draft);
  assert.deepEqual(draft.cardList, { titleField: 'title' });
});

test('preview draft skips duplicate table keys that block save', () => {
  const input = {
    ...baseInput,
    chartType: 'table',
    values: {
      name: '表格',
      chartType: 'table',
    },
    displayColumns: [
      { id: 'a', key: 'cpu', title: 'CPU', visible: true, order: 0 },
      { id: 'b', key: 'cpu', title: 'CPU 2', visible: true, order: 1 },
    ],
  };

  const saved = buildWidgetSubmitConfig(input);
  assert.equal(saved.error, 'duplicateFieldKey');
  assert.equal(saved.config, undefined);

  const draft = buildWidgetDraftConfig(input);
  assert.ok(draft);
  assert.equal(draft.tableConfig?.columns?.length, 2);
});

test('preview draft skips hidden-only columns that block save', () => {
  const input = {
    ...baseInput,
    chartType: 'table',
    values: {
      name: '表格',
      chartType: 'table',
    },
    displayColumns: [
      { id: 'a', key: 'cpu', title: 'CPU', visible: false, order: 0 },
    ],
  };

  const saved = buildWidgetSubmitConfig(input);
  assert.equal(saved.error, 'atLeastOneVisibleColumn');
  assert.equal(saved.config, undefined);

  const draft = buildWidgetDraftConfig(input);
  assert.ok(draft);
  assert.equal(draft.tableConfig?.columns?.[0]?.visible, false);
});

test('preview draft skips multiple componentSwitch params that block save', () => {
  const input = {
    ...baseInput,
    chartType: 'topN',
    values: {
      name: 'TopN',
      chartType: 'topN',
      dataSourceParams: [switchParam('room'), switchParam('cluster')],
    },
  };

  const saved = buildWidgetSubmitConfig(input);
  assert.equal(saved.error, 'multipleComponentSwitchParams');
  assert.equal(saved.config, undefined);

  const nodeGraph = buildWidgetSubmitConfig({
    ...input,
    chartType: 'nodeGraph',
    values: {
      ...input.values,
      name: '关系',
      chartType: 'nodeGraph',
    },
  });
  assert.equal(nodeGraph.error, 'multipleComponentSwitchParams');
  assert.equal(nodeGraph.config, undefined);

  const draft = buildWidgetDraftConfig(input);
  assert.ok(draft);
  assert.equal(draft.chartType, 'topN');
});

const visibleNameColumn = [
  { id: 'a', key: 'inst_name', title: '名称', visible: true, order: 0 },
];

const inheritedCmdbQueryParams = (): ParamItem[] => [
  {
    name: 'analysis_mode',
    alias_name: '分析方式',
    type: 'string',
    filterType: 'params',
    required: true,
    value: 'list',
    inputConfig: {
      control: 'select',
      componentSwitch: true,
      optionsSource: {
        type: 'static',
        staticItems: [
          { label: '明细', value: 'list' },
          { label: '数量', value: 'count' },
        ],
      },
    },
  },
  {
    name: 'model_id',
    alias_name: '模型',
    type: 'string',
    filterType: 'params',
    required: true,
    value: 'host',
    inputConfig: {
      control: 'select',
      componentSwitch: true,
      optionsSource: {
        type: 'dynamic',
        sourceRef: { type: 'rest_api', value: 'cmdb/get_model_options' },
        valueField: 'model_id',
        labelField: 'model_name',
      },
    },
  },
  {
    name: 'page',
    alias_name: '页码',
    type: 'number',
    filterType: 'params',
    value: 1,
  },
];

test('cmdb instance query table saves without a manual component switch override', () => {
  const saved = buildWidgetSubmitConfig({
    ...baseInput,
    chartType: 'table',
    displayColumns: visibleNameColumn,
    values: {
      name: 'CMDB 实例查询',
      chartType: 'table',
      dataSourceParams: inheritedCmdbQueryParams(),
    },
  });

  assert.equal(saved.error, undefined);
  const stored = saved.config?.dataSourceParams || [];
  for (const name of ['analysis_mode', 'model_id']) {
    const param = stored.find((item) => item.name === name);
    assert.ok(param?.inputConfig && param.inputConfig.control === 'select');
    assert.equal('componentSwitch' in param.inputConfig, false);
    assert.ok(param.inputConfig.optionsSource);
  }
  assert.equal(stored.find((item) => item.name === 'analysis_mode')?.value, 'list');
  assert.equal(stored.find((item) => item.name === 'model_id')?.value, 'host');
  const modelConfig = stored.find((item) => item.name === 'model_id')?.inputConfig;
  assert.ok(modelConfig && modelConfig.control === 'select');
  assert.equal(modelConfig.optionsSource.type, 'dynamic');
  if (modelConfig.optionsSource.type === 'dynamic') {
    assert.equal(modelConfig.optionsSource.sourceRef?.value, 'cmdb/get_model_options');
  }
  assert.equal(stored.find((item) => item.name === 'page')?.value, 1);
});

test('table keeps one component switch used by a chart that supports switching', () => {
  const saved = buildWidgetSubmitConfig({
    ...baseInput,
    chartType: 'table',
    displayColumns: visibleNameColumn,
    values: {
      name: '排行',
      chartType: 'table',
      dataSourceParams: [switchParam('metric')],
    },
  });

  assert.equal(saved.error, undefined);
  const metric = saved.config?.dataSourceParams?.find((item) => item.name === 'metric');
  assert.ok(metric?.inputConfig && metric.inputConfig.control === 'select');
  assert.equal(metric.inputConfig.componentSwitch, true);
});

test('preview draft still carries filter bindings', () => {
  const draft = buildWidgetDraftConfig({
    ...baseInput,
    chartType: 'line',
    filterBindings: { instance_ids__string: true },
    values: {
      name: '折线',
      chartType: 'line',
      dataSource: 9,
    },
  });

  assert.deepEqual(draft?.filterBindings, { instance_ids__string: true });
});
