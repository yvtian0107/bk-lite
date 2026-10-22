import React, { useState } from 'react';
import '@ant-design/v5-patch-for-react-19';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SingleValueStyleConfig } from '@/app/ops-analysis/utils/singleValueStyle';
import { ScreenSingleValueStyleSections } from '../singleValueStyleSection';

const showModal = vi.fn();

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/app/cmdb/utils/modelIcon', () => ({
  getModelIconUrl: ({ icn }: { icn: string }) => `/assets/${icn}.svg`,
}));

vi.mock('@/app/cmdb/(pages)/assetManage/management/list/selectIcon', () => {
  function MockSelectIcon(
    props: { onSelect: (iconKey: string) => void },
    ref: React.Ref<{ showModal: (info: unknown) => void }>,
  ) {
    React.useImperativeHandle(ref, () => ({
      showModal: (info: unknown) => {
        showModal(info);
      },
    }));
    return (
      <button type="button" data-testid="select-icon-confirm" onClick={() => props.onSelect('cc-host')}>
        pick
      </button>
    );
  }
  return { default: React.forwardRef(MockSelectIcon) };
});

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

afterEach(() => {
  cleanup();
  showModal.mockClear();
});

const Harness: React.FC<{
  initial?: SingleValueStyleConfig;
  onStyleChange?: (next: SingleValueStyleConfig | undefined) => void;
}> = ({ initial, onStyleChange }) => {
  const [style, setStyle] = useState<SingleValueStyleConfig | undefined>(initial);
  return (
    <ScreenSingleValueStyleSections
      t={(key) => key}
      style={style}
      onStyleChange={(next) => {
        setStyle(next);
        onStyleChange?.(next);
      }}
    />
  );
};

const sourceRadio = (name: string) => screen.getByRole('radio', { name });

describe('ScreenSingleValueStyleSections', () => {
  it('keeps the icon body empty until the switch is on, and leaves source unselected', () => {
    render(<Harness />);

    expect(screen.queryByText('dashboard.singleStyleIconSource')).toBeNull();
    expect(screen.queryByText('dashboard.singleStyleIconPosition')).toBeNull();
    expect(screen.queryByText('dashboard.singleStyleIconHint')).toBeNull();
    expect(screen.queryByText('dashboard.singleStyleAlignHintScreen')).toBeNull();
    expect(screen.getByRole('button', { name: 'dashboard.singleStyleAlignLeft' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'dashboard.singleStyleAlignCenter' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'dashboard.singleStyleAlignRight' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('switch', { name: 'dashboard.singleStyleIcon' }));

    expect(sourceRadio('dashboard.singleStyleIconBuiltin').getAttribute('aria-checked')).not.toBe('true');
    expect(sourceRadio('dashboard.singleStyleIconUpload').getAttribute('aria-checked')).not.toBe('true');
    expect(showModal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('single-style-icon-cell'));
    expect(showModal).not.toHaveBeenCalled();
  });

  it('keeps the other source while editing and persists only the active one', async () => {
    const onStyleChange = vi.fn();
    render(<Harness onStyleChange={onStyleChange} />);

    fireEvent.click(screen.getByRole('switch', { name: 'dashboard.singleStyleIcon' }));
    fireEvent.click(sourceRadio('dashboard.singleStyleIconBuiltin'));
    fireEvent.click(screen.getByTestId('single-style-icon-cell'));
    expect(showModal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('select-icon-confirm'));

    await waitFor(() => {
      const latest = onStyleChange.mock.calls.at(-1)?.[0];
      expect(latest).toEqual({ showIcon: true, iconKey: 'cc-host' });
    });
    expect(screen.getByTestId('single-style-icon-cell').querySelector('img')?.getAttribute('src')).toBe('/assets/cc-host.svg');

    fireEvent.click(sourceRadio('dashboard.singleStyleIconUpload'));
    await waitFor(() => {
      const latest = onStyleChange.mock.calls.at(-1)?.[0];
      expect(latest).toEqual({ showIcon: true });
      expect(latest.iconKey).toBeUndefined();
      expect(latest.iconImage).toBeUndefined();
    });

    const input = screen.getByTestId('single-style-file-input') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['icon'], 'mark.png', { type: 'image/png' })] },
    });

    await waitFor(() => {
      const latest = onStyleChange.mock.calls.at(-1)?.[0] as SingleValueStyleConfig;
      expect(latest.iconSource).toBe('upload');
      expect(latest.iconImage?.startsWith('data:image/png')).toBe(true);
      expect(latest.iconKey).toBeUndefined();
    });

    fireEvent.click(sourceRadio('dashboard.singleStyleIconBuiltin'));
    await waitFor(() => {
      expect(screen.getByTestId('single-style-icon-cell').querySelector('img')?.getAttribute('src')).toBe('/assets/cc-host.svg');
      expect(onStyleChange.mock.calls.at(-1)?.[0]).toEqual({ showIcon: true, iconKey: 'cc-host' });
    });

    fireEvent.click(sourceRadio('dashboard.singleStyleIconUpload'));
    await waitFor(() => {
      const latest = onStyleChange.mock.calls.at(-1)?.[0] as SingleValueStyleConfig;
      expect(latest.iconSource).toBe('upload');
      expect(latest.iconImage?.startsWith('data:image/png')).toBe(true);
      expect(latest.iconKey).toBeUndefined();
    });
  });

  it('writes alignment only after a button is pressed', () => {
    const onStyleChange = vi.fn();
    render(<Harness onStyleChange={onStyleChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'dashboard.singleStyleAlignCenter' }));
    expect(onStyleChange).toHaveBeenCalledWith({ align: 'center' });
    expect(screen.getByRole('button', { name: 'dashboard.singleStyleAlignCenter' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'dashboard.singleStyleAlignLeft' }).getAttribute('aria-pressed')).toBe('false');
  });
});
