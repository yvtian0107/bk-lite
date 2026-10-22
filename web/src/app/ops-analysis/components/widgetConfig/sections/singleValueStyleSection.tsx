import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Form, Radio, Switch, Tooltip, message } from 'antd';
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  PictureOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import SelectIcon, {
  type SelectIconRef,
} from '@/app/cmdb/(pages)/assetManage/management/list/selectIcon';
import { getModelIconUrl } from '@/app/cmdb/utils/modelIcon';
import {
  isSingleValueIconDataUrl,
  persistSingleValueStyle,
  readSingleValueStyle,
  validateSingleValueIconFile,
  type SingleValueContentAlign,
  type SingleValueIconPosition,
  type SingleValueIconSize,
  type SingleValueIconSource,
  type SingleValueStyleConfig,
  type SingleValueStyleDraft,
} from '@/app/ops-analysis/utils/singleValueStyle';

const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';

const sectionClass = 'rounded-lg border border-(--color-border-1) bg-(--color-fill-1)/25 p-3 transition-colors hover:border-(--color-border-2)';

const StyleBlock: React.FC<{
  title: string;
  hint: string;
  extra?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, hint, extra, children }) => (
  <section className={sectionClass}>
    <div
      className={`flex items-center justify-between ${
        children ? 'mb-2.5 border-b border-(--color-border-1)/60 pb-2' : ''
      }`}
    >
      <div className="flex items-center gap-1 text-xs font-semibold text-(--color-text-1)">
        <span>{title}</span>
        <Tooltip title={hint}>
          <QuestionCircleOutlined className="cursor-help text-xs text-(--color-text-3) hover:text-(--color-primary)" />
        </Tooltip>
      </div>
      {extra ? <div className="text-xs">{extra}</div> : null}
    </div>
    {children ? <div className="space-y-3">{children}</div> : null}
  </section>
);

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-1.5 text-[11px] text-(--color-text-3)">{children}</div>
);

const choiceClass = (selected: boolean) =>
  `flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-all ${
    selected
      ? 'border-(--color-primary) bg-(--color-primary)/10 font-semibold text-(--color-primary)'
      : 'border-(--color-border-1) bg-(--color-bg-1) text-(--color-text-2) hover:border-(--color-border-2)'
  }`;

const PositionMark: React.FC<{ side: SingleValueIconPosition }> = ({ side }) => (
  <span className="inline-flex items-center gap-1" aria-hidden>
    {side === 'left' ? <span className="inline-block h-3 w-3 rounded-[2px] bg-current" /> : null}
    <span className="font-semibold tracking-tight">00</span>
    {side === 'right' ? <span className="inline-block h-3 w-3 rounded-[2px] bg-current" /> : null}
  </span>
);

