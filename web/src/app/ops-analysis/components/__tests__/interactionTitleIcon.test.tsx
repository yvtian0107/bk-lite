import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import InteractionTitleIcon from '@/app/ops-analysis/components/interactionTitleIcon';
import { ShareModeProvider } from '@/app/ops-analysis/context/shareMode';
import ScreenWidgetFrame from '@/app/ops-analysis/(pages)/view/screen/components/screenWidgetFrame';
import type { WidgetInteractionLink } from '@/app/ops-analysis/types/dashBoard';
import type { ScreenWidgetItem } from '@/app/ops-analysis/types/screen';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

const titleLink: WidgetInteractionLink = {
  kind: 'title',
  name: '查看详情',
  url: '/ops',
  openMode: 'sameTab',
};

const widget = (
  interaction?: WidgetInteractionLink,
  frame?: 'panel' | 'bare',
): ScreenWidgetItem => ({
  id: 'w1',
  type: 'widget',
  chartType: 'line',
  title: 'CPU 使用率',
  x: 0,
  y: 0,
  w: 240,
  h: 160,
  zIndex: 1,
  valueConfig: {
    chartType: 'line',
    ...(frame ? { appearance: { frame } } : {}),
    ...(interaction ? { interaction } : {}),
  },
});

const renderWithIntl = (node: React.ReactNode) => render(
  <IntlProvider locale="zh" messages={{}}>
    {node}
  </IntlProvider>,
);

describe('InteractionTitleIcon', () => {
  it('keeps the dashboard icon as a plain link glyph', () => {
    renderWithIntl(
      <InteractionTitleIcon config={{ interaction: titleLink }} floating />,
    );

    const button = screen.getByRole('button', { name: '查看详情' });
    expect(button.className).toContain('text-(--color-text-2)');
    expect(button.className).toContain('rounded-full');
    expect(button.className).toContain('h-6');
    expect(button.className).not.toContain('screen-widget-frame__title-link');
    expect(button.getAttribute('title')).toBe('查看详情');
  });

  it('hides the entry on the share surface and for data links', () => {
    const { rerender } = render(
      <IntlProvider locale="zh" messages={{}}>
        <ShareModeProvider value>
          <InteractionTitleIcon config={{ interaction: titleLink }} variant="screen" />
        </ShareModeProvider>
      </IntlProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <IntlProvider locale="zh" messages={{}}>
        <InteractionTitleIcon
          config={{
            chartType: 'line',
            interaction: { ...titleLink, kind: 'data' },
          }}
          variant="screenFloating"
        />
      </IntlProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('screen title link', () => {
  it('places a scaled link glyph after the framed title and leaves an unlinked title unchanged', () => {
    const { rerender } = renderWithIntl(
      <ScreenWidgetFrame item={widget(titleLink)}>
        <div>chart</div>
      </ScreenWidgetFrame>,
    );

    const button = screen.getByRole('button', { name: '查看详情' });
    expect(button.className).toContain('screen-widget-frame__title-link');
    expect(button.className).not.toContain('screen-widget-frame__title-link--floating');
    expect(button.className).not.toContain('text-(--color-text-2)');
    expect(button.querySelector('.anticon-link')).toBeTruthy();
    expect(button.parentElement?.className).toContain('screen-widget-frame__header');
    expect(screen.getByText('CPU 使用率').className).toBe('screen-widget-frame__title');

    rerender(
      <IntlProvider locale="zh" messages={{}}>
        <ScreenWidgetFrame item={widget()}>
          <div>chart</div>
        </ScreenWidgetFrame>
      </IntlProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('CPU 使用率').className).toBe('screen-widget-frame__title');
  });

  it('shows only a round icon on a bare screen widget and the name in a tooltip', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <IntlProvider locale="zh" messages={{}}>
          <ScreenWidgetFrame item={widget(titleLink, 'bare')}>
            <div>chart</div>
          </ScreenWidgetFrame>
        </IntlProvider>
      </ConfigProvider>,
    );

    const button = screen.getByRole('button', { name: '查看详情' });
    expect(button.className).toContain('screen-widget-frame__title-link--floating');
    expect(button.getAttribute('title')).toBeNull();
    expect(button.textContent).toBe('');
    expect(button.querySelector('.anticon-link')).toBeTruthy();
    expect(screen.queryByText('CPU 使用率')).toBeNull();

    await user.hover(button);
    expect(await screen.findByText('查看详情')).toBeTruthy();

    rerender(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <IntlProvider locale="zh" messages={{}}>
          <ScreenWidgetFrame
            item={widget({ ...titleLink, name: '' }, 'bare')}
          >
            <div>chart</div>
          </ScreenWidgetFrame>
        </IntlProvider>
      </ConfigProvider>,
    );
    const emptyName = screen.getByRole('button', { name: '打开链接' });
    expect(emptyName.textContent).toBe('');
    await user.hover(emptyName);
    expect(await screen.findByText('打开链接')).toBeTruthy();
  });
});

describe('screen title link styles', () => {
  it('keeps the full-width title unless a link is present, then follows the screen chrome scale', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/app/ops-analysis/(pages)/view/screen/components/screenCanvas.tsx'),
      'utf8',
    );
    expect(source).toContain(`width: 100%;
          overflow: hidden;`);
    expect(source).toContain(`.screen-widget-frame__header:has(.screen-widget-frame__title-link) {
          justify-content: flex-start;
          gap: calc(6px * var(--screen-widget-ui-scale));
        }`);
    expect(source).toContain(`width: auto;
          flex: 0 1 auto;`);
    expect(source).toContain('font-size: calc(14px * var(--screen-widget-ui-scale));');
    expect(source).toContain('color-mix(in srgb, var(--screen-chrome-accent) 68%, #02060c)');
    expect(source).toContain('drop-shadow(0 0 calc(6px * var(--screen-widget-ui-scale)) var(--screen-chrome-glow))');
    expect(source).toContain('width: calc(20px * var(--screen-widget-ui-scale));');
    expect(source).toContain('height: calc(20px * var(--screen-widget-ui-scale));');
    expect(source).toContain('font-size: calc(12px * var(--screen-widget-ui-scale));');
    expect(source).toContain('text-overflow: ellipsis;');
    expect(source).not.toContain('screen-widget-frame__title-link-name');
    expect(source).not.toContain('--color-text-2');
  });
});
