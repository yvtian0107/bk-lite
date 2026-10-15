import React, { useMemo } from 'react';
import { Form, Input, Radio } from 'antd';

import { FilterTokenInput } from '@/app/ops-analysis/components/filterTokenInput';
import { ConfigSectionTitle } from '@/app/ops-analysis/components/widgetConfig/configTitles';
import type {
  UnifiedFilterDefinition,
  ValueConfig,
  WidgetInteractionKind,
} from '@/app/ops-analysis/types/dashBoard';
import { buildInteractionPoints } from '@/app/ops-analysis/utils/interactionPoints';
import {
  interactionCapability,
  listInteractionVariables,
  listPresentDataVariables,
} from '@/app/ops-analysis/utils/interactionLink';

type Translate = (
  key: string,
  defaultValue?: string,
  values?: Record<string, string | number>,
) => string;

interface InteractionLinkSectionProps {
  t: Translate;
  chartType?: string;
  definitions: UnifiedFilterDefinition[];
  rawData: unknown;
  fieldConfig?: ValueConfig | null;
}

const InteractionLinkSection: React.FC<InteractionLinkSectionProps> = ({
  t,
  chartType,
  definitions,
  rawData,
  fieldConfig,
}) => {
  const form = Form.useFormInstance();
  const kind = Form.useWatch(['interaction', 'kind'], form) as WidgetInteractionKind | undefined;
  const capability = interactionCapability(chartType);
  const selectedKind: WidgetInteractionKind = kind === 'data' && capability.data ? 'data' : 'title';

  const variables = useMemo(() => {
    const points = buildInteractionPoints(chartType, rawData, fieldConfig);
    const dataVariables = listPresentDataVariables(chartType, rawData, {
      valueGroup: t('dashboard.interactionGroupValue', '数据点'),
      fieldGroup: t('dashboard.interactionGroupField', '数据字段'),
      fieldLabel: (field) => field,
      category: t('dashboard.interactionPointCategory', '分类'),
      series: t('dashboard.interactionSeriesName', '系列'),
      name: t('dashboard.interactionPointName', '名称'),
      indicator: t('dashboard.interactionPointIndicator', '指标'),
      time: t('dashboard.interactionValueTime', '时间'),
      numeric: t('dashboard.interactionValueNumeric', '数值'),
      cabinetId: t('dashboard.interactionCabinetId', '机柜 ID'),
      cabinetName: t('dashboard.interactionCabinetName', '机柜名称'),
      deviceId: t('dashboard.interactionDeviceId', '设备 ID'),
      deviceName: t('dashboard.interactionDeviceName', '设备名称'),
      systemId: t('dashboard.interactionSystemId', '系统 ID'),
      systemName: t('dashboard.interactionSystemName', '系统名称'),
      hostId: t('dashboard.interactionHostId', '主机 ID'),
      hostName: t('dashboard.interactionHostName', '主机名称'),
    }, points);
    return listInteractionVariables({
      definitions,
      dataVariables: selectedKind === 'data' ? dataVariables : [],
      filterGroup: t('dashboard.interactionGroupFilter', '筛选条件'),
      timeStartLabel: (name) => t('dashboard.interactionTimeStart', '{name} 开始', { name }),
      timeEndLabel: (name) => t('dashboard.interactionTimeEnd', '{name} 结束', { name }),
    });
  }, [chartType, definitions, fieldConfig, rawData, selectedKind, t]);

  const selectKind = (next: WidgetInteractionKind) => {
    if (next === 'data' && !capability.data) return;
    form.setFieldValue(['interaction', 'kind'], next);
  };

  const dataHint = capability.data === 'table'
    ? t('dashboard.interactionDataTableHint', '表格只显示这一条操作按钮，字段取当前行。')
    : capability.data === 'timeline'
      ? t('dashboard.interactionDataTimelineHint', '单击事件卡片或标题时打开，字段取这条事件。')
      : capability.data === 'contextMenu'
        ? t('dashboard.interactionDataMenuHint', '在机柜、设备、系统或主机上右键打开，左键交互保持不变。')
        : t('dashboard.interactionDataClickHint', '单击数据点、柱、扇区或数字时打开。');

  return (
    <section>
      <ConfigSectionTitle>
        {t('dashboard.interactionSection', '交互')}
      </ConfigSectionTitle>
      <Form.Item name={['interaction', 'kind']} hidden>
        <Input />
      </Form.Item>
      <div className="space-y-4">
        <div className="rounded-md border border-(--color-border-1) p-3">
          <Radio
            checked={selectedKind === 'title'}
            onChange={() => selectKind('title')}
          >
            {t('dashboard.interactionTitleLink', '标题链接')}
          </Radio>
          <p className="mb-0 mt-1 text-xs text-(--color-text-3)">
            {t('dashboard.interactionTitleHint', '在标题旁显示图标。')}
          </p>
        </div>
        <div className={`rounded-md border border-(--color-border-1) p-3 ${capability.data ? '' : 'opacity-60'}`}>
          <Radio
            checked={selectedKind === 'data'}
            disabled={!capability.data}
            onChange={() => selectKind('data')}
          >
            {t('dashboard.interactionDataLink', '数据链接')}
          </Radio>
          <p className="mb-0 mt-1 text-xs text-(--color-text-3)">
            {capability.data
              ? dataHint
              : t('dashboard.interactionDataUnsupported', '这个组件只有标题链接。')}
          </p>
        </div>
        <Form.Item
          label={t('dashboard.interactionName', '名称')}
          name={['interaction', 'name']}
        >
          <Input placeholder={t('dashboard.interactionNamePlaceholder', '例如：查看详情')} />
        </Form.Item>
        <Form.Item
          label={t('dashboard.interactionUrl', '目标 URL')}
          name={['interaction', 'url']}
        >
          <FilterTokenInput
            t={t}
            variables={variables}
            hint={t('dashboard.interactionTokenHint', '输入 $ 选择要带上的值')}
            placeholder={t('dashboard.interactionUrlPlaceholder', 'https:// 或 / 开头的路径')}
          />
        </Form.Item>
        <Form.Item
          label={t('dashboard.interactionOpenMode', '打开方式')}
          name={['interaction', 'openMode']}
        >
          <Radio.Group>
            <Radio value="sameTab">{t('dashboard.interactionSameTab', '当前页')}</Radio>
            <Radio value="newTab">{t('dashboard.interactionNewTab', '新标签')}</Radio>
          </Radio.Group>
        </Form.Item>
      </div>
    </section>
  );
};

export default InteractionLinkSection;
