# 运营分析 · 选项查询参数级联 — 实现方案

- 最近更新：2026-10-30
- 状态：产品已拍板，已实现（2026-10-30）
- 关联决策记忆：`docs/design/product-decisions/ops-analysis-unified-filter.md`（其中「级联下拉」原为明确后置，由本文接续）
- 范围模块：`web/src/app/ops-analysis`
- 实现入口包：`components/unifiedFilter/`（页面实际 import）；`components/ops-analysis-unified-filter/` 为并存旧包，改动需评估是否同步或删死引用，不以旧包为主路径

---

## 1. 背景与现状缺口

运营分析统一筛选已具备：盘级筛定义、草稿 +「搜索」才应用、动态选项、组件内切换、AI/YAML 读写 `inputConfig`。缺的是 **Grafana / 观测云型「选项查询入参引用上游参数」**——下游候选项随上游值变化，而不是新 Cascader 控件，也不是「记住上次搜索」。

### 1.1 代码对照（真实路径）

| 能力点 | 现状 | 关键符号 / 路径 |
| --- | --- | --- |
| 参数输入配置 UI | 动态源只配 source / valueField / labelField；**无查询入参、无 `$` 引用拾取** | `components/paramInputConfigEditor.tsx` |
| 动态选项模型 | `DynamicOptionsSource` 无 params / queryInputs | `types/dataSource.ts` → `DynamicOptionsSource` |
| 选项请求 | `getSourceDataByApiId(sourceId, {})`，入参恒为空对象 | `utils/paramInputOptionsLoader.ts` L143 |
| 选项缓存键 | `getParamInputConfigKey` 不含运行时上游值 | 同文件 L66–78 |
| `$` 语法 | 仅展示文案模板 `$key$` / `$key:type$`，**不参与选项查询** | `utils/filterTemplate.ts` |
| 草稿 + 搜索 | 栏上改值进 local draft；点搜索才 `onSearch` | `components/unifiedFilter/unifiedFilterBar.tsx` `handleSearch` / `publishValues` |
| 打开校正 | 动态选项值先 defer 再按列表 `retain`；不在列表则 **清空为 null** | `utils/optionBackedFilterValue.ts` |
| 选项 reconcile 副作用 | `reconcileFilterOptions` 校正后走 `publishValues`（默认 `notify='search'`），**可能立刻当搜索刷图** | `unifiedFilterBar.tsx` L176–188 |
| 合并键 | 扫描合并仅 `` `${name}__${type}` ``，后扫到的 `sampleInputConfig` 不覆盖已有 | `unifiedFilterConfigModal.tsx` `scanFilterParams` L203–217；旧包 `ops-analysis-unified-filter/runtime.ts` `scanUnifiedFilterParams` |
| AI 合同摘要 | 已有私有 `optionsSourceIdentity`（动态源 identity，**不含入参引用**） | `utils/applyDashboardProposal.ts` L181–214 |
| 组件内切换失效 | 标量走 `reconcileComponentSwitchValue` → **落到 `options[0]`**；多选走 retain 不清空首项 | `utils/componentParamSwitch.ts` L50–82 |
| 筛选 id | `` `${key}__${type}` ``（如 `server_room_id__string`、`organization__string`） | `getFilterDefinitionId` / 配置弹窗新建 definition |

### 1.2 产品痛点（由 grill 确认）

1. 下游选项查询无法带上游值 → 级联做不成。  
2. 异源同名硬并成一行时，一套 `inputConfig` 盖不住两套选项宇宙 → 级联语义错。  
3. 时间 / 组织等盘级共用维度若按选项源拆，栏上会冒出一堆控件 → 不合理（`screen_11` 机房相反：异源但同 `cmdb/get_room_list`，应仍一条）。  
4. 组件内切换失效选第一项，与全局筛「失效清空」不一致。

---

## 2. 目标 / 非目标

### 2.1 目标

