'use client';

import React, { useMemo, useState } from 'react';
import { Button, Drawer, Empty, Input, Tree } from 'antd';
import type { DataNode } from 'antd/lib/tree';
import { useTranslation } from '@/utils/i18n';
import { getCanvasTypeMeta, isCanvasType, type CanvasType } from '@/app/ops-analysis/constants/canvasTypes';
import type { DirItem } from '@/app/ops-analysis/types';
import { CanvasTypeIcon } from './canvasTypeIcon';

export interface PickedCanvas {
  resourceType: CanvasType;
  canvasId: number;
  name: string;
  groups: number[];
}

interface CanvasPickerProps {
  open: boolean;
  directories: DirItem[];
  onClose: () => void;
  onConfirm: (canvases: PickedCanvas[]) => void;
}

const toGroupIds = (groups?: number[]): number[] =>
  (groups || []).map((groupId) => Number(groupId)).filter((groupId) => Number.isFinite(groupId));

const CanvasPicker: React.FC<CanvasPickerProps> = ({
  open,
  directories,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [checked, setChecked] = useState<React.Key[]>([]);

  const canvases = useMemo(() => {
    const found: PickedCanvas[] = [];
    const walk = (items: DirItem[]) => {
      items.forEach((item) => {
        if (isCanvasType(item.type)) {
          found.push({
            resourceType: item.type,
            canvasId: Number(item.data_id),
            name: item.name,
            groups: toGroupIds(item.groups),
          });
        }
        if (item.children?.length) {
          walk(item.children);
        }
      });
    };
    walk(directories);
    return found;
  }, [directories]);

  const treeData = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const build = (items: DirItem[]): DataNode[] => items.flatMap((item): DataNode[] => {
      if (isCanvasType(item.type)) {
        if (query && !item.name.toLowerCase().includes(query)) {
          return [];
        }
        const meta = getCanvasTypeMeta(item.type);
        return [{
          key: `${item.type}:${item.data_id}`,
          title: (
            <span className="inline-flex items-center gap-1">
              <CanvasTypeIcon type={item.type} />
              <span>{item.name}</span>
              <span className="text-xs text-[var(--color-text-3)]">{meta ? t(meta.nameKey) : ''}</span>
            </span>
          ),
          isLeaf: true,
        }];
      }
      const children = item.children ? build(item.children) : [];
      if (!children.length) {
        return [];
      }
      return [{
        key: item.id,
        title: item.name,
        selectable: false,
        disableCheckbox: true,
        children,
      }];
    });
    return build(directories);
  }, [directories, keyword, t]);

  return (
    <Drawer
      title={t('opsCarousel.addCanvas')}
      open={open}
      onClose={onClose}
      width={420}
      destroyOnClose
      extra={(
        <Button
          type="primary"
          disabled={checked.length === 0}
          onClick={() => {
            const selected = new Set(checked.map(String));
            onConfirm(canvases.filter((canvas) => selected.has(`${canvas.resourceType}:${canvas.canvasId}`)));
            setChecked([]);
            onClose();
          }}
        >
          {t('common.confirm')}
        </Button>
      )}
    >
      <Input.Search
        allowClear
        placeholder={t('common.search')}
        className="mb-3"
        onChange={(event) => setKeyword(event.target.value)}
      />
      {treeData.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('opsCarousel.noCanvas')} />
      ) : (
        <Tree
          checkable
          blockNode
          defaultExpandAll
          checkedKeys={checked}
          treeData={treeData}
          onCheck={(keys) => {
            const next = Array.isArray(keys) ? keys : keys.checked;
            setChecked(next.filter((key) => String(key).includes(':')));
          }}
        />
      )}
    </Drawer>
  );
};

export default CanvasPicker;
