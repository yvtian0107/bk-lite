'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Spin, Switch } from 'antd';
import { useTranslation } from '@/utils/i18n';
import type {
  ArchitectureNodeStatusItem,
  BindingSearchHit,
  ModelOption,
} from '../binding/model';
import { bindingDisplay } from '../binding/model';

interface ResourceBindingPanelProps {
  showFollow: boolean;
  followAlert: boolean;
  bound: boolean;
  statusLoading: boolean;
  status: ArchitectureNodeStatusItem | null;
  modelName: string;
  models: ModelOption[];
  onSearch: (keyword: string, modelId: string) => Promise<BindingSearchHit[]>;
  onBind: (hit: BindingSearchHit) => void;
  onUnbind: () => void;
  onFollowAlert: (enabled: boolean) => void;
}

const ResourceBindingPanel = ({
  showFollow,
  followAlert,
  bound,
  statusLoading,
  status,
  modelName,
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
  const [searching, setSearching] = useState(false);
  const display = bindingDisplay(status, modelName);
  const showSearch = !bound || replacing;

  useEffect(() => {
    setReplacing(false);
    setKeyword('');
    setModelId('');
    setHits([]);
  }, [bound, status?.inst_uuid]);

  useEffect(() => {
    if (!showSearch) return undefined;
    const text = keyword.trim();
    if (!text) {
      setHits([]);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      onSearch(text, modelId)
        .then((next) => {
          if (!cancelled) setHits(next);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword, modelId, onSearch, showSearch]);

  const blockedText = display.blocked === 'invalid'
    ? t('opsAnalysis.architecture.bindingInvalid')
    : display.blocked === 'forbidden'
      ? t('opsAnalysis.architecture.bindingForbidden')
      : display.blocked === 'unknown'
        ? t('opsAnalysis.architecture.bindingUnknown')
        : '';

  return (
    <aside
      className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-24px)] w-80 flex-col gap-3 overflow-auto rounded-md border border-[var(--color-border-2)] bg-[var(--color-bg-1)] p-3 shadow-sm"
      data-testid="architecture-binding-panel"
    >
      <div className="text-sm font-medium text-[var(--color-text-1)]">
        {t('opsAnalysis.architecture.bindingTitle')}
      </div>
      {bound && !replacing ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-[var(--color-text-3)]">
            {t('opsAnalysis.architecture.bindingCurrent')}
          </div>
          <div className="text-sm text-[var(--color-text-1)]">
            {statusLoading ? <Spin size="small" /> : display.blocked ? blockedText : `${display.name} · ${display.typeName}`}
          </div>
          <div className="flex gap-2">
            <Button size="small" onClick={() => setReplacing(true)}>
              {t('opsAnalysis.architecture.bindingReplace')}
            </Button>
            <Button size="small" onClick={onUnbind}>
              {t('opsAnalysis.architecture.bindingUnbind')}
            </Button>
          </div>
        </div>
      ) : null}
      {showSearch ? (
        <div className="flex flex-col gap-2">
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
          {!searching && keyword.trim() && hits.length === 0 ? (
            <div className="text-xs text-[var(--color-text-3)]">
              {t('opsAnalysis.architecture.bindingEmpty')}
            </div>
          ) : null}
          <div className="flex flex-col">
            {hits.map((hit) => (
              <button
                key={`${hit.model_id}:${hit.inst_uuid}`}
                type="button"
                className="rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--color-fill-2)]"
                onClick={() => {
                  onBind(hit);
                  setReplacing(false);
                }}
              >
                <div className="text-[var(--color-text-1)]">{hit.inst_name || hit.inst_uuid}</div>
                <div className="text-xs text-[var(--color-text-3)]">
                  {[hit.ip_addr, hit.model_id].filter(Boolean).join(' · ')}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {showFollow ? (
        <label className="flex items-center justify-between gap-3 text-sm text-[var(--color-text-1)]">
          <span>{t('opsAnalysis.architecture.bindingFollow')}</span>
          <Switch checked={followAlert} onChange={onFollowAlert} />
        </label>
      ) : null}
    </aside>
  );
};

export default ResourceBindingPanel;
