import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const chartSpy = vi.hoisted(() => ({
  mounts: 0,
  optionDeliveries: 0,
  lastOption: null as unknown,
  onEvents: null as { finished?: () => void } | null,
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/app/ops-analysis/components/widget-viewport', () => ({
  toCanvasPixels: (value: number) => value,
  useWidgetViewport: () => ({ scale: 1 }),
}));

vi.mock('echarts-for-react', () => {
  const MockEcharts = React.forwardRef(
    (
      {
        option,
        onEvents,
      }: {
        option: unknown;
        onEvents?: { finished?: () => void };
      },
      _ref: React.ForwardedRef<unknown>,
    ) => {
      React.useEffect(() => {
        chartSpy.mounts += 1;
        chartSpy.onEvents = onEvents ?? null;
      }, [onEvents]);

      React.useEffect(() => {
        chartSpy.optionDeliveries += 1;
        chartSpy.lastOption = option;
      }, [option]);

      return <div data-testid="echarts" />;
    },
  );
  MockEcharts.displayName = 'MockEcharts';
  return { default: MockEcharts };
});

import OpsAnalysisPie from '@/app/ops-analysis/components/ops-analysis-widgets/pie';
import ComPie from '@/app/ops-analysis/components/widgets/comPie';

const pieData = [
  { name: '未分派', value: 12 },
  { name: '待响应', value: 8 },
];

const resetSpy = () => {
  chartSpy.mounts = 0;
  chartSpy.optionDeliveries = 0;
  chartSpy.lastOption = null;
  chartSpy.onEvents = null;
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('pie load-time option delivery', () => {
  afterEach(() => {
    cleanup();
    resetSpy();
  });

  it('delivers option once after ComPie leaves loading', async () => {
    const view = render(<ComPie rawData={pieData} loading />);
    expect(chartSpy.mounts).toBe(0);

    view.rerender(<ComPie rawData={pieData} loading={false} />);
    await flush();
    view.rerender(<ComPie rawData={pieData} loading={false} />);
    await flush();

    expect({
      mounts: chartSpy.mounts,
      optionDeliveries: chartSpy.optionDeliveries,
    }).toEqual({
      mounts: 1,
      optionDeliveries: 1,
    });
  });

  it('delivers option once after OpsAnalysisPie leaves loading', async () => {
    const view = render(<OpsAnalysisPie rawData={pieData} loading />);
    expect(chartSpy.mounts).toBe(0);

    view.rerender(<OpsAnalysisPie rawData={pieData} loading={false} />);
    await flush();
    view.rerender(<OpsAnalysisPie rawData={pieData} loading={false} />);
    await flush();

    expect({
      mounts: chartSpy.mounts,
      optionDeliveries: chartSpy.optionDeliveries,
    }).toEqual({
      mounts: 1,
      optionDeliveries: 1,
    });
  });

  it('does not mark ComPie ready until the pie animation finished event', async () => {
    const onReady = vi.fn();
    render(<ComPie rawData={pieData} loading={false} onReady={onReady} />);
    await flush();

    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      chartSpy.onEvents?.finished?.();
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(true);
  });

  it('does not mark OpsAnalysisPie ready until the pie animation finished event', async () => {
    const onReady = vi.fn();
    render(<OpsAnalysisPie rawData={pieData} loading={false} onReady={onReady} />);
    await flush();

    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      chartSpy.onEvents?.finished?.();
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(true);
  });

  it('tells the user a pie page is not the whole population', async () => {
    render(
      <OpsAnalysisPie
        rawData={{
          count: 5,
          items: [
            { group_value: '四', count: 4 },
            { group_value: '三', count: 3 },
          ],
        }}
        config={{ chartType: 'pie', dimensionField: 'group_value', valueField: 'count' }}
      />,
    );
    await flush();
    const notice = screen.getByTestId('page-slice-notice');
    expect(notice.textContent).toContain('dashboard.pageSliceNotice');
    expect(notice.getAttribute('data-shown')).toBe('2');
    expect(notice.getAttribute('data-total')).toBe('5');
  });
});
