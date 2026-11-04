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
  Button,
  Form,
  Input,
  InputNumber,
  Spin,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { DeleteOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
import GroupTreeSelect from '@/components/group-tree-select';
import CompactEmptyState from '@/components/compact-empty-state';
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

const SortableRow = ({
  item,
  invalid,
  hiddenLabels,
  onDwell,
  onRemove,
}: {
  item: DraftItem;
  invalid: boolean;
  hiddenLabels: string[];
  onDwell: (value: number | null) => void;
  onRemove: () => void;
}) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.key });
  const meta = getCanvasTypeMeta(item.resource_type);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded border bg-[var(--color-bg-1)] px-2 py-2 ${
        invalid ? 'border-[var(--ant-color-error)]' : 'border-[var(--color-border-1)]'
      }`}
    >
      <button
        type="button"
        className="cursor-grab text-[var(--color-text-3)]"
        aria-label={t('opsCarousel.drag')}
        {...attributes}
        {...listeners}
      >
        <HolderOutlined />
      </button>
      <CanvasTypeIcon type={item.resource_type} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-[var(--color-text-1)]">
          {item.exists ? item.canvas_name || t('opsCarousel.unnamed') : t('opsCarousel.invalid')}
        </div>
        <div className="text-xs text-[var(--color-text-3)]">{meta ? t(meta.nameKey) : item.resource_type}</div>
      </div>
      {invalid && <Tag color="error">{t('opsCarousel.invalid')}</Tag>}
      {hiddenLabels.length > 0 && (
        <Tooltip title={t('opsCarousel.hiddenOrgsTip')}>
          <Tag color="warning">{hiddenLabels.join('、')}</Tag>
        </Tooltip>
      )}
      <InputNumber
        min={CAROUSEL_DWELL_MIN_SECONDS}
        max={CAROUSEL_DWELL_MAX_SECONDS}
        value={item.dwell_seconds ?? undefined}
        placeholder={t('opsCarousel.useDefault')}
        className="w-28"
        onChange={(value) => onDwell(value == null ? null : clampCarouselDwellSeconds(value))}
      />
      <Button type="text" danger aria-label={t('common.delete')} icon={<DeleteOutlined />} onClick={onRemove} />
    </div>
  );
};

const CarouselEditor = forwardRef<CarouselEditorRef, CarouselEditorProps>(({ carouselId, onSaved }, ref) => {
  const { t } = useTranslation();
  const { hasPermission } = useBtnPermissions();
  const { selectedGroup, groupTree, flatGroups } = useUserInfoContext();
  const { getCarousel, createCarousel, updateCarousel } = useCarouselApi();
  const { getDirectoryTree } = useDirectoryApi();
  const [form] = Form.useForm();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [directories, setDirectories] = useState<DirItem[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const groups = Form.useWatch('groups', form) as number[] | undefined;
  const canEdit = carouselId === 'new'
    ? hasPermission(['AddChart'])
    : hasPermission(['EditChart']);
  const canPlay = hasPermission(['View']);

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
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getCarousel(carouselId).then((detail) => {
      if (cancelled) return;
      form.setFieldsValue({
        name: detail.name,
        desc: detail.desc,
        groups: detail.groups,
        default_dwell_seconds: detail.default_dwell_seconds,
      });
      setItems(detail.items.map(toDraft));
      setDirty(false);
    }).catch((error) => {
      console.error('Failed to load carousel:', error);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // 只在切换列表时重载。组织变化由条目上的不可见提示即时重算，避免清掉未保存编辑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carouselId, form, getCarousel]);

  useEffect(() => {
    if (carouselId !== 'new' || !selectedGroup?.id) return;
    const current = form.getFieldValue('groups') as number[] | undefined;
    if (!current?.length) {
      form.setFieldsValue({ groups: [Number(selectedGroup.id)] });
    }
  }, [carouselId, form, selectedGroup?.id]);

  const openPicker = async () => {
    if (items.length >= CAROUSEL_MAX_ITEMS) {
      message.warning(t('opsCarousel.itemLimit'));
      return;
    }
    try {
      setDirectories(await getDirectoryTree());
    } catch (error) {
      console.error('Failed to load canvases:', error);
      setDirectories([]);
    }
    setPickerOpen(true);
  };

  const addCanvases = (picked: PickedCanvas[]) => {
    setItems((current) => {
      const room = CAROUSEL_MAX_ITEMS - current.length;
      const next = picked.slice(0, room).map((canvas, index) => ({
        key: `new-${canvas.resourceType}-${canvas.canvasId}-${Date.now()}-${index}`,
        resource_type: canvas.resourceType,
        canvas_id: canvas.canvasId,
        dwell_seconds: null,
        canvas_name: canvas.name,
        exists: true,
        visible: true,
        canvas_group_ids: canvas.groups,
      }));
      return [...current, ...next];
    });
    setDirty(true);
  };

  const save = async () => {
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
      onSaved(saved.id);
    } catch (error) {
      console.error('Failed to save carousel:', error);
    } finally {
      setSaving(false);
    }
  };

  if (!carouselId) {
    return (
      <div className="flex h-full items-center justify-center">
        <CompactEmptyState description={t('opsCarousel.selectList')} />
      </div>
    );
  }

  return (
    <Spin spinning={loading}>
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
        <div className="flex items-center justify-end gap-2">
          {canPlay && carouselId !== 'new' && (
            <Button
              onClick={() => window.open(buildCarouselPlayHref(carouselId), '_blank', 'noopener,noreferrer')}
            >
              {t('opsCarousel.startPlay')}
            </Button>
          )}
          {canEdit && (
            <Button type="primary" loading={saving} onClick={() => { void save(); }}>
              {t('common.save')}
            </Button>
          )}
        </div>
        <Form
          form={form}
          layout="vertical"
          disabled={!canEdit}
          onValuesChange={() => setDirty(true)}
        >
          <Form.Item name="name" label={t('opsAnalysisSidebar.nameLabel')} rules={[{ required: true, message: t('common.inputMsg') }]}>
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item name="desc" label={t('opsAnalysisSidebar.descLabel')}>
            <Input.TextArea autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Form.Item
            name="groups"
            label={t('common.group')}
            rules={[{ required: true, message: `${t('common.selectMsg')}${t('common.group')}` }]}
          >
            <GroupTreeSelect
              treeData={convertGroupTreeToTreeSelectData(groupTree || [])}
              placeholder={`${t('common.selectMsg')}${t('common.group')}`}
              multiple
              mode="ownership"
            />
          </Form.Item>
          <Form.Item
            name="default_dwell_seconds"
            label={t('opsCarousel.defaultDwell')}
            rules={[{ required: true, message: t('common.inputMsg') }]}
          >
            <InputNumber min={CAROUSEL_DWELL_MIN_SECONDS} max={CAROUSEL_DWELL_MAX_SECONDS} className="w-40" addonAfter={t('opsCarousel.seconds')} />
          </Form.Item>
        </Form>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--color-text-1)]">
            {t('opsCarousel.items')} ({items.length}/{CAROUSEL_MAX_ITEMS})
          </span>
          {canEdit && (
            <Button icon={<PlusOutlined />} onClick={() => { void openPicker(); }}>
              {t('opsCarousel.addCanvas')}
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <CompactEmptyState description={t('opsCarousel.noItems')} />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event: DragEndEvent) => {
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
            <SortableContext items={items.map((item) => item.key)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {items.map((item) => {
                  const invalid = !item.exists || !item.visible;
                  const hidden = invalid ? [] : carouselHiddenGroupIds(item.canvas_group_ids, groups || []);
                  return (
                    <SortableRow
                      key={item.key}
                      item={item}
                      invalid={invalid}
                      hiddenLabels={hidden.map(groupName)}
                      onDwell={(value) => {
                        setItems((current) => current.map((row) => (
                          row.key === item.key ? { ...row, dwell_seconds: value } : row
                        )));
                        setDirty(true);
                      }}
                      onRemove={() => {
                        setItems((current) => current.filter((row) => row.key !== item.key));
                        setDirty(true);
                      }}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <CanvasPicker
        open={pickerOpen}
        directories={directories}
        onClose={() => setPickerOpen(false)}
        onConfirm={addCanvases}
      />
    </Spin>
  );
});

CarouselEditor.displayName = 'CarouselEditor';

export default CarouselEditor;
