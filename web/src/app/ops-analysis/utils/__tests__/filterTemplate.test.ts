import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import type {
  FilterValue,
  UnifiedFilterDefinition,
} from '@/app/ops-analysis/types/dashBoard';
import {
  listFilterTemplateVariables,
  resolveFilterTemplate,
  type FilterTemplateLabels,
} from '@/app/ops-analysis/utils/filterTemplate';

const filter = (
  overrides: Partial<UnifiedFilterDefinition> & Pick<UnifiedFilterDefinition, 'id' | 'key' | 'type'>,
): UnifiedFilterDefinition => ({
  name: overrides.key,
  order: 0,
  enabled: true,
  ...overrides,
});

const labels = (overrides: Partial<FilterTemplateLabels> = {}): FilterTemplateLabels => ({
  optionLabelsByFilterId: {},
  timeRangeLabels: {},
  dateRangeLabels: {},
  formatMultiSelect: (first, count) => `${first} 等 ${count} 项`,
  ...overrides,
});

const resolve = (
  text: string,
  definitions: UnifiedFilterDefinition[],
  appliedValues: Record<string, FilterValue> = {},
  displayLabels: Partial<FilterTemplateLabels> = {},
) => resolveFilterTemplate(text, definitions, appliedValues, labels(displayLabels));

