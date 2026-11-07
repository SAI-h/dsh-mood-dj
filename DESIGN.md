# 心绪电台 · 情绪采集与连续播放设计

## 0. 先说结论

现在的电台是「打开面板时分析一次 → 排 5 首歌 → 播完就停」，情绪采集是**隐式常开**的，没有会话级开关，也没有“下一批歌什么时候补”的调度。

要变成你描述的形态，需要把它拆成四个独立层：

1. **意图层**：判断用户是在表达情绪、想开始、想停、想换，还是只是普通聊天；
2. **情绪层**：短时间窗口内的情绪轨迹，而不是单条消息的正负判断；
3. **调度层**：按歌曲时长和队列剩余时间，在歌曲快结束前补下一批；
4. **画像层**：短期偏好 + 长期偏好 + 冷启动，保证没有对话时也有歌可放。

核心原则：**分析可以慢，歌不能断；除非明确说要停，否则只换歌、不停止。**

---

## 1. 状态机

```text
off
 └─ 用户打开“情绪采集”开关
      ↓
collecting（采集中，后台队列播放）
 ├─ 用户说“停 / 别放了 / 关掉” → off
 ├─ 队列剩余 < leadTime → 分析 → 规划下一批 → 追加队列
 ├─ 队列意外空了 → 立即用画像兜底 → 继续播放
 └─ 到达本轮上限（默认 90 分钟）→ 询问“继续 / 结束”，默认继续
```

状态对象建议：

```js
{
  enabled: true,
  sessionId: "session-...",
  startedAt: 1794...,
  endsAt: 1794...,
  queue: [
    { songId, title, durationSec, startedAt, endsAt }
  ],
  queueEndsAt: 1794...,
  lastAnalyzedSeq: 662,
  lastAnalyzedAt: 1794...,
  lastUserMessageAt: 1794...,
  lastIntent: "comfort",
  status: "playing" // playing | refilling | paused | stopped
}
```

`lastAnalyzedSeq` 很关键：只分析上次分析之后的新消息，避免重复把同一段对话喂给模型。

---

## 2. 意图识别

### 2.1 先规则，后模型

规则负责“高确定、要立刻生效”的动作，模型只处理模糊句。

| 意图 | 规则示例 | 动作 |
|---|---|---|
| stop | `停`、`停止`、`别放了`、`关掉`、`不要放了`、`暂停音乐` | 立即停止播放，关闭采集 |
| skip | `换一首`、`下一首`、`换点别的`、`这首不好听` | 跳过当前，立即补位 |
| quieter | `太吵`、`小声点`、`安静点` | 同氛围内降低 arousal |
| louder | `大声点`、`来点劲的` | 提高 arousal |
| start | `开始`、`开个电台`、`放点歌`、`来点音乐` | 开启采集并播放 |
| like | `喜欢这首`、`好听`、`收藏` | 正向反馈 |
| dislike | `不喜欢`、`跳过这首`、`太吵了` | 负向反馈 |
| emotion | `好烦`、`累`、`难受`、`想哭`、`开心` | 记录情绪，但不一定立即切歌 |

### 2.2 否定与歧义

- `不要停` / `别停` / `继续放` → 不停止；
- `不是这首` → skip，不是 stop；
- `停车` / `停止位` / `停一下手` 这类技术语境 → 不触发 stop；
- 规则命中但句子较长或含否定 → 交给 LLM 二分类，超时 1.5 秒；低置信度就不动作。

### 2.3 时效性

- stop / skip / start：**立即执行**，不等下一批；
- 情绪：只记录到短期窗口，**在补歌时统一分析**；
- 普通聊天：不触发任何播放动作。

---

## 3. 歌曲画像

每首歌至少要有这些字段。当前曲库只有 `id/title/artist/tags/valence/arousal`，需要补齐 `durationSec` 和场景标签。