1. 在参数「配置」的选项查询上，支持**结构化引用**其它可筛参数作为请求入参（Grafana / 观测云型）。  
2. 硬顶约 **3** 级依赖；配置期校验：整值引用、禁拼接、环检测、级数。  
3. 上游变化 → **立刻重载**下游候选项；上游空 → **不请求**下游；旧值在列表保留，不在则**清空且不自动第一项**；只改草稿，**不**触发搜索；点搜索才应用刷图。  
4. 收紧全局筛合并：同名 + 同类型 + 同选项源 identity +（若有）同一组上游引用 → 一行；否则拆行并区分显示。**例外**：时间范围、组织等盘级共用维度继续仅同名同类型合并。  
5. 组件内切换：失效清空不选；**有依赖不禁开**；局部选项依赖 = 本卡局部值 + **已应用**全局筛。  
6. AI 搭盘 / YAML 与配置 UI 读写同一份 `inputConfig`。

### 2.2 非目标

- 新 Cascader / 树形联动控件。  
- 「记住上次点搜索的整组值」或 Saved View / 跨会话筛选持久化。  
- 改造无依赖路径以外的图表主查询协议。  
- 把 `$` 展示模板（`filterTemplate`）改成选项查询引擎（可共用 token 解析风格，存储仍落在 `inputConfig`）。  
- 无依赖组件内切换以外的大范围交互改版。

---

## 3. 产品决策表（已拍板，实现不得改）

| # | 决策 | 说明 |
| --- | --- | --- |
| D1 | 模型 | Grafana / 观测云型选项查询入参 `$` 引用；硬顶约 3 级；非 Cascader；不做记住上次搜索 |
| D2 | 打开 | `defaultValue`（+ URL / 报表传入）→ 按新候选项校验 |
| D3 | 上游变 | 立刻重载下游选项；上游空不请求；旧值在则保留、不在则清空不选第一项；只动草稿不搜；点搜索才应用 |
| D4 | 合并 | 同名+同类型+同 `optionsSourceIdentity`+（若有）同一组上游引用 → 并一行；否则拆并区分显示。**例外**：`timeRange` / `dateRange`、组织控件继续仅同名同类型并。异源但 optionsSource 相同（如 `screen_11` 的 `server_room_id`）仍并一条。配置表一行 = 运行时栏一个控件；并着则一套配置，要分配置先拆 |
| D5 | 组件内切换 | 失效清空不选；有依赖不禁；局部选项跟本卡局部值 + 已应用全局筛 |
| D6 | 配置入口 | 上游引用配在参数「配置」里的选项查询入参；**不是**全局筛总表另开「上游」列 |

---

## 4. 数据模型

### 4.1 扩展 `DynamicOptionsSource`

文件：`web/src/app/ops-analysis/types/dataSource.ts`

```ts
/** 选项查询入参：整值引用其它参数；禁止与字面量拼接 */
export type OptionsQueryParamValue =
  | string
  | number
  | boolean
  | null
  | { ref: string }; // ref = 被引用参数的 name（盘级筛 key / 同卡 params.name）

export interface DynamicOptionsSource {
  type: 'dynamic';
  sourceId?: number;
  sourceRef?: SourceRef;
  valueField: string;
  labelField: string;
  /** 选项查询请求体/查询参数；值为字面量或 { ref } */
  queryParams?: Record<string, OptionsQueryParamValue>;
}
```

- **主存储**：`queryParams` 内 `{ ref: 'server_room_id' }`。  
- **YAML / 展示友好**：允许整值写成 `"$server_room_id$"` 或 `"$server_room_id:string$"`，读写时归一成 `{ ref }`；**禁止** `"prefix-$id$"` 这类拼接（配置保存与运行解析均拒绝）。  
- 落点：筛定义的 `UnifiedFilterDefinition.inputConfig`；组件参数的 `ParamItem.inputConfig`（组件内切换同源）。全局筛总表不新增「上游」列。

### 4.2 `optionsSourceIdentity`（合并与 AI digest 共用）

从 `applyDashboardProposal.ts` 私有函数抽出到 `utils/paramInputConfigUtils.ts`（或新建 `utils/optionsSourceIdentity.ts`），并扩展：

```ts
optionsSourceIdentity(inputConfig) =>
  | null  // input / organization / 无 options
  | { type: 'static'; itemsDigest }
  | {
      type: 'dynamic';
      sourceId; sourceRef; valueField; labelField;
      queryParamsRefs: string[]; // 规范化后的 ref 名列表，排序后参与 identity
      // 字面量 queryParams 也进入 digest，避免「同源不同固定入参」误并
      queryParamsLiterals: Record<string, string | number | boolean | null>;
    }
```

