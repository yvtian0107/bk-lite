import React, { useCallback, useRef } from 'react';
import { Button, Form, Radio, Switch, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import SelectIcon, {
  type SelectIconRef,
} from '@/app/cmdb/(pages)/assetManage/management/list/selectIcon';
import { getModelIconUrl } from '@/app/cmdb/utils/modelIcon';
import {
  isSingleValueIconDataUrl,
  validateSingleValueIconFile,
} from '@/app/ops-analysis/utils/singleValueStyle';

const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';

interface SingleValueStyleSectionProps {
  t: (key: string) => string;
  showPreviewHint?: boolean;
  onAlignTouched?: () => void;
}

const ChoiceGroup: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}> = ({ value, onChange, options, disabled }) => (
  <Radio.Group
    value={value}
    disabled={disabled}
    optionType="button"
    buttonStyle="solid"
    onChange={(event) => onChange?.(event.target.value)}
  >
    {options.map((option) => (
      <Radio.Button key={option.value} value={option.value}>
        {option.label}
      </Radio.Button>
    ))}
  </Radio.Group>
);

const AlignChoice: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
  onTouched?: () => void;
  options: Array<{ value: string; label: string }>;
}> = ({ value, onChange, onTouched, options }) => (
  <div onClick={() => onTouched?.()}>
    <ChoiceGroup value={value} onChange={onChange} options={options} />
  </div>
);