```js
{
  id: 386175,
  title: "倔强",
  artist: "五月天",
  album: "神的孩子都在跳舞",
  durationSec: 262,

  // 情绪坐标
  valence: 76,          // 0 悲伤 ←→ 100 愉悦
  arousal: 70,          // 0 平静 ←→ 100 激动

  // 听感属性
  bpm: 136,             // 可人工标注/估算，拿不到就 null
  genre: ["摇滚", "流行"],
  language: "zh",
  era: "2000s",
  instrumental: false,
  vocalType: "male",
  energyCurve: "high-flat", // intro-build-drop / low-flat / high-flat

  // 场景与人群（行为场景，不做敏感人口属性）
  contexts: ["运动", "通勤", "需要打气", "白天"],
  personaFit: ["热血型", "华语流行偏好"],

  // 运营属性
  familiarity: 0.8,     // 大众熟悉度 0-1
  novelty: 0.2,         // 对用户的新鲜度
  skipRisk: 0.1,
  vip: true,
  free: false
}
```

### 3.1 时长从哪里来

- 网易云 `song/detail` 返回 `duration`（毫秒），用它写入 `durationSec`；
- 播放时再用 CDP store 的 `resourceDuration` 和当前 `position` 校正剩余时间；
- 非会员 VIP 歌曲实际只有 30 秒试听：用 `fee` / `freeTrialInfo` 标记 `playableDurationSec`，排歌时按 30 秒算，避免“以为还有 4 分钟，其实已经停了”；
- 队列结束时间 = 每首 `playableDurationSec` 之和，不是固定 5 首。

### 3.2 “适用人群”怎么理解

不做年龄/性别/收入之类推断。用**行为场景分群**：

- 深夜独处型：低 arousal、低 BPM、器乐/民谣；
- 通勤移动型：中高 familiarity、节奏稳定；
- 专注工作型：器乐、低人声、稳定 BPM；
- 情绪宣泄型：高 arousal、摇滚/说唱；
- 被接住型：低 arousal、温暖、慢节奏；
- 庆祝型：高 valence、高 arousal。

这些分群由用户行为和反馈打分，不预设身份。

---

## 4. 短期情绪模型

### 4.1 输入

只看真实用户消息（`source.kind === "user"`），排除运行上下文、技能目录、审批通知。

窗口建议：

- 时间窗：最近 15 分钟；
- 条数窗：最近 20 条用户消息；
- 权重：越新越高，半衰期 8 分钟；
- 长消息降权，避免一段技术说明压过一句“好烦”。

### 4.2 输出

```js
{
  valence: 38,
  arousal: 58,
  trend: "falling",       // rising | falling | flat
  volatility: 0.2,
  intent: "vent",        // vent | comfort | celebrate | focus | quiet | unknown
  confidence: 0.78,
  cues: ["好烦", "都没有做到"],
  summary: "你既烦躁又疲惫，需要被接住，而不是继续解释。"
}
```

### 4.3 模型调用策略

- 只在**补歌窗口**调用，不在每条消息上调用；
- 同一 `lastAnalyzedSeq` 缓存 10 分钟；
- LLM 超时 8 秒；超时就沿用上一轮情绪，不打断当前队列；
- LLM 失败时，规则引擎给出低置信度兜底；
- 不把原始对话写进长期画像，只写标签、分数、时间。

---

## 5. 长期画像与冷启动

### 5.1 长期画像

```js
{
  tagWeights: { "华语": 0.8, "摇滚": 0.4, "夜晚": 0.3 },
  artistWeights: { "五月天": 0.6 },
  languageWeights: { "zh": 0.9, "en": 0.1 },
  eraWeights: { "2000s": 0.5, "2020s": 0.3 },
  skipRates: { "386175": 0.1 },
  timeBuckets: {
    "morning": { valence: 60, arousal: 45 },
    "late-night": { valence: 45, arousal: 28 }
  },
  effectiveness: {
    "comfort": { "calm": 0.7, "release": -0.2 }
  }
}
```

