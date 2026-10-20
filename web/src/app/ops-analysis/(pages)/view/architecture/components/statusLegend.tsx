'use client';

import type { ReactNode } from 'react';
import { useTranslation } from '@/utils/i18n';
import type { LegendSignal } from '../binding/status';

const SWATCH = {
  normal: '#16a34a',
  warning: '#f5c400',
  critical: '#dc2626',
  gray: '#9ca3af',
  invalid: '#c2410c',
} as const;

const SIGNAL_COLOR: Record<LegendSignal, string> = {
  critical: SWATCH.critical,
  warning: SWATCH.warning,
  gray: SWATCH.gray,
};

const Row = ({ swatch, label }: { swatch: ReactNode; label: string }) => (
  <div className="flex items-center gap-2 text-xs text-[var(--color-text-1)]">
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{swatch}</span>
    <span>{label}</span>
  </div>
);

const CountDisc = ({ color }: { color: string }) => (
  <span
    className="inline-block h-4 w-4 rounded-full"
    style={{ background: color }}
  />
);

const StatusBadge = ({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) => (
  <span
    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-white"
    style={{
      background: color,
      border: '1.5px solid #fff',
      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.28)',
    }}
  >
    {children}
  </span>
);

const Plug = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
    <path d="M5 1.4v3.1M11 1.4v3.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M3.6 6.2h8.8v2.3a3.1 3.1 0 0 1-3.1 3.1H6.7a3.1 3.1 0 0 1-3.1-3.1V6.2z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 11.6v2.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const Lock = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
    <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

const Chain = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
    <path d="M1.8 6.2h3.4a1.8 1.8 0 0 1 0 3.6H1.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M14.2 6.2h-3.4a1.8 1.8 0 0 0 0 3.6h3.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M7.2 8h1.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const LegendMark = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
    <circle cx="3" cy="4" r="1.4" fill="currentColor" />
    <circle cx="3" cy="8" r="1.4" fill="currentColor" />
    <circle cx="3" cy="12" r="1.4" fill="currentColor" />
    <path d="M6.5 4h7M6.5 8h7M6.5 12h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const StatusLegend = ({
  open,
  signal,
  onToggle,
}: {
  open: boolean;
  signal: LegendSignal | null;
  onToggle: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <div className="contents">
      {open ? (
        <div
          data-testid="architecture-status-legend-panel"
          className="absolute left-0 z-20 flex w-40 flex-col gap-1.5 rounded-md border border-[#bdbdbd] bg-white p-2 shadow-sm"
          style={{ bottom: 'calc(100% + 8px)' }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Row swatch={<CountDisc color={SWATCH.normal} />} label={t('opsAnalysis.architecture.statusNormal')} />
          <Row swatch={<CountDisc color={SWATCH.warning} />} label={t('opsAnalysis.architecture.statusWarningYellow')} />
          <Row swatch={<CountDisc color={SWATCH.critical} />} label={t('opsAnalysis.architecture.statusCriticalRed')} />
          <Row
            swatch={<StatusBadge color={SWATCH.gray}><Plug /></StatusBadge>}
            label={t('opsAnalysis.architecture.statusUnmonitored')}
          />
          <Row
            swatch={<StatusBadge color={SWATCH.gray}><span className="text-[10px] font-bold leading-none">?</span></StatusBadge>}
            label={t('opsAnalysis.architecture.statusUnknown')}
          />
          <Row
            swatch={<StatusBadge color={SWATCH.gray}><Lock /></StatusBadge>}
            label={t('opsAnalysis.architecture.legendForbidden')}
          />
          <Row
            swatch={<StatusBadge color={SWATCH.invalid}><Chain /></StatusBadge>}
            label={t('opsAnalysis.architecture.legendInvalid')}
          />
        </div>
      ) : null}
      <button
        type="button"
        data-testid="architecture-status-legend"
        data-legend-open={open ? 'true' : 'false'}
        data-legend-signal={signal ?? ''}
        className="box-border flex h-10 items-center gap-1 rounded-lg border bg-white px-2.5 text-xs text-[#111827]"
        style={{
          borderColor: open ? '#155aef' : '#bdbdbd',
          background: open ? '#e8f1ff' : '#fff',
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        {signal ? (
          <span
            data-testid="architecture-legend-dot"
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: SIGNAL_COLOR[signal] }}
          />
        ) : null}
        <LegendMark />
        {t('opsAnalysis.architecture.legendTitle')}
      </button>
    </div>
  );
};

export default StatusLegend;
