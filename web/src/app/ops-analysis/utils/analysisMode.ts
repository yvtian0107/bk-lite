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
  if (!config || config.control === 'input' || config.control === 'organization') return [];
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
  if (chosen && options.some((item) => item.value === chosen)) return chosen;
  if (chartType) {
    const compatible = options.find((item) => item.charts.includes(chartType));
    if (compatible) return compatible.value;
  }
  return options[0]?.value;
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
  const allowed = chartsForAnalysisMode(params, mode);
  if (!allowed) return chartTypes;
  return chartTypes.filter((item) => allowed.includes(item.value));
};