更新规则：

- 播放完成 + 喜欢：标签 `+0.08`；
- 30 秒内跳过：当前歌标签 `-0.12`，同 artist `-0.04`；
- 连续跳过 2 首：下一批强制换一个 genre/情绪方向；
- 所有分数做 `0.98` 的时间衰减，避免画像僵化；
- 探索率 20%：每 5 首里留 1 首低分但高新鲜度的歌。

### 5.2 冷启动

第一次开启采集时，按顺序补：

1. 当前对话情绪（如果有）；
2. 当前时间 + 星期（深夜/早晨/工作时段/周末）；
3. 三选一轻量偏好（“最近更想听：安静 / 有劲 / 都行”）；
4. 如果 ncm-cli 已登录：导入最近播放/红心歌单的**标签统计**，不导入原始历史；
5. 默认探索池：每类氛围 2 首高 familiarity 的安全牌。

不要一上来就用一首很偏的歌；冷启动阶段 familiarity 权重更高，探索率降到 10%。

---

## 6. 调度：歌不能停

### 6.1 批次规划

- 每批 4–6 首，目标总时长 **18–25 分钟**；
- 第一首按当前情绪强匹配，后续做“情绪曲线”：先接住，再缓慢抬升/下降；
- 每批至少 1 首低 skipRisk 的安全牌；
- 避免同一 artist 连续出现，避免 3 小时内重复。

### 6.2 补歌时机

```js
const leadMs = clamp(batchDurationMs * 0.12, 60_000, 150_000)
const refillAt = queueEndsAt - leadMs
```

- 在 `refillAt` 分析新消息、规划下一批；
- 用 **append**（`playingList/addItemToCurPlayingList`，`clear:false`）把下一批接到当前队列尾部；
- 不要用 `playing/play` + `clear:true` 补歌，它会清空当前队列并造成硬切；
- 如果 append 失败，才在 `queueEndsAt - 5s` 用一次 `playing/play` 兜底，并记录降级。

### 6.3 实际进度校正

每 30 秒查一次 CDP：

```js
{ currentSongId, positionSec, durationSec, playingState, queueLength }
```

- 用户手动跳过 → 重算 `queueEndsAt`；
- 队列只剩 1 首 → 提前进入补歌；
- 播放暂停超过 5 分钟 → 视为用户想停，进入 paused，不自动恢复；
- 队列空了且没有新批次 → 立即用长期画像兜底，绝不让它静默停掉。

### 6.4 停止条件

只有这些会停：

- 明确 stop 意图；
- 用户手动关闭采集开关；
- 暂停超过 5 分钟；
- 本轮达到硬上限（默认 3 小时）且用户不续。

到 90 分钟时只提示“要继续吗”，默认继续，不自动停。

---

## 7. 话题相关歌曲

情绪不是唯一入口。分析器同时提取用户明确谈到的具体对象：

```js
topics: [
  { type: "media", name: "进击的巨人", query: "进击的巨人 主题曲", confidence: 0.92 },
  { type: "event", name: "毕业论文", query: "毕业 歌曲", confidence: 0.71 }
]
```

规则：

- 只接受具体对象，不接受「动漫」「音乐」「事情」这类泛称，也过滤「网易云音乐」「插件」「仓库」「路径」「代码」「按钮」「进度」这类技术/产品词；
- `media` 直接搜主题曲/OST；`event/place/activity` 搜主题词；`work/person` 通常不使用字面歌名，交给情绪兜底；
- 一批 5 首里，话题歌曲最多 3 首，随后补 2 首公开歌单「新发现」，其余用曲库补齐；
- 话题搜索结果做 12 小时缓存，失败不影响播放；
- 话题歌曲和情绪歌曲都要经过时长、去重、artist 连续重复检查；
- 最近 12 首（含上一批全部曲目）不重复；目录 42 首轮换，时间种子只做小幅随机，避免固定成同一组五首。

