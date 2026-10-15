import React, { useEffect, useMemo } from 'react';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { Form, Input, Segmented, Tooltip } from 'antd';

import { FilterTokenInput } from '@/app/ops-analysis/components/filterTokenInput';
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

  useEffect(() => {
    if (capability.data || kind !== 'data') return;
    form.setFieldValue(['interaction', 'kind'], 'title');
  }, [capability.data, form, kind]);

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

  const linkTypeTip = capability.data ? (
    <div>
      <div>{t('dashboard.interactionLinkTypeTitleTip', '标题链接：标题旁显示图标')}</div>
      <div>{t('dashboard.interactionLinkTypeDataTip', '数据链接：点击数据点、柱、扇区或数字打开')}</div>
    </div>
  ) : (
    t('dashboard.interactionTitleOnlyTip', '该组件仅支持标题链接，点击标题旁图标打开')
  );

  return (
    <section>
      <Form.Item name={['interaction', 'kind']} hidden>
        <Input />
      </Form.Item>
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center text-sm text-(--color-text-1)">
            <span>
              {capability.data
                ? t('dashboard.interactionLinkType', '链接类型')
                : t('dashboard.interactionTitleLink', '标题链接')}
            </span>
            <Tooltip title={linkTypeTip}>
              <QuestionCircleOutlined className="ml-1 cursor-help text-(--color-text-3)" />
            </Tooltip>
          </div>
          {capability.data ? (
            <Segmented
              value={selectedKind}
              onChange={(value) => selectKind(value === 'data' ? 'data' : 'title')}
              options={[
                { label: t('dashboard.interactionTitleLink', '标题链接'), value: 'title' },
                { label: t('dashboard.interactionDataLink', '数据链接'), value: 'data' },
              ]}
            />
          ) : null}
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
          required
        >
          <FilterTokenInput
            t={t}
            variables={variables}
            hint=""
            placeholder={t('dashboard.interactionUrlPlaceholder', '输入 URL，键入 $ 插入变量')}
          />
        </Form.Item>
        <Form.Item
          label={t('dashboard.interactionOpenMode', '打开方式')}
          name={['interaction', 'openMode']}
        >
          <Segmented
            size="small"
            options={[
              { label: t('dashboard.interactionSameTab', '当前页'), value: 'sameTab' },
              { label: t('dashboard.interactionNewTab', '新标签'), value: 'newTab' },
            ]}
          />
        </Form.Item>
      </div>
    </section>
  );
};

export default InteractionLinkSection;
