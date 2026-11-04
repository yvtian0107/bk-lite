'use client';

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Alert,
  Breadcrumb,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Spin,
  Tag,
  message,
} from 'antd';
import { HolderOutlined, PlusOutlined } from '@ant-design/icons';
import GroupTreeSelect from '@/components/group-tree-select';
import CompactEmptyState from '@/components/compact-empty-state';
import MoreActionsDropdown from '@/components/more-actions-dropdown';
import { useTranslation } from '@/utils/i18n';
import { useUserInfoContext } from '@/context/userInfo';
import { convertGroupTreeToTreeSelectData } from '@/utils/index';
import { getCanvasTypeMeta } from '@/app/ops-analysis/constants/canvasTypes';
import { useDirectoryApi } from '@/app/ops-analysis/api';
import { useCarouselApi } from '@/app/ops-analysis/api/carousel';
import type { CarouselItem } from '@/app/ops-analysis/types/carousel';
import type { DirItem } from '@/app/ops-analysis/types';
import {
  CAROUSEL_DEFAULT_DWELL_SECONDS,
  CAROUSEL_DWELL_MAX_SECONDS,
  CAROUSEL_DWELL_MIN_SECONDS,
  CAROUSEL_MAX_ITEMS,
  carouselHiddenGroupIds,
  clampCarouselDwellSeconds,
} from '@/app/ops-analysis/utils/carouselPlayer';
import {
  canvasIdentityKey,
  carouselDurationMessage,
  carouselRoundSeconds,
  duplicateCanvasKeys,
  syncCarouselSelection,
} from '@/app/ops-analysis/utils/carouselDraft';
import { buildCarouselPlayHref } from '@/app/ops-analysis/utils/carouselLinks';
import useBtnPermissions from '@/hooks/usePermissions';
import { CanvasTypeIcon } from './canvasTypeIcon';
import CanvasPicker, { type PickedCanvas } from './canvasPicker';

export interface CarouselEditorRef {
  hasUnsavedChanges: () => boolean;
}

interface DraftItem {
  key: string;
  id?: number;
  resource_type: CarouselItem['resource_type'];
  canvas_id: number;
  dwell_seconds: number | null;
  canvas_name: string;
  exists: boolean;
  visible: boolean;
  canvas_group_ids: number[];
}

interface CarouselEditorProps {
  carouselId: string | null;
  onSaved: (id: number) => void;
  onCreate?: () => void;
  onCopied?: (id: number) => void;
  onDeleted?: (id: number) => void;
}

const toDraft = (item: CarouselItem): DraftItem => ({
  key: `item-${item.id}`,
  id: item.id,
  resource_type: item.resource_type,
  canvas_id: item.canvas_id,
  dwell_seconds: item.dwell_seconds,
  canvas_name: item.canvas_name || '',
  exists: item.exists,
  visible: item.visible,
  canvas_group_ids: item.canvas_group_ids || [],
});

const moveItem = (items: DraftItem[], key: string, to: number): DraftItem[] => {
  const from = items.findIndex((item) => item.key === key);
  if (from < 0 || from === to) {
    return items;
  }
  const next = items.slice();
  const [row] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, row);
  return next;
};

