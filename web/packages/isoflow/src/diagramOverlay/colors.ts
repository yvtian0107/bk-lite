import type { NodeStatusLevel, RectangleBorderLevel } from 'src/types';

export const STATUS_GRAY = '#9ca3af';
export const WARNING_AMBER = '#f5c400';
export const BRAND_BLUE = '#155aef';

export const NODE_STATUS_COLOR: Record<NodeStatusLevel, string> = {
  normal: '#16a34a',
  warning: WARNING_AMBER,
  critical: '#dc2626',
  unmonitored: STATUS_GRAY,
  unknown: STATUS_GRAY,
  invalid: '#c2410c',
  forbidden: STATUS_GRAY
};

export const RECTANGLE_BORDER_COLOR: Record<RectangleBorderLevel, string> = {
  warning: WARNING_AMBER,
  critical: '#dc2626',
  unknown: STATUS_GRAY
};

/** View-mode selection. Matches the app brand blue (`--color-primary` fallback). */
export const HIGHLIGHT_STROKE = BRAND_BLUE;

// Unprojected SVG units. The isometric matrix scales this toward a 2px screen edge.
export const RECTANGLE_STATUS_STROKE_WIDTH = 4;
export const RECTANGLE_STATUS_STROKE_HOVER_WIDTH = 7;

export const withAlpha = (hex: string, alpha: number) => {
  const raw = hex.replace('#', '');
  const value = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};
