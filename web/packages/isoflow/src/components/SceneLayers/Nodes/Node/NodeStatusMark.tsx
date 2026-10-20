import React from 'react';
import { Box } from '@mui/material';
import { PROJECTED_TILE_SIZE } from 'src/config';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import { HIGHLIGHT_STROKE, NODE_STATUS_COLOR } from 'src/diagramOverlay/colors';
import type { NodeStatus, NodeStatusLevel } from 'src/types';

interface Props {
  nodeId: string;
  order: number;
}

// Highlight stroke is 5px. Expand the outline hit box by half of that so the
// stroke edge still counts as the icon.
const STATUS_OUTLINE_HIT_PAD = 3;
const MARK_SIZE = 16;
const CORNER_BADGE = 18;
const CHAIN_COLOR = '#0891b2';

// Isometric icons are a square this wide, bottom-centered on the tile anchor
// (IsometricIcon). The painted picture does not fill that square: its
// lower-right sits near 74% of the box, inside the transparent viewBox
// padding. The corner badge is centered on that point, the same way the
// alert disc is centered on the upper-right, so both stay on the picture
// when the scene scale changes.
const ICON_BOX = PROJECTED_TILE_SIZE.width * 0.8;
const PICTURE_CORNER = 0.74;

const COLORED_LEVEL = new Set<NodeStatusLevel>(['normal', 'warning', 'critical']);

const badgeLabel = (status: NodeStatus) => {
  if (status.level !== 'warning' && status.level !== 'critical') return null;
  if (typeof status.count !== 'number' || !Number.isFinite(status.count)) return null;

  return String(status.count);
};

const MarkDisc = ({
  nodeId,
  order,
  left,
  top,
  title,
  color,
  filled,
  grow,
  ring,
  shadow,
  size = MARK_SIZE,
  children
}: {
  nodeId: string;
  order: number;
  left: number;
  top: number;
  title?: string;
  color: string;
  filled?: boolean;
  grow?: boolean;
  ring?: string;
  shadow?: boolean;
  size?: number;
  children: React.ReactNode;
}) => {
  return (
    <Box
      title={title || undefined}
      data-icon-hit={nodeId}
      data-icon-order={order}
      data-corner-badge={size === CORNER_BADGE ? 'true' : undefined}
      data-status-disc={ring ? 'badge' : undefined}
      sx={{
        position: 'absolute',
        left,
        top,
        width: grow ? 'auto' : size,
        minWidth: size,
        height: size,
        px: grow ? '4px' : 0,
        transform: 'translate(-50%, -50%)',
        borderRadius: size,
        border: ring
          ? `1.5px solid ${ring}`
          : filled
            ? 'none'
            : `1.5px solid ${color}`,
        bgcolor: filled || ring ? color : '#fff',
        color: filled || ring
          ? color === NODE_STATUS_COLOR.warning
            ? '#1f2937'
            : '#fff'
          : color,
        boxShadow: shadow ? '0 1px 2px rgba(15, 23, 42, 0.28)' : undefined,
        pointerEvents: title ? 'auto' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box'
      }}
    >
      {children}
    </Box>
  );
};

const PlugGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
    <path
      d="M5 1.4v3.1M11 1.4v3.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <path
      d="M3.6 6.2h8.8v2.3a3.1 3.1 0 0 1-3.1 3.1H6.7a3.1 3.1 0 0 1-3.1-3.1V6.2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M8 11.6v2.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);

const GrayGlyph = ({ level }: { level: NodeStatusLevel }) => {
  if (level === 'unmonitored') return <PlugGlyph />;

  if (level === 'unknown') {
    return (
      <Box component="span" sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>
        ?
      </Box>
    );
  }

  if (level === 'forbidden') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
        <rect
          x="3.2"
          y="7"
          width="9.6"
          height="6.6"
          rx="1.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  if (level === 'invalid') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
        <path
          d="M1.8 6.2h3.4a1.8 1.8 0 0 1 0 3.6H1.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M14.2 6.2h-3.4a1.8 1.8 0 0 0 0 3.6h3.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M7.2 8h1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return null;
};