静态源：用 staticItems 稳定序列化进 identity（避免两套静态列表同名硬并）。

### 4.3 引用校验（配置期 + 可选运行期断言）

| 规则 | 行为 |
| --- | --- |
| 整值引用 | 入参值要么纯字面量，要么纯 `{ ref }` / 整 token `$key$`；拒绝拼接 |
| 目标存在 | `ref` 必须指向同画布启用筛的 `key`，或（组件内）同卡其它 `params.name` |
| 类型可绑定 | 被引用参数须为可筛/可传值类型；自引用禁止 |
| 环检测 | 对 `queryParams.ref` 建有向图，DFS/拓扑；有环则保存失败并提示路径 |
| 级数 | 最长依赖链 ≤ 3（边数）；超限拒绝保存 |
| 空上游 | 运行时任一 required 上游值为 `null` / `undefined` / `''` / `[]` → 下游不发请求，选项置空 |

校验函数建议：`utils/optionsQueryParamRefs.ts`（纯函数 + 单测）。

### 4.4 筛选 id（拆行时）

现状 id = `` `${key}__${type}` ``。收紧后同名同类型可能多行：

- **可并（含时间/组织例外）**：继续 `` `${key}__${type}` ``，兼容存量绑定。  
- **必须拆**：`` `${key}__${type}__${shortDigest}` ``，`shortDigest` 来自 `optionsSourceIdentity` 稳定 hash 前 8 位（或 base32）。  
- 绑定面板、`FilterBindings`、运行时传参仍按 **definition.id**；传给数据源的参数名仍是 **key**（各组件跟随自己绑定的那条 id）。

存量盘：打开配置时按新算法重扫；若原 id 仍匹配「可并」集合则保留；仅当同 key+type 出现多个 identity 时才生成带 digest 的新 id，并尽量把旧 bindings 挂到「与旧 inputConfig identity 最接近」的那条（迁移见 §9）。

---

## 5. 运行时

### 5.1 选项加载签名

扩展 loader / hook：

- `getParamInputConfigKey(config)` → 增加规范化 `queryParams` 结构（含 ref 名，不含运行时值）。  
- 另增 **运行时签名**：`optionsLoadSignature = configKey + '|' + resolvedUpstreamValuesJson`。  
- `createParamInputOptionsLoader.load(config, resolvedParams)`：动态源调用 `getSourceDataByApiId(sourceId, resolvedParams, …)`，**不再传 `{}`**。  
- 上游未齐（空）→ 不调用 API，返回 `success` + `options: []`（或明确 `status: 'blocked'`，UI 显示「请先选择上游」）；与 error 区分。

文件：`paramInputOptionsLoader.ts`、`hooks/useParamInputOptions.ts`；筛栏与组件内切换共用 loader。

### 5.2 草稿 vs 已应用

| 场景 | 读哪个值解析下游 `queryParams` | 是否改 applied / 刷图 |
| --- | --- | --- |
| 全局筛栏上改上游 | **草稿** `filterValues` / bar `localValues` | 只更新下游草稿选项与草稿值校正；**不** `onSearch` |
| 点「搜索」 | 将草稿写入 applied | 刷图 |
| 组件内切换拉选项 | 本卡局部切换值 + **已应用**全局筛 | 局部立即影响本卡请求（既有 componentSwitch 语义）；不改全局草稿 |

**必须改**：`unifiedFilterBar.tsx` 的 `reconcileFilterOptions` 不得默认 `publishValues(..., 'search')`。级联校正应：

1. 只写 local draft（`setLocalValues` / 等价）；  
2. **不**调用 `onSearch`；  
3. 与「用户点搜索」分离。

若当前存在「打开盘时 defer 动态默认值再 reconcile 且误触发搜索」的路径，一并收口为「只同步 draft + applied 初值策略按 D2，不额外打图表请求风暴」。

### 5.3 失效策略

统一用 `retainFilterValueInOptions` / 扩展后的 reconcile：

