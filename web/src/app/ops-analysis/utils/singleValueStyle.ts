export type SingleValueIconSource = 'builtin' | 'upload';
export type SingleValueIconPosition = 'left' | 'right';
export type SingleValueIconSize = 'small' | 'medium' | 'large';
export type SingleValueContentAlign = 'left' | 'center' | 'right';

/** 单值组件样式。字段缺省时渲染保持旧行为。 */
export interface SingleValueStyleConfig {
  showIcon?: boolean;
  iconSource?: SingleValueIconSource;
  /** 内置图标 key，对应 CMDB 模型图标库 */
  iconKey?: string;
  /** 上传图片的 data URL */
  iconImage?: string;
  iconPosition?: SingleValueIconPosition;
  iconSize?: SingleValueIconSize;
  align?: SingleValueContentAlign;
}

export interface NormalizedSingleValueStyle {
  showIcon: boolean;
  iconSource: SingleValueIconSource;
  iconKey: string;
  iconImage: string;
  iconPosition: SingleValueIconPosition;
  iconSize: SingleValueIconSize;
  /** 未配置时为 undefined，由各主题沿用旧对齐 */
  align?: SingleValueContentAlign;
}

export const SINGLE_VALUE_ICON_MAX_BYTES = 100 * 1024;

/** 相对数值字号的图标比例，不向用户暴露像素 */
export const SINGLE_VALUE_ICON_FONT_RATIO: Record<SingleValueIconSize, number> = {
  small: 0.72,
  medium: 1,
  large: 1.36,
};

export const SINGLE_VALUE_ICON_GAP_RATIO = 0.18;
/** 窄卡片先把图标收到这个比例，再窄则隐藏 */
export const SINGLE_VALUE_ICON_MIN_SCALE = 0.45;

const ICON_FILE_EXT = /\.(png|jpe?g|webp|svg)$/i;
const ICON_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

const roundTenth = (value: number) => Math.round(value * 10) / 10;

export const readSingleValueStyle = (
  style?: SingleValueStyleConfig | null,
): NormalizedSingleValueStyle => ({
  showIcon: style?.showIcon === true,
  iconSource: style?.iconSource === 'upload' ? 'upload' : 'builtin',
  iconKey: typeof style?.iconKey === 'string' ? style.iconKey.trim() : '',
  iconImage: typeof style?.iconImage === 'string' ? style.iconImage.trim() : '',
  iconPosition: style?.iconPosition === 'right' ? 'right' : 'left',
  iconSize:
    style?.iconSize === 'small' || style?.iconSize === 'large'
      ? style.iconSize
      : 'medium',
  align:
    style?.align === 'left' || style?.align === 'center' || style?.align === 'right'
      ? style.align
      : undefined,
});

export const isSingleValueIconDataUrl = (value: string) =>
  /^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/i.test(value);

export const validateSingleValueIconFile = (file: {
  name: string;
  type: string;
  size: number;
}): 'type' | 'size' | null => {
  const typeOk = ICON_MIME.has(file.type) || ICON_FILE_EXT.test(file.name);
  if (!typeOk) return 'type';
  if (file.size > SINGLE_VALUE_ICON_MAX_BYTES) return 'size';
  return null;
};

export const resolveSingleValueIconSrc = (
  style: NormalizedSingleValueStyle,
  resolveBuiltin: (iconKey: string) => string,
): string | null => {
  if (!style.showIcon) return null;
  if (style.iconSource === 'upload') {
    return isSingleValueIconDataUrl(style.iconImage) ? style.iconImage : null;
  }
  if (!style.iconKey) return null;
  const src = resolveBuiltin(style.iconKey);
  return src || null;
};

export interface ResolveSingleValueIconBoxInput {
  rowWidth: number;
  fontSize: number;
  textWidth: number;
  size: SingleValueIconSize;
}

export interface SingleValueIconBox {
  visible: boolean;
  size: number;
  gap: number;
}

/**
 * 图标跟随数值字号。宽度不够时先缩小图标，再隐藏，把宽度留给数值。
 * 尚未量到行宽时保持可见，避免首帧把图标丢掉。
 */
export const resolveSingleValueIconBox = ({
  rowWidth,
  fontSize,
  textWidth,
  size,
}: ResolveSingleValueIconBoxInput): SingleValueIconBox => {
  const desired = Math.max(0, fontSize) * SINGLE_VALUE_ICON_FONT_RATIO[size];
  const gap = Math.max(0, fontSize) * SINGLE_VALUE_ICON_GAP_RATIO;
  if (!(rowWidth > 0) || !(fontSize > 0)) {
    return { visible: true, size: roundTenth(desired), gap: roundTenth(gap) };
  }

  const minSize = desired * SINGLE_VALUE_ICON_MIN_SCALE;
  const available = rowWidth - Math.max(0, textWidth) - gap;
  if (available >= desired) {
    return { visible: true, size: roundTenth(desired), gap: roundTenth(gap) };
  }
  if (available >= minSize) {
    return { visible: true, size: roundTenth(available), gap: roundTenth(gap) };
  }
  return { visible: false, size: 0, gap: 0 };
};

export interface PersistSingleValueStyleOptions {
  /** 用户改过对齐。未改时不把表单默认「左」写回，避免大屏旧卡片位移。 */
  alignTouched?: boolean;
  previousAlign?: SingleValueContentAlign;
}

export const persistSingleValueStyle = (
  style: SingleValueStyleConfig | undefined,
  options: PersistSingleValueStyleOptions = {},
): SingleValueStyleConfig | undefined => {
  const read = readSingleValueStyle(style);
  const next: SingleValueStyleConfig = {};

  if (read.showIcon) next.showIcon = true;
  if (read.iconSource === 'upload') next.iconSource = 'upload';
  if (read.iconKey) next.iconKey = read.iconKey;
  if (isSingleValueIconDataUrl(read.iconImage)) next.iconImage = read.iconImage;
  if (read.iconPosition === 'right') next.iconPosition = 'right';
  if (read.iconSize !== 'medium') next.iconSize = read.iconSize;

  const align = read.align;
  if (align === 'center' || align === 'right') {
    next.align = align;
  } else if (
    align === 'left'
    && (options.alignTouched || options.previousAlign === 'left')
  ) {
    next.align = 'left';
  }

  return Object.keys(next).length > 0 ? next : undefined;
};
