// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComTable from '@/app/ops-analysis/components/widgets/comTable';
import EventTable from '@/app/ops-analysis/components/widgets/eventTable/eventTable';

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
});

const dataSource = {
  params: [{ name: 'page' }, { name: 'page_size' }],
  field_schema: [{ key: 'name', title: '名称', value_type: 'string' }],
} as any;

const frameClass = (container: HTMLElement) => {
  const frame = container.querySelector<HTMLElement>('.pt-2');
  expect(frame).not.toBeNull();
  return frame as HTMLElement;
};

describe('table card pagination frame', () => {
  it('keeps the dashboard table gap inside the full-height box', () => {
    const view = render(
      <div style={{ width: 770, height: 519 }}>
        <ComTable
          rawData={{ items: [{ name: 'bare-01' }], count: 16 }}
          loading={false}
          dataSource={dataSource}
          config={{
            chartType: 'table',
            tableConfig: {
              columns: [{ key: 'name', title: '名称', visible: true, order: 0 }],
            },
          }}
        />
      </div>,
    );

    const frame = frameClass(view.container);
    expect(frame.className).toContain('h-full');
    expect(frame.className).toContain('min-h-0');
    expect(frame.className).toContain('pt-2');
    expect(frame.className).not.toContain('mt-2');
  });

  it('keeps the event table gap inside the measured body', () => {
    const view = render(
      <div style={{ width: 770, height: 519 }}>
        <EventTable
          rawData={{ items: [{ id: '1', summary: '告警' }], count: 4 }}
          loading={false}
          dataSource={dataSource}
          config={{
            chartType: 'eventTable',
            tableConfig: {
              columns: [{ key: 'summary', title: '摘要', visible: true, order: 0 }],
            },
          }}
        />
      </div>,
    );

    const frame = frameClass(view.container);
    expect(frame.className).toContain('pt-2');
    expect(frame.className).not.toContain('mt-2');
    const measured = frame.firstElementChild as HTMLElement | null;
    expect(measured?.className).toContain('overflow-hidden');
    expect(measured).not.toBe(frame);
  });
});
