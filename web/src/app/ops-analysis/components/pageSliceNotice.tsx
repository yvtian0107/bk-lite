'use client';

import React from 'react';
import { useTranslation } from '@/utils/i18n';
import { readPageSlice } from '@/app/ops-analysis/utils/pageSlice';

const PageSliceNotice: React.FC<{ rawData: unknown; messageKey?: string }> = ({
  rawData,
  messageKey = 'dashboard.pageSliceNotice',
}) => {
  const { t } = useTranslation();
  const slice = readPageSlice(rawData);
  if (!slice) return null;
  return (
    <p
      className="m-0 px-2 py-1 text-xs text-[var(--color-text-3)]"
      data-testid="page-slice-notice"
      data-message-key={messageKey}
      data-shown={slice.shown}
      data-total={slice.total}
    >
      {t(messageKey, undefined, { shown: slice.shown, total: slice.total })}
    </p>
  );
};

export default PageSliceNotice;
