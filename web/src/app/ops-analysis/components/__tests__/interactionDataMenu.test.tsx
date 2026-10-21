import React from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractionSurfaceProvider } from '@/app/ops-analysis/context/interactionSurface';
import ScreenWidgetThemeProvider from '@/app/ops-analysis/components/screenWidgetThemeProvider';
import InteractionDataMenu from '../interactionDataMenu';

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
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(cleanup);

const collectInjectedCss = () => {
  const fromTags = Array.from(document.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n');
  const fromSheets = Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join('\n');
  return `${fromTags}\n${fromSheets}`;
};

const renderMenu = ({
  editing = false,
  theme,
  onSelect = vi.fn(),
  onClose = vi.fn(),
}: {
  editing?: boolean;
  theme?: 'screen-dark' | 'screen-light';
  onSelect?: () => void;
  onClose?: () => void;
} = {}) => {
  const view = render(
    <IntlProvider locale="zh" messages={{}}>
      <ScreenWidgetThemeProvider mode={theme}>
        <InteractionSurfaceProvider editing={editing}>
          <InteractionDataMenu
            open
            x={24}
            y={36}
            label="查看 CMDB 详情"
            onSelect={onSelect}
            onClose={onClose}
          />
        </InteractionSurfaceProvider>
      </ScreenWidgetThemeProvider>
    </IntlProvider>,
  );
  return { ...view, onSelect, onClose };
};

describe('interaction data context menu', () => {
  it('renders one link item at the pointer and opens it', () => {
    const { onSelect, onClose } = renderMenu();
    const item = screen.getByRole('menuitem', { name: '查看 CMDB 详情' });
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(item.textContent).toBe('查看 CMDB 详情');
    expect(item.querySelector('.anticon-link')).toBeTruthy();
    expect(item.closest('.ant-dropdown-menu')).toBeTruthy();
    expect(item.getAttribute('aria-disabled')).not.toBe('true');

    const anchor = document.querySelector('[data-interaction-menu-anchor]') as HTMLElement;
    expect(anchor.parentElement).toBe(document.body);
    expect(anchor.className).toContain('fixed');
    expect(anchor.style.left).toBe('24px');
    expect(anchor.style.top).toBe('36px');

    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the only item while editing and explains why', () => {
    const { onSelect, onClose } = renderMenu({ editing: true });
    const item = screen.getByRole('menuitem', { name: '查看 CMDB 详情' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe('查看模式下可跳转');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape, an outside pointer, and scroll', () => {
    const { onClose, unmount } = renderMenu();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    const outside = renderMenu();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(outside.onClose).toHaveBeenCalledTimes(1);

    outside.unmount();
    const scrolling = renderMenu();
    window.dispatchEvent(new Event('scroll'));
    expect(scrolling.onClose).toHaveBeenCalledTimes(1);

    scrolling.onClose.mockClear();
    const item = screen.getByRole('menuitem', { name: '查看 CMDB 详情' });
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(scrolling.onClose).not.toHaveBeenCalled();
  });

  it('keeps the screen-dark css var class on the menu after it portals to body', () => {
    renderMenu({ theme: 'screen-dark' });
    const item = screen.getByRole('menuitem', { name: '查看 CMDB 详情' });
    const popup = item.closest('.ant-dropdown');
    const themeRoot = document.querySelector('[data-screen-widget-theme="screen-dark"]');
    expect(popup).toBeTruthy();
    expect(themeRoot?.contains(popup)).toBe(false);
    expect(popup?.className).toContain('ops-screen-dark');
    expect(popup?.className).toContain('ant-dropdown-css-var');
    const css = collectInjectedCss();
    expect(css).toContain('ops-screen-dark');
    expect(css).toContain('#14243a');
  });

  it('uses the light screen theme class outside the dark big screen', () => {
    renderMenu({ theme: 'screen-light' });
    const item = screen.getByRole('menuitem', { name: '查看 CMDB 详情' });
    const popup = item.closest('.ant-dropdown');
    expect(popup?.className).toContain('ops-screen-light');
    expect(popup?.className).not.toContain('ops-screen-dark');
  });
});
