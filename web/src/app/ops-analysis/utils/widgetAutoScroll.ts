export const DEFAULT_AUTO_SCROLL_INTERVAL_MS = 2000;

export const MIN_AUTO_SCROLL_INTERVAL_MS = 500;

export const MAX_AUTO_SCROLL_INTERVAL_MS = 60_000;

export const AUTO_SCROLL_CHART_TYPES = [
  'table',
  'eventTable',
  'topN',
  'cardList',
  'multiValue',
  'eventTimeline',
  'text',
] as const;

export interface WidgetAutoScroll {
  enabled: true;
  intervalMs: number;
}

const clampInterval = (value: number): number => (
  Math.min(
    MAX_AUTO_SCROLL_INTERVAL_MS,
    Math.max(MIN_AUTO_SCROLL_INTERVAL_MS, value),
  )
);

export function readAutoScroll(
  source: { autoScroll?: { enabled?: unknown; intervalMs?: unknown } } | undefined,
): { enabled: boolean; intervalMs: number } {
  const raw = source?.autoScroll?.intervalMs;
  const intervalMs = typeof raw === 'number' && Number.isFinite(raw)
    ? clampInterval(Math.round(raw))
    : DEFAULT_AUTO_SCROLL_INTERVAL_MS;
  return {
    enabled: source?.autoScroll?.enabled === true,
    intervalMs,
  };
}

export function persistAutoScroll(values: {
  autoScrollEnabled?: unknown;
  autoScrollIntervalSec?: unknown;
}): WidgetAutoScroll | undefined {
  if (values.autoScrollEnabled !== true) return undefined;
  const seconds = typeof values.autoScrollIntervalSec === 'number'
    && Number.isFinite(values.autoScrollIntervalSec)
    ? values.autoScrollIntervalSec
    : DEFAULT_AUTO_SCROLL_INTERVAL_MS / 1000;
  return {
    enabled: true,
    intervalMs: clampInterval(Math.round(seconds * 1000)),
  };
}

export const supportsAutoScroll = (chartType: string | undefined): boolean => (
  AUTO_SCROLL_CHART_TYPES.some((type) => type === chartType)
);
