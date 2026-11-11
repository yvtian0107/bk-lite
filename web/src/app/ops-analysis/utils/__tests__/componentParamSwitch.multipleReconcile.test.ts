import { describe, expect, test } from 'vitest';
import {
  reconcileComponentParamValue,
  reconcileComponentSwitchValue,
  reconcileParamValueWithOptions,
} from '@/app/ops-analysis/utils/componentParamSwitch';
import { processDataSourceParams } from '@/app/ops-analysis/utils/widgetDataTransform';
import type { InputOption, ParamItem } from '@/app/ops-analysis/types/dataSource';

const OPTIONS: InputOption[] = [
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
];

describe('reconcileComponentParamValue multiple', () => {
  test('保留多选数组中仍存在于选项里的全部值，不得截成 options[0]', () => {
    expect(reconcileComponentParamValue(['1', '2'], OPTIONS)).toEqual(['1', '2']);
  });

  test('多选数组过滤已失效选项，空结果保持空数组', () => {
    expect(reconcileComponentParamValue(['9', '8'], OPTIONS)).toEqual([]);
    expect(reconcileComponentParamValue(['2', '9'], OPTIONS)).toEqual(['2']);
  });

  test('标量失效时清空，不自动选中第一项', () => {
    expect(reconcileComponentParamValue('2', OPTIONS)).toBe('2');
    expect(reconcileComponentParamValue('missing', OPTIONS)).toBeNull();
    expect(reconcileComponentSwitchValue('missing', OPTIONS)).toBeNull();
    expect(reconcileComponentSwitchValue('1', [])).toBeNull();
  });

  test('选项还没回来时保留现值，已经是空列表时清空失效值', () => {
    expect(reconcileComponentParamValue('saved', undefined)).toBe('saved');
    expect(reconcileComponentParamValue(['saved'], undefined)).toEqual(['saved']);
    expect(reconcileComponentParamValue('saved', [])).toBeNull();
    expect(reconcileComponentParamValue(['saved', 'kept'], [])).toEqual([]);
    expect(reconcileComponentParamValue(null, [])).toBeNull();
  });

  test('确认提交链路：多选查询参数经选项对齐后请求仍为完整数组', () => {
    const formValue = ['1', '2'];
    const reconciled = reconcileComponentParamValue(formValue, OPTIONS);
    const sourceParams: ParamItem[] = [
      {
        name: 'cheshi2',
        alias_name: '测试',
        type: 'string',
        filterType: 'params',
        value: reconciled,
        inputConfig: {
          control: 'select',
          multiple: true,
          optionsSource: {
            type: 'static',
            staticItems: OPTIONS,
          },
        },
      },
    ];

    expect(
      processDataSourceParams({
        sourceParams,
        userParams: { cheshi2: reconciled },
      }),
    ).toEqual({ cheshi2: ['1', '2'] });
  });
});

describe('reconcileParamValueWithOptions leaves catalog controls alone', () => {
  const catalogOptions: InputOption[] = [
    { label: '主机 · 容量', value: 'host:capacity' },
    { label: '实例名', value: 'inst_name' },
  ];
  const conditions = {
    logic: 'and',
    children: [{
      logic: 'and',
      model_id: 'host',
      children: [{ scope: 'host', attr_id: 'capacity', operator: 'int>', value: 1 }],
    }],
  };
  const metrics = [{ sources: ['host:capacity'], func: 'sum', label: '容量' }];

  test('下拉仍清掉不在选项里的值，retain 仍保留', () => {
    const select = {
      inputConfig: { control: 'select' as const, optionsSource: { type: 'static' as const, staticItems: catalogOptions } },
    };
    const retain = {
      inputConfig: {
        control: 'select' as const,
        missingOptionPolicy: 'retain' as const,
        optionsSource: { type: 'static' as const, staticItems: catalogOptions },
      },
    };
    expect(reconcileParamValueWithOptions(select, ['host:capacity', 'gone'], catalogOptions)).toEqual(['host:capacity']);
    expect(reconcileParamValueWithOptions(select, 'gone', catalogOptions)).toBeNull();
    expect(reconcileParamValueWithOptions(retain, ['host:capacity', 'gone'], catalogOptions)).toEqual(['host:capacity', 'gone']);
  });

  test('条件卡片、字段分组和排序在目录就绪后保持原值', () => {
    const condition = { inputConfig: { control: 'condition' as const, optionsSource: { type: 'dynamic' as const, valueField: 'key', labelField: 'label' } } };
    const fieldGroup = { inputConfig: { control: 'fieldGroup' as const, variant: 'metrics' as const, optionsSource: { type: 'dynamic' as const, valueField: 'key', labelField: 'label' } } };
    const order = { inputConfig: { control: 'order' as const, optionsSource: { type: 'dynamic' as const, valueField: 'key', labelField: 'label' } } };
    expect(reconcileParamValueWithOptions(condition, conditions, catalogOptions)).toEqual(conditions);
    expect(reconcileParamValueWithOptions(fieldGroup, metrics, catalogOptions)).toEqual(metrics);
    expect(reconcileParamValueWithOptions(order, '-cpu_avg', catalogOptions)).toBe('-cpu_avg');
    expect(reconcileComponentParamValue(conditions, catalogOptions)).toBeNull();
    expect(reconcileComponentParamValue(metrics, catalogOptions)).toEqual([]);
  });
});
