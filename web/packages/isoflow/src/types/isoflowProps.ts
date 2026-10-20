import type { EditorModeEnum, MainMenuOptions } from './common';
import type { Model, Rectangle, ViewItem } from './model';
import type { RendererProps } from './rendererProps';

export type InitialData = Model & {
  fitToView?: boolean;
  view?: string;
};

export const nodeStatusLevels = [
  'normal',
  'warning',
  'critical',
  'unmonitored',
  'unknown',
  'invalid',
  'forbidden'
] as const;

export type NodeStatusLevel = (typeof nodeStatusLevels)[number];

export interface NodeStatus {
  level: NodeStatusLevel;
  count?: number;
  /** Hover text for a gray status mark. The host supplies the localized sentence. */
  hint?: string;
  /** Hover text for the alert-count badge. */
  badgeHint?: string;
}

/** Edit-mode binding marks. These are not status and must not carry alert color. */
export interface NodeBindingMark {
  chain?: boolean;
  unbound?: boolean;
}

export const rectangleBorderLevels = ['warning', 'critical', 'unknown'] as const;

export type RectangleBorderLevel = (typeof rectangleBorderLevels)[number];

export interface RectangleStatus {
  label?: string;
  borderLevel?: RectangleBorderLevel;
  /** Outlined capsule drawn beside the area tab. Host supplies the full text. */
  badgeText?: string;
  /** Binding mark shown on the area tab when child alerts are summarized. */
  summaryText?: string;
}

export type DiagramItemHit = {
  type: 'ITEM' | 'RECTANGLE' | 'CONNECTOR';
  id: string;
};

export type DiagramPointerEvent = {
  clientX: number;
  clientY: number;
};

export interface IsoflowProps {
  initialData?: InitialData;
  mainMenuOptions?: MainMenuOptions;
  onModelUpdated?: (Model: Model) => void;
  width?: number | string;
  height?: number | string;
  enableDebugTools?: boolean;
  editorMode?: keyof typeof EditorModeEnum;
  renderer?: RendererProps;
  /**
   * Controls whether drag interactions are captured globally (window-level) or limited to the frame.
   * 
   * - `true` (default): Drag events are captured globally, allowing dragging even when the mouse moves outside the component
   * - `false`: Drag events are limited to the component frame, useful for embedding in other pages
   * 
   * @default true
   */
  enableGlobalDragHandlers?: boolean;
  /**
   * View mode only (`EXPLORABLE_READONLY`). Fired on a click, not a pan.
   * `null` means empty canvas, so the host can close a detail view.
   * Text boxes are not reported.
   */
  onItemClick?: (
    item: DiagramItemHit | null,
    event?: DiagramPointerEvent
  ) => void;
  /**
   * Edit mode only. Fired when cursor mode opens item, rectangle or connector
   * controls, and with `null` when the selection is cleared.
   */
  onItemSelect?: (item: DiagramItemHit | null) => void;
  /** View mode. Neutral stroke around one icon. Keyed by view item id. */
  highlightedItemId?: string;
  /** Keyed by view item id. Icons omitted from the map are drawn unchanged. */
  nodeStatus?: Record<string, NodeStatus>;
  /**
   * Edit mode. Keyed by view item id. Chain and unbound outlines are binding
   * marks, drawn only for ids present in the map.
   */
  nodeBinding?: Record<string, NodeBindingMark>;
  /** Edit mode. Title for the left appearance panel. Other Isoflow copy stays in English. */
  appearancePanelTitle?: string;
  /** Keyed by rectangle id. Labels, borders and badges are draw-only. */
  rectangleStatus?: Record<string, RectangleStatus>;
  /**
   * Edit mode. Calls the existing single-item updaters so a binding change
   * goes through onModelUpdated without replacing initialData.
   */
  sceneApiRef?: { current: IsoflowSceneApi | null };
}

export interface IsoflowSceneApi {
  updateViewItem: (id: string, updates: Partial<ViewItem>) => void;
  updateRectangle: (id: string, updates: Partial<Rectangle>) => void;
}