const ItemRow = ({
  item,
  index,
  total,
  canEdit,
  defaultDwell,
  hiddenLabels,
  onDwell,
  onMove,
  onRemove,
}: {
  item: DraftItem;
  index: number;
  total: number;
  canEdit: boolean;
  defaultDwell: number;
  hiddenLabels: string[];
  onDwell: (value: number | null) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) => {
  const { t } = useTranslation();
  const sortable = useSortable({ id: item.key, disabled: !canEdit });
  const meta = getCanvasTypeMeta(item.resource_type);
  const invalid = !item.exists || !item.visible;
  const name = !item.exists
    ? (item.canvas_name || t('opsCarousel.deletedCanvas'))
    : !item.visible
      ? (item.canvas_name || t('opsCarousel.invisibleCanvas'))
      : (item.canvas_name || t('opsCarousel.unnamed'));
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className="flex items-center gap-2 border-b border-[var(--color-border-1)] px-2 py-1.5"
    >
      {canEdit && (
        <button
          type="button"
          className="w-6 cursor-grab text-[var(--color-text-3)]"
          aria-label={t('opsCarousel.drag')}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <HolderOutlined />
        </button>
      )}
      <span className="w-8 text-center text-xs text-[var(--color-text-3)]">{index + 1}</span>
      <CanvasTypeIcon type={item.resource_type} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${invalid ? 'text-[var(--color-text-3)]' : 'text-[var(--color-text-1)]'}`}>
          {name}
        </div>
      </div>
      <span className="w-16 shrink-0 text-xs text-[var(--color-text-3)]">
        {meta ? t(meta.nameKey) : item.resource_type}
      </span>
      {!item.exists && <Tag>{t('opsCarousel.invalidDeleted')}</Tag>}
      {item.exists && !item.visible && <Tag>{t('opsCarousel.invalidHidden')}</Tag>}
      {hiddenLabels.length > 0 && (
        <Popover
          content={(
            <div className="flex max-w-xs flex-col gap-1 text-sm">
              {hiddenLabels.map((label) => <span key={label}>{label}</span>)}
            </div>
          )}
        >
          <Tag>{t('opsCarousel.hiddenOrgCount', undefined, { count: hiddenLabels.length })}</Tag>
        </Popover>
      )}
      {canEdit ? (
        <InputNumber
          min={CAROUSEL_DWELL_MIN_SECONDS}
          max={CAROUSEL_DWELL_MAX_SECONDS}
          value={item.dwell_seconds ?? undefined}
          placeholder={String(defaultDwell)}
          className="w-32"
          addonAfter={t('opsCarousel.seconds')}
          onChange={(value) => onDwell(value == null ? null : clampCarouselDwellSeconds(value))}
        />
      ) : (
        <span className="w-32 text-sm text-[var(--color-text-2)]">
          {item.dwell_seconds ?? defaultDwell} {t('opsCarousel.seconds')}
        </span>
      )}
      {canEdit && (
        <MoreActionsDropdown
          stopPropagation
          labelAlign="start"
          items={[
            { key: 'up', label: t('opsCarousel.moveUp'), disabled: index === 0, onClick: () => onMove(index - 1) },
            { key: 'down', label: t('opsCarousel.moveDown'), disabled: index === total - 1, onClick: () => onMove(index + 1) },
            { key: 'top', label: t('opsCarousel.moveTop'), disabled: index === 0, onClick: () => onMove(0) },
            { key: 'bottom', label: t('opsCarousel.moveBottom'), disabled: index === total - 1, onClick: () => onMove(total - 1) },
            { key: 'remove', label: t('opsCarousel.remove'), danger: true, onClick: onRemove },
          ]}
        />
      )}
    </div>
  );
};

const CarouselEditor = forwardRef<CarouselEditorRef, CarouselEditorProps>(({
  carouselId,
  onSaved,
  onCreate,
  onCopied,
  onDeleted,
}, ref) => {
  const { t } = useTranslation();
  const { hasPermission } = useBtnPermissions();
  const { selectedGroup, groupTree, flatGroups } = useUserInfoContext();
  const {
    getCarousel,
    createCarousel,
    updateCarousel,
    copyCarousel,
    deleteCarousel,
  } = useCarouselApi();
  const { getDirectoryTree } = useDirectoryApi();
  const [form] = Form.useForm();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playPrompt, setPlayPrompt] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [directories, setDirectories] = useState<DirItem[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const groups = Form.useWatch('groups', form) as number[] | undefined;
  const watchedName = Form.useWatch('name', form) as string | undefined;
  const watchedDwell = Form.useWatch('default_dwell_seconds', form) as number | undefined;
  const canEdit = carouselId === 'new' ? hasPermission(['AddChart']) : hasPermission(['EditChart']);
  const canPlay = hasPermission(['View']);
  const canCopy = hasPermission(['AddChart']);
  const canDelete = hasPermission(['DeleteChart']);
  const isNew = !carouselId || carouselId === 'new';
  const defaultDwell = clampCarouselDwellSeconds(watchedDwell, CAROUSEL_DEFAULT_DWELL_SECONDS);
  const unsaved = dirty || carouselId === 'new';

  useImperativeHandle(ref, () => ({
    hasUnsavedChanges: () => dirty,
  }), [dirty]);

  const groupName = useMemo(() => {
    const names = new Map<string, string>();
    (flatGroups || []).forEach((group) => {
      names.set(String(group.id), group.name);
    });
    return (groupId: number) => names.get(String(groupId)) || String(groupId);
  }, [flatGroups]);

  useEffect(() => {
    if (!carouselId || carouselId === 'new') {
      form.setFieldsValue({
        name: '',
        desc: '',
        groups: selectedGroup?.id ? [Number(selectedGroup.id)] : [],
        default_dwell_seconds: CAROUSEL_DEFAULT_DWELL_SECONDS,
      });
      setItems([]);
      setDirty(false);
      setProblemsOnly(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getCarousel(carouselId).then((detail) => {
      if (cancelled) return;
      const drafts = detail.items.map(toDraft);
      form.setFieldsValue({
        name: detail.name,
        desc: detail.desc,
        groups: detail.groups,
        default_dwell_seconds: detail.default_dwell_seconds,
      });
      setItems(drafts);
      setDirty(false);
      setProblemsOnly(false);
      if (duplicateCanvasKeys(drafts.map((item) => ({
        resourceType: item.resource_type,
        canvasId: item.canvas_id,
      }))).length > 0) {
        message.warning(t('opsCarousel.duplicateHint'));
      }
    }).catch((error) => {
      console.error('Failed to load carousel:', error);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [carouselId, form, getCarousel, t]);

  useEffect(() => {
    if (carouselId !== 'new' || !selectedGroup?.id) return;
    const current = form.getFieldValue('groups') as number[] | undefined;
    if (!current?.length) {
      form.setFieldsValue({ groups: [Number(selectedGroup.id)] });
    }
  }, [carouselId, form, selectedGroup?.id]);

  const openPicker = async () => {
    try {
      setDirectories(await getDirectoryTree());
    } catch (error) {
      console.error('Failed to load canvases:', error);
      setDirectories([]);
    }
    setPickerOpen(true);
  };

  const applyPicked = (picked: PickedCanvas[]) => {
    const stamp = Date.now();
    let sequence = 0;
    setItems((current) => syncCarouselSelection(
      current,
      picked,
      (item) => canvasIdentityKey(item.resource_type, item.canvas_id),
      (canvas) => ({
        key: `new-${canvas.resourceType}-${canvas.canvasId}-${stamp}-${sequence += 1}`,
        resource_type: canvas.resourceType,
        canvas_id: canvas.canvasId,
        dwell_seconds: null,
        canvas_name: canvas.name,
        exists: true,
        visible: true,
        canvas_group_ids: canvas.groups,
      }),
    ).items);
    setDirty(true);
    setPickerOpen(false);
  };

  const persist = async (): Promise<number | null> => {
    const duplicates = duplicateCanvasKeys(items.map((item) => ({
      resourceType: item.resource_type,
      canvasId: item.canvas_id,
    })));
    if (duplicates.length > 0) {
      message.warning(t('opsCarousel.duplicateHint'));
      return null;
    }
    const values = await form.validateFields();
    const payload = {
      name: String(values.name).trim(),
      desc: values.desc || '',
      groups: (values.groups || []).map((groupId: number) => Number(groupId)),
      default_dwell_seconds: clampCarouselDwellSeconds(values.default_dwell_seconds),
      items: items.map((item) => ({
        ...(item.id ? { id: item.id } : {}),
        resource_type: item.resource_type,
        canvas_id: item.canvas_id,
        dwell_seconds: item.dwell_seconds,
      })),
    };
    setSaving(true);
    try {
      const saved = carouselId && carouselId !== 'new'
        ? await updateCarousel(carouselId, payload)
        : await createCarousel(payload);
      setDirty(false);
      message.success(t('common.saveSuccess'));
      return saved.id;
    } catch (error) {
      console.error('Failed to save carousel:', error);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const playSaved = () => {
    if (!carouselId || carouselId === 'new') return;
    window.open(buildCarouselPlayHref(carouselId), '_blank', 'noopener,noreferrer');
  };

  const saveAndPlay = async () => {
    const id = await persist();
    if (id == null) return;
    window.open(buildCarouselPlayHref(id), '_blank', 'noopener,noreferrer');
    setPlayPrompt(false);
    onSaved(id);
  };

  const startPlay = () => {
    if (carouselId === 'new' || dirty) {
      setPlayPrompt(true);
      return;
    }
    playSaved();
  };

  const duration = carouselDurationMessage(carouselRoundSeconds(items.map((item) => ({
    dwellSeconds: item.dwell_seconds,
    countsTowardDuration: item.exists && item.visible,
  })), defaultDwell));
  const invalidCount = items.filter((item) => !item.exists || !item.visible).length;
  const hiddenCount = items.filter((item) => (
    item.exists && item.visible && carouselHiddenGroupIds(item.canvas_group_ids, groups || []).length > 0
  )).length;
  const problemFilter = problemsOnly && (invalidCount > 0 || hiddenCount > 0);
  const shown = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (!problemFilter) return true;
      const hidden = item.exists && item.visible
        ? carouselHiddenGroupIds(item.canvas_group_ids, groups || [])
        : [];
      return !item.exists || !item.visible || hidden.length > 0;
    });
  const selectedKeys = useMemo(
    () => [...new Set(items.map((item) => canvasIdentityKey(item.resource_type, item.canvas_id)))],
    [items],
  );

  if (!carouselId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <CompactEmptyState description={t('opsCarousel.emptyList')} />
        {hasPermission(['AddChart']) && (
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            {t('opsCarousel.newList')}
          </Button>
        )}
      </div>
    );
  }

  const renderRow = (item: DraftItem, index: number) => {
    const hidden = !item.exists || !item.visible
      ? []
      : carouselHiddenGroupIds(item.canvas_group_ids, groups || []);
    return (
      <ItemRow
        key={item.key}
        item={item}
        index={index}
        total={items.length}
        canEdit={canEdit}
        defaultDwell={defaultDwell}
        hiddenLabels={hidden.map(groupName)}
        onDwell={(value) => {
          setItems((current) => current.map((row) => (
            row.key === item.key ? { ...row, dwell_seconds: value } : row
          )));
          setDirty(true);
        }}
        onMove={(to) => {
          setItems((current) => moveItem(current, item.key, to));
          setDirty(true);
        }}
        onRemove={() => {
          setItems((current) => current.filter((row) => row.key !== item.key));
          setDirty(true);
        }}
      />
    );
  };

  const list = shown.map(({ item, index }) => renderRow(item, index));

  return (
    <Spin spinning={loading} wrapperClassName="h-full">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-1)] px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <Breadcrumb
              items={[
                { title: t('opsCarousel.carousel') },
                { title: watchedName?.trim() || (isNew ? t('opsCarousel.newList') : t('opsCarousel.unnamed')) },
              ]}
            />
            <span className="shrink-0 text-xs text-[var(--color-text-3)]">
              {t('opsCarousel.roundDuration', undefined, { duration: t(duration.id, undefined, duration.values) })}
            </span>
            <span className="shrink-0 text-xs text-[var(--color-text-3)]">
              {unsaved ? t('opsCarousel.unsaved') : t('opsCarousel.saved')}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canPlay && (!isNew || canEdit) && (
              <Button onClick={startPlay}>{t('opsCarousel.startPlay')}</Button>
            )}
            {canEdit && (
              <Button type="primary" loading={saving} onClick={() => { void persist().then((id) => { if (id != null) onSaved(id); }); }}>
                {t('common.save')}
              </Button>
            )}
            {canEdit && !isNew && (canCopy || canDelete) && (
              <MoreActionsDropdown
                buttonSize="middle"
                labelAlign="start"
                items={[
                  ...(canCopy ? [{
                    key: 'copy',
                    label: t('common.copy'),
                    onClick: () => {
                      if (!carouselId) return;
                      void copyCarousel(carouselId).then((copied) => onCopied?.(copied.id));
                    },
                  }] : []),
                  ...(canDelete ? [{
                    key: 'delete',
                    label: t('common.delete'),
                    danger: true,
                    onClick: () => {
                      if (!carouselId) return;
                      Modal.confirm({
                        title: t('opsCarousel.deleteConfirm'),
                        content: watchedName,
                        okText: t('common.confirm'),
                        cancelText: t('common.cancel'),
                        okButtonProps: { danger: true },
                        centered: true,
                        onOk: () => deleteCarousel(carouselId).then(() => onDeleted?.(Number(carouselId))),
                      });
                    },
                  }] : []),
                ]}
              />
            )}
          </div>
        </div>
        <div className="shrink-0 border-b border-[var(--color-border-1)] px-4 py-3">
          <Form
            form={form}
            layout="vertical"
            disabled={!canEdit}
            className="grid grid-cols-4 gap-3 rounded-md border border-[var(--color-border-1)] bg-[var(--color-bg-2)] px-3 py-3"
            onValuesChange={() => setDirty(true)}
          >
            <Form.Item
              className="mb-0 min-w-0"
              name="name"
              label={t('opsAnalysisSidebar.nameLabel')}
              rules={[{ required: true, message: t('common.inputMsg') }]}
            >
              <Input maxLength={128} />
            </Form.Item>
            <Form.Item
              className="mb-0 min-w-0"
              name="groups"
              label={t('opsCarousel.ownerOrg')}
              rules={[{ required: true, message: `${t('common.selectMsg')}${t('opsCarousel.ownerOrg')}` }]}
            >
              <GroupTreeSelect
                treeData={convertGroupTreeToTreeSelectData(groupTree || [])}
                placeholder={`${t('common.selectMsg')}${t('opsCarousel.ownerOrg')}`}
                multiple
                mode="ownership"
              />
            </Form.Item>
            <Form.Item
              className="mb-0 min-w-0"
              name="default_dwell_seconds"
              label={t('opsCarousel.defaultDwell')}
              rules={[{ required: true, message: t('common.inputMsg') }]}
            >
              <InputNumber
                min={CAROUSEL_DWELL_MIN_SECONDS}
                max={CAROUSEL_DWELL_MAX_SECONDS}
                className="w-full"
                addonAfter={t('opsCarousel.seconds')}
              />
            </Form.Item>
            <Form.Item className="mb-0 min-w-0" name="desc" label={t('opsAnalysisSidebar.descLabel')}>
              <Input />
            </Form.Item>
          </Form>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-[var(--color-text-1)]">
                {t('opsCarousel.items')} ({items.length}/{CAROUSEL_MAX_ITEMS})
              </div>
              <div className="text-xs text-[var(--color-text-3)]">
                {t('opsCarousel.dwellEmptyHint', undefined, { seconds: defaultDwell })}
              </div>
            </div>
            {canEdit && (
              <Button icon={<PlusOutlined />} onClick={() => { void openPicker(); }}>
                {t('opsCarousel.addCanvas')}
              </Button>
            )}
          </div>
          {(invalidCount > 0 || hiddenCount > 0) && (
            <Alert
              className="mb-3"
              type="warning"
              showIcon
              message={t('opsCarousel.issueSummary', undefined, { invalid: invalidCount, hidden: hiddenCount })}
              action={(
                <div className="flex gap-2">
                  <Button size="small" onClick={() => setProblemsOnly((value) => !value)}>
                    {problemFilter ? t('opsCarousel.showAll') : t('opsCarousel.problemsOnly')}
                  </Button>
                  {canEdit && invalidCount > 0 && (
                    <Button
                      size="small"
                      danger
                      onClick={() => {
                        setItems((current) => current.filter((item) => item.exists && item.visible));
                        setDirty(true);
                      }}
                    >
                      {t('opsCarousel.removeInvalid')}
                    </Button>
                  )}
                </div>
              )}
            />
          )}
          {shown.length === 0 ? (
            <CompactEmptyState description={t('opsCarousel.noItems')} />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => {
                if (!canEdit) return;
                const { active, over } = event;
                if (!over || active.id === over.id) return;
                setItems((current) => {
                  const from = current.findIndex((item) => item.key === active.id);
                  const to = current.findIndex((item) => item.key === over.id);
                  if (from < 0 || to < 0) return current;
                  return arrayMove(current, from, to);
                });
                setDirty(true);
              }}
            >
              <SortableContext items={shown.map(({ item }) => item.key)} strategy={verticalListSortingStrategy}>
                <div>{list}</div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
      <CanvasPicker
        open={pickerOpen}
        directories={directories}
        selectedKeys={selectedKeys}
        currentItems={items.map((item) => ({ resourceType: item.resource_type, canvasId: item.canvas_id }))}
        onClose={() => setPickerOpen(false)}
        onConfirm={applyPicked}
      />
      <Modal
        open={playPrompt}
        centered
        title={t('opsCarousel.unsavedPlayTitle')}
        onCancel={() => setPlayPrompt(false)}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPlayPrompt(false)}>{t('common.cancel')}</Button>
            {carouselId !== 'new' && (
              <Button onClick={() => { setPlayPrompt(false); playSaved(); }}>
                {t('opsCarousel.playSaved')}
              </Button>
            )}
            <Button type="primary" loading={saving} onClick={() => { void saveAndPlay(); }}>
              {t('opsCarousel.saveAndPlay')}
            </Button>
          </div>
        )}
      >
        {t('opsCarousel.unsavedPlayBody')}
      </Modal>
    </Spin>
  );
});

CarouselEditor.displayName = 'CarouselEditor';

export default CarouselEditor;