export const SingleValueStyleSection: React.FC<SingleValueStyleSectionProps> = ({
  t,
  showPreviewHint = false,
  onAlignTouched,
}) => {
  const form = Form.useFormInstance();
  const selectIconRef = useRef<SelectIconRef>(null);
  const showIcon = Form.useWatch(['singleStyle', 'showIcon'], form) === true;
  const iconSource = Form.useWatch(['singleStyle', 'iconSource'], form) === 'upload'
    ? 'upload'
    : 'builtin';
  const iconKey = Form.useWatch(['singleStyle', 'iconKey'], form);
  const iconImage = Form.useWatch(['singleStyle', 'iconImage'], form);
  const selectedIconKey = typeof iconKey === 'string' ? iconKey : '';
  const uploadedImage = typeof iconImage === 'string' && isSingleValueIconDataUrl(iconImage)
    ? iconImage
    : '';

  const handleSelectIcon = useCallback(() => {
    selectIconRef.current?.showModal({
      title: t('dashboard.singleStyleSelectIcon'),
      defaultIcon: selectedIconKey || 'cc-host',
    });
  }, [selectedIconKey, t]);

  const handleIconSelect = useCallback((nextIconKey: string) => {
    form.setFieldValue(['singleStyle', 'iconKey'], nextIconKey);
    form.setFieldValue(['singleStyle', 'iconSource'], 'builtin');
  }, [form]);

  const handleBeforeUpload = useCallback<NonNullable<UploadProps['beforeUpload']>>((file) => {
    const error = validateSingleValueIconFile(file);
    if (error) {
      message.warning(
        t(error === 'size'
          ? 'dashboard.singleStyleUploadSizeError'
          : 'dashboard.singleStyleUploadTypeError'),
      );
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!isSingleValueIconDataUrl(result)) {
        message.warning(t('dashboard.singleStyleUploadTypeError'));
        return;
      }
      form.setFieldValue(['singleStyle', 'iconImage'], result);
      form.setFieldValue(['singleStyle', 'iconSource'], 'upload');
    };
    reader.readAsDataURL(file);
    return false;
  }, [form, t]);

  const clearUploadedImage = useCallback(() => {
    form.setFieldValue(['singleStyle', 'iconImage'], undefined);
  }, [form]);

  const clearBuiltinIcon = useCallback(() => {
    form.setFieldValue(['singleStyle', 'iconKey'], undefined);
  }, [form]);

  return (
    <div className="space-y-4">
      {showPreviewHint ? (
        <p className="text-xs leading-5 text-(--color-text-3)">
          {t('dashboard.singleStylePreviewHint')}
        </p>
      ) : null}

      <Form.Item
        label={t('dashboard.singleStyleShowIcon')}
        name={['singleStyle', 'showIcon']}
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <div className={showIcon ? 'space-y-4' : 'hidden'}>
        <Form.Item
          label={t('dashboard.singleStyleIconSource')}
          name={['singleStyle', 'iconSource']}
          initialValue="builtin"
        >
          <Radio.Group>
            <Radio value="builtin">{t('dashboard.singleStyleIconBuiltin')}</Radio>
            <Radio value="upload">{t('dashboard.singleStyleIconUpload')}</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item name={['singleStyle', 'iconKey']} hidden>
          <input />
        </Form.Item>
        <Form.Item name={['singleStyle', 'iconImage']} hidden>
          <input />
        </Form.Item>

        {iconSource === 'builtin' ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSelectIcon}
              className="flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-(--color-border-2) bg-(--color-fill-1)"
            >
              {selectedIconKey ? (
                <img
                  src={getModelIconUrl({ icn: selectedIconKey, model_id: '' })}
                  alt=""
                  className="h-10 w-10 object-contain"
                />
              ) : (
                <span className="px-1 text-center text-xs text-(--color-text-3)">
                  {t('dashboard.singleStyleSelectIcon')}
                </span>
              )}
            </button>
            {selectedIconKey ? (
              <Button type="link" size="small" onClick={clearBuiltinIcon}>
                {t('dashboard.singleStyleRemoveIcon')}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Upload
                accept={ICON_ACCEPT}
                showUploadList={false}
                beforeUpload={handleBeforeUpload}
              >
                <div className="flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-(--color-border-2) bg-(--color-fill-1)">
                  {uploadedImage ? (
                    <img src={uploadedImage} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <UploadOutlined className="text-base text-(--color-text-3)" />
                  )}
                </div>
              </Upload>
              {uploadedImage ? (
                <Button type="link" size="small" onClick={clearUploadedImage}>
                  {t('dashboard.singleStyleRemoveIcon')}
                </Button>
              ) : (
                <span className="text-xs text-(--color-text-3)">
                  {t('dashboard.singleStyleUpload')}
                </span>
              )}
            </div>
            <p className="text-xs leading-5 text-(--color-text-3)">
              {t('dashboard.singleStyleUploadHint')}
            </p>
          </div>
        )}

        <Form.Item
          label={t('dashboard.singleStyleIconPosition')}
          name={['singleStyle', 'iconPosition']}
          initialValue="left"
        >
          <ChoiceGroup
            options={[
              { value: 'left', label: t('dashboard.singleStylePositionLeft') },
              { value: 'right', label: t('dashboard.singleStylePositionRight') },
            ]}
          />
        </Form.Item>

        <Form.Item
          label={t('dashboard.singleStyleIconSize')}
          name={['singleStyle', 'iconSize']}
          initialValue="medium"
        >
          <ChoiceGroup
            options={[
              { value: 'small', label: t('dashboard.singleStyleSizeSmall') },
              { value: 'medium', label: t('dashboard.singleStyleSizeMedium') },
              { value: 'large', label: t('dashboard.singleStyleSizeLarge') },
            ]}
          />
        </Form.Item>
      </div>

      <Form.Item
        label={t('dashboard.singleStyleAlign')}
        name={['singleStyle', 'align']}
        initialValue="left"
      >
        <AlignChoice
          onTouched={onAlignTouched}
          options={[
            { value: 'left', label: t('dashboard.singleStyleAlignLeft') },
            { value: 'center', label: t('dashboard.singleStyleAlignCenter') },
            { value: 'right', label: t('dashboard.singleStyleAlignRight') },
          ]}
        />
      </Form.Item>
      <SelectIcon ref={selectIconRef} onSelect={handleIconSelect} />
    </div>
  );
};
