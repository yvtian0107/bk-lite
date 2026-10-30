import type {
  InputControlConfig,
  SourceRef,
} from '@/app/ops-analysis/types/dataSource';
import { isOptionInputControl, normalizeInputConfig } from '@/app/ops-analysis/utils/paramInputConfigUtils';
import {
  collectQueryParamLiterals,
  collectQueryParamRefs,
  stableStringify,
} from '@/app/ops-analysis/utils/optionsQueryParamRefs';

export type OptionsSourceIdentity =
  | null
  | { type: 'static'; itemsDigest: string }
  | {
    type: 'dynamic';
    sourceId: number | null;
    sourceRef: SourceRef | null;
    valueField: string;
    labelField: string;
    queryParamsRefs: string[];
    queryParamsLiterals: Record<string, string | number | boolean | null>;
  };

export const optionsSourceIdentity = (
  inputConfig?: InputControlConfig | { control?: string; inputMode?: string; optionsSource?: unknown } | null,
): OptionsSourceIdentity => {
  const normalized = normalizeInputConfig(
    inputConfig && 'control' in (inputConfig as object)
      ? { inputConfig: inputConfig as InputControlConfig }
      : undefined,
  );
  if (!normalized || !isOptionInputControl(normalized)) return null;
  const source = normalized.optionsSource;
  if (!source) return null;
  if (source.type === 'static') {
    return {
      type: 'static',
      itemsDigest: stableStringify(source.staticItems ?? []),
    };
  }
  return {
    type: 'dynamic',
    sourceId: source.sourceId ?? null,
    sourceRef: source.sourceRef ?? null,
    valueField: source.valueField,
    labelField: source.labelField,
    queryParamsRefs: collectQueryParamRefs(source.queryParams),
    queryParamsLiterals: collectQueryParamLiterals(source.queryParams),
  };
};

export const optionsSourceIdentityKey = (identity: OptionsSourceIdentity): string =>
  identity === null ? 'none' : stableStringify(identity);

export const shortOptionsSourceDigest = (identity: OptionsSourceIdentity): string => {
  const text = optionsSourceIdentityKey(identity);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8);
};

export const optionsSourceSummary = (
  inputConfig?: InputControlConfig,
): string => {
  const identity = optionsSourceIdentity(inputConfig);
  if (!identity) return '';
  if (identity.type === 'static') return 'static';
  if (identity.sourceRef?.value) return identity.sourceRef.value;
  if (identity.sourceId != null) return `source:${identity.sourceId}`;
  return 'dynamic';
};