- 在列表 → 保留。  
- 不在 → **`null`（清空不选）**，禁止 `options[0]`。  
- 多选：只保留仍在列表中的子集；全无则 `null` 或 `[]`（与现有多选空语义对齐：空选择省略参数）。

全局筛：已基本是清空（`optionBackedFilterValue`）。  
组件内：改 `reconcileComponentSwitchValue`（及 `resolveComponentSwitchRuntime` 对空值的 gate），与 D5 对齐。

### 5.4 与 UnifiedFilterBar「搜索」关系

- 选项重载、草稿值清空：**不是**搜索。  
- 搜索按钮 / 等价入口：唯一把草稿提交为 applied 并驱动画布请求的用户动作（重置若产品已定义为「恢复默认并立即应用」，保持现行为，但重置仍应按新选项再校验）。

### 5.5 解析顺序

1. 按依赖图拓扑排序启用筛（无依赖优先）。  
2. 对每个动态筛：解析 `queryParams` → 若缺上游则跳过请求。  
3. 选项返回后校正该筛草稿值。  
4. 值变化则使直接下游签名失效并重载（链式，深度 ≤ 3）。  
5. 用户点搜索 → applied = draft → 图表用 applied 组参。

---

## 6. 合并算法

入口：`scanFilterParams`（`unifiedFilterConfigModal.tsx`）；发现/同步其它调用点（`widgetDataTransform` 收集、旧包 `scanUnifiedFilterParams`、报表/拓扑若复用）必须同一套纯函数，建议抽到 `utils/scanUnifiedFilterParams.ts`。

### 6.1 合并键

```
isBoardSharedDimension(param|definition):
  type ∈ { timeRange, dateRange }
  OR inputConfig.control === 'organization'
  OR 归一后的 organization 旁路

mergeKey =
  if isBoardSharedDimension:
    `${name}__${type}`                    # 仅名+类型；不因 optionsSource 拆
  else:
    `${name}__${type}__${stableHash(optionsSourceIdentity(inputConfig))}`
    # 无 options / identity 为 null 时 hash 用 'none'，与「同名纯输入」互并
```

扫描时：同一 `mergeKey` 只建一条 `ScannedParam`，累加 `componentCount`；`sampleInputConfig` 取首次（已并意味着 identity 相同，内容一致）。

### 6.2 行为表

| 场景 | 配置表行数 | 查看态栏 |
| --- | --- | --- |
| 三图同一数据源、同名同配置 | 1 | 1 个控件 |
| 异源、同名，但 `optionsSourceIdentity` 相同（`screen_11` 机房） | 1 | 1 |
| 异源、同名，identity 不同（即使后来配了同一组 ref） | N，显示名/副文案区分 | N 个控件 |
| 同名同 identity，且 `queryParams` refs 相同 | 1 | 1 |
| 多数据源各绑 `time` / 组织 | 1（例外） | 1 |

「配了同一个上游引用也不会合并」——仅当 **optionsSource 仍不同**；引用相同不能盖过选项宇宙不同（D4）。

### 6.3 并着与拆开

- 并成一行 = 盘级唯一 `inputConfig` / 默认值 / 显示名；点「配置」改的是这一套。  
- 要分别配：改某一侧数据源参数的 options 或 `queryParams` 使 identity 不同 → 下次打开配置表自动拆行；或后续可加「拆分为独立筛」显式动作（非本期必做）。  
- **禁止**一行内嵌多套配置。

---

## 7. 配置 UI

### 7.1 全局筛选配置表（不新增「上游」列）

- 列保持：参数名、显示名、类型、控件、默认值、启用、配置、…  
- **拆行区分**（D4）：  
  - 显示名默认：`alias`；冲突时自动建议 `alias · 数据源名`（可改）。  
  - 参数名旁副文案：数据源名或 options 摘要（如 `cmdb/get_room_list` / sourceRef）。  
- 点「配置」打开现有 `ParamInputConfigEditor`，在动态源区编辑 `queryParams`。

### 7.2 参数配置 · 引用拾取

在 `paramInputConfigEditor.tsx` 动态源区块增加「查询入参」编辑：

