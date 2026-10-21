'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { useInteractionMenuScale } from '@/app/ops-analysis/context/interactionMenuScale';
import { useInteractionSurface } from '@/app/ops-analysis/context/interactionSurface';
import { shouldNavigateInteraction } from '@/app/ops-analysis/utils/interactionLink';
import { useTranslation } from '@/utils/i18n';

interface InteractionDataMenuProps {
  open: boolean;
  x: number;
  y: number;
  label: string;
  onSelect: () => void;
  onClose: () => void;
}

const menuLength = (pixels: number, scale: number) => `calc(${pixels}px * ${scale})`;

/**
 * 数据链接的右键菜单。锚点 portal 到 body，按视口 clientX/Y 定位，
 * 避免大屏 CSS transform 把 fixed 算进缩放层。
 * 大屏上用字号、行高、内边距和圆角跟上画布倍数，不用 transform，点击区域仍按视口算。
 * 弹出层带上当前 ConfigProvider 的 cssVar 类，大屏暗色主题不必留在主题容器内部。
 */
const InteractionDataMenu: React.FC<InteractionDataMenuProps> = ({
  open,
  x,
  y,
  label,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation();
  const surface = useInteractionSurface();
  const scale = useInteractionMenuScale();
  const canNavigate = shouldNavigateInteraction(surface);
  const disabledHint = t('dashboard.interactionViewModeOnly', '查看模式下可跳转');

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.ant-dropdown')) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <Dropdown
      open
      autoAdjustOverflow
      getPopupContainer={() => document.body}
      overlayStyle={{ zIndex: 1100 }}
      menu={{
        items: [
          {
            key: 'open-link',
            disabled: !canNavigate,
            // 图标只作装饰。antd 默认把图标名写成 aria-label，会把菜单项读成 “link 链接名”。
            icon: (
              <LinkOutlined
                aria-hidden
                aria-label=""
                style={{ fontSize: menuLength(12, scale) }}
              />
            ),
            label,
            title: canNavigate ? undefined : disabledHint,
            style: {
              fontSize: menuLength(14, scale),
              lineHeight: menuLength(22, scale),
              padding: `${menuLength(5, scale)} ${menuLength(12, scale)}`,
              borderRadius: menuLength(4, scale),
            },
          },
        ],
        style: {
          minWidth: menuLength(96, scale),
          borderRadius: menuLength(8, scale),
        },
        onClick: () => {
          if (!canNavigate) return;
          onSelect();
          onClose();
        },
      }}
    >
      <div
        data-interaction-menu-anchor=""
        className="pointer-events-none fixed h-px w-px"
        style={{ left: x, top: y }}
      />
    </Dropdown>,
    document.body,
  );
};

export default InteractionDataMenu;