这样“聊到某个动漫”可以放该动漫主题曲，“聊到某件事”可以放相关歌曲；没有具体话题时，先从按情绪选定的公开歌单里随机捞 2 首「新发现」，再用情绪画像补足，不会为了凑话题硬放不相干的歌。只有歌单请求失败才完全回退到固定曲库。

## 8. 选歌打分

```text
score =
  0.35 * moodFit(mood, song)
+ 0.20 * longTermAffinity(profile, song)
+ 0.15 * contextFit(time, context, song)
+ 0.10 * novelty
+ 0.10 * familiaritySafety
- 0.15 * fatigue(recentHistory, song)
- 0.10 * skipRisk(song)
+ 0.05 * exploration
```

约束：

- 同一批尽量不重复 artist；
- 最近 12 首不重复，跨批次轮换；
- 最近 2 首高 arousal 后，下一首优先降一点；
- 没有新情绪时，不让 valence/arousal 跳变超过 10 点，保持“氛围连续”。

---

## 9. API 与 UI

新增接口：

```text
POST /mood-dj/radio/start   { sessionId, minutes? }
POST /mood-dj/radio/stop    { sessionId, reason? }
GET  /mood-dj/radio/status  ?sessionId=
POST /mood-dj/settings      { collectEmotion: true|false }
```

UI：

- 面板顶部一个开关：**在对话中采集情绪**；
- 开启后显示：`采集中 · 本轮 18:40 结束 · 已采集 12 条消息`；
- 一个明确的「停止播放」按钮；
- 关闭开关立即停止自动采集和自动补歌，但当前歌可以继续放完（用户可再点停止）。

---

## 10. 失败与降级

| 失败 | 降级 |
|---|---|
| LLM 超时 | 沿用上一轮情绪，继续播当前队列 |
| LLM 不可用 | 规则引擎 + 长期画像 |
| CDP 不在 | 深链播放一首，提示“后台控制未开启” |
| append 失败 | 队列结束前 5 秒 replace 兜底 |
| 歌曲详情拿不到 | 用缓存时长；没有缓存则按 4 分钟估 |
| 用户长时间不说话 | 不换情绪方向，只续同氛围；提高 familiarity |
| 用户连续跳过 | 暂停自动补歌 10 分钟，等明确指令 |

---

## 11. 实施顺序

### Phase 1（先把“不断歌”跑通）

- 补 `durationSec` / `playableDurationSec`；
- 新增 `RadioSession` 状态与 start/stop/status；
- 用定时器 + CDP 实际进度校正；
- append 下一批，不再 clear 队列；
- UI 加开关和停止按钮。

### Phase 2（意图层）

- 规则 stop/skip/start/like/dislike；
- 否定与误触发保护；
- 明确 stop 立即停，情绪只在补歌时分析。

### Phase 3（短期模型）

- 15 分钟滑窗、趋势、volatility、intent；
- 只在 `lastAnalyzedSeq` 之后的新消息上调用 LLM；
- 无对话时保持氛围连续。

### Phase 4（长期画像与冷启动）

- 标签/artist/时段权重；
- 完成/跳过/喜欢反馈；
- 三选一冷启动 + ncm-cli 最近播放标签导入；
- 20% 探索。

---

## 12. 需要先定下来的默认值

1. 一轮电台默认多长：建议 90 分钟提示、3 小时硬上限；
2. 补歌提前量：建议 90 秒；
3. 每批几首：建议 5 首 / 约 20 分钟；
4. 对话采集窗口：建议 15 分钟；
5. 无对话时是否允许换氛围：建议不换，只续当前氛围；
6. 停止后当前歌是否继续：建议继续放完，用户再点停止才硬停；
7. 冷启动是否允许问一个三选一：建议允许，只问一次。

这些定下来后，Phase 1 可以直接在当前 `mood-dj` 上改，不需要重写整个插件。