- 表格：入参名、值类型（字面量 | 引用）、值 / 引用下拉。  
- 引用下拉候选：当前画布已启用（或即将启用）的其它筛 key；组件参数场景下加同卡其它 params。  
- 保存时跑 §4.3 校验；环与超深用 form 级错误。  
- 预览请求：用字面量或「示例上游值」解析后带参调用；无上游示例时可禁用预览并提示。

### 7.3 组件内切换配置

- 仍允许对有 `queryParams.ref` 的参数开 `componentSwitch`（D5）。  
- 校验文案可提示：局部选项依赖本卡其它局部值 + 已应用全局筛。

---

## 8. AI 搭盘 / YAML

- Proposal / YAML 中筛与参数的 `inputConfig.optionsSource` 直接带 `queryParams`。  
- `filterContractDigest` 使用抽出后的 `optionsSourceIdentity`（含 refs + literals），避免 AI 合并时丢掉级联合同。  
- `applyDashboardProposal.ts`：按 id / digest 对齐筛定义；拆行后的新 id 允许 proposal 显式给出。  
- 导入导出：旧盘无 `queryParams` 视为 `{}`，行为与现网一致。  
- 文档化给搭盘提示词：级联用 `queryParams.{ name: { ref } }`，禁止拼接字符串。

---

## 9. 迁移与兼容

| 项 | 策略 |
| --- | --- |
| 无 `queryParams` 的旧配置 | 等价空；选项请求仍可传 `{}` |
| 仅 `key__type` 的旧 filter id | 若新算法仍并成一条，id 不变；bindings 不动 |
| 同 key+type 多 identity（旧盘被错误硬并） | 打开配置重扫拆成多行；旧 id 优先留给「与已存 definition.inputConfig identity 匹配」的那条；其余新建带 digest 的 id；bindings 中仅旧 id 保留，新行默认按「同名同类型参数所在组件」自动跟随规则重建（与现网扫参启用逻辑一致），需单测锁定 |
| `reconcileComponentSwitchValue` → 清空 | 行为变更：原先失效变第一项；接受为对齐全局筛；changelog 一句说明 |
| 旧包 `ops-analysis-unified-filter` | 若测试仍引用，抽公共 scan/identity 后两边共用，避免两套合并键 |

不做：批量改写用户已存显示名；不做会话级「恢复上次搜索」。

---

## 10. 验收用例

1. **`screen_11`（3D 机房）**：多组件、多数据源、同名 `server_room_id`、同 `cmdb/get_room_list` → 配置表 1 行、栏上 1 个机房筛；跟随与现网一致。  
2. **三图同一数据源同名参数**：配置表 1 行、栏 1 控件；改配置一处生效。  
3. **异源 + 异 optionsSource 同名**：配置表多行且可区分；栏上多控件；各值只喂绑定到自己 id 的图。  
4. **异源 + 同 optionsSource + 同 refs**：仍 1 行。  
5. **异源 + 异 optionsSource + 人为配了相同 refs**：仍多行（引用不能盖过 options 宇宙）。  
6. **多数据源各绑 timeRange / 组织**：栏上仍各 1 个，不拆。  
7. **级联两级**：机房 → 设备；改机房草稿立刻换设备选项；设备旧值失效则清空；图不变直至点搜索。  
8. **上游空**：清空机房 → 设备不请求、选项空、设备值清空（草稿）。  
9. **三级**：A→B→C 可保存；A→B→C→D 配置拒绝。  
10. **环**：A→B→A 配置拒绝。  
11. **拼接**：`queryParams.x = "pre-$id$"` 拒绝。  
12. **打开盘**：用 defaultValue（+URL）；按选项 retain；不恢复上次搜索会话。  
13. **组件内切换 + 依赖**：可开启；选项随本卡局部上游 + applied 全局变化；失效清空不选第一项。  
14. **YAML 往返**：带 `queryParams.ref` 的盘导出再导入，行为一致。  
15. **点搜索**：仅此时 applied 更新并刷图；上游抖动不刷图。

---

## 11. 建议实现文件清单与 PR 边界

### 11.1 建议改动文件（主路径）

**模型 / 纯函数**

