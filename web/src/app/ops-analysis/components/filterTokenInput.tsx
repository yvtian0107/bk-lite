'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Dropdown, Input } from 'antd';

import { useFilterTemplateVariables } from '@/app/ops-analysis/context/filterTemplate';
import type { UnifiedFilterDefinition } from '@/app/ops-analysis/types/dashBoard';
import { listFilterTemplateVariables } from '@/app/ops-analysis/utils/filterTemplate';

type FilterTokenTranslate = (
  key: string,
  defaultValue?: string,
  values?: Record<string, string | number>,
) => string;

interface FilterTokenInputProps {
  t: FilterTokenTranslate;
  value?: string;
  onChange?: (value: string) => void;
  id?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
  multiline?: boolean;
  rows?: number;
  autoSize?: { minRows?: number; maxRows?: number };
  definitions?: UnifiedFilterDefinition[];
}

const typeLabel = (
  type: UnifiedFilterDefinition['type'],
  t: FilterTokenTranslate,
) => {
  if (type === 'number') return t('dashboard.filterTokenTypeNumber', '数字');
  if (type === 'timeRange') return t('dashboard.filterTokenTypeTimeRange', '时间');
  if (type === 'dateRange') return t('dashboard.filterTokenTypeDateRange', '日期');
  return t('dashboard.filterTokenTypeString', '文本');
};

const focusCaret = (field: HTMLDivElement | null, caret: number) => {
  const node = field?.querySelector('input, textarea');
  if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement)) return;
  node.focus();
  node.setSelectionRange(caret, caret);
};

export const FilterTokenInput: React.FC<FilterTokenInputProps> = ({
  t,
  value,
  onChange,
  id,
  placeholder,
  maxLength,
  disabled,
  allowClear,
  className,
  multiline = false,
  rows,
  autoSize,
  definitions,
}) => {
  const contextDefinitions = useFilterTemplateVariables();
  const source = definitions ?? contextDefinitions;
  const variables = useMemo(() => listFilterTemplateVariables(source), [source]);
  const fieldRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(0);
  const cursorRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const hintId = React.useId();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return variables;
    return variables.filter((item) => {
      const typeName = typeLabel(item.definition.type, t);
      const haystack = `${item.definition.name} ${item.definition.key} ${item.token} ${typeName}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, t, variables]);
  const currentIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));
  const menuOpen = open && filtered.length > 0;

  const insertToken = (token: string) => {
    const current = value ?? '';
    const anchor = anchorRef.current;
    const end = Math.max(cursorRef.current, anchor + 1);
    const next = `${current.slice(0, anchor)}${token}${current.slice(end)}`;
    if (maxLength != null && next.length > maxLength) {
      setOpen(false);
      return;
    }
    onChange?.(next);
    setOpen(false);
    const caret = anchor + token.length;
    requestAnimationFrame(() => focusCaret(fieldRef.current, caret));
  };

  const handleValueChange = (next: string, cursor: number) => {
    const previous = value ?? '';
    cursorRef.current = cursor;
    onChange?.(next);
    if (open) {
      const anchor = anchorRef.current;
      if (cursor <= anchor || next[anchor] !== '$') {
        setOpen(false);
        return;
      }
      setQuery(next.slice(anchor + 1, cursor));
      setActiveIndex(0);
      return;
    }
    const insertedDollar = cursor > 0
      && next[cursor - 1] === '$'
      && next[cursor - 2] !== '\\'
      && previous[cursor - 1] !== '$';
    if (insertedDollar && variables.length > 0) {
      anchorRef.current = cursor - 1;
      setQuery('');
      setActiveIndex(0);
      setOpen(true);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!menuOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((currentIndex + 1) % filtered.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((currentIndex - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const selected = filtered[currentIndex];
      if (selected) insertToken(selected.token);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  const controlProps = {
    id,
    value: value ?? '',
    disabled,
    maxLength,
    placeholder,
    className,
    'aria-describedby': hintId,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      handleValueChange(event.target.value, event.target.selectionStart ?? event.target.value.length);
    },
    onKeyDown: handleKeyDown,
    onBlur: () => setOpen(false),
  };

  const control = multiline ? (
    <Input.TextArea {...controlProps} rows={rows} autoSize={autoSize} />
  ) : (
    <Input {...controlProps} allowClear={allowClear} />
  );

  return (
    <div className="flex w-full flex-wrap items-start gap-2">
      <Dropdown
        open={menuOpen}
        trigger={[]}
        placement="bottomLeft"
        overlayStyle={{ zIndex: 2100 }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOpen(false);
        }}
        popupRender={() => (
          <div
            role="listbox"
            className="max-h-64 min-w-52 overflow-y-auto rounded-md border border-(--color-border-1) bg-(--color-bg-1) py-1 shadow-md"
          >
            {filtered.map((item, index) => {
              const typeName = typeLabel(item.definition.type, t);
              const optionLabel = t(
                'dashboard.filterTokenOption',
                '{name}（{token} · {type}）',
                {
                  name: item.definition.name || item.definition.key,
                  token: item.token,
                  type: typeName,
                },
              );
              return (
                <button
                  key={item.definition.id}
                  type="button"
                  role="option"
                  aria-selected={index === currentIndex}
                  className={`block w-full cursor-pointer px-3 py-1.5 text-left text-xs text-(--color-text-1) ${
                    index === currentIndex ? 'bg-(--color-fill-2)' : 'hover:bg-(--color-fill-1)'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertToken(item.token);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  {optionLabel}
                </button>
              );
            })}
          </div>
        )}
      >
        <div ref={fieldRef} className="min-w-0 flex-1">{control}</div>
      </Dropdown>
      <span id={hintId} className="pt-1 text-xs leading-5 text-(--color-text-3)">
        {t('dashboard.filterTokenHint', '输入 $ 插入筛选')}
      </span>
    </div>
  );
};
