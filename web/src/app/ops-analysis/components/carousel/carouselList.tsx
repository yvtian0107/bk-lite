'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Spin } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';
import CompactEmptyState from '@/components/compact-empty-state';
import EllipsisWithTooltip from '@/components/ellipsis-with-tooltip';
import MoreActionsDropdown from '@/components/more-actions-dropdown';
import useBtnPermissions from '@/hooks/usePermissions';
import { useTranslation } from '@/utils/i18n';
import { useCarouselApi } from '@/app/ops-analysis/api/carousel';
import type { CarouselSummary } from '@/app/ops-analysis/types/carousel';

interface CarouselListProps {
  keyword: string;
  refreshKey: number;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onPlay: (id: number) => void;
  onCopied: (id: number) => void;
  onDeleted: (id: number) => void;
}

const CarouselList: React.FC<CarouselListProps> = ({
  keyword,
  refreshKey,
  selectedId,
  onSelect,
  onPlay,
  onCopied,
  onDeleted,
}) => {
  const { t } = useTranslation();
  const { hasPermission } = useBtnPermissions();
  const { listCarousels, copyCarousel, deleteCarousel } = useCarouselApi();
  const [rows, setRows] = useState<CarouselSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listCarousels(keyword.trim() || undefined));
    } catch (error) {
      console.error('Failed to load carousels:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [keyword, listCarousels]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const canPlay = hasPermission(['View']);
  const canCopy = hasPermission(['AddChart']);
  const canEdit = hasPermission(['EditChart']);
  const canDelete = hasPermission(['DeleteChart']);

  return (
    <Spin spinning={loading}>
      {rows.length === 0 ? (
        <CompactEmptyState description={t('opsCarousel.emptyList')} />
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((row) => {
            const selected = selectedId === String(row.id);
            return (
              <div
                key={row.id}
                className={`flex items-center gap-1 rounded px-1 py-1 ${
                  selected ? 'bg-[var(--color-fill-2)]' : 'hover:bg-[var(--color-fill-1)]'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer bg-transparent text-left"
                  onClick={() => onSelect(String(row.id))}
                >
                  <EllipsisWithTooltip
                    className="block truncate text-sm text-[var(--color-text-1)]"
                    text={row.name}
                  />
                  <span className="text-xs text-[var(--color-text-3)]">
                    {t('opsCarousel.canvasCount', undefined, { count: row.item_count })}
                  </span>
                </button>
                {canPlay && (
                  <Button
                    type="text"
                    size="small"
                    aria-label={t('opsCarousel.play')}
                    icon={<CaretRightOutlined />}
                    onClick={() => onPlay(row.id)}
                  />
                )}
                <MoreActionsDropdown
                  stopPropagation
                  labelAlign="start"
                  items={[
                    ...(canEdit ? [{
                      key: 'edit',
                      label: t('common.edit'),
                      onClick: () => onSelect(String(row.id)),
                    }] : []),
                    ...(canCopy ? [{
                      key: 'copy',
                      label: t('common.copy'),
                      onClick: () => {
                        void copyCarousel(row.id).then((copied) => onCopied(copied.id));
                      },
                    }] : []),
                    ...(canDelete ? [{
                      key: 'delete',
                      label: t('common.delete'),
                      danger: true,
                      onClick: () => {
                        Modal.confirm({
                          title: t('opsCarousel.deleteConfirm'),
                          content: row.name,
                          okText: t('common.confirm'),
                          cancelText: t('common.cancel'),
                          okButtonProps: { danger: true },
                          centered: true,
                          onOk: () => deleteCarousel(row.id).then(() => onDeleted(row.id)),
                        });
                      },
                    }] : []),
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}
    </Spin>
  );
};

export default CarouselList;
