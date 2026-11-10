'use client';

import React, { useEffect, useState } from 'react';
import { Button, Collapse, DatePicker, Input, InputNumber, Radio, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from '@/utils/i18n';
import {
  emptyConditionGroup,
  inspectCondition,
  isLegacyConditionTree,
  leafFields,
  previewCondition,
  readConditionCards,
  summarizeConditionCards,
  writeConditionCards,
  type ConditionCard,
  type ConditionGroup,
  type ConditionLeaf,
  type QueryFieldCatalogItem,
} from '@/app/ops-analysis/utils/conditionTree';

const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

interface ConditionTreeEditorProps {
  value?: unknown;
  onChange?: (value: ConditionGroup) => void;
  disabled?: boolean;
  catalog: QueryFieldCatalogItem[];
  catalogReady: boolean;
  selectedModelIds?: string[];
  resultEmpty?: boolean;
  onFocusModels?: () => void;
}

const modelNameOf = (catalog: QueryFieldCatalogItem[], modelId: string) => (
  catalog.find((item) => item.modelId === modelId)?.modelName || modelId
);

const ConditionTreeEditor: React.FC<ConditionTreeEditorProps> = ({
  value,
  onChange,
  disabled = false,
  catalog,
  catalogReady,
  selectedModelIds = [],
  resultEmpty = false,
  onFocusModels,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const issue = inspectCondition(value, catalog, catalogReady);
  const issueKey = issue ? `${issue.code}:${issue.cardIndex ?? ''}:${issue.leafIndex ?? ''}` : '';
  useEffect(() => {
    if (issueKey) setOpen(true);
  }, [issueKey]);
  const legacy = isLegacyConditionTree(value);
  const cards = readConditionCards(value);
  const selected = selectedModelIds.filter((item) => typeof item === 'string' && item);
  const used = new Set(cards.map((card) => card.modelId).filter(Boolean));
  const remaining = selected.filter((modelId) => !used.has(modelId));
  const addDisabled = disabled || selected.length === 0 || remaining.length === 0;
  const addReason = selected.length === 0
    ? t('conditionBuilder.needModel')
    : t('conditionBuilder.modelsAlreadyAdded');
  const summary = summarizeConditionCards(
    selected.map((modelId) => ({ id: modelId, name: modelNameOf(catalog, modelId) })),
    cards,
    catalog,
    {
      and: t('conditionBuilder.and'),
      or: t('conditionBuilder.or'),
      all: t('conditionBuilder.allInstances'),
      unfinished: t('conditionBuilder.unfinished'),
    },
  );
  const issueText = issue ? t(`conditionBuilder.issue.${issue.code}`) : '';

  const commit = (next: ConditionCard[]) => onChange?.(writeConditionCards(next));

  const renderValue = (
    node: ConditionLeaf,
    kind: string,
    field: QueryFieldCatalogItem | undefined,
    onLeaf: (next: ConditionLeaf) => void,
  ) => {
    if (!field || kind === 'none') return null;
    if (kind === 'number') {
      return (
        <InputNumber
          disabled={disabled}
          className="min-w-28"
          value={typeof node.value === 'number' ? node.value : undefined}
          onChange={(next) => onLeaf({ ...node, value: next ?? undefined })}
        />
      );
    }
    if (kind === 'bool') {
      return (
        <Select
          disabled={disabled}
          className="min-w-24"
          value={typeof node.value === 'boolean' ? String(node.value) : undefined}
          options={[
            { value: 'true', label: t('common.yes') },
            { value: 'false', label: t('common.no') },
          ]}
          onChange={(next) => onLeaf({ ...node, value: next === 'true' })}
        />
      );
    }
    if (kind === 'enum') {
      return (
        <Select
          disabled={disabled}
          mode="multiple"
          className="min-w-40"
          value={Array.isArray(node.value) ? node.value.map(String) : []}
          options={field.options}
          onChange={(next) => onLeaf({ ...node, value: next })}
        />
      );
    }
    if (kind === 'time' || kind === 'range') {
      const start = kind === 'range' && node.value && typeof node.value === 'object'
        ? (node.value as { start?: string }).start
        : typeof node.value === 'string' ? node.value : undefined;
      const end = kind === 'range' && node.value && typeof node.value === 'object'
        ? (node.value as { end?: string }).end
        : undefined;
      return (
        <Space>
          <DatePicker
            disabled={disabled}
            showTime
            value={start ? dayjs(start) : null}
            onChange={(next) => {
              const text = next ? next.format(TIME_FORMAT) : '';
              onLeaf({
                ...node,
                value: kind === 'range' ? { start: text, end: end || '' } : text,
              });
            }}
          />
          {kind === 'range' && (
            <DatePicker
              disabled={disabled}
              showTime
              value={end ? dayjs(end) : null}
              onChange={(next) => onLeaf({
                ...node,
                value: { start: start || '', end: next ? next.format(TIME_FORMAT) : '' },
              })}
            />
          )}
        </Space>
      );
    }
    return (
      <Input
        disabled={disabled}
        className="min-w-36"
        value={typeof node.value === 'string' ? node.value : ''}
        onChange={(event) => onLeaf({ ...node, value: event.target.value })}
      />
    );
  };

  const renderLeaf = (card: ConditionCard, leaf: ConditionLeaf, leafIndex: number, cardIndex: number) => {
    const fields = catalog.filter((item) => item.modelId === card.modelId);
    const selectedFields = leafFields(catalog, leaf);
    const field = selectedFields[0];
    const operators = selectedFields.length
      ? selectedFields[0].operators.filter((item) => selectedFields.every((candidate) => candidate.operators.some((choice) => choice.value === item.value)))
      : [];
    const operator = operators.find((item) => item.value === leaf.operator);
    const replace = (nextLeaf: ConditionLeaf) => {
      const next = cards.slice();
      const children = card.children.slice();
      children[leafIndex] = nextLeaf;
      next[cardIndex] = { ...card, children };
      commit(next);
    };
    const leafIssue = issue && issue.cardIndex === cardIndex && issue.leafIndex === leafIndex;
    return (
      <div className="flex flex-col gap-1">
        <Space wrap className="w-full">
          <Select
            disabled={disabled}
            showSearch
            optionFilterProp="label"
            className="min-w-44"
            placeholder={t('conditionBuilder.field')}
            value={leaf.attr_id || undefined}
            options={fields.map((item) => ({ value: item.attrId, label: item.label }))}
            onChange={(attrId) => {
              const nextField = fields.find((item) => item.attrId === String(attrId));
              replace({
                scope: card.modelId,
                attr_id: String(attrId),
                field_ref: nextField?.key,
                operator: nextField?.operators[0]?.value || '',
                value: undefined,
              });
            }}
          />
          <Select
            disabled={disabled || !field}
            className="min-w-28"
            placeholder={t('conditionBuilder.operator')}
            value={leaf.operator || undefined}
            options={operators.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(nextOperator) => replace({ ...leaf, operator: nextOperator, value: undefined })}
          />
          {renderValue(leaf, operator?.valueKind || 'text', field, replace)}
          <Button
            disabled={disabled}
            onClick={() => {
              const next = cards.slice();
              next[cardIndex] = { ...card, children: card.children.filter((_, index) => index !== leafIndex) };
              commit(next);
            }}
          >
            {t('conditionBuilder.remove')}
          </Button>
        </Space>
        {leafIssue ? <p className="m-0 text-xs text-[var(--color-fail)]">{issueText}</p> : null}
      </div>
    );
  };

  const renderCard = (card: ConditionCard, cardIndex: number) => {
    const locked = card.children.length > 0;
    const lockId = `condition-model-lock-${cardIndex}`;
    const known = new Set(selected);
    const options = selected
      .filter((modelId) => modelId === card.modelId || !used.has(modelId))
      .map((modelId) => ({ value: modelId, label: modelNameOf(catalog, modelId) }));
    if (card.modelId && !known.has(card.modelId)) {
      options.push({
        value: card.modelId,
        label: `${modelNameOf(catalog, card.modelId)}（${t('conditionBuilder.staleModel')}）`,
      });
    }
    const cardIssue = issue && issue.cardIndex === cardIndex && issue.leafIndex === undefined;
    return (
      <div key={`${card.modelId || 'new'}-${cardIndex}`} className="flex flex-col gap-2 rounded border border-[var(--color-border-2)] p-2">
        <Select
          disabled={disabled || locked}
          className="min-w-44"
          placeholder={t('conditionBuilder.pickModel')}
          value={card.modelId || undefined}
          options={options}
          aria-describedby={locked ? lockId : undefined}
          onChange={(modelId) => {
            const next = cards.slice();
            next[cardIndex] = { ...card, modelId: String(modelId), children: [] };
            commit(next);
          }}
        />
        {locked ? (
          <p id={lockId} className="m-0 text-xs text-[var(--color-text-3)]">
            {t('conditionBuilder.modelLocked')}
          </p>
        ) : null}
        {card.children.length >= 2 ? (
          <Radio.Group
            disabled={disabled}
            value={card.logic}
            optionType="button"
            options={[
              { value: 'and', label: t('conditionBuilder.and') },
              { value: 'or', label: t('conditionBuilder.or') },
            ]}
            onChange={(event) => {
              const next = cards.slice();
              next[cardIndex] = { ...card, logic: event.target.value };
              commit(next);
            }}
          />
        ) : null}
        {card.children.map((leaf, leafIndex) => renderLeaf(card, leaf, leafIndex, cardIndex))}
        {cardIssue ? <p className="m-0 text-xs text-[var(--color-fail)]">{issueText}</p> : null}
        <Space wrap>
          <Button
            disabled={disabled || !card.modelId}
            onClick={() => {
              const next = cards.slice();
              next[cardIndex] = {
                ...card,
                children: [...card.children, { scope: card.modelId, attr_id: '', operator: '' }],
              };
              commit(next);
            }}
          >
            {t('conditionBuilder.addLeaf')}
          </Button>
          {card.children.length > 0 ? (
            <Button
              disabled={disabled}
              onClick={() => {
                const next = cards.slice();
                next[cardIndex] = { ...card, children: [] };
                commit(next);
              }}
            >
              {t('conditionBuilder.clearModel')}
            </Button>
          ) : null}
          <Button
            disabled={disabled}
            onClick={() => commit(cards.filter((_, index) => index !== cardIndex))}
          >
            {t('conditionBuilder.remove')}
          </Button>
        </Space>
      </div>
    );
  };

  const labels = {
    and: t('conditionBuilder.and'),
    or: t('conditionBuilder.or'),
    global: t('conditionBuilder.global'),
    missing: t('conditionBuilder.missing'),
  };

  return (
    <div className="flex flex-col gap-2">
      {catalogReady ? null : <span className="text-xs text-[var(--color-text-3)]">{t('conditionBuilder.loading')}</span>}
      {legacy ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs text-[var(--color-text-2)]">{t('conditionBuilder.legacyKept')}</p>
          <p className="m-0 text-xs text-[var(--color-text-3)]">{previewCondition(value, catalog, labels) || t('conditionBuilder.emptyHint')}</p>
          {issue ? <p className="m-0 text-xs text-[var(--color-fail)]">{issueText}</p> : null}
          <Button disabled={disabled} onClick={() => onChange?.(emptyConditionGroup())}>
            {t('conditionBuilder.rebuild')}
          </Button>
        </div>
      ) : (
        <Collapse
          ghost
          activeKey={open ? ['conditions'] : []}
          onChange={(key) => {
            const keys = Array.isArray(key) ? key : [key];
            setOpen(keys.includes('conditions'));
          }}
          items={[{
            key: 'conditions',
            label: (
              <span className="text-sm text-[var(--color-text-2)]">
                {summary || t('conditionBuilder.emptyHint')}
              </span>
            ),
            children: (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-xs text-[var(--color-text-3)]">{t('conditionBuilder.emptyHint')}</p>
                {summary ? <p className="m-0 text-xs text-[var(--color-text-2)]">{summary}</p> : null}
                {cards.map((card, index) => renderCard(card, index))}
                <Button
                  disabled={addDisabled}
                  onClick={() => commit([...cards, { modelId: '', logic: 'and', children: [] }])}
                >
                  {t('conditionBuilder.addCard')}
                </Button>
                {addDisabled ? <p className="m-0 text-xs text-[var(--color-text-3)]">{addReason}</p> : null}
                {issue && issue.cardIndex === undefined ? (
                  <p className="m-0 text-xs text-[var(--color-fail)]">{issueText}</p>
                ) : null}
              </div>
            ),
          }]}
        />
      )}
      {resultEmpty ? (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-xs text-[var(--color-text-2)]">{t('conditionBuilder.emptyResult')}</p>
          <Space wrap>
            {cards.map((card, index) => (
              card.children.length > 0 ? (
                <Button
                  key={`${card.modelId}-${index}`}
                  disabled={disabled}
                  onClick={() => {
                    const next = cards.slice();
                    next[index] = { ...card, children: [] };
                    commit(next);
                  }}
                >
                  {t('conditionBuilder.clearModel')}
                </Button>
              ) : null
            ))}
            <Button disabled={disabled} onClick={() => onFocusModels?.()}>
              {t('conditionBuilder.backToModels')}
            </Button>
          </Space>
        </div>
      ) : null}
    </div>
  );
};

export default ConditionTreeEditor;
