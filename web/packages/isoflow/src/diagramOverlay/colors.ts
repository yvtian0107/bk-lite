import type { NodeStatusLevel, RectangleBorderLevel } from 'src/types';

export const NODE_STATUS_COLOR: Record<NodeStatusLevel, string> = {
  normal: '#16a34a',
  warning: '#f59e0b',
  critical: '#dc2626',
  unmonitored: '#9ca3af',
  unknown: '#6b7280',
  invalid: '#c2410c',
  forbidden: '#475569'
};

export const RECTANGLE_BORDER_COLOR: Record<RectangleBorderLevel, string> = {
  warning: '#f59e0b',
  critical: '#dc2626',
  unknown: '#9ca3af'
};

export const HIGHLIGHT_STROKE = '#334155';

// Unprojected SVG units. The isometric matrix scales this down to a thin edge.
export const RECTANGLE_STATUS_STROKE_WIDTH = 8;
