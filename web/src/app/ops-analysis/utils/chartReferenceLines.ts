export const REFERENCE_SERIES_ID = 'ops-reference-lines';

export const REFERENCE_LINE_COLOR_TOKEN = '--color-fail';

export interface ChartReferenceLine {
  name: string;
  value: number;
  color?: string;
}

interface ReferenceLineSource {
  referenceLines?: unknown;
  thresholdColors?: Array<{
    name?: unknown;
    value?: unknown;
    color?: unknown;
  }> | null;
}

const finiteValue = (value: unknown): number | undefined => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const readColor = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  return color || undefined;
};

const readName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const tokenName = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('var(') || !trimmed.endsWith(')')) return undefined;
  const name = trimmed.slice(4, -1).split(',')[0]?.trim();
  return name || undefined;
};

const readThemeToken = (token: string): string => {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
};

export const resolveReferenceLineColor = (color?: string): string => {
  const explicit = color?.trim();
  if (explicit && !tokenName(explicit)) return explicit;
  let token = tokenName(explicit || '') || REFERENCE_LINE_COLOR_TOKEN;
  let resolved = '';
  for (let hop = 0; hop < 4; hop += 1) {
    resolved = readThemeToken(token);
    const next = tokenName(resolved);
    if (!next) break;
    token = next;
  }
  return resolved || `var(${REFERENCE_LINE_COLOR_TOKEN})`;
};

const explicitLines = (value: unknown): ChartReferenceLine[] => {
  if (!Array.isArray(value)) return [];
  const lines: ChartReferenceLine[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as { name?: unknown; value?: unknown; color?: unknown };
    const numeric = finiteValue(record.value);
    if (numeric === undefined) return;
    const name = readName(record.name);
    const color = readColor(record.color);
    lines.push({
      name,
      value: numeric,
      ...(color ? { color } : {}),
    });
  });
  return lines;
};

const thresholdLines = (
  value: ReferenceLineSource['thresholdColors'],
): ChartReferenceLine[] => {
  if (!Array.isArray(value)) return [];
  const lines: ChartReferenceLine[] = [];
  value.forEach((item) => {
    const numeric = finiteValue(item?.value);
    if (numeric === undefined || numeric === 0) return;
    const color = readColor(item?.color);
    const name = readName(item?.name);
    lines.push({
      name,
      value: numeric,
      ...(color ? { color } : {}),
    });
  });
  return lines;
};

export function readReferenceLines(
  source: ReferenceLineSource | undefined,
): ChartReferenceLine[] {
  if (Array.isArray(source?.referenceLines)) {
    return explicitLines(source.referenceLines);
  }
  return thresholdLines(source?.thresholdColors);
}

export function persistReferenceLines(
  value: unknown,
): ChartReferenceLine[] | undefined {
  const lines = explicitLines(value).filter((line) => line.name.length > 0);
  return lines.length > 0 ? lines : undefined;
}

const lineLabel = (line: ChartReferenceLine): string => (
  line.name ? `${line.name} ${line.value}` : String(line.value)
);

export function appendReferenceSeries<T extends { id?: string; markLine?: unknown }>(
  series: T[],
  source: ReferenceLineSource | undefined,
  metrics?: { lineWidth?: number; fontSize?: number },
): T[] {
  const lines = readReferenceLines(source);
  if (lines.length === 0 || series.length === 0) return series;
  const lineWidth = metrics?.lineWidth ?? 1.5;
  const fontSize = metrics?.fontSize ?? 10;
  const referenceSeries = {
    id: REFERENCE_SERIES_ID,
    name: REFERENCE_SERIES_ID,
    type: 'line',
    data: [],
    yAxisIndex: 0,
    silent: true,
    legendHoverLink: false,
    showSymbol: false,
    tooltip: { show: false },
    lineStyle: { opacity: 0, width: 0 },
    emphasis: { disabled: true },
    markLine: {
      symbol: 'none',
      silent: true,
      data: lines.map((line) => {
        const color = resolveReferenceLineColor(line.color);
        return {
          yAxis: line.value,
          lineStyle: { color, type: 'dashed', width: lineWidth },
          label: {
            show: true,
            position: 'insideEndTop',
            formatter: lineLabel(line),
            color,
            fontSize,
          },
        };
      }),
    },
  };
  return [...series, referenceSeries as unknown as T];
}

export const isReferenceSeries = (series: { id?: string } | undefined): boolean => (
  series?.id === REFERENCE_SERIES_ID
);