describe('统一筛选标题模板', () => {
  const biz = filter({
    id: 'biz__string',
    key: 'biz',
    name: '业务',
    type: 'string',
    order: 1,
  });

  it('解析 $key$，并保留周围原文', () => {
    expect(resolve('【$biz$】告警', [biz], { 'biz__string': '蓝鲸' })).toBe('【蓝鲸】告警');
  });

  it('用 \\$ 输出字面量 $，不把它当成变量', () => {
    expect(resolve('费用\\$100，$biz$', [biz], { 'biz__string': '蓝鲸' })).toBe('费用$100，蓝鲸');
    expect(resolve('前缀\\$biz$', [biz], { 'biz__string': '蓝鲸' })).toBe('前缀$biz$');
  });

  it('同一 key 的第二个启用筛选用 $key:type$', () => {
    const amount = filter({
      id: 'biz__number',
      key: 'biz',
      name: '业务数',
      type: 'number',
      order: 2,
    });
    const variables = listFilterTemplateVariables([amount, biz]);

    expect(variables.map((item) => item.token)).toEqual(['$biz$', '$biz:number$']);
    expect(resolve('$biz$ / $biz:number$ / $biz:string$', [biz, amount], {
      'biz__string': '蓝鲸',
      'biz__number': 3,
    })).toBe('蓝鲸 / 3 / 蓝鲸');
  });

  it('排序靠前的启用项占用 $key$，禁用项不进入下拉也不参与替换', () => {
    const disabledText = filter({
      id: 'biz__string',
      key: 'biz',
      type: 'string',
      enabled: false,
      order: 0,
    });
    const amount = filter({
      id: 'biz__number',
      key: 'biz',
      name: '业务数',
      type: 'number',
      order: 2,
    });

    expect(listFilterTemplateVariables([disabledText, amount]).map((item) => item.token)).toEqual(['$biz$']);
    expect(resolve('$biz$', [disabledText], { 'biz__string': '蓝鲸' })).toBe('$biz$');
    expect(resolve('$biz$', [disabledText, amount], { 'biz__number': 8 })).toBe('8');
  });

  it('数字 0 和文本按值展示，未选或已删除的筛选保留占位符', () => {
    const count = filter({ id: 'count__number', key: 'count', type: 'number' });

    expect(resolve('$count$', [count], { 'count__number': 0 })).toBe('0');
    expect(resolve('$biz$', [biz], { 'biz__string': null })).toBe('$biz$');
    expect(resolve('$biz$', [biz], {})).toBe('$biz$');
    expect(resolve('$gone$', [biz], {})).toBe('$gone$');
    expect(resolve('', [biz])).toBe('');
  });

  it('静态选项显示 label，动态选项加载中或对不上时保留占位符', () => {
    const room = filter({
      id: 'room__string',
      key: 'room',
      type: 'string',
      inputConfig: {
        control: 'select',
        optionsSource: {
          type: 'static',
          staticItems: [{ label: '一号机房', value: 7 }],
        },
      },
    });
    const dynamicBiz = filter({
      id: 'biz__string',
      key: 'biz',
      type: 'string',
      inputConfig: {
        control: 'select',
        optionsSource: {
          type: 'dynamic',
          valueField: 'id',
          labelField: 'name',
        },
      },
    });

    expect(resolve('$room$', [room], { 'room__string': 7 })).toBe('一号机房');
    expect(resolve('$room$', [room], { 'room__string': 8 })).toBe('$room$');
    expect(resolve('$biz$', [dynamicBiz], { 'biz__string': '42' })).toBe('$biz$');
    expect(resolve('$biz$', [dynamicBiz], { 'biz__string': '42' }, {
      optionLabelsByFilterId: { 'biz__string': { 42: '蓝鲸' } },
    })).toBe('蓝鲸');
    expect(resolve('$biz$', [dynamicBiz], { 'biz__string': '42' }, {
      optionLabelsByFilterId: { 'biz__string': {} },
    })).toBe('$biz$');
  });

  it('多选 1 项、2 项和 3 项以上按约定拼接', () => {
    const owners = filter({
      id: 'owner__string',
      key: 'owner',
      type: 'string',
      inputConfig: {
        control: 'select',
        multiple: true,
        optionsSource: {
          type: 'static',
          staticItems: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
            { label: 'C', value: 'c' },
          ],
        },
      },
    });

    expect(resolve('$owner$', [owners], { 'owner__string': ['a'] })).toBe('A');
    expect(resolve('$owner$', [owners], { 'owner__string': ['a', 'b'] })).toBe('A、B');
    expect(resolve('$owner$', [owners], { 'owner__string': ['a', 'b', 'c'] })).toBe('A 等 3 项');
    expect(resolve('$owner$', [owners], { 'owner__string': ['a', 'missing'] })).toBe('$owner$');
    expect(resolve('$owner$', [owners], { 'owner__string': [] })).toBe('$owner$');
  });

  it('时间范围用快捷项文案，自定义用起止时间', () => {
    const time = filter({ id: 'time__timeRange', key: 'time', type: 'timeRange' });
    const start = '2024-03-01T00:00:00.000Z';
    const end = '2024-03-08T00:00:00.000Z';

    expect(resolve('$time$', [time], {
      'time__timeRange': { start, end, selectValue: 10080 },
    }, {
      timeRangeLabels: { 10080: '近 7 天' },
    })).toBe('近 7 天');
    expect(resolve('$time$', [time], {
      'time__timeRange': { start, end, selectValue: 0 },
    })).toBe(`${dayjs(start).format('YYYY-MM-DD HH:mm:ss')} ~ ${dayjs(end).format('YYYY-MM-DD HH:mm:ss')}`);
    expect(resolve('$time$', [time], {
      'time__timeRange': { start, end, selectValue: 999 },
    }, {
      timeRangeLabels: { 10080: '近 7 天' },
    })).toBe('$time$');
    expect(resolve('$time$', [time], { 'time__timeRange': null })).toBe('$time$');
  });

  it('日期范围用快捷文案或起止日期', () => {
    const date = filter({ id: 'date__dateRange', key: 'date', type: 'dateRange' });

    expect(resolve('$date$', [date], {
      'date__dateRange': { rangeType: 'last_7_days' },
    }, {
      dateRangeLabels: { last_7_days: '最近7天' },
    })).toBe('最近7天');
    expect(resolve('$date$', [date], {
      'date__dateRange': { rangeType: 'custom', startDate: '2024-03-01', endDate: '2024-03-08' },
    })).toBe('2024-03-01 ~ 2024-03-08');
    expect(resolve('$date$', [date], { 'date__dateRange': null })).toBe('$date$');
  });

  it('组织未加载或找不到名称时保留占位符，加载后显示组织名', () => {
    const org = filter({
      id: 'org__string',
      key: 'org',
      type: 'string',
      inputConfig: { control: 'organization' },
    });

    expect(resolve('$org$', [org], { 'org__string': 12 })).toBe('$org$');
    expect(resolve('$org$', [org], { 'org__string': 12 }, { orgNamesById: {} })).toBe('$org$');
    expect(resolve('$org$', [org], { 'org__string': 12 }, {
      orgNamesById: { 12: '运维一组' },
    })).toBe('运维一组');
  });
});
