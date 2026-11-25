import React from 'react';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, InputNumber, Switch } from 'antd';
import { supportsAutoScroll } from '@/app/ops-analysis/utils/widgetAutoScroll';

interface ChartBehaviorFieldsProps {
  t: (key: string) => string;
  chartType?: string;
}

export const ChartBehaviorFields: React.FC<ChartBehaviorFieldsProps> = ({
  t,
  chartType,
}) => {
  const showReferenceLines = chartType === 'bar' || chartType === 'line';
  const showAutoScroll = supportsAutoScroll(chartType);
  if (!showReferenceLines && !showAutoScroll && chartType !== 'bar') return null;

  return (
    <div className="space-y-3">
      {chartType === 'bar' ? (
        <Form.Item
          className="!mb-0"
          label={t('dashboard.barStack')}
          name="stack"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      ) : null}
      {chartType === 'line' ? (
        <Form.Item name="stack" hidden valuePropName="checked">
          <Switch />
        </Form.Item>
      ) : null}
      {showReferenceLines ? (
        <Form.Item className="!mb-0" label={t('dashboard.referenceLines')}>
          <Form.List name="referenceLines">
            {(fields, { add, remove }) => (
              <div className="space-y-2">
                {fields.map((field) => (
                  <div
                    key={field.key}
                    className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-start gap-2"
                  >
                    <Form.Item name={[field.name, 'name']} className="!mb-0">
                      <Input placeholder={t('dashboard.referenceLineName')} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'value']} className="!mb-0">
                      <InputNumber
                        className="w-full"
                        placeholder={t('dashboard.referenceLineValue')}
                      />
                    </Form.Item>
                    <Button
                      type="text"
                      aria-label={t('dashboard.referenceLineRemove')}
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() => add({})}
                >
                  {t('dashboard.referenceLineAdd')}
                </Button>
              </div>
            )}
          </Form.List>
        </Form.Item>
      ) : null}
      {showAutoScroll ? (
        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item
            className="!mb-0"
            label={t('dashboard.autoScroll')}
            name="autoScrollEnabled"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            className="!mb-0"
            label={t('dashboard.autoScrollInterval')}
            name="autoScrollIntervalSec"
          >
            <InputNumber
              className="w-full"
              min={0.5}
              max={60}
              step={0.5}
              precision={1}
            />
          </Form.Item>
        </div>
      ) : null}
    </div>
  );
};
