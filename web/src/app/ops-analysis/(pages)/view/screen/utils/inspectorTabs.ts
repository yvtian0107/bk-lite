export type ScreenWidgetInspectorTab = 'style' | 'data' | 'singleStyle' | 'interaction';

/** 大屏检查器页签。单值组件在「数据」和「交互」之间插入数值样式。 */
export const screenWidgetInspectorTabs = (
  chartType: string | undefined,
  pending: boolean,
): ScreenWidgetInspectorTab[] => {
  const withSingleStyle = chartType === 'single';
  if (pending) {
    return withSingleStyle
      ? ['data', 'singleStyle', 'interaction']
      : ['data', 'interaction'];
  }
  return withSingleStyle
    ? ['style', 'data', 'singleStyle', 'interaction']
    : ['style', 'data', 'interaction'];
};