- `web/src/app/ops-analysis/types/dataSource.ts` — `DynamicOptionsSource.queryParams`、`OptionsQueryParamValue`  
- `web/src/app/ops-analysis/utils/paramInputConfigUtils.ts` — 导出 / 扩展 identity、normalize ref  
- `web/src/app/ops-analysis/utils/optionsQueryParamRefs.ts`（新）— 解析、环、深度、空上游  
- `web/src/app/ops-analysis/utils/scanUnifiedFilterParams.ts`（新，或从 modal 抽出）— 合并键含例外  
- `web/src/app/ops-analysis/utils/paramInputOptionsLoader.ts` — 带参请求 + 签名  
- `web/src/app/ops-analysis/utils/optionBackedFilterValue.ts` — 保持清空语义，供级联复用  
- `web/src/app/ops-analysis/utils/componentParamSwitch.ts` — 失效改清空  
- `web/src/app/ops-analysis/utils/applyDashboardProposal.ts` — 改用共享 identity  
- `web/src/app/ops-analysis/utils/widgetDataTransform.ts` — 若有扫参/id，对齐新 mergeKey  

**UI / hooks**

- `components/paramInputConfigEditor.tsx` — 查询入参编辑 + 校验  
- `components/unifiedFilter/unifiedFilterConfigModal.tsx` — 新合并；拆行副文案  
- `components/unifiedFilter/unifiedFilterBar.tsx` — 依赖重载；reconcile **不**触发 search  
- `hooks/useParamInputOptions.ts` — 接收 resolved upstream  
- 组件内切换消费处（TopN / nodeGraph / room3D 等调用 `useParamInputOptions` / reconcile 的组件）— 传入局部+applied  

**测试**

- `utils/__tests__/optionsQueryParamRefs.test.ts`（新）  
- `utils/__tests__/scanUnifiedFilterParams.test.ts`（新；含 screen_11 同类 fixture）  
- `utils/__tests__/paramInputOptionsLoader.test.ts` — 带参 / 空上游  
- `utils/__tests__/componentParamSwitch.multipleReconcile.test.ts` — 失效清空  
- `components/unifiedFilter/__tests__/…` — 草稿不搜、拆行 UI  

**文档**

- 本文；落地后回写 `ops-analysis-unified-filter.md`「明确后置」中「级联下拉」→ 指向本文并标已拍板/已实现  

### 11.2 PR 边界

- **单功能单 commit / 单 PR**：只做「选项查询参数级联」（含合并收紧 + 失效清空 + 草稿不搜）。  
- 不顺手改 Saved View、Cascader、无关筛选视觉。  
- 提交作者：`yvtian0107 <2915505011@qq.com>`；**禁止** `Co-authored-by`。  
- 从 fork `master` 开分支；复杂实现可交 **Cursor cloud**，以本文为唯一产品合同。  
- 若 cloud 不可用：本机改同一文件清单，仍保持单 PR 边界。

### 11.3 建议实现顺序（便于 cloud 拆步）

1. 类型 + `optionsQueryParamRefs` + 抽出 `optionsSourceIdentity` + 单测。  
2. Loader 带参 + 空上游短路 + hook 签名。  
3. 合并算法抽出 + 配置表副文案；`screen_11` / 时间 / 组织单测。  
4. ConfigEditor 入参 UI + 校验。  
5. FilterBar 依赖链 + reconcile 改草稿不搜。  
6. componentSwitch 失效清空 + 局部依赖解析。  
7. AI digest / YAML 往返测试。  
8. 回写决策记忆与 changelog 一句。

---

## 12. 决策来源

- 用户 grill（2026-10-30）：打开策略、失效不搜、合并收紧与时间/组织例外、`screen_11` 仍一条、配置表并一行合理性、分别配置=先拆、组件内失效改清空、有依赖不禁切换、上游配在参数「配置」而非总表列。  
- 代码现状：`ParamInputConfigEditor`、`DynamicOptionsSource`、`paramInputOptionsLoader`（`{}`）、`filterTemplate`（仅展示）、`UnifiedFilterBar` draft+Search、`` key__type `` 合并、`reconcileComponentSwitchValue`、`optionBackedFilterValue`、`applyDashboardProposal.optionsSourceIdentity`。  
- 前序后置声明：`docs/design/product-decisions/ops-analysis-unified-filter.md` §明确后置「级联下拉」。
