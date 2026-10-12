import {
  resolveAnalysisCanvasInteraction,
  shouldShowAnalysisWidgetCopyAction,
} from '@/app/ops-analysis/utils/widgetCopy';
import { supportsWidgetCsvExport } from '@/app/ops-analysis/utils/widgetCsvExport';

export type DashboardWidgetMenuKey = 'edit' | 'copy' | 'delete' | 'exportCsv';

export type WidgetCsvExportSurface = 'dashboard' | 'screen' | 'topology';

export type WidgetCsvExportEntry = 'hover' | 'menu' | 'none';

export const isWidgetCsvExportBlocked = ({
  shareMode = false,
  fullscreen = false,
  renderMode = false,
}: {
  shareMode?: boolean;
  fullscreen?: boolean;
  renderMode?: boolean;
}): boolean => Boolean(shareMode || fullscreen || renderMode);

/**
 * 查看态用悬浮入口，编辑态放进已有菜单。
 * 分享、全屏、订阅截图都不出现入口。
 */
export const resolveWidgetCsvExportEntry = ({
  chartType,
  editMode = false,
  shareMode = false,
  fullscreen = false,
  renderMode = false,
}: {
  surface: WidgetCsvExportSurface;
  chartType?: string;
  editMode?: boolean;
  shareMode?: boolean;
  fullscreen?: boolean;
  renderMode?: boolean;
}): WidgetCsvExportEntry => {
  if (isWidgetCsvExportBlocked({ shareMode, fullscreen, renderMode })) return 'none';
  if (!supportsWidgetCsvExport(chartType)) return 'none';
  return editMode ? 'menu' : 'hover';
};

export const resolveTopologyCsvExportHoverEnabled = ({
  editMode = false,
  shareMode = false,
  fullscreen = false,
}: {
  editMode?: boolean;
  shareMode?: boolean;
  fullscreen?: boolean;
}): boolean => !editMode && !isWidgetCsvExportBlocked({ shareMode, fullscreen });

export const buildDashboardWidgetMenuKeys = ({
  isEditMode,
  shareMode = false,
  isBuiltIn = false,
  renderMode = false,
  fullscreen = false,
  chartType,
  sceneWidgetType,
}: {
  isEditMode: boolean;
  shareMode?: boolean;
  isBuiltIn?: boolean;
  renderMode?: boolean;
  fullscreen?: boolean;
  chartType?: string;
  sceneWidgetType?: string;
}): DashboardWidgetMenuKey[] => {
  const keys: DashboardWidgetMenuKey[] = [];
  const exportCsv = resolveWidgetCsvExportEntry({
    surface: 'dashboard',
    chartType,
    editMode: isEditMode,
    shareMode,
    fullscreen,
    renderMode,
  }) === 'menu';
  if (isEditMode) {
    keys.push('edit');
    if (shouldShowAnalysisWidgetCopyAction({
      interaction: resolveAnalysisCanvasInteraction({
        editMode: isEditMode,
        shareMode,
        isBuiltIn,
      }),
      sceneWidgetType,
      chartType,
    })) {
      keys.push('copy');
    }
    if (exportCsv) keys.push('exportCsv');
    keys.push('delete');
    return keys;
  }
  return keys;
};

export const resolveScreenItemMenuMode = ({
  editMode,
  shareMode = false,
  fullscreen = false,
}: {
  editMode: boolean;
  shareMode?: boolean;
  fullscreen?: boolean;
}): 'edit' | 'view' => (
  editMode && !shareMode && !fullscreen ? 'edit' : 'view'
);