const ChainGlyph = () => {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="0.8" y="4.8" width="8.4" height="4.8" rx="2.4" transform="rotate(-42 5 7.2)" />
        <rect x="6.8" y="6.4" width="8.4" height="4.8" rx="2.4" transform="rotate(-42 11 8.8)" />
      </g>
    </svg>
  );
};

export const NodeStatusMark = ({ nodeId, order }: Props) => {
  const visual = useDiagramVisual();
  const status = visual.nodeStatus?.[nodeId];
  const binding = visual.nodeBinding?.[nodeId];
  const highlighted =
    visual.editorMode === 'EXPLORABLE_READONLY' &&
    visual.highlightedItemId === nodeId;
  const showChain = Boolean(binding?.chain);
  const showUnbound = Boolean(binding?.unbound);

  if (!status && !highlighted && !showChain && !showUnbound) return null;

  const width = PROJECTED_TILE_SIZE.width;
  const height = PROJECTED_TILE_SIZE.height;
  const color = status ? NODE_STATUS_COLOR[status.level] : undefined;
  const label = status ? badgeLabel(status) : null;
  const coloredOutline = Boolean(status && color && COLORED_LEVEL.has(status.level));
  const grayMark = Boolean(
    status && !COLORED_LEVEL.has(status.level)
  );
  const points = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
  const topRight = { left: width * 0.84, top: height * 0.2 };
  const pictureRight = -ICON_BOX / 2 + ICON_BOX * PICTURE_CORNER;
  const pictureBottom = -ICON_BOX * (1 - PICTURE_CORNER);
  const bottomRight = {
    left: pictureRight + width / 2,
    top: pictureBottom + height
  };

  return (
    <Box
      aria-hidden
      data-node-status={status?.level ?? ''}
      data-node-highlight={highlighted ? 'true' : 'false'}
      data-binding-chain={showChain ? 'true' : 'false'}
      data-binding-unbound={showUnbound ? 'true' : 'false'}
      data-icon-hit={nodeId}
      data-icon-order={order}
      data-icon-pad={STATUS_OUTLINE_HIT_PAD}
      sx={{
        position: 'absolute',
        left: -width / 2,
        top: -height,
        width,
        height,
        pointerEvents: 'none'
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ pointerEvents: 'none' }}
      >
        {highlighted && (
          <polygon
            points={points}
            fill="none"
            stroke={HIGHLIGHT_STROKE}
            strokeWidth={5}
            strokeLinejoin="round"
          />
        )}
        {showUnbound && (
          <polygon
            points={points}
            fill="none"
            stroke="#9ca3af"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeDasharray="5 4"
          />
        )}
        {coloredOutline && (
          <polygon
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        )}
      </svg>
      {label && color ? (
        <MarkDisc
          nodeId={nodeId}
          order={order}
          left={topRight.left}
          top={topRight.top}
          title={status?.badgeHint}
          color={color}
          filled
          grow
        >
          <Box
            component="span"
            sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1, px: '1px' }}
          >
            {label}
          </Box>
        </MarkDisc>
      ) : null}
      {grayMark && status && color ? (
        <MarkDisc
          nodeId={nodeId}
          order={order}
          left={bottomRight.left}
          top={bottomRight.top}
          title={status.hint}
          color={color}
          filled
          ring="#fff"
          shadow
          size={MARK_SIZE}
        >
          <GrayGlyph level={status.level} />
        </MarkDisc>
      ) : null}
      {showChain ? (
        <MarkDisc
          nodeId={nodeId}
          order={order}
          left={bottomRight.left}
          top={bottomRight.top}
          color={CHAIN_COLOR}
          size={CORNER_BADGE}
        >
          <ChainGlyph />
        </MarkDisc>
      ) : null}
    </Box>
  );
};
