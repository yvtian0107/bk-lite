'use client';

import React, { useEffect, useState } from 'react';
import { Button, Collapse, DatePicker, Input, InputNumber, Modal, Radio, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from '@/utils/i18n';
import {
  appendCopiedCondition,
  copyModelCondition,
  explainFieldCopy,
  hasConditionLeaves,
  inspectCondition,
  isLegacyConditionTree,
  leafFields,
  previewCondition,
  readConditionCards,
  sourceAttrIds,
  summarizeConditionCards,
  writeConditionCards,
  type ConditionCard,
  type ConditionGroup,
  type ConditionIssue,
  type ConditionLeaf,
  type ConditionNode,
  type CopyBlockReason,
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

const samePath = (issue: ConditionIssue | null, cardIndex: number, path: number[]) => (
  Boolean(issue && issue.cardIndex === cardIndex && (issue.path || []).join('.') === path.join('.'))
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
  const selected = selectedModelIds.filter((item) => typeof item === 'string' && item);
  const issue = inspectCondition(value, catalog, catalogReady, selected);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const legacy = isLegacyConditionTree(value);
  const cards = readConditionCards(value);
  const byId = new Map(cards.map((card) => [card.modelId, card]));
  const staleCards = cards.filter((card) => card.modelId && !selected.includes(card.modelId));
  const sections = [
    ...selected.map((modelId) => byId.get(modelId) || { modelId, logic: 'and' as const, children: [] }),
    ...staleCards,
  ];
  const issueModelId = issue?.cardIndex === undefined ? '' : (cards[issue.cardIndex]?.modelId || '');
  useEffect(() => {
    if (!issueModelId) return;
    setOpenKeys((current) => (current.includes(issueModelId) ? current : [...current, issueModelId]));
  }, [issueModelId]);
  const labels = {
    and: t('conditionBuilder.and', '并且'),
    or: t('conditionBuilder.or', '或者'),
    all: t('conditionBuilder.summaryAll', '全部'),
    unfinished: t('conditionBuilder.unfinished', '未完成'),
    stale: t('conditionBuilder.summaryStale', '已失效，不会按全部实例查询'),
    match: t('conditionBuilder.summaryMatch', '符合'),
    lead: t('conditionBuilder.summaryLead', '返回'),
    join: t('conditionBuilder.summaryJoin', '，以及'),
    of: t('conditionBuilder.summaryOf', '的'),
  };
  const summary = summarizeConditionCards(
    selected.map((modelId) => ({ id: modelId, name: modelNameOf(catalog, modelId) })),
    cards,
    catalog,
    labels,
  );
  const issueText = issue ? t(`conditionBuilder.issue.${issue.code}`, {
    invalid: '条件结构不正确',
    legacy: '条件结构不正确',
    staleField: '条件字段已失效，请重新选择',
    ambiguousField: '同名属性不是同一个字段，请按模型分别选择',
    staleScope: '这个模型不在已选范围内，请移除这张卡或改回已选模型。不会按全部实例查询。',
    missingValue: '请填写条件值',
    unsupportedOperator: '该字段不支持这个运算符',
    incompatible: '字段类型或单位不一致，不能合并',
  }[issue.code]) : '';
  const [copySource, setCopySource] = useState<string | null>(null);

  const commit = (next: ConditionCard[]) => onChange?.(writeConditionCards(next, selected));
  const replaceCard = (modelId: string, next: ConditionCard) => {
    const index = cards.findIndex((card) => card.modelId === modelId);
    const copy = cards.slice();
    if (index >= 0) copy[index] = next;
    else copy.push(next);
    commit(copy);
  };

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
          options={[{ value: 'true', label: t('common.yes') }, { value: 'false', label: t('common.no') }]}
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
          onChange={(next) => {
            const current = Array.isArray(node.value) ? node.value.map(String) : [];
            if (next.length === current.length && next.every((item, index) => item === current[index])) return;
            onLeaf({ ...node, value: next });
          }}
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
              onLeaf({ ...node, value: kind === 'range' ? { start: text, end: end || '' } : text });
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

  const renderNodes = (
    card: ConditionCard,
    cardIndex: number,
    nodes: ConditionNode[],
    path: number[],
    allowGroup: boolean,
    onNodes: (next: ConditionNode[]) => void,
  ) => {
    const fields = catalog.filter((item) => item.modelId === card.modelId);
    const replaceAt = (index: number, next: ConditionNode) => {
      const copy = nodes.slice();
      copy[index] = next;
      onNodes(copy);
    };
    return (
      <div className="flex flex-col gap-2">
        {allowGroup && nodes.length >= 2 ? (
          <Radio.Group
            disabled={disabled}
            value={card.logic}
            optionType="button"
            options={[
              { value: 'and', label: t('conditionBuilder.meetAll', '满足全部') },
              { value: 'or', label: t('conditionBuilder.meetAny', '满足任一') },
            ]}
            onChange={(event) => replaceCard(card.modelId, { ...card, logic: event.target.value })}
          />
        ) : null}
        {nodes.map((node, index) => {
          const nodePath = [...path, index];
          if (isGroup(node)) {
            return (
              <div key={nodePath.join('-')} className="flex flex-col gap-2 rounded border border-[var(--color-border-2)] p-2">
                <div className="text-xs text-[var(--color-text-3)]">{t('conditionBuilder.nestedGroup', '一组条件')}</div>
                {renderNodes(card, cardIndex, node.children, nodePath, false, (children) => replaceAt(index, { ...node, children }))}
                <GroupLogic
                  disabled={disabled}
                  logic={node.logic}
                  visible={node.children.length >= 2}
                  meetAll={t('conditionBuilder.meetAll', '满足全部')}
                  meetAny={t('conditionBuilder.meetAny', '满足任一')}
                  onChange={(logic) => replaceAt(index, { ...node, logic })}
                />
                <Button disabled={disabled} onClick={() => onNodes(nodes.filter((_, childIndex) => childIndex !== index))}>
                  {t('conditionBuilder.remove', '删除')}
                </Button>
              </div>
            );
          }
          return (
            <LeafRow
              key={nodePath.join('-')}
              disabled={disabled}
              node={node}
              fields={fields}
              catalog={catalog}
              issueText={samePath(issue, cardIndex, nodePath) ? issueText : ''}
              onChange={(next) => replaceAt(index, next)}
              onRemove={() => onNodes(nodes.filter((_, childIndex) => childIndex !== index))}
              renderValue={renderValue}
              fieldLabel={t('conditionBuilder.field', '属性')}
              operatorLabel={t('conditionBuilder.operator', '运算符')}
              removeLabel={t('conditionBuilder.remove', '删除')}
            />
          );
        })}
        <Space wrap>
          <Button
            disabled={disabled}
            onClick={() => onNodes([...nodes, { scope: card.modelId, attr_id: '', operator: '' }])}
          >
            {t('conditionBuilder.addLeaf', '添加一条')}
          </Button>
          {allowGroup ? (
            <Button
              disabled={disabled}
              onClick={() => onNodes([...nodes, { logic: 'or', children: [] }])}
            >
              {t('conditionBuilder.addGroup', '添加一组')}
            </Button>
          ) : null}
        </Space>
      </div>
    );
  };

  const renderSection = (card: ConditionCard, cardIndex: number) => {
    const outside = !selected.includes(card.modelId);
    const unrestricted = !hasConditionLeaves(card);
    const name = modelNameOf(catalog, card.modelId);
    const body = (
      <div className="flex flex-col gap-2" data-testid={`condition-model-${card.modelId}`}>
        <div className="text-sm text-[var(--color-text-1)]">{name}</div>
        {outside ? <p className="m-0 text-xs text-[var(--color-fail)]">{issueText || labels.stale}</p> : null}
        {unrestricted && !outside ? (
          <p className="m-0 text-xs text-[var(--color-text-3)]">{t('conditionBuilder.unrestricted', '未限制条件，返回该模型全部实例')}</p>
        ) : null}
        {renderNodes(card, cardIndex, card.children, [], true, (children) => replaceCard(card.modelId, { ...card, children }))}
        {selected.length > 1 && hasConditionLeaves(card) ? (
          <Button disabled={disabled} onClick={() => setCopySource(card.modelId)}>
            {t('conditionBuilder.copyTo', '复制到其他模型')}
          </Button>
        ) : null}
      </div>
    );
    return { key: card.modelId, name, unrestricted, outside, body };
  };

  const storedIndex = (modelId: string) => cards.findIndex((card) => card.modelId === modelId);
  const rendered = sections.map((card) => renderSection(card, storedIndex(card.modelId)));
  const many = selected.length > 1;
  const previewLabels = {
    and: labels.and,
    or: labels.or,
    global: t('conditionBuilder.global', '全局'),
    missing: t('conditionBuilder.missing', '已失效'),
  };

  const askRebuild = () => {
    Modal.confirm({
      title: t('conditionBuilder.rebuild', '按模型重新添加'),
      content: t('conditionBuilder.rebuildWarn', '这会替换当前条件。不能按模型原样保留的部分会被去掉，没有该属性的模型可能从「不返回」变成「返回全部实例」。取消则保持原条件。'),
      okText: t('conditionBuilder.rebuildOk', '确认替换'),
      cancelText: t('common.cancel', '取消'),
      onOk: () => onChange?.({ logic: 'and', children: [] }),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {catalogReady ? null : <span className="text-xs text-[var(--color-text-3)]">{t('conditionBuilder.loading')}</span>}
      {selected.length === 0 && staleCards.length === 0 ? (
        <p className="m-0 text-xs text-[var(--color-text-3)]">{t('conditionBuilder.needModel', '请先选择模型')}</p>
      ) : null}
      {legacy ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs text-[var(--color-text-2)]">{t('conditionBuilder.legacyKept', '已有筛选会原样保留。要改成按模型添加，需要确认替换。')}</p>
          <p className="m-0 text-xs text-[var(--color-text-3)]">{previewCondition(value, catalog, previewLabels)}</p>
          {issue ? <p className="m-0 text-xs text-[var(--color-fail)]">{issueText}</p> : null}
          <Button disabled={disabled} onClick={askRebuild}>{t('conditionBuilder.rebuild', '按模型重新添加')}</Button>
        </div>
      ) : (
        <>
          {summary ? <p className="m-0 text-xs text-[var(--color-text-2)]">{summary}</p> : null}
          {many ? (
            <Collapse
              ghost
              activeKey={openKeys}
              onChange={(key) => setOpenKeys(Array.isArray(key) ? key.map(String) : [String(key)])}
              items={rendered.map((section) => ({
                key: section.key,
                label: (
                  <span className="text-sm text-[var(--color-text-2)]">
                    {section.outside
                      ? `${section.name}（${labels.stale}）`
                      : section.unrestricted
                        ? `${labels.all}${section.name}`
                        : section.name}
                  </span>
                ),
                children: section.body,
              }))}
            />
          ) : rendered.map((section) => <div key={section.key}>{section.body}</div>)}
        </>
      )}
      {copySource ? (
        <CopyPanel
          disabled={disabled}
          sourceId={copySource}
          source={byId.get(copySource)}
          targets={selected.filter((modelId) => modelId !== copySource)}
          cards={cards}
          catalog={catalog}
          onClose={() => setCopySource(null)}
          onApply={(next) => {
            commit(next);
            setCopySource(null);
          }}
        />
      ) : null}
      {resultEmpty ? (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-xs text-[var(--color-text-2)]">{t('conditionBuilder.emptyResult')}</p>
          <Button disabled={disabled} onClick={() => onFocusModels?.()}>{t('conditionBuilder.backToModels')}</Button>
        </div>
      ) : null}
    </div>
  );
};

const isGroup = (node: ConditionNode): node is ConditionGroup => (
  Boolean(node) && typeof node === 'object' && 'children' in node && Array.isArray(node.children)
    && (node.logic === 'and' || node.logic === 'or')
);

const GroupLogic: React.FC<{
  disabled: boolean;
  logic: 'and' | 'or';
  visible: boolean;
  meetAll: string;
  meetAny: string;
  onChange: (logic: 'and' | 'or') => void;
}> = ({ disabled, logic, visible, meetAll, meetAny, onChange }) => (
  visible ? (
    <Radio.Group
      disabled={disabled}
      value={logic}
      optionType="button"
      options={[{ value: 'and', label: meetAll }, { value: 'or', label: meetAny }]}
      onChange={(event) => onChange(event.target.value)}
    />
  ) : null
);

const LeafRow: React.FC<{
  disabled: boolean;
  node: ConditionLeaf;
  fields: QueryFieldCatalogItem[];
  catalog: QueryFieldCatalogItem[];
  issueText: string;
  fieldLabel: string;
  operatorLabel: string;
  removeLabel: string;
  onChange: (next: ConditionLeaf) => void;
  onRemove: () => void;
  renderValue: (
    node: ConditionLeaf,
    kind: string,
    field: QueryFieldCatalogItem | undefined,
    onLeaf: (next: ConditionLeaf) => void,
  ) => React.ReactNode;
}> = ({
  disabled, node, fields, catalog, issueText, fieldLabel, operatorLabel, removeLabel, onChange, onRemove, renderValue,
}) => {
  const selectedFields = leafFields(catalog, node);
  const field = selectedFields[0];
  const operators = selectedFields.length
    ? selectedFields[0].operators.filter((item) => selectedFields.every((candidate) => candidate.operators.some((choice) => choice.value === item.value)))
    : [];
  const operator = operators.find((item) => item.value === node.operator);
  return (
    <div className="flex flex-col gap-1">
      <Space wrap className="w-full">
        <Select
          disabled={disabled}
          showSearch
          optionFilterProp="label"
          className="min-w-44"
          placeholder={fieldLabel}
          value={node.attr_id || undefined}
          options={fields.map((item) => ({ value: item.attrId, label: item.label }))}
          onChange={(attrId) => {
            if (String(attrId) === node.attr_id) return;
            const nextField = fields.find((item) => item.attrId === String(attrId));
            onChange({
              scope: node.scope,
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
          placeholder={operatorLabel}
          value={node.operator || undefined}
          options={operators.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(nextOperator) => {
            if (nextOperator === node.operator) return;
            onChange({ ...node, operator: nextOperator, value: undefined });
          }}
        />
        {renderValue(node, operator?.valueKind || 'text', field, onChange)}
        <Button disabled={disabled} onClick={onRemove}>{removeLabel}</Button>
      </Space>
      {issueText ? <p className="m-0 text-xs text-[var(--color-fail)]">{issueText}</p> : null}
    </div>
  );
};

const reasonText = (reason: CopyBlockReason, t: (key: string, fallback?: string) => string) => {
  const text: Record<CopyBlockReason, string> = {
    unmapped: t('conditionBuilder.copyUnmapped', '请选择目标模型上的对应字段'),
    type: t('conditionBuilder.copyType', '字段类型不一致，不能复制'),
    unit: t('conditionBuilder.copyUnit', '字段单位不一致，不能复制'),
    operator: t('conditionBuilder.copyOperator', '目标字段不支持这个运算符，不能复制'),
    'enum-unknown': t('conditionBuilder.copyEnumUnknown', '无法核对枚举含义，不能复制这一项'),
    'enum-value': t('conditionBuilder.copyEnumValue', '目标枚举没有这个值，不能复制'),
    'enum-meaning': t('conditionBuilder.copyEnumMeaning', '相同枚举值的含义不一致，不能复制'),
    incomplete: t('conditionBuilder.copyIncomplete', '条件还没填完，不能复制'),
    depth: t('conditionBuilder.copyDepth', '嵌套后会超过条件层级，不能复制'),
    'too-many': t('conditionBuilder.copyTooMany', '条件条数会超过上限，不能复制'),
  };
  return text[reason];
};

const CopyPanel: React.FC<{
  disabled: boolean;
  sourceId: string;
  source?: ConditionCard;
  targets: string[];
  cards: ConditionCard[];
  catalog: QueryFieldCatalogItem[];
  onClose: () => void;
  onApply: (cards: ConditionCard[]) => void;
}> = ({ disabled, sourceId, source, targets, cards, catalog, onClose, onApply }) => {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, Record<string, string>>>({});
  const [blocked, setBlocked] = useState('');
  const attrs = sourceAttrIds(source);
  const sourceName = modelNameOf(catalog, sourceId);
  if (!source) return null;

  const apply = async () => {
    const next = cards.slice();
    for (const targetId of chosen) {
      const plan = copyModelCondition(source, targetId, mapping[targetId] || {}, catalog);
      if (plan.ok === false) {
        setBlocked(plan.reasons.map((item) => `${item.attrId || sourceName}：${reasonText(item.reason, t)}`).join(' '));
        return;
      }
      const existing = next.find((card) => card.modelId === targetId);
      const appended = appendCopiedCondition(existing, plan.node);
      if (appended.ok === false) {
        setBlocked(reasonText(appended.reason, t));
        return;
      }
      const index = next.findIndex((card) => card.modelId === targetId);
      if (index >= 0) next[index] = appended.card;
      else next.push(appended.card);
    }
    const needsConfirm = chosen.some((targetId) => hasConditionLeaves(cards.find((card) => card.modelId === targetId)));
    if (!needsConfirm) {
      onApply(next);
      return;
    }
    Modal.confirm({
      title: t('conditionBuilder.copyTo', '复制到其他模型'),
      content: t('conditionBuilder.copyAppend', '目标模型已有条件。复制后用「并且」接在后面，原条件保留，结果不会变多。'),
      okText: t('conditionBuilder.rebuildOk', '确认替换'),
      cancelText: t('common.cancel', '取消'),
      onOk: () => onApply(next),
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--color-border-2)] p-2">
      <div className="text-sm text-[var(--color-text-1)]">{t('conditionBuilder.copyTitle', '复制条件')}</div>
      <p className="m-0 text-xs text-[var(--color-text-3)]">
        {t('conditionBuilder.copyHint', '从{model}复制一次。复制后各自独立，不会继续联动。', { model: sourceName } as never)}
      </p>
      {targets.map((targetId) => {
        const targetName = modelNameOf(catalog, targetId);
        const targetFields = catalog.filter((item) => item.modelId === targetId);
        return (
          <div key={targetId} className="flex flex-col gap-1">
            <label className="text-xs text-[var(--color-text-2)]">
              <input
                type="checkbox"
                className="mr-1"
                checked={chosen.includes(targetId)}
                onChange={(event) => setChosen((current) => (
                  event.target.checked ? [...current, targetId] : current.filter((item) => item !== targetId)
                ))}
              />
              {targetName}
            </label>
            {chosen.includes(targetId) ? attrs.map((attrId) => {
              const sample = findLeaf(source, attrId);
              const picked = mapping[targetId]?.[attrId] || '';
              const from = catalog.find((item) => item.modelId === sourceId && item.attrId === attrId);
              const to = targetFields.find((item) => item.attrId === picked);
              const reason = picked ? explainFieldCopy(from, to, sample?.operator || '', sample?.value) : 'unmapped' as const;
              return (
                <div key={attrId} className="flex flex-col gap-1 pl-4">
                  <span className="text-xs text-[var(--color-text-2)]">{from?.label || attrId}</span>
                  <Select
                    disabled={disabled}
                    className="min-w-44"
                    placeholder={t('conditionBuilder.copyUnmapped', '请选择目标模型上的对应字段')}
                    value={picked || undefined}
                    options={targetFields.map((item) => ({ value: item.attrId, label: item.label }))}
                    onChange={(next) => setMapping((current) => ({
                      ...current,
                      [targetId]: { ...current[targetId], [attrId]: String(next) },
                    }))}
                  />
                  {reason ? <p className="m-0 text-xs text-[var(--color-fail)]">{reasonText(reason, t)}</p> : null}
                </div>
              );
            }) : null}
          </div>
        );
      })}
      {blocked ? <p className="m-0 text-xs text-[var(--color-fail)]">{blocked}</p> : null}
      <Space>
        <Button disabled={disabled || chosen.length === 0} onClick={() => { void apply(); }}>
          {t('conditionBuilder.copyApply', '复制')}
        </Button>
        <Button disabled={disabled} onClick={onClose}>{t('common.cancel', '取消')}</Button>
      </Space>
    </div>
  );
};

const findLeaf = (node: ConditionNode, attrId: string): ConditionLeaf | undefined => {
  if (!('children' in node)) return node.attr_id === attrId ? node : undefined;
  for (const child of node.children) {
    const found = findLeaf(child, attrId);
    if (found) return found;
  }
  return undefined;
};

export default ConditionTreeEditor;
