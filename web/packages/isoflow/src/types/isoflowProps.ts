import type { ReactNode } from 'react';
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
  /** Omitted in edit mode, where the plate is a name and not a runtime status. */
  level?: NodeStatusLevel;
  count?: number;
  /** Hover text for a gray status mark. The host supplies the localized sentence. */
  hint?: string;
  /** Hover text for the alert-count badge. */
  badgeHint?: string;
  /**
   * Short mark inside the name plate, to the right of the name.
   * View mode only. The host supplies the localized text: an alert count,
   * or a short label such as unmonitored, unknown, or no permission.
   * A normal level draws a floor-wash-colored dot here instead of text.
   */
  plateMark?: string;
  /** Replaces the icon title when the icon name is empty or the default Untitled. */
  plateTitle?: string;
  /** Second line under the icon name. Hidden by the scene when zoom is below 70%. */
  plateSubtitle?: string;
  /**
   * Bound resource name and model. View mode expands the name plate in place
   * while the pointer is on the icon or the plate. Omitted fields are not drawn.
   */
  hoverName?: string;
  hoverModel?: string;
  /** Label drawn before the model name when the plate is expanded. Host supplies the localized word, including its colon. */
  hoverModelLabel?: string;
  /** Label drawn before the status sentence when the plate is expanded. */
  hoverStatusLabel?: string;
  /** Status sentence drawn under the model when the plate is expanded. */
  hoverAlert?: string;
}

/** Edit-mode binding marks. These are not status and must not carry alert color. */
export interface NodeBindingMark {
  unbound?: boolean;
}

export const rectangleBorderLevels = ['warning', 'critical', 'unknown'] as const;

export type RectangleBorderLevel = (typeof rectangleBorderLevels)[number];

export interface RectangleStatusBadgePart {
  level: 'critical' | 'warning';
  text: string;
}

export interface RectangleStatus {
  label?: string;
  borderLevel?: RectangleBorderLevel;
  /**
   * Colored level counts on the status plate, severe first.
   * Host supplies the localized text, such as "严重 2".
   */
  badgeParts?: RectangleStatusBadgePart[];
  /** Plain fallback when badgeParts is empty, and the plate's data attribute. */
  badgeText?: string;
  /** Hover sentence for the status plate. Host supplies the localized text. */
  badgeHint?: string;
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
   * Edit mode. Keyed by view item id. An unbound diamond is drawn only for ids
   * present in the map, and only while the host asks for that highlight.
   */
  nodeBinding?: Record<string, NodeBindingMark>;
  /** Keyed by rectangle id. Labels, borders and badges are draw-only. */
  rectangleStatus?: Record<string, RectangleStatus>;
  /**
   * View mode. Rendered after the zoom row (`- 100% +` and fit-to-screen).
   * The host owns the copy and the open state.
   */
  viewLegend?: ReactNode;
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
