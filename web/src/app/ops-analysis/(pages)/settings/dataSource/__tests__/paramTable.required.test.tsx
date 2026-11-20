// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParamItem } from '@/app/ops-analysis/types/dataSource';

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => (
      key === 'dataSource.requiredFlag' ? '是否必填' : key
    ),
  }),
}));

import ParamTable from '../paramTable';

const param = (required?: boolean): ParamItem => ({
  id: 'room',
  name: 'server_room_id',
  alias_name: '机房',
  type: 'string',
  filterType: 'filter',
  value: '',
  required,
});

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
});

describe('data source parameter required switch', () => {
  it('saves and echoes whether a parameter is required', () => {
    const onChange = vi.fn();
    const view = render(<ParamTable params={[param(false)]} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: '是否必填' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({
      name: 'server_room_id',
      required: true,
      value: '',
    })]);

    view.rerender(<ParamTable params={[param(true)]} onChange={onChange} />);
    expect(screen.getByRole('switch', { name: '是否必填' }).getAttribute('aria-checked')).toBe('true');
  });

  it('keeps the switch disabled for a read-only builtin definition', () => {
    render(<ParamTable params={[param(true)]} onChange={vi.fn()} readOnly />);
    expect(screen.getByRole('switch', { name: '是否必填' }).hasAttribute('disabled')).toBe(true);
  });
});