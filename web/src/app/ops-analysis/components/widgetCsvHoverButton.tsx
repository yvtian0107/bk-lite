'use client';

import React from 'react';
import { DownloadOutlined } from '@ant-design/icons';

interface WidgetCsvHoverButtonProps {
  label: string;
  onClick: () => void;
}

const WidgetCsvHoverButton: React.FC<WidgetCsvHoverButtonProps> = ({
  label,
  onClick,
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    data-csv-export-hover="true"
    data-export-hidden="true"
    className="no-drag pointer-events-none inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-(--color-bg-1) p-0 text-(--color-text-2) opacity-0 shadow-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
    onClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    }}
    onMouseDown={(event) => {
      event.stopPropagation();
    }}
    onPointerDown={(event) => {
      event.stopPropagation();
    }}
  >
    <DownloadOutlined />
  </button>
);

export default WidgetCsvHoverButton;
