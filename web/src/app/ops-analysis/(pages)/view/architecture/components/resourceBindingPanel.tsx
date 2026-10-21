'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Spin, Switch } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { useTranslation } from '@/utils/i18n';
import type {
  ArchitectureBinding,
  ArchitectureNodeStatusItem,
  BindingSearchHit,
  BindingSearchResult,
  ModelOption,
} from '../binding/model';
import { bindingDisplay, bindingModelLabel, bindingSearchMode } from '../binding/model';

interface ResourceBindingPanelProps {
  showFollow: boolean;
  followAlert: boolean;
  bound: boolean;
  binding: ArchitectureBinding | null;
  statusLoading: boolean;
  status: ArchitectureNodeStatusItem | null;
  modelName: string;
  iconTotal: number;
  iconBound: number;
  models: ModelOption[];
  onSearch: (keyword: string, modelId: string) => Promise<BindingSearchResult>;
  onBind: (hit: BindingSearchHit) => void;
  onUnbind: () => void;
  onFollowAlert: (enabled: boolean) => void;
}

const ResourceBindingPanel = ({
  showFollow,
  followAlert,
  bound,
  binding,
  statusLoading,
  status,
  modelName,
  iconTotal,
  iconBound,
  models,
  onSearch,
  onBind,
  onUnbind,
  onFollowAlert,
}: ResourceBindingPanelProps) => {
  const { t } = useTranslation();
  const [replacing, setReplacing] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [modelId, setModelId] = useState('');
  const [hits, setHits] = useState<BindingSearchHit[]>([]);
  const [resultLimit, setResultLimit] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searching, setSearching] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const display = bindingDisplay(status, modelName);
  const showSearch = !showFollow && (!bound || replacing);

  useEffect(() => {
    setReplacing(false);
    setKeyword('');
    setModelId('');
    setHits([]);
  }, [bound, status?.inst_uuid]);

  const cancelReplace = () => {
    setReplacing(false);
    setKeyword('');
    setModelId('');
    setHits([]);
    setTruncated(false);
    setSearchError(false);
  };

  useEffect(() => {
    if (!showSearch || bindingSearchMode(keyword, modelId) === 'idle') {
      setHits([]);
      setTruncated(false);
      setSearchError(false);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(false);
    const timer = window.setTimeout(() => {
      onSearch(keyword.trim(), modelId)
        .then((next) => {
          if (cancelled) return;
          setHits(next.hits);
          setResultLimit(next.limit);
          setTruncated(next.truncated);
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setTruncated(false);
          setSearchError(true);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword, modelId, onSearch, retryToken, showSearch]);

  const cardName = !display.blocked && display.name ? display.name : '';
  const cardType = display.typeName || (binding ? bindingModelLabel(models, binding.model_id) : modelName);
  const cardId = binding?.inst_uuid || status?.inst_uuid || '';
  const searchBlock = (
    <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="text-xs text-[var(--color-text-3)]">
          {t('opsAnalysis.architecture.bindingPick')}
        </div>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={t('opsAnalysis.architecture.bindingModel')}
          value={modelId || undefined}
          options={models.map((model) => ({
            value: model.model_id,
            label: model.model_name,
          }))}
          onChange={(value) => setModelId(value || '')}
        />
        <Input
          allowClear
          placeholder={t('opsAnalysis.architecture.bindingSearch')}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        {searching ? <Spin size="small" /> : null}
        {!searching && searchError ? (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-3)]">
            <span>{t('opsAnalysis.architecture.bindingSearchFailed')}</span>
            <Button
              type="link"
              size="small"
              className="h-auto p-0"
              onClick={() => setRetryToken((current) => current + 1)}
            >
              {t('opsAnalysis.architecture.bindingSearchRetry')}
            </Button>
          </div>
        ) : null}
        {!searching && !searchError && bindingSearchMode(keyword, modelId) !== 'idle' && hits.length === 0 ? (
          <div className="text-xs text-[var(--color-text-3)]">
            {t('opsAnalysis.architecture.bindingEmpty')}
          </div>
        ) : null}
      </div>
      {hits.length > 0 || truncated ? (
        <div className="min-h-0 flex-auto overflow-y-auto">
          {hits.map((hit) => (
            <button
              key={`${hit.model_id}:${hit.inst_uuid}`}
              type="button"
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-fill-2)]"
              onClick={() => {
                onBind(hit);
                setReplacing(false);
              }}
            >
              <div className="text-[var(--color-text-1)]">{hit.inst_name || hit.inst_uuid}</div>
              <div className="text-xs text-[var(--color-text-3)]">
                {[hit.ip_addr, bindingModelLabel(models, hit.model_id)].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
          {!searching && !searchError && truncated ? (
            <div className="px-2 py-1.5 text-xs text-[var(--color-text-3)]">
              {t('opsAnalysis.architecture.bindingSearchTruncated', undefined, { limit: resultLimit })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  const boundCard = bound ? (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="rounded border border-[var(--color-border-2)] px-2 py-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-3)]">{t('opsAnalysis.architecture.bindingCardName')}</span>
          <span className="truncate text-[var(--color-text-1)]">
            {statusLoading ? <Spin size="small" /> : cardName || '—'}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-3)]">{t('opsAnalysis.architecture.bindingCardType')}</span>
          <span className="truncate text-[var(--color-text-1)]">{cardType || '—'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-[var(--color-text-3)]">{t('opsAnalysis.architecture.bindingCardId')}</span>
          <span className="truncate text-[var(--color-text-1)]">{cardId || '—'}</span>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="small" onClick={() => setReplacing(true)}>
          {t('opsAnalysis.architecture.bindingReplace')}
        </Button>
        <Button size="small" onClick={onUnbind}>
          {t('opsAnalysis.architecture.bindingUnbind')}
        </Button>
        {replacing ? (
          <Button size="small" onClick={cancelReplace}>
            {t('opsAnalysis.architecture.bindingCancel')}
          </Button>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <aside
      className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-24px)] w-80 flex-col gap-3 overflow-hidden rounded-md border border-[var(--color-border-2)] bg-[var(--color-bg-1)] p-3 shadow-sm"
      data-testid="architecture-binding-panel"
    >
      {showFollow ? (
        <section className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3 text-sm text-[var(--color-text-1)]">
            <span>{t('opsAnalysis.architecture.followAlertSwitch')}</span>
            <Switch checked={followAlert} onChange={onFollowAlert} />
          </label>
          <p className="m-0 text-xs text-[var(--color-text-3)]">
            {t('opsAnalysis.architecture.followAlertHint')}
          </p>
          <p className="m-0 text-xs text-[var(--color-text-2)]">
            {t('opsAnalysis.architecture.regionIconCount', undefined, {
              total: iconTotal,
              bound: iconBound,
            })}
          </p>
        </section>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--color-text-1)]">
            <LinkOutlined className="text-[var(--color-primary)]" />
            <span>{t('opsAnalysis.architecture.bindingTitle')}</span>
          </div>
          {boundCard}
          {showSearch ? searchBlock : null}
        </>
      )}
    </aside>
  );
};

export default ResourceBindingPanel;