const AlignButton: React.FC<{
  label: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, selected, onClick, children }) => (
  <Tooltip title={label}>
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-sm transition-all ${
        selected
          ? 'border-(--color-primary) bg-(--color-primary)/10 text-(--color-primary)'
          : 'border-(--color-border-1) bg-(--color-bg-1) text-(--color-text-2) hover:border-(--color-border-2)'
      }`}
    >
      {children}
    </button>
  </Tooltip>
);

export const SingleValueStyleFields: React.FC<{
  t: (key: string) => string;
  value: SingleValueStyleDraft;
  onChange: (next: SingleValueStyleDraft) => void;
  /** 大屏未设置对齐时沿用原布局，提示里多一句 */
  legacyAlignHint?: boolean;
}> = ({ t, value, onChange, legacyAlignHint = false }) => {
  const selectIconRef = useRef<SelectIconRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patch = (partial: Partial<SingleValueStyleDraft>) => onChange({ ...value, ...partial });
  const uploadedImage = isSingleValueIconDataUrl(value.iconImage) ? value.iconImage : '';
  const previewSrc = value.iconSource === 'upload'
    ? uploadedImage
    : value.iconSource === 'builtin' && value.iconKey
      ? getModelIconUrl({ icn: value.iconKey, model_id: '' })
      : '';

  const openPicker = () => {
    if (value.iconSource === 'builtin') {
      selectIconRef.current?.showModal({
        title: t('dashboard.singleStyleSelectIcon'),
        defaultIcon: value.iconKey || 'cc-host',
      });
      return;
    }
    if (value.iconSource === 'upload') {
      fileInputRef.current?.click();
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const error = validateSingleValueIconFile(file);
    if (error) {
      message.warning(t(error === 'size'
        ? 'dashboard.singleStyleUploadSizeError'
        : 'dashboard.singleStyleUploadTypeError'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!isSingleValueIconDataUrl(result)) {
        message.warning(t('dashboard.singleStyleUploadTypeError'));
        return;
      }
      patch({ iconImage: result, iconSource: 'upload' });
    };
    reader.readAsDataURL(file);
  };

  const clearCurrent = () => {
    if (value.iconSource === 'upload') patch({ iconImage: '' });
    if (value.iconSource === 'builtin') patch({ iconKey: '' });
  };

  const alignOptions: Array<{
    value: SingleValueContentAlign;
    label: string;
    icon: React.ReactNode;
  }> = [
    { value: 'left', label: t('dashboard.singleStyleAlignLeft'), icon: <AlignLeftOutlined /> },
    { value: 'center', label: t('dashboard.singleStyleAlignCenter'), icon: <AlignCenterOutlined /> },
    { value: 'right', label: t('dashboard.singleStyleAlignRight'), icon: <AlignRightOutlined /> },
  ];

  const sizeOptions: Array<{ value: SingleValueIconSize; label: string }> = [
    { value: 'small', label: t('dashboard.singleStyleSizeSmall') },
    { value: 'medium', label: t('dashboard.singleStyleSizeMedium') },
    { value: 'large', label: t('dashboard.singleStyleSizeLarge') },
  ];

  return (
    <div className="space-y-3">
      <StyleBlock
        title={t('dashboard.singleStyleIcon')}
        hint={t('dashboard.singleStyleIconHint')}
        extra={(
          <Switch
            size="small"
            aria-label={t('dashboard.singleStyleIcon')}
            checked={value.showIcon}
            onChange={(showIcon) => patch({ showIcon })}
          />
        )}
      >
        {value.showIcon ? (
          <>
            <div>
              <FieldLabel>{t('dashboard.singleStyleIconSource')}</FieldLabel>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value={value.iconSource ?? ''}
                onChange={(event) => patch({ iconSource: event.target.value as SingleValueIconSource })}
              >
                <Radio.Button value="builtin">{t('dashboard.singleStyleIconBuiltin')}</Radio.Button>
                <Radio.Button value="upload">{t('dashboard.singleStyleIconUpload')}</Radio.Button>
              </Radio.Group>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="single-style-icon-cell"
                aria-label={t('dashboard.singleStyleSelectIcon')}
                onClick={openPicker}
                className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-(--color-border-2) bg-(--color-bg-1) ${
                  value.iconSource ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                {previewSrc ? (
                  <img src={previewSrc} alt="" className="h-full w-full object-contain" />
                ) : (
                  <PictureOutlined className="text-base text-(--color-text-3)" />
                )}
              </button>
              {previewSrc ? (
                <div className="flex items-center gap-1">
                  <Button type="link" size="small" onClick={openPicker}>
                    {t('dashboard.singleStyleReplace')}
                  </Button>
                  <Button type="link" size="small" onClick={clearCurrent}>
                    {t('dashboard.singleStyleRemoveIcon')}
                  </Button>
                </div>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept={ICON_ACCEPT}
                className="hidden"
                data-testid="single-style-file-input"
                onChange={(event) => {
                  handleFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </div>

            <div>
              <FieldLabel>{t('dashboard.singleStyleIconPosition')}</FieldLabel>
              <div className="flex gap-2">
                {(['left', 'right'] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    aria-pressed={value.iconPosition === side}
                    onClick={() => patch({ iconPosition: side })}
                    className={choiceClass(value.iconPosition === side)}
                  >
                    <PositionMark side={side} />
                    <span>
                      {side === 'left'
                        ? t('dashboard.singleStylePositionLeft')
                        : t('dashboard.singleStylePositionRight')}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>{t('dashboard.singleStyleIconSize')}</FieldLabel>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value={value.iconSize}
                onChange={(event) => patch({ iconSize: event.target.value as SingleValueIconSize })}
              >
                {sizeOptions.map((option) => (
                  <Radio.Button key={option.value} value={option.value}>
                    {option.label}
                  </Radio.Button>
                ))}
              </Radio.Group>
            </div>
          </>
        ) : null}
      </StyleBlock>

      <StyleBlock
        title={t('dashboard.singleStyleAlign')}
        hint={t(legacyAlignHint
          ? 'dashboard.singleStyleAlignHintScreen'
          : 'dashboard.singleStyleAlignHint')}
      >
        <div className="flex gap-2">
          {alignOptions.map((option) => (
            <AlignButton
              key={option.value}
              label={option.label}
              selected={value.align === option.value}
              onClick={() => patch({ align: option.value })}
            >
              {option.icon}
            </AlignButton>
          ))}
        </div>
      </StyleBlock>

      <SelectIcon
        ref={selectIconRef}
        onSelect={(iconKey) => patch({ iconKey, iconSource: 'builtin' })}
      />
    </div>
  );
};

/** 占位登记。对象值不能塞进 input，否则会被收成字符串。 */
const SingleStyleField = React.forwardRef<HTMLSpanElement>((_props, ref) => (
  <span ref={ref} hidden />
));
SingleStyleField.displayName = 'SingleStyleField';

export const SingleValueStyleSection: React.FC<{
  t: (key: string) => string;
}> = ({ t }) => {
  const form = Form.useFormInstance();
  const watched = Form.useWatch(['singleStyle'], form) as SingleValueStyleConfig | undefined;
  const stored = readSingleValueStyle(watched);
  const sourceExplicit = watched?.iconSource === 'builtin' || watched?.iconSource === 'upload';
  const value: SingleValueStyleDraft = {
    ...stored,
    iconKey: typeof watched?.iconKey === 'string' ? watched.iconKey : stored.iconKey,
    iconImage: typeof watched?.iconImage === 'string' ? watched.iconImage : stored.iconImage,
    // 表单把来源显式写成空时，不能按暂存的 key 推断成已选。
    iconSource: watched && !sourceExplicit && Object.prototype.hasOwnProperty.call(watched, 'iconSource')
      ? undefined
      : stored.iconSource,
  };

  return (
    <>
      {/* 未登记的字段 useWatch 和 validateFields 都看不到，开关和对齐点了不会刷新。 */}
      <Form.Item name="singleStyle" hidden>
        <SingleStyleField />
      </Form.Item>
      <SingleValueStyleFields
        t={t}
        value={value}
        onChange={(next) => {
          form.setFieldValue(['singleStyle'], {
            showIcon: next.showIcon,
            iconSource: next.iconSource,
            iconKey: next.iconKey || undefined,
            iconImage: next.iconImage || undefined,
            iconPosition: next.iconPosition,
            iconSize: next.iconSize,
            align: next.align,
          });
        }}
      />
    </>
  );
};

const styleSignature = (style: SingleValueStyleConfig | undefined) =>
  JSON.stringify(style ?? null);

/** 大屏样式检查器：草稿保留未选来源，画布上只写入当前来源。 */
export const ScreenSingleValueStyleSections: React.FC<{
  style: SingleValueStyleConfig | undefined;
  onStyleChange: (next: SingleValueStyleConfig | undefined) => void;
  t: (key: string) => string;
}> = ({ style, onStyleChange, t }) => {
  const [draft, setDraft] = useState(() => readSingleValueStyle(style));
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    const incoming = styleSignature(style);
    if (incoming === lastEmitted.current) return;
    setDraft(readSingleValueStyle(style));
    lastEmitted.current = incoming;
  }, [style]);

  const handleChange = useCallback((next: SingleValueStyleDraft) => {
    setDraft(next);
    const persisted = persistSingleValueStyle(next);
    lastEmitted.current = styleSignature(persisted);
    onStyleChange(persisted);
  }, [onStyleChange]);

  return (
    <SingleValueStyleFields
      t={t}
      value={draft}
      legacyAlignHint
      onChange={handleChange}
    />
  );
};
