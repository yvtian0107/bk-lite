'use client';

import { useState, type ReactNode } from 'react';
import { useTranslation } from '@/utils/i18n';

const SWATCH = {
  normal: '#16a34a',
  warning: '#f59e0b',
  critical: '#dc2626',
  unmonitored: '#9ca3af',
  unknown: '#6b7280',
  forbidden: '#475569',
  invalid: '#c2410c',
} as const;

const Row = ({ swatch, label }: { swatch: ReactNode; label: string }) => (
  <div className="flex items-center gap-2 text-xs text-[var(--color-text-1)]">
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{swatch}</span>
    <span>{label}</span>
  </div>
);

const Dot = ({ className }: { className: string }) => (
  <span className={`h-3 w-3 rounded-full ${className}`} />
);

const StatusLegend = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div
      className="absolute bottom-14 left-3 z-30"
      data-testid="architecture-status-legend"
    >
      {open ? (
        <div className="flex w-40 flex-col gap-1.5 rounded-md border border-[var(--color-border-2)] bg-[var(--color-bg-1)] p-2 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--color-text-1)]">
              {t('opsAnalysis.architecture.legendTitle')}
            </span>
            <button
              type="button"
              className="text-xs text-[var(--color-text-3)]"
              onClick={() => setOpen(false)}
            >
              {t('opsAnalysis.architecture.legendCollapse')}
            </button>
          </div>
          <Row swatch={<Dot className="bg-[#16a34a]" />} label={t('opsAnalysis.architecture.statusNormal')} />
          <Row swatch={<Dot className="bg-[#f59e0b]" />} label={t('opsAnalysis.architecture.statusWarningYellow')} />
          <Row swatch={<Dot className="bg-[#dc2626]" />} label={t('opsAnalysis.architecture.statusCriticalRed')} />
          <Row
            swatch={(
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <circle cx="8" cy="8" r="4.2" fill="none" stroke={SWATCH.unmonitored} strokeWidth="1.6" strokeDasharray="2 2" />
              </svg>
            )}
            label={t('opsAnalysis.architecture.statusUnmonitored')}
          />
          <Row
            swatch={<span className="text-xs font-semibold text-[#6b7280]">?</span>}
            label={t('opsAnalysis.architecture.statusUnknown')}
          />
          <Row
            swatch={(
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke={SWATCH.forbidden} strokeWidth="1.6" />
                <path d="M5.5 7V5.4a2.5 2.5 0 0 1 5 0V7" fill="none" stroke={SWATCH.forbidden} strokeWidth="1.6" />
              </svg>
            )}
            label={t('opsAnalysis.architecture.legendForbidden')}
          />
          <Row
            swatch={(
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path d="M2.5 6.2h3.2a1.7 1.7 0 0 1 0 3.4H2.5" fill="none" stroke={SWATCH.invalid} strokeWidth="1.6" strokeLinecap="round" />
                <path d="M13.5 6.2H10.3a1.7 1.7 0 0 0 0 3.4h3.2" fill="none" stroke={SWATCH.invalid} strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
            label={t('opsAnalysis.architecture.legendInvalid')}
          />
        </div>
      ) : (
        <button
          type="button"
          className="rounded-md border border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-2 py-1 text-xs text-[var(--color-text-1)] shadow-sm"
          onClick={() => setOpen(true)}
        >
          {t('opsAnalysis.architecture.legendTitle')}
        </button>
      )}
    </div>
  );
};

export default StatusLegend;
