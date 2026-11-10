import type { InputOption, ParamItem } from '@/app/ops-analysis/types/dataSource';

export const ANALYSIS_MODE_PARAM = 'analysis_mode';

export interface AnalysisModeOption {
  label: string;
  value: string;
  charts: string[];
  result?: InputOption['result'];
}

const staticItemsOf = (param?: ParamItem): InputOption[] => {
  const config = param?.inputConfig;
  if (!config || !('optionsSource' in config)) return [];
  if (config.optionsSource.type !== 'static') return [];
  return config.optionsSource.staticItems;
};

export const findAnalysisModeParam = (
  params?: ParamItem[] | null,
): ParamItem | undefined =>
  (Array.isArray(params) ? params : []).find((param) => param?.name === ANALYSIS_MODE_PARAM);

export const analysisModeOptions = (
  params?: ParamItem[] | null,
): AnalysisModeOption[] =>
  staticItemsOf(findAnalysisModeParam(params))
    .filter((item) => item.value !== undefined && item.value !== null && String(item.value) !== '')
    .map((item) => ({
      label: String(item.label ?? item.value),
      value: String(item.value),
      charts: Array.isArray(item.charts) ? item.charts.map((chart) => String(chart)) : [],
      result: item.result,
    }));

export const resolveAnalysisModeValue = ({
  params,
  selected,
  chartType,
}: {
  params?: ParamItem[] | null;
  selected?: unknown;
  chartType?: string;
}): string | undefined => {
  const options = analysisModeOptions(params);
  if (!options.length) return undefined;
  const chosen = selected === undefined || selected === null ? '' : String(selected);
  const chartModes = chartType ? options.filter((item) => item.charts.includes(chartType)) : [];
  if (chosen && chartModes.some((item) => item.value === chosen)) return chosen;
  if (chartModes.length) return chartModes[0].value;
  if (chosen && options.some((item) => item.value === chosen)) return chosen;
  return options[0]?.value;
};

/** 同一图表对应多种分析方式时才展示下拉，例如实例单值的计数和聚合。 */
export const shouldShowAnalysisMode = (
  params: ParamItem[] | null | undefined,
  chartType?: string,
): boolean => {
  const options = analysisModeOptions(params);
  const matching = chartType ? options.filter((item) => item.charts.includes(chartType)) : options;
  return matching.length > 1;
};

export const chartsForAnalysisMode = (
  params: ParamItem[] | null | undefined,
  mode: string | undefined,
): string[] | null => {
  const options = analysisModeOptions(params);
  if (!options.length) return null;
  const selected = options.find((item) => item.value === mode) ?? options[0];
  return selected?.charts ?? [];
};

export const isParamVisibleForAnalysisMode = (
  param: ParamItem,
  mode: string | undefined,
  params?: ParamItem[] | null,
): boolean => {
  if (!findAnalysisModeParam(params)) return true;
  if (param.name === ANALYSIS_MODE_PARAM) return true;
  const modes = param.visible_modes;
  if (!Array.isArray(modes) || modes.length === 0) return true;
  if (!mode) return false;
  return modes.includes(mode);
};

export const filterChartTypesForAnalysisMode = <ChartType extends { value: string }>(
  chartTypes: ChartType[],
  params: ParamItem[] | null | undefined,
  mode: string | undefined,
): ChartType[] => {
  // 图表决定分析方式，不再按当前方式收窄可选图表。
  void mode;
  if (!findAnalysisModeParam(params)) return chartTypes;
  return chartTypes;
};
