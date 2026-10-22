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

/** 编辑态。来源未选时 iconSource 为空，两边已选内容都留在这里。 */
export interface SingleValueStyleDraft {
  showIcon: boolean;
  iconSource?: SingleValueIconSource;
  iconKey: string;
  iconImage: string;
  iconPosition: SingleValueIconPosition;
  iconSize: SingleValueIconSize;
  /** 未配置时为 undefined，由各主题沿用旧对齐 */
  align?: SingleValueContentAlign;
}

export const SINGLE_VALUE_ICON_MAX_BYTES = 100 * 1024;

/**
 * 图标高度相对数值字号。中档对齐字形高度（cap-height），
 * 小、大在此基础上按原有档差缩放。不是整行 em 框。
 */
export const SINGLE_VALUE_ICON_FONT_RATIO: Record<SingleValueIconSize, number> = {
  small: 0.52,
  medium: 0.72,
  large: 0.98,
};

/** 约半个数字字宽（tabular 的 0.5ch ≈ 0.31em），随字号缩放 */
export const SINGLE_VALUE_ICON_GAP_RATIO = 0.31;
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

export const isSingleValueIconDataUrl = (value: string) =>
  /^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/i.test(value);

const readIconSource = (
  style: SingleValueStyleConfig | null | undefined,
  iconKey: string,
  iconImage: string,
): SingleValueIconSource | undefined => {
  if (style?.iconSource === 'upload' || style?.iconSource === 'builtin') {
    return style.iconSource;
  }
  if (iconKey) return 'builtin';
  if (isSingleValueIconDataUrl(iconImage)) return 'upload';
  return undefined;
};

export const readSingleValueStyle = (
  style?: SingleValueStyleConfig | null,
): SingleValueStyleDraft => {
  const iconKey = typeof style?.iconKey === 'string' ? style.iconKey.trim() : '';
  const iconImage = typeof style?.iconImage === 'string' ? style.iconImage.trim() : '';
  return {
    showIcon: style?.showIcon === true,
    iconSource: readIconSource(style, iconKey, iconImage),
    iconKey,
    iconImage,
    iconPosition: style?.iconPosition === 'right' ? 'right' : 'left',
    iconSize:
      style?.iconSize === 'small' || style?.iconSize === 'large'
        ? style.iconSize
        : 'medium',
    align:
      style?.align === 'left' || style?.align === 'center' || style?.align === 'right'
        ? style.align
        : undefined,
  };
};

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
  style: SingleValueStyleDraft,
  resolveBuiltin: (iconKey: string) => string,
): string | null => {
  if (!style.showIcon || !style.iconSource) return null;
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
  /** 图片宽高比。未知时按正方形，量到后再收窄。 */
  aspect?: number;
}

export interface SingleValueIconBox {
  visible: boolean;
  /** 图标高度 */
  size: number;
  /** 图标占位宽度，按图片宽高比 */
  width: number;
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
  aspect = 1,
}: ResolveSingleValueIconBoxInput): SingleValueIconBox => {
  const desired = Math.max(0, fontSize) * SINGLE_VALUE_ICON_FONT_RATIO[size];
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const gap = Math.max(0, fontSize) * SINGLE_VALUE_ICON_GAP_RATIO;
  const hidden = { visible: false, size: 0, width: 0, gap: 0 };
  if (!(rowWidth > 0) || !(fontSize > 0)) {
    return {
      visible: true,
      size: roundTenth(desired),
      width: roundTenth(desired * safeAspect),
      gap: roundTenth(gap),
    };
  }

  const minHeight = desired * SINGLE_VALUE_ICON_MIN_SCALE;
  const available = rowWidth - Math.max(0, textWidth) - gap;
  const desiredWidth = desired * safeAspect;
  if (available >= desiredWidth) {
    return {
      visible: true,
      size: roundTenth(desired),
      width: roundTenth(desiredWidth),
      gap: roundTenth(gap),
    };
  }
  if (available >= minHeight * safeAspect) {
    return {
      visible: true,
      size: roundTenth(available / safeAspect),
      width: roundTenth(available),
      gap: roundTenth(gap),
    };
  }
  return hidden;
};

/**
 * 只写入当前来源。编辑态里另一边的选择留在草稿，不进配置。
 * 来源未显式选择时不推断，避免把暂存的另一边写进去。
 * 对齐只有用户点过（草稿里有值）才写入，缺省不把「左」落库。
 */
export const persistSingleValueStyle = (
  style: SingleValueStyleConfig | undefined,
): SingleValueStyleConfig | undefined => {
  const iconKey = typeof style?.iconKey === 'string' ? style.iconKey.trim() : '';
  const iconImage = typeof style?.iconImage === 'string' ? style.iconImage.trim() : '';
  const source = style?.iconSource === 'upload' || style?.iconSource === 'builtin'
    ? style.iconSource
    : undefined;
  const next: SingleValueStyleConfig = {};

  if (style?.showIcon === true) {
    next.showIcon = true;
    if (source === 'upload' && isSingleValueIconDataUrl(iconImage)) {
      next.iconSource = 'upload';
      next.iconImage = iconImage;
    } else if (source === 'builtin' && iconKey) {
      next.iconKey = iconKey;
    }
    if (style.iconPosition === 'right') next.iconPosition = 'right';
    if (style.iconSize === 'small' || style.iconSize === 'large') {
      next.iconSize = style.iconSize;
    }
  }

  if (style?.align === 'left' || style?.align === 'center' || style?.align === 'right') {
    next.align = style.align;
  }

  return Object.keys(next).length > 0 ? next : undefined;
};
