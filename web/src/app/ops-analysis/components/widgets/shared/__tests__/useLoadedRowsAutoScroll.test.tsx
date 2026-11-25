import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import AutoScrollRegion from '../AutoScrollRegion';

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
const tops = new WeakMap<HTMLElement, number>();

const installMetrics = () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.dataset.scrollHeight ? Number(this.dataset.scrollHeight) : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.dataset.clientHeight ? Number(this.dataset.clientHeight) : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.dataset.rowHeight ? Number(this.dataset.rowHeight) : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return tops.get(this) ?? 0;
    },
    set(value: number) {
      tops.set(this, value);
    },
  });
};

const restoreMetrics = (descriptor: PropertyDescriptor | undefined, name: string) => {
  if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  restoreMetrics(originalScrollHeight, 'scrollHeight');
  restoreMetrics(originalClientHeight, 'clientHeight');
  restoreMetrics(originalOffsetHeight, 'offsetHeight');
  restoreMetrics(originalScrollTop, 'scrollTop');
});

const Table = ({
  enabled,
  intervalMs = 1000,
  scrollHeight = '200',
  clientHeight = '40',
}: {
  enabled: boolean;
  intervalMs?: number;
  scrollHeight?: string;
  clientHeight?: string;
}) => (
  <AutoScrollRegion
    config={enabled ? { autoScroll: { enabled: true, intervalMs } } : undefined}
  >
    <div className="ant-table-header">表头</div>
    <div
      className="ant-table-body"
      data-scroll-height={scrollHeight}
      data-client-height={clientHeight}
    >
      <table>
        <tbody>
          <tr className="ant-table-measure-row" data-row-height="0"><td /></tr>
          <tr data-row-height="20"><td>第一行</td></tr>
          <tr data-row-height="20"><td>第二行</td></tr>
        </tbody>
      </table>
    </div>
    <div className="ant-pagination">页码</div>
  </AutoScrollRegion>
);

describe('loaded row auto scroll', () => {
  it('scrolls only the body at the saved interval and pauses on the header', () => {
    installMetrics();
    vi.useFakeTimers();
    const view = render(<Table enabled intervalMs={1000} />);
    const body = view.container.querySelector<HTMLElement>('.ant-table-body');
    const header = view.container.querySelector<HTMLElement>('.ant-table-header');
    expect(body).toBeTruthy();
    expect(header?.style.transform || '').toBe('');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(body?.scrollTop).toBe(20);
    expect(header?.style.transform || '').toBe('');

    const region = view.container.firstElementChild as HTMLElement;
    expect(region.contains(header!)).toBe(true);
    expect(region.contains(view.getByText('页码'))).toBe(true);
    fireEvent.pointerEnter(region);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(body?.scrollTop).toBe(20);

    fireEvent.pointerLeave(region);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(body?.scrollTop).toBe(40);
  });

  it('does not start a timer when the loaded rows already fit or scrolling is off', () => {
    installMetrics();
    const spy = vi.spyOn(window, 'setInterval');
    const fitted = render(<Table enabled scrollHeight="40" clientHeight="40" />);
    expect(spy).not.toHaveBeenCalled();
    fitted.unmount();
    spy.mockClear();
    render(<Table enabled={false} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
