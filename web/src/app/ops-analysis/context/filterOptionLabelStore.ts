export interface FilterOptionLabelSnapshot {
  coveredIds: ReadonlySet<string>;
  labelsByFilterId: Record<string, Record<string, string> | undefined>;
  /** 画布或动态筛选配置变化时递增，用来迫使筛选栏重新发布当前结果。 */
  revision: number;
}

export interface FilterOptionLabelStore {
  claim: (ids: string[]) => () => void;
  publish: (filterId: string, labels: Record<string, string>) => void;
  /** 删掉标签并递增 revision。`null` 表示清空全部。空数组不做事。 */
  invalidate: (filterIds: readonly string[] | null) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => FilterOptionLabelSnapshot;
  getServerSnapshot: () => FilterOptionLabelSnapshot;
}

const sameLabelMap = (
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
) => {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
};

const snapshotOf = (
  coveredIds: ReadonlySet<string>,
  labelsByFilterId: Record<string, Record<string, string> | undefined>,
  revision: number,
): FilterOptionLabelSnapshot => ({ coveredIds, labelsByFilterId, revision });

/** 一块画布上的动态选项标签。筛选栏和标题解析共用，避免同一筛选再拉一次数据源。 */
export const createFilterOptionLabelStore = (): FilterOptionLabelStore => {
  const coveredCounts = new Map<string, number>();
  let labelsByFilterId: Record<string, Record<string, string> | undefined> = {};
  let revision = 0;
  let snapshot = snapshotOf(new Set<string>(), labelsByFilterId, revision);
  const serverSnapshot = snapshot;
  const listeners = new Set<() => void>();

  const emit = (coveredIds: Set<string>) => {
    snapshot = snapshotOf(coveredIds, labelsByFilterId, revision);
    listeners.forEach((listener) => listener());
  };

  return {
    claim: (ids) => {
      const unique = [...new Set(ids.filter(Boolean))];
      let changed = false;
      unique.forEach((id) => {
        const next = (coveredCounts.get(id) ?? 0) + 1;
        if (next === 1) changed = true;
        coveredCounts.set(id, next);
      });
      if (changed) emit(new Set(coveredCounts.keys()));
      return () => {
        let released = false;
        unique.forEach((id) => {
          const next = (coveredCounts.get(id) ?? 1) - 1;
          if (next <= 0) {
            coveredCounts.delete(id);
            released = true;
            return;
          }
          coveredCounts.set(id, next);
        });
        if (released) emit(new Set(coveredCounts.keys()));
      };
    },
    invalidate: (filterIds) => {
      if (filterIds && filterIds.length === 0) return;
      if (filterIds == null) {
        labelsByFilterId = {};
      } else {
        const next = { ...labelsByFilterId };
        filterIds.forEach((id) => {
          delete next[id];
        });
        labelsByFilterId = next;
      }
      revision += 1;
      emit(new Set(snapshot.coveredIds));
    },
    publish: (filterId, nextLabels) => {
      if (
        Object.prototype.hasOwnProperty.call(labelsByFilterId, filterId)
        && sameLabelMap(labelsByFilterId[filterId], nextLabels)
      ) {
        return;
      }
      labelsByFilterId = { ...labelsByFilterId, [filterId]: nextLabels };
      emit(new Set(snapshot.coveredIds));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
  };
};
