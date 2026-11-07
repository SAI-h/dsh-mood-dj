/**
 * 心绪电台 / Mood Radio — Host half.
 *
 * Responsibilities:
 *   1. Read the most recent live conversation (or a session id supplied by the UI).
 *   2. Infer a small, explainable mood vector from recent user/assistant text.
 *   3. Pick a song that gently adjusts the current atmosphere, using the
 *      conversation, the listening profile, the previous song, and time of day.
 *   4. Open NetEase Cloud Music (or another installed music app) and play it.
 *
 * The browser half talks to the same-origin routes under /mood-dj. All mood
 * analysis happens locally; nothing is uploaded anywhere.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'mood-dj'

const ROUTE = '/mood-dj'
const STATE_VERSION = 1

/**
 * Plugin-owned data lives on D: by default. The DSH profile keeps only a link
 * to this workspace bundle, so no listening diary or cache needs C: space.
 */
const SAVE_ROOT = process.env.MOOD_DJ_HOME
  || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'mood-dj')
const STATE_PATH = path.join(SAVE_ROOT, 'state.json')

/**
 * The six atmospheres the radio can aim for. `target` is the emotional target
 * of the *next* song, not a copy of the current mood: when someone is low we
 * lift the valence a little instead of making them feel worse.
 */
const MOODS = {
  comfort: {
    label: '被接住',
    short: 'COMFORT',
    subtitle: '先把速度放慢，让情绪落地',
    line: '不用急着振作，先听一首不催你的歌。',
    target: { valence: 58, arousal: 29 },
    tags: ['治愈', '陪伴', '慢下来'],
    colorA: '#5f728f',
    colorB: '#c98b7a',
  },
  calm: {
    label: '慢慢来',
    short: 'CALM',
    subtitle: '把呼吸放慢半拍',
    line: '世界可以先安静一会儿，你也是。',
    target: { valence: 55, arousal: 21 },
    tags: ['安静', '夜晚', '放空'],
    colorA: '#3f5f6b',
    colorB: '#9db8ad',
  },
  warm: {
    label: '靠近一点',
    short: 'WARM',
    subtitle: '让一点温度回到房间里',
    line: '不必盛大，一点点温柔就够。',
    target: { valence: 69, arousal: 40 },
    tags: ['温柔', '陪伴', '日常'],
    colorA: '#8a5a44',
    colorB: '#e0a86f',
  },
  focus: {
    label: '沉入当下',
    short: 'FOCUS',
    subtitle: '把注意力收回到眼前',
    line: '先做手上的这一件，别让世界太吵。',
    target: { valence: 58, arousal: 46 },
    tags: ['专注', '器乐', '稳定'],
    colorA: '#4f5d75',
    colorB: '#8fa3bf',
  },
  uplift: {
    label: '把光打开',
    short: 'UPLIFT',
    subtitle: '给身体一点向前的力气',
    line: '今天值得一点亮色，也值得被听见。',
    target: { valence: 79, arousal: 69 },
    tags: ['明亮', '向前', '能量'],
    colorA: '#c96f38',
    colorB: '#f2c14e',
  },
  release: {
    label: '让情绪有出口',
    short: 'RELEASE',
    subtitle: '把闷着的那口气放出来',
    line: '不必体面，先让声音替你喊一会儿。',
    target: { valence: 47, arousal: 75 },
    tags: ['释放', '摇滚', '出口'],
    colorA: '#5d3a4a',
    colorB: '#c25b4e',
  },
}

/**
 * A deliberately small, playable catalogue. Every entry has a verified NetEase
 * song id, so the desktop client can be deep-linked without a network search.
 * Tags are also the vocabulary used by the listening profile.
 */
const SONGS = [
  // comfort — warm, low-pressure songs for tired or heavy moments
  { id: 569214247, title: '平凡的一天', artist: '毛不易', album: '平凡的一天', tags: ['华语', '治愈', '日常', '慢'], valence: 58, arousal: 27, free: true },
  { id: 65538, title: '好久不见', artist: '陈奕迅', album: '认了吧', tags: ['华语', '怀旧', '温柔', '夜晚'], valence: 43, arousal: 24 },
  { id: 26598946, title: '山丘', artist: '李宗盛', album: '山丘', tags: ['华语', '怀旧', '人生', '慢'], valence: 47, arousal: 32 },
  { id: 28815250, title: '平凡之路', artist: '朴树', album: '猎户星座', tags: ['华语', '公路', '治愈', '坚持'], valence: 55, arousal: 44 },
  { id: 441491828, title: '水星记', artist: '郭顶', album: '飞行器的执行周期', tags: ['华语', '独立', '夜晚', '孤独'], valence: 41, arousal: 30 },
  { id: 437715323, title: 'Merry Christmas Mr. Lawrence', artist: '坂本龍一', album: 'Merry Christmas Mr. Lawrence', tags: ['器乐', '钢琴', '安静', '电影'], valence: 50, arousal: 23 },

  // calm — evening / late-night / decompression
  { id: 299936, title: '红豆', artist: '王菲', album: '唱游', tags: ['华语', '怀旧', '温柔', '夜晚'], valence: 59, arousal: 28 },
  { id: 209228, title: '旅行的意义', artist: '陈绮贞', album: '华丽的冒险', tags: ['华语', '独立', '民谣', '公路'], valence: 63, arousal: 38 },
  { id: 513360721, title: '云烟成雨', artist: '房东的猫', album: '云烟成雨', tags: ['华语', '民谣', '温柔', '治愈'], valence: 56, arousal: 30 },
  { id: 22829932, title: 'River Flows in You', artist: 'Yiruma', album: 'The Best - Reminiscent', tags: ['器乐', '钢琴', '安静', '专注'], valence: 61, arousal: 30 },

  // uplift — bright, forward, celebratory
  { id: 386175, title: '倔强', artist: '五月天', album: '神的孩子都在跳舞', tags: ['华语', '摇滚', '热血', '明亮'], valence: 76, arousal: 70 },
  { id: 287221, title: '绿光', artist: '孙燕姿', album: 'My Story, Your Song', tags: ['华语', '流行', '明亮', '轻快'], valence: 80, arousal: 66 },
  { id: 25706282, title: '夜空中最亮的星', artist: '逃跑计划', album: '世界', tags: ['华语', '摇滚', '希望', '合唱'], valence: 72, arousal: 62 },
  { id: 408055928, title: '你要跳舞吗', artist: '新裤子', album: '生命因你而火热', tags: ['华语', '摇滚', '迪斯科', '释放'], valence: 82, arousal: 78 },
  { id: 551339740, title: '阳光彩虹小白马', artist: '大张伟', album: '阳光彩虹小白马', tags: ['华语', '流行', '快乐', '搞怪'], valence: 88, arousal: 80 },

  // release — angry / restless / need an outlet
  { id: 411314659, title: '山海', artist: '草东没有派对', album: '丑奴儿', tags: ['华语', '摇滚', '独立', '宣泄'], valence: 34, arousal: 82 },
  { id: 386844, title: '杀死那个石家庄人', artist: '万能青年旅店', album: '万能青年旅店', tags: ['华语', '摇滚', '独立', '时代'], valence: 30, arousal: 70, free: true },
  { id: 381825, title: '公路之歌', artist: '痛仰乐队', album: '不要停止我的音乐', tags: ['华语', '摇滚', '公路', '自由'], valence: 52, arousal: 72, free: true },
  { id: 66842, title: '十年', artist: '陈奕迅', album: '黑·白·灰', tags: ['华语', '怀旧', '情歌', '慢'], valence: 42, arousal: 28 },
  { id: 108914, title: '江南', artist: '林俊杰', album: '第二天堂', tags: ['华语', '流行', 'R&B', '怀旧'], valence: 64, arousal: 48 },
  { id: 1360465542, title: '天黑黑', artist: '孙燕姿', album: '孙燕姿', tags: ['华语', '流行', '怀旧', '成长'], valence: 55, arousal: 38 },
  { id: 386538, title: '温柔', artist: '五月天', album: '爱情万岁', tags: ['华语', '摇滚', '温柔', '青春'], valence: 58, arousal: 45 },
  { id: 139357, title: '生如夏花', artist: '朴树', album: '生如夏花', tags: ['华语', '民谣', '公路', '生命'], valence: 62, arousal: 50 },
  { id: 436514312, title: '成都', artist: '赵雷', album: '无法长大', tags: ['华语', '民谣', '城市', '慢'], valence: 58, arousal: 30 },
  { id: 421423806, title: '小半', artist: '陈粒', album: '小梦大半', tags: ['华语', '独立', '民谣', '暗恋'], valence: 46, arousal: 35 },
  { id: 417596830, title: '美好事物', artist: '房东的猫', album: '美好事物', tags: ['华语', '民谣', '治愈', '日常'], valence: 62, arousal: 32, free: true },
  { id: 569200213, title: '消愁', artist: '毛不易', album: '平凡的一天', tags: ['华语', '民谣', '孤独', '夜晚'], valence: 40, arousal: 28, free: true },
  { id: 109998, title: '贝加尔湖畔', artist: '李健', album: '依然', tags: ['华语', '民谣', '安静', '湖'], valence: 60, arousal: 22 },
  { id: 29713754, title: '匆匆那年', artist: '王菲', album: '匆匆那年', tags: ['华语', '怀旧', '青春', '慢'], valence: 48, arousal: 28 },
  { id: 449818741, title: '光年之外', artist: 'G.E.M.邓紫棋', album: '光年之外', tags: ['华语', '流行', '力量', '太空'], valence: 66, arousal: 62 },
  { id: 516823132, title: '大鱼', artist: '周深', album: '大鱼', tags: ['华语', '国风', '空灵', '温柔'], valence: 62, arousal: 28 },
  { id: 28009051, title: '没有理想的人不伤心', artist: '新裤子', album: '生命因你而火热', tags: ['华语', '摇滚', '独立', '丧'], valence: 38, arousal: 65 },
  { id: 528272281, title: '火车驶向云外，梦安魂于九霄', artist: '刺猬', album: '生之响往', tags: ['华语', '摇滚', '独立', '夜'], valence: 45, arousal: 60 },
  { id: 381821, title: '再见杰克', artist: '痛仰乐队', album: '不要停止我的音乐', tags: ['华语', '摇滚', '公路', '自由'], valence: 55, arousal: 72 },
  { id: 25706279, title: '一万次悲伤', artist: '逃跑计划', album: '世界', tags: ['华语', '摇滚', '希望', '夜'], valence: 58, arousal: 55 },
  { id: 386835, title: '秦皇岛', artist: '万能青年旅店', album: '万能青年旅店', tags: ['华语', '摇滚', '小号', '时代'], valence: 42, arousal: 55 },
  { id: 411314657, title: '大风吹', artist: '草东没有派对', album: '丑奴儿', tags: ['华语', '摇滚', '独立', '无奈'], valence: 32, arousal: 78 },
  { id: 5147557, title: 'Energy Flow', artist: '坂本龙一', album: 'BTTB', tags: ['器乐', '钢琴', '安静', '治愈'], valence: 58, arousal: 20, free: true },
  { id: 443242, title: 'Summer', artist: '久石譲', album: '菊次郎的夏天', tags: ['器乐', '钢琴', '夏日', '轻快'], valence: 72, arousal: 45 },
  { id: 28411989, title: 'Kiss The Rain', artist: 'Yiruma', album: 'From the Yellow Room', tags: ['器乐', '钢琴', '雨', '夜'], valence: 52, arousal: 24 },
  { id: 30431472, title: '琵琶语', artist: '林海', album: '琵琶相', tags: ['器乐', '国风', '安静', '夜'], valence: 55, arousal: 22 },
  { id: 468176711, title: '城南花已开', artist: '三亩地', album: '城南花已开', tags: ['器乐', '钢琴', '治愈', '希望'], valence: 60, arousal: 25 },
]

/** Verified NetEase durations for planning a batch before playback starts. */
const SONG_DURATIONS = {
  569214247: 277,
  65538: 251,
  26598946: 406,
  28815250: 302,
  441491828: 325,
  437715323: 277,
  299936: 256,
  209228: 258,
  513360721: 241,
  22829932: 215,
  386175: 262,
  287221: 192,
  25706282: 252,
  408055928: 193,
  551339740: 226,
  411314659: 251,
  386844: 344,
  381825: 185,
  66842: 205,
  108914: 268,
  1360465542: 234,
  386538: 270,
  139357: 295,
  436514312: 328,
  421423806: 297,
  417596830: 199,
  569200213: 261,
  109998: 246,
  29713754: 241,
  449818741: 236,
  516823132: 318,
  28009051: 341,
  528272281: 326,
  381821: 274,
  25706279: 255,
  386835: 481,
  411314657: 236,
  5147557: 273,
  443242: 154,
  28411989: 261,
  30431472: 259,
  468176711: 271,
}
for (const song of SONGS) {
  song.durationSec = SONG_DURATIONS[song.id] ?? 240
  // The current account has no black-vinyl membership. VIP tracks play a
  // 30-second preview, so planning must use 30s or the next batch arrives too
  // late. Free tracks keep their full duration.
  song.playableDurationSec = song.free === true ? song.durationSec : 30
}

const POSITIVE = {
  开心: 3, 高兴: 3, 喜欢: 2, 爱: 2, 太好了: 3, 顺利: 2, 成功: 2, 谢谢: 1,
  期待: 2, 舒服: 2, 放松: 2, 治愈: 2, 温柔: 2, 惊喜: 3, 不错: 2, 棒: 2,
  哈哈: 2, 嘻嘻: 2, 好耶: 3, 赞: 2, 可爱: 2, 满足: 2, 幸福: 3, 希望: 2,
  安心: 2, 好玩: 2, 漂亮: 2, 厉害: 2, '😊': 3, '😄': 3, '🥰': 3, '❤️': 3, '😍': 3,
}

const NEGATIVE = {
  累: 3, 疲惫: 3, 烦: 3, 难过: 3, 焦虑: 3, 压力: 3, 崩: 3, 崩溃: 4, 失败: 3,
  生气: 3, 讨厌: 3, 痛: 3, 失眠: 3, 孤独: 3, 委屈: 3, 哭: 3, 唉: 2, 难受: 3,
  害怕: 3, 紧张: 2, 糟糕: 3, 无语: 2, 郁闷: 3, 心累: 3, 摆烂: 2, 内耗: 3,
  焦躁: 3, 烦死: 3, 心碎: 4, 分手: 4, 失恋: 4, 撑不住: 4, 想哭: 4, 抑郁: 4,
  麻木: 2, 没意思: 2, 不想: 1, 好烦: 3, 好累: 3, 不想动: 2, 撑不下去: 4,
  '😭': 3, '😞': 3, '😩': 3, '💔': 4, '😔': 3, '🥲': 2, '😣': 3, '😢': 3,
}

const HIGH_AROUSAL = {
  急: 3, 快: 1, 兴奋: 3, 冲: 2, 立刻: 2, 马上: 2, 加班: 2, 截止: 3,
  崩溃: 3, 激动: 3, 吵架: 3, 生气: 3, 紧张: 2, 焦虑: 3, 赶: 2, 忙: 2,
  熬夜: 2, ddl: 3, deadline: 3, 冲冲冲: 3, 烦死: 3, 气死: 4,
}

const LOW_AROUSAL = {
  累: 2, 困: 2, 睡: 2, 安静: 2, 慢: 1, 放空: 2, 平静: 2, 温柔: 2,
  夜: 1, 晚: 1, 躺: 2, 休息: 2, 舒服: 2, 发呆: 2, 摸鱼: 1, 散步: 2,
  听歌: 1, 下雨: 1, 疲惫: 2, 没力气: 2,
}

const CATEGORY_TERMS = {
  heartbreak: ['分手', '失恋', '离开', '错过', '遗憾', '想他', '想她', '前任', '不爱了', '心碎'],
  lonely: ['孤独', '一个人', '没人', '孤单', '空荡', '寂寞', '无人'],
  tired: ['累', '疲惫', '困', '熬夜', '失眠', '撑不住', '休息', '摆烂', '没力气'],
  angry: ['生气', '烦', '气死', '吵架', '无语', '恶心', '滚', '烦死', '火大'],
  anxious: ['焦虑', '紧张', '压力', '害怕', '担心', '慌', '来不及', 'deadline', 'ddl', '内耗'],
  work: ['工作', '项目', '加班', '代码', 'bug', '需求', '上线', '考试', '学习', '论文', '会议'],
  celebration: ['庆祝', '成功', '拿到offer', '通过了', '面试通过', '审核通过', '考试通过', '升职', '生日', '录取', '获奖', '上岸'],
  calm: ['平静', '放松', '舒服', '安静', '发呆', '散步', '听歌', '慢慢', '松弛'],
  happy: ['开心', '高兴', '喜欢', '期待', '哈哈', '好耶', '棒', '可爱', '幸福'],
  romantic: ['喜欢', '爱', '心动', '想念', '温柔', '拥抱', '陪你', '想你'],
}

const ANSI_OR_CODE = /```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g

/** A small deterministic hash, used only for gentle song rotation. */
function hash(text) {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return Math.abs(value)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function round(value) {
  return Math.round(value)
}

function nowLabel(date = new Date()) {
  const hour = date.getHours()
  if (hour < 5) return '凌晨'
  if (hour < 9) return '清晨'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 23) return '晚上'
  return '深夜'
}

function emptyState() {
  return {
    version: STATE_VERSION,
    createdAt: Date.now(),
    plays: 0,
    lastSongId: null,
    history: [],
    recentProgramIds: [],
    analysisCache: null,
    topicCache: {},
    discoveryCache: {},
    lastAutoAt: null,
    radio: null,
  }
}

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    if (!raw || raw.version !== STATE_VERSION || !Array.isArray(raw.history)) return emptyState()
    return {
      ...emptyState(),
      ...raw,
      history: raw.history.filter((item) => item && typeof item === 'object').slice(0, 60),
    }
  } catch {
    return emptyState()
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
    fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // A read-only profile should not break playback; the diary is best-effort.
  }
}

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function cleanText(text) {
  return String(text)
    .replace(ANSI_OR_CODE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000)
}

function collectConversation(session) {
  if (!session) return { entries: [], userMessages: 0 }
  let events = []
  try {
    events = session.ownEvents()
  } catch {
    events = []
  }
  const entries = []
  for (const event of events) {
    if (event.type === 'user/message') {
      // `user/message` stores the UserMessage directly; assistant events wrap it.
      const message = event.data?.message ?? event.data
      // Runtime context, time snapshots, skill catalogs, and approval notices are
      // also logged as user messages. Only a real human turn carries kind=user.
      const sourceKind = message?.source?.kind
      if (sourceKind !== undefined && sourceKind !== 'user') continue
      const text = cleanText(textFromContent(message?.content))
      if (text) entries.push({ role: 'user', text, time: event.time ?? 0, seq: event.seq })
    } else if (event.type === 'assistant/message') {
      const message = event.data?.message ?? event.data
      const text = cleanText(textFromContent(message?.content))
      if (text) entries.push({ role: 'assistant', text, time: event.time ?? 0, seq: event.seq })
    }
  }
  const recent = entries.slice(-40)
  return {
    entries: recent,
    userMessages: recent.filter((entry) => entry.role === 'user').length,
  }
}

function latestSession(sessions, preferredId) {
  if (preferredId) {
    const preferred = sessions.get(preferredId)
    if (preferred) return preferred
  }
  const live = sessions.list().filter((session) => !session.header?.parentSession && session.header?.origin !== 'subagent')
  let best = null
  for (const session of live) {
    let lastTime = 0
    try {
      const events = session.ownEvents()
      lastTime = events.length > 0 ? events[events.length - 1].time ?? 0 : 0
    } catch {
      lastTime = 0
    }
    if (best === null || lastTime > best.lastTime) best = { session, lastTime }
  }
  return best?.session ?? sessions.list()[0]
}

/** Count a term while treating “不开心 / 没那么开心” as a negation. */
function addTerm(score, text, term, weight) {
  let from = 0
  let count = 0
  let negated = 0
  while (from < text.length) {
    const index = text.indexOf(term, from)
    if (index < 0) break
    const prefix = text.slice(Math.max(0, index - 2), index)
    if (/(不|没|别|无|未|不是|没有)$/.test(prefix)) negated += 1
    else count += 1
    from = index + term.length
  }
  score.value += count * weight - negated * weight * 0.8
  score.count += count
  if (negated > 0) score.count += negated * 0.4
}

function scoreEntries(entries) {
  const positive = { value: 0, count: 0 }
  const negative = { value: 0, count: 0 }
  const high = { value: 0, count: 0 }
  const low = { value: 0, count: 0 }
  const cues = new Map()
  const categories = new Map()
  // The user's own words set the mood. Assistant prose can mention bugs, tests,
  // or build status without saying anything about how the person feels.
  const scoped = entries.filter((entry) => entry.role === 'user')

  for (let index = 0; index < scoped.length; index += 1) {
    const entry = scoped[index]
    const recency = 0.35 + 0.65 * ((index + 1) / scoped.length)
    const weight = recency * 2.2
    const text = entry.text

    for (const [term, value] of Object.entries(POSITIVE)) addTerm(positive, text, term, value * weight)
    for (const [term, value] of Object.entries(NEGATIVE)) addTerm(negative, text, term, value * weight)
    for (const [term, value] of Object.entries(HIGH_AROUSAL)) addTerm(high, text, term, value * weight)
    for (const [term, value] of Object.entries(LOW_AROUSAL)) addTerm(low, text, term, value * weight)

    for (const [category, terms] of Object.entries(CATEGORY_TERMS)) {
      for (const term of terms) {
        if (!text.includes(term)) continue
        const value = (categories.get(category) ?? 0) + weight
        categories.set(category, value)
        cues.set(term, (cues.get(term) ?? 0) + weight)
      }
    }

    // Emoji and exclamation marks are useful, low-effort signals.
    const exclamations = (text.match(/[!！]/g) ?? []).length
    if (exclamations > 0) {
      high.value += Math.min(exclamations, 4) * 1.3 * weight
      high.count += Math.min(exclamations, 4)
    }
  }

  const topCues = [...cues.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([term]) => term)
  const topCategories = [...categories.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([category]) => category)

  const valence = clamp(50 + (positive.value - negative.value) * 5.2, 4, 96)
  const arousal = clamp(42 + (high.value - low.value) * 5.8, 8, 96)
  const signal = positive.value + negative.value + high.value + low.value >= 1.5
  const confidence = clamp(38 + (positive.value + negative.value + high.value + low.value) * 6, 38, 94)

  return {
    valence: round(valence),
    arousal: round(arousal),
    positive: positive.value,
    negative: negative.value,
    high: high.value,
    low: low.value,
    signal,
    confidence: round(confidence),
    cues: topCues,
    categories: topCategories,
  }
}

function timeMood(date) {
  const hour = date.getHours()
  const day = date.getDay()
  if (hour >= 23 || hour < 5) return 'calm'
  if (hour < 9) return 'warm'
  if (hour < 12) return 'focus'
  if (hour < 14) return 'warm'
  if (hour < 18) return 'focus'
  if ((day === 0 || day === 6) && hour < 21) return 'uplift'
  return 'warm'
}

function moodForSong(song) {
  if (!song) return 'calm'
  if (song.tags.includes('宣泄') || song.tags.includes('释放')) return 'release'
  if (song.tags.includes('快乐') || song.tags.includes('明亮')) return 'uplift'
  if (song.tags.includes('钢琴') || song.tags.includes('安静')) return 'calm'
  if (song.tags.includes('治愈')) return 'comfort'
  if (song.tags.includes('温柔')) return 'warm'
  return song.valence > 65 ? 'warm' : 'calm'
}

function topTagAffinity(state) {
  const scores = new Map()
  for (const entry of state.history.slice(0, 40)) {
    const weight = entry.verdict === 'like' ? 3 : entry.verdict === 'skip' ? -1.4 : 0.9
    for (const tag of entry.tags ?? []) scores.set(tag, (scores.get(tag) ?? 0) + weight)
  }
  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([tag, score]) => ({ tag, score: round(score * 10) / 10 }))
}

function profileFromState(state) {
  const affinity = topTagAffinity(state)
  return {
    topTags: affinity.map((item) => item.tag),
    affinity,
    plays: state.plays ?? state.history.length,
    liked: state.history.filter((entry) => entry.verdict === 'like').length,
    skipped: state.history.filter((entry) => entry.verdict === 'skip').length,
  }
}

function moodFromProfile(state) {
  const top = profileFromState(state).topTags
  const joined = top.join(' ')
  if (/摇滚|释放|宣泄|公路/.test(joined)) return 'release'
  if (/明亮|快乐|热血|轻快/.test(joined)) return 'uplift'
  if (/钢琴|器乐|专注|安静/.test(joined)) return 'calm'
  if (/治愈|陪伴|慢/.test(joined)) return 'comfort'
  if (/温柔|日常|怀旧/.test(joined)) return 'warm'
  return timeMood(new Date())
}

function topicSearchQuery(topic) {
  if (topic.query) return topic.query
  if (topic.type === 'media') return `${topic.name} 主题曲`
  if (topic.type === 'event') return `${topic.name} 歌曲`
  return ''
}

async function resolveTopicSongs(ctx, semantic, state) {
  if (!semantic?.topics?.length) return []
  const cache = state.topicCache ?? {}
  const selected = []
  for (const topic of semantic.topics.slice(0, 2)) {
    const query = topicSearchQuery(topic)
    if (!query) continue
    let entry = cache[query]
    if (!entry || Date.now() - Number(entry.at ?? 0) > 12 * 60 * 60 * 1000) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6500)
      try {
        const url = `https://music.163.com/api/search/get/web?csrf_token=&s=${encodeURIComponent(query)}&type=1&offset=0&total=true&limit=5`
        const response = await fetch(url, {
          headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://music.163.com/' },
          signal: controller.signal,
        })
        const payload = response.ok ? await response.json() : null
        const items = Array.isArray(payload?.result?.songs) ? payload.result.songs : []
        entry = {
          at: Date.now(),
          songs: items.slice(0, 3).map((item) => ({
            id: Number(item.id),
            title: String(item.name ?? ''),
            artist: (item.artists ?? []).map((artist) => artist.name).filter(Boolean).join(' / '),
            album: String(item.album?.name ?? ''),
            durationSec: Math.max(30, Math.round(Number(item.duration ?? 240000) / 1000)),
            free: item.fee === 8,
            tags: ['话题', topic.name],
            valence: 55,
            arousal: 52,
          })).filter((item) => item.id > 0
            && item.title
            && item.durationSec >= 60
            && !/伴奏|翻唱|cover|karaoke|铃声|片段|remix|dj版/i.test(item.title)),
        }
        cache[query] = entry
        state.topicCache = cache
        saveState(state)
      } catch {
        entry = { at: Date.now(), songs: [] }
      } finally {
        clearTimeout(timer)
      }
    }
    for (const song of entry.songs ?? []) {
      if (selected.some((item) => item.id === song.id)) continue
      selected.push({
        ...song,
        playableDurationSec: song.free ? song.durationSec : 30,
        topicType: topic.type,
        topicName: topic.name,
        source: 'topic',
      })
      if (selected.length >= 3) break
    }
    if (selected.length >= 3) break
  }
  return selected
}

const DISCOVERY_PLAYLISTS = {
  comfort: [562895150, 17836846497],
  calm: [8880666, 5218976950],
  warm: [8465359190, 562895150],
  focus: [5218976950, 8880666],
  uplift: [3778678, 19723756],
  release: [8293792441, 19723756],
}

function shuffle(values) {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

async function fetchDiscoveryPlaylist(playlistId, mood) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch(`https://music.163.com/api/playlist/detail?id=${playlistId}`, {
      headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://music.163.com/' },
      signal: controller.signal,
    })
    const payload = response.ok ? await response.json() : null
    const tracks = Array.isArray(payload?.result?.tracks) ? payload.result.tracks : []
    return tracks
      .map((item) => ({
        id: Number(item.id),
        title: String(item.name ?? '').trim(),
        artist: (item.artists ?? []).map((artist) => artist.name).filter(Boolean).join(' / '),
        album: String(item.album?.name ?? ''),
        durationSec: Math.max(30, Math.round(Number(item.duration ?? 240000) / 1000)),
        free: item.fee === 0 || item.fee === 8,
        tags: ['新发现', mood.label],
        valence: mood.valence,
        arousal: mood.arousal,
      }))
      .filter((item) => item.id > 0
        && item.title
        && item.durationSec >= 60
        && !/伴奏|翻唱|cover|karaoke|铃声|片段|remix|dj版/i.test(item.title))
      .slice(0, 80)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

async function resolveDiscoverySongs(ctx, mood, state) {
  const ids = DISCOVERY_PLAYLISTS[mood.id] ?? [3778678]
  const cache = state.discoveryCache ?? {}
  const recent = new Set([
    ...(state.recentProgramIds ?? []).slice(0, 12),
    ...state.history.slice(0, 12).map((entry) => entry.songId),
    ...SONGS.map((song) => song.id),
  ].map(Number))

  for (const playlistId of ids) {
    const key = String(playlistId)
    let entry = cache[key]
    if (!entry || Date.now() - Number(entry.at ?? 0) > 6 * 60 * 60 * 1000) {
      const songs = await fetchDiscoveryPlaylist(playlistId, mood)
      entry = { at: Date.now(), songs }
      cache[key] = entry
      state.discoveryCache = cache
      saveState(state)
    }
    const candidates = shuffle((entry.songs ?? []).filter((song) => !recent.has(Number(song.id))))
    if (candidates.length === 0) continue
    return candidates.slice(0, 2).map((song) => ({
      ...song,
      source: 'discovery',
      tags: ['新发现', mood.label],
      playableDurationSec: song.free ? song.durationSec : 30,
    }))
  }
  return []
}

function parseSemanticJson(text) {
  const cleaned = String(text ?? '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
  const mood = typeof parsed.mood === 'string' && MOODS[parsed.mood] ? parsed.mood : null
  if (!mood) return null
  const valence = clamp(Number(parsed.valence), 0, 100)
  const arousal = clamp(Number(parsed.arousal), 0, 100)
  if (!Number.isFinite(valence) || !Number.isFinite(arousal)) return null
  const allowedTopicTypes = new Set(['media', 'event', 'work', 'place', 'activity'])
  const genericTopics = new Set([
    '动漫', '动画', '音乐', '歌曲', '歌单', '电影', '游戏', '事情', '工作', '生活', '聊天',
    '网易云', '网易云音乐', '插件', '仓库', '路径', '代码', '补歌', '兜底', '按钮', '进度',
  ])
  const technicalTopic = /网易云|deepseek|dsh|github|插件|仓库|路径|代码|补歌|兜底|按钮|进度|歌单|热门|情绪|电台/i
  const topics = Array.isArray(parsed.topics)
    ? parsed.topics
      .filter((topic) => topic && typeof topic.name === 'string')
      .map((topic) => ({
        type: allowedTopicTypes.has(topic.type) ? topic.type : 'other',
        name: topic.name.trim().slice(0, 40),
        query: typeof topic.query === 'string' ? topic.query.trim().slice(0, 80) : '',
        confidence: clamp(Number(topic.confidence) || 0, 0, 1),
      }))
      .filter((topic) => allowedTopicTypes.has(topic.type)
        && topic.name.length >= 2
        && topic.confidence >= 0.7
        && !genericTopics.has(topic.name)
        && !technicalTopic.test(topic.name)
        && !technicalTopic.test(topic.query))
      .slice(0, 3)
    : []
  return {
    mood,
    valence: round(valence),
    arousal: round(arousal),
    confidence: round(clamp(Number(parsed.confidence) || 60, 30, 96)),
    cues: Array.isArray(parsed.cues)
      ? parsed.cues.filter((cue) => typeof cue === 'string').map((cue) => cue.slice(0, 24)).slice(0, 6)
      : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 180) : '',
    topics,
  }
}

/**
 * Ask the current DSH model for a short, constrained emotion read. This is
 * cached against the last user-message sequence so reopening the panel does not
 * call the model again until the person actually says something new.
 */
async function semanticAnalysis(ctx, session, conversation, state) {
  const userEntries = conversation.entries.filter((entry) => entry.role === 'user')
  if (userEntries.length === 0) return null
  const lastUser = userEntries[userEntries.length - 1]
  const cacheKey = `${session?.id ?? 'unknown'}:${lastUser.seq ?? lastUser.time ?? 0}:v2-topics`
  if (state.analysisCache
    && state.analysisCache.key === cacheKey
    && Date.now() - Number(state.analysisCache.at ?? 0) < 10 * 60 * 1000) {
    return state.analysisCache.semantic ?? null
  }

  const llm = ctx.get('llm')
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
  if (!llm || typeof llm.stream !== 'function' || !selection?.provider || !selection?.model) return null

  const recentUsers = userEntries.slice(-12).map((entry, index) => `用户 ${index + 1}: ${entry.text}`)
  const lastAssistant = [...conversation.entries].reverse().find((entry) => entry.role === 'assistant')
  const context = [
    ...recentUsers,
    lastAssistant ? `助手最后说: ${lastAssistant.text.slice(0, 600)}` : '',
  ].filter(Boolean).join('\n\n')

  const system = [
    '你是只做情绪标注的分析器，不是聊天助手。',
    '阅读用户自己说的话，判断用户此刻的情绪状态和需要，不要被助手的技术解释带偏。',
    '只输出一个 JSON 对象，不要 markdown，不要解释。',
    '格式: {"valence":0到100,"arousal":0到100,"mood":"comfort|calm|warm|focus|uplift|release","confidence":0到100,"cues":["简短线索"],"summary":"一句话概括用户此刻的情绪与需要，主语用你","topics":[{"type":"media|event|work|place|activity|person|other","name":"具体作品/事件/地点/活动名","query":"用于搜歌的短查询","confidence":0到1}]}',
    'valence 越高越愉悦，arousal 越高越激动/紧张；mood 选择最适合调节当下氛围的一种。',
    'topics 只提取用户明确谈到、且适合用来找歌的具体对象：例如「进击的巨人」「毕业论文」「去大阪」「生日」。不要提取泛泛的「动漫」「音乐」「事情」「工作」，也不要提取技术/产品/软件/插件/仓库/路径/代码/按钮/进度这类词。没有具体对象就返回空数组。',
    '对 media（动漫/电影/游戏/剧集）query 用「作品名 主题曲」；event/place/activity 用简短主题词；work/person 可给空 query，让情绪兜底。',
  ].join('\n')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let text = ''
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: selection.reasoningEffort,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: context }] }],
      maxTokens: 900,
      temperature: 0.2,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        return null
      }
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }

  const semantic = parseSemanticJson(text)
  if (semantic) {
    state.analysisCache = { key: cacheKey, at: Date.now(), semantic }
    saveState(state)
  }
  return semantic
}

function buildMood(analysis, state, now, forcedMood, semantic = null) {
  const forced = forcedMood && MOODS[forcedMood] ? forcedMood : null
  let id = forced
  let basis = forced ? 'manual' : 'conversation'
  let confidence = analysis.confidence
  let semanticUsed = false

  if (!id && semantic?.mood && MOODS[semantic.mood]) {
    id = semantic.mood
    basis = 'conversation'
    confidence = semantic.confidence
    semanticUsed = true
  }

  if (!id) {
    if (analysis.signal && analysis.categories.length > 0) {
      const category = analysis.categories[0]
      if (category === 'heartbreak' || category === 'lonely') id = 'comfort'
      else if (category === 'angry') id = 'release'
      else if (category === 'anxious') id = analysis.arousal > 65 ? 'release' : 'calm'
      else if (category === 'tired') id = analysis.valence < 45 ? 'comfort' : 'calm'
      else if (category === 'celebration') id = 'uplift'
      else if (category === 'happy') id = analysis.arousal > 55 ? 'uplift' : 'warm'
      else if (category === 'calm') id = 'calm'
      else if (category === 'romantic') id = 'warm'
    }

    if (!id && analysis.signal) {
      if (analysis.negative > analysis.positive + 1.5) id = 'comfort'
      else if (analysis.positive > analysis.negative + 1.5) id = analysis.arousal > 55 ? 'uplift' : 'warm'
      else if (analysis.high > analysis.low + 1.5) id = 'focus'
      else if (analysis.low > analysis.high + 1.5) id = 'calm'
    }

    if (!id) {
      const last = state.history[0]
      const lastSong = last ? SONGS.find((song) => song.id === last.songId) : null
      if (lastSong) {
        id = moodForSong(lastSong)
        basis = 'last-song'
        confidence = 46
      } else if (state.history.length > 0) {
        id = moodFromProfile(state)
        basis = 'history'
        confidence = 42
      } else {
        id = timeMood(now)
        basis = 'time'
        confidence = 35
      }
    }
  }

  if (!id) id = 'calm'
  const mood = MOODS[id]
  const cues = [...new Set([...(semantic?.cues ?? []), ...analysis.cues])].slice(0, 6)
  return {
    id,
    label: mood.label,
    short: mood.short,
    subtitle: mood.subtitle,
    line: mood.line,
    tags: mood.tags,
    colorA: mood.colorA,
    colorB: mood.colorB,
    target: mood.target,
    valence: semanticUsed
      ? semantic.valence
      : analysis.signal ? analysis.valence : round((mood.target.valence + 55) / 2),
    arousal: semanticUsed
      ? semantic.arousal
      : analysis.signal ? analysis.arousal : round((mood.target.arousal + 38) / 2),
    confidence,
    basis,
    cues,
    categories: analysis.categories,
    summary: semantic?.summary ?? '',
    ai: semanticUsed,
  }
}

function scoreSong(song, mood, profile, state, now, options) {
  const target = { ...mood.target }
  if (options.direction === 'quieter') target.arousal = clamp(target.arousal - 16, 10, 90)
  if (options.direction === 'energy') target.arousal = clamp(target.arousal + 16, 10, 92)

  let score = 100
  score -= Math.abs(song.valence - target.valence) * 0.95
  score -= Math.abs(song.arousal - target.arousal) * 0.9

  for (const item of profile.affinity) {
    if (song.tags.includes(item.tag)) score += Math.min(item.score, 8) * 1.6
  }

  if (song.tags.includes('摇滚') && mood.id !== 'release' && mood.id !== 'uplift') score -= 8
  if (now.getHours() >= 23 && song.arousal > 65) score -= 12
  if (now.getHours() < 7 && song.arousal > 55) score -= 8
  if (mood.id === 'focus' && song.tags.includes('钢琴')) score += 5
  // Keep the experience usable when the account has no black-vinyl membership.
  if (song.free === true) score += 6

  if (state.lastSongId === song.id) score -= 45
  if ((state.recentProgramIds ?? []).includes(song.id)) score -= 24
  const recentIndex = state.history.findIndex((entry) => entry.songId === song.id)
  if (recentIndex >= 0 && recentIndex < 8) score -= (8 - recentIndex) * 3

  // A larger time-seeded jitter keeps near-equal songs from forming a fixed
  // top-five loop across batches.
  score += (hash(`${song.id}:${Math.floor(now.getTime() / 60000)}`) % 100) / 10
  return score
}

function chooseProgram(mood, profile, state, now, options, limit = 5, seedSongs = []) {
  const requested = options.songId ? Number(options.songId) : null
  const exact = requested ? SONGS.find((song) => song.id === requested) : null
  const avoid = new Set(Array.isArray(options.avoid) ? options.avoid.map(Number) : [])
  const recentIds = Array.isArray(state.recentProgramIds) && state.recentProgramIds.length > 0
    ? state.recentProgramIds.slice(0, 12)
    : state.history.slice(0, 12).map((entry) => entry.songId)
  const recent = new Set(recentIds.map(Number))
  let pool = SONGS.filter((song) => !avoid.has(song.id) && !recent.has(song.id))
  // Never make the pool impossible; if the whole catalogue was heard recently,
  // fall back to the full catalogue but keep the scoring penalties below.
  if (pool.length < Math.max(3, limit)) pool = SONGS.filter((song) => !avoid.has(song.id))

  const seeds = (Array.isArray(seedSongs) ? seedSongs : [])
    .filter((song) => song && Number(song.id) > 0 && !avoid.has(Number(song.id)))
    .filter((song) => !recent.has(Number(song.id)))
  const ranked = pool
    .map((song) => ({ song, score: scoreSong(song, mood, profile, state, now, options) }))
    .sort((left, right) => right.score - left.score)

  const ordered = []
  const artists = new Set()
  const add = (song) => {
    if (!song || ordered.some((item) => item.id === song.id)) return
    if (ordered.length > 0 && song.artist && artists.has(song.artist)) return
    ordered.push(song)
    if (song.artist) artists.add(song.artist)
  }
  if (exact) add(exact)
  for (const song of seeds) add(song)
  for (const item of ranked) add(item.song)

  // If artist de-duplication left us short, fill without the artist constraint.
  if (ordered.length < Math.max(1, limit)) {
    for (const item of ranked) {
      if (ordered.length >= limit) break
      if (!ordered.some((song) => song.id === item.song.id)) ordered.push(item.song)
    }
  }
  return ordered.slice(0, Math.max(1, limit))
}

function describeLast(state) {
  const last = state.history[0]
  if (!last) return null
  return {
    title: last.title,
    artist: last.artist,
    tags: last.tags ?? [],
    at: last.at,
  }
}

function sourceLabel(song) {
  if (song?.source === 'topic') return '话题'
  if (song?.source === 'discovery') return '新发现'
  return '曲库'
}

function buildReason(mood, song, basis, state, semantic = null) {
  const cues = mood.cues.slice(0, 3)
  const topicLine = song.source === 'topic' && semantic?.topics?.length
    ? `你刚聊到「${semantic.topics.map((topic) => topic.name).join('、')}」，所以这批先接相关的歌。`
    : ''
  const discoveryLine = song.source === 'discovery'
    ? '这批从曲库外捞了新歌，不再只绕着你听过的那几首转。'
    : ''
  const last = describeLast(state)
  const time = nowLabel()
  const lastSong = last ? SONGS.find((item) => item.id === last.songId) : null
  const move = lastSong == null
    ? '换一个角度'
    : song.arousal < lastSong.arousal - 8
      ? '把能量往下收一点'
      : song.arousal > lastSong.arousal + 8
        ? '把能量往上推一点'
        : '换一个角度'
  const lastLine = last ? `上一首是《${last.title}》，这次${move}。` : ''

  if (basis === 'conversation') {
    const heard = mood.summary
      ? `${mood.summary}`
      : cues.length > 0
        ? `我听到「${cues.join('、')}」这些信号。`
        : '我听到你这次说话的节奏比平时更沉一点。'
    const tail = mood.id === 'release'
      ? '让闷着的那口气先出去。'
      : mood.id === 'uplift'
        ? '把气氛往前推一点。'
        : '不会把情绪推得更高。'
    return `${topicLine}${discoveryLine}${heard}${mood.line}所以选了《${song.title}》——${song.tags.slice(0, 2).join('、')}，${tail}`
  }
  if (basis === 'last-song') {
    const top = profileFromState(state).topTags.slice(0, 2)
    const taste = top.length > 0 ? `你最近的偏好也在往「${top.join('、')}」靠。` : ''
    return `${lastLine}${taste}${mood.line}这首《${song.title}》接着上一首的气质，但把速度放在了更舒服的位置。`
  }
  if (basis === 'history') {
    const top = profileFromState(state).topTags.slice(0, 2)
    return `最近的对话里没有很明显的新情绪。按你以前更常听的${top.length > 0 ? `「${top.join('、')}」` : '那些歌'}，以及${time}的光线，我挑了《${song.title}》。`
  }
  if (basis === 'manual') {
    return `你想把氛围调到「${mood.label}」。这首《${song.title}》的${song.tags.slice(0, 2).join('、')}刚好落在这个区间。`
  }
  return `${time}了，${mood.line}这首《${song.title}》的${song.tags.slice(0, 2).join('、')}，适合把今天慢慢收好。`
}

function regExe() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
}

function cmdExe() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
}

function runCommand(ctx, argv, timeoutMs = 6000, options = {}) {
  const subprocess = ctx.get('subprocess')
  if (!subprocess || typeof subprocess.spawn !== 'function') {
    return Promise.resolve({ code: -1, error: 'subprocess service is unavailable' })
  }
  const capture = options.capture === true
  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve(result)
    }
    let handle
    try {
      handle = subprocess.spawn({
        argv,
        cwd: os.tmpdir(),
        stdio: {
          stdin: 'ignore',
          stdout: capture ? { maxBytes: 64 * 1024 } : 'ignore',
          stderr: capture ? { maxBytes: 16 * 1024 } : 'ignore',
        },
        graceMs: timeoutMs,
      })
    } catch (error) {
      finish({ code: -1, error: error instanceof Error ? error.message : String(error) })
      return
    }
    timer = setTimeout(() => {
      try { handle.terminate() } catch { /* already gone */ }
      finish({ code: -2, error: 'music app launch timed out' })
    }, timeoutMs)
    handle.done.then(
      (outcome) => {
        let text = ''
        let stderr = ''
        if (capture) {
          try { text = handle.collected?.stdout?.readFrom(0).text ?? '' } catch { text = '' }
          try { stderr = handle.collected?.stderr?.readFrom(0).text ?? '' } catch { stderr = '' }
        }
        finish({ code: outcome.exitCode ?? -1, signal: outcome.signal, text, stderr })
      },
      (error) => finish({ code: -1, error: error instanceof Error ? error.message : String(error) }),
    )
  })
}

/** Modern desktop deep-link: base64 of { type, id, cmd }. */
function orpheusUri(song) {
  const command = JSON.stringify({ type: 'song', id: String(song.id), cmd: 'play' })
  return `orpheus://${Buffer.from(command, 'utf8').toString('base64')}`
}

const protocolCache = new Map()

async function hasProtocol(ctx, protocol) {
  if (process.platform !== 'win32') return false
  if (protocolCache.has(protocol)) return protocolCache.get(protocol)
  const result = await runCommand(ctx, [regExe(), 'query', `HKCR\\${protocol}`], 3500)
  const found = result.code === 0
  protocolCache.set(protocol, found)
  return found
}

function powershellExe() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function openUri(ctx, uri) {
  if (process.platform === 'win32') {
    const shell = powershellExe()
    if (fs.existsSync(shell)) {
      const escaped = String(uri).replace(/'/g, "''")
      return runCommand(ctx, [
        shell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command', `Start-Process -FilePath '${escaped}'`,
      ], 8000)
    }
    return runCommand(ctx, [cmdExe(), '/d', '/s', '/c', `start "" "${uri}"`], 8000)
  }
  if (process.platform === 'darwin') return runCommand(ctx, ['open', uri], 8000)
  return runCommand(ctx, ['xdg-open', uri], 8000)
}

const CDP_PORT = Number(process.env.MOOD_DJ_CDP_PORT || 9223)
const CDP_ORIGIN = `http://127.0.0.1:${CDP_PORT}`
const PS_PREFIX = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Text.UTF8Encoding]::new($false);'

function runPowerShell(ctx, script, timeoutMs = 6000) {
  const shell = powershellExe()
  if (!fs.existsSync(shell)) {
    return Promise.resolve({ code: -1, text: '', error: 'powershell.exe not found' })
  }
  return runCommand(ctx, [
    shell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', PS_PREFIX + script,
  ], timeoutMs, { capture: true })
}

async function cdpTargets(timeoutMs = 1600) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${CDP_ORIGIN}/json`, { signal: controller.signal })
    if (!response.ok) return []
    const payload = await response.json()
    return Array.isArray(payload) ? payload : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

async function cdpReady() {
  const targets = await cdpTargets()
  return targets.some((target) => target.type === 'page'
    && target.webSocketDebuggerUrl
    && String(target.url || '').startsWith('orpheus://'))
}

function cdpEval(expression, awaitPromise = true, timeoutMs = 12000) {
  if (typeof WebSocket !== 'function') {
    return Promise.reject(new Error('Node WebSocket client is unavailable'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let ws = null
    let timer = null
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      try { ws?.close() } catch { /* already closed */ }
      if (error) reject(error)
      else resolve(value)
    }
    timer = setTimeout(() => finish(new Error('NetEase CDP evaluation timed out')), timeoutMs)
    cdpTargets(1200).then((targets) => {
      const target = targets.find((item) => item.type === 'page'
        && String(item.url || '').startsWith('orpheus://')
        && String(item.url || '').includes('app.html'))
        ?? targets.find((item) => item.type === 'page'
          && String(item.url || '').startsWith('orpheus://'))
      if (!target?.webSocketDebuggerUrl) {
        finish(new Error('NetEase CDP target not found'))
        return
      }
      try {
        ws = new WebSocket(target.webSocketDebuggerUrl)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
        return
      }
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise },
          }))
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      }
      ws.onmessage = (event) => {
        let message
        try { message = JSON.parse(event.data) } catch { return }
        if (message.id !== 1) return
        const exception = message.result?.exceptionDetails
        if (exception) {
          const description = exception.exception?.description ?? exception.text ?? 'JavaScript exception'
          finish(new Error(String(description).slice(0, 800)))
          return
        }
        finish(null, message.result?.result?.value)
      }
      ws.onerror = () => finish(new Error('NetEase CDP WebSocket failed'))
      ws.onclose = () => finish(new Error('NetEase CDP WebSocket closed before a reply'))
    }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
  })
}

const CDP_BOOTSTRAP = `
  if (typeof window.__gpt_cm_require__ !== 'function') {
    webpackJsonp.push([[987660], { 987660: function (module, exports, require) {
      window.__gpt_cm_require__ = require
    } }, [[987660]]])
  }
  true
`

const CDP_FIND_STORE = `(() => {
  const req = window.__gpt_cm_require__
  for (const [id, module] of Object.entries(req.c || {})) {
    let exports
    try { exports = module && module.exports } catch { continue }
    if (!exports) continue
    for (const candidate of [exports, exports.a, exports.default, exports.Z, exports.z]) {
      try {
        if (candidate && typeof candidate.getStore === 'function' && typeof candidate.getDispatch === 'function') {
          return id
        }
      } catch { /* keep looking */ }
    }
  }
  return null
})()`

async function fetchNetEaseTracks(songs) {
  if (!Array.isArray(songs) || songs.length === 0) return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6500)
  try {
    const ids = songs.map((song) => song.id)
    const response = await fetch(
      `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(ids))}`,
      {
        headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://music.163.com/' },
        signal: controller.signal,
      },
    )
    if (!response.ok) return []
    const payload = await response.json()
    if (!Array.isArray(payload?.songs)) return []
    const byId = new Map(payload.songs.map((track) => [Number(track.id), track]))
    return ids.map((id) => byId.get(Number(id))).filter(Boolean)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

async function isNetEaseRunning(ctx) {
  const result = await runPowerShell(
    ctx,
    'Get-Process cloudmusic -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id',
    5000,
  )
  return result.code === 0 && /\d/.test(result.text || '')
}

async function findNetEaseExe(ctx) {
  const running = await runPowerShell(
    ctx,
    'Get-Process cloudmusic -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path',
    5000,
  )
  const runningPath = String(running.text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  if (runningPath && fs.existsSync(runningPath)) return runningPath

  const registry = await runPowerShell(
    ctx,
    "(Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\\orpheus\\shell\\open\\command').'(default)'",
    5000,
  )
  const match = String(registry.text || '').match(/"([^"]+cloudmusic\.exe)"/i)
  if (match && fs.existsSync(match[1])) return match[1]

  const startApp = await runPowerShell(
    ctx,
    "Get-StartApps | Where-Object { $_.Name -eq '网易云音乐' } | Select-Object -First 1 -ExpandProperty AppID",
    5000,
  )
  const startPath = String(startApp.text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  if (startPath && fs.existsSync(startPath)) return startPath
  return null
}

function escapePowerShell(value) {
  return String(value).replace(/'/g, "''")
}

async function launchNetEaseWithControl(ctx, exe) {
  const script = [
    `$exe = '${escapePowerShell(exe)}'`,
    `$dir = Split-Path -LiteralPath $exe`,
    `Start-Process -FilePath $exe -ArgumentList '--remote-debugging-address=127.0.0.1','--remote-debugging-port=${CDP_PORT}' -WorkingDirectory $dir -WindowStyle Minimized`,
  ].join('; ')
  const result = await runPowerShell(ctx, script, 9000)
  return result.code === 0
}

async function waitForCdp(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cdpReady()) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

/**
 * Play by talking to the desktop client's own Chromium control channel. This
 * dispatches the player action inside the page, so the window is not raised.
 * If the client is running without the channel, we deliberately do not kill it.
 */
async function playViaCdp(ctx, song, queue = [song]) {
  if (process.env.MOOD_DJ_DISABLE_CDP === '1') {
    return { played: false, reason: 'cdp-disabled' }
  }
  if (process.platform !== 'win32') return { played: false, reason: 'unsupported-platform' }
  if (!(await hasProtocol(ctx, 'orpheus'))) return { played: false, reason: 'netease-missing' }

  let ready = await cdpReady()
  if (!ready) {
    if (await isNetEaseRunning(ctx)) {
      return { played: false, reason: 'running-without-cdp' }
    }
    const exe = await findNetEaseExe(ctx)
    if (!exe) return { played: false, reason: 'netease-exe-missing' }
    if (!(await launchNetEaseWithControl(ctx, exe))) {
      return { played: false, reason: 'cdp-launch-failed' }
    }
    ready = await waitForCdp(30000)
    if (!ready) return { played: false, reason: 'cdp-not-ready' }
  }

  try {
    await cdpEval(CDP_BOOTSTRAP, true, 6000)
    const storeId = String(await cdpEval(CDP_FIND_STORE, false, 6000) ?? '')
    if (!storeId) return { played: false, reason: 'store-not-found' }
    const tracks = await fetchNetEaseTracks(queue)
    if (tracks.length === 0) return { played: false, reason: 'track-detail-failed' }

    const from = {
      text: 'Mood Radio',
      href: '',
      resourceType: 'track',
      scene: 'search',
      fromInfo: {
        originalScene: 'search',
        originalResourceType: 'track',
        computeSourceResourceType: 'track',
        sourceData: {},
      },
    }
    const action = {
      type: 'playing/play',
      payload: {
        tracks,
        from,
        options: { clear: true, play: true, playId: song.id, offset: 0 },
        triggerScene: 'search',
        triggerAction: 'playAll',
      },
    }
    const expression = `(async () => {
      const d = __gpt_cm_require__(${JSON.stringify(storeId)}).a.getDispatch()
      await d(${JSON.stringify(action)})
      await new Promise((resolve) => setTimeout(resolve, 420))
      const p = __gpt_cm_require__(${JSON.stringify(storeId)}).a.getStore().playing
      return JSON.stringify({
        current: p.curPlaying?.track?.name ?? null,
        id: p.curPlaying?.track?.id ?? null,
        status: p.playingState,
      })
    })()`
    const raw = await cdpEval(expression, true, 15000)
    const confirmed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Number(confirmed?.id) === song.id) {
      return { played: true, background: true, storeId, confirmed }
    }
    return { played: false, reason: 'play-not-confirmed', detail: confirmed }
  } catch (error) {
    return { played: false, reason: 'cdp-failed', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Append a pre-planned batch to the live queue without clearing it. */
async function appendViaCdp(ctx, queue) {
  if (process.env.MOOD_DJ_DISABLE_CDP === '1') return false
  if (process.platform !== 'win32' || !(await cdpReady())) return false
  try {
    await cdpEval(CDP_BOOTSTRAP, true, 6000)
    const storeId = String(await cdpEval(CDP_FIND_STORE, false, 6000) ?? '')
    if (!storeId) return false
    const tracks = await fetchNetEaseTracks(queue)
    if (tracks.length === 0) return false
    const trackFrom = {
      text: 'Mood Radio',
      href: '',
      resourceType: 'track',
      scene: 'search',
      fromInfo: {
        originalScene: 'search',
        originalResourceType: 'track',
        computeSourceResourceType: 'track',
        sourceData: {},
      },
    }
    const action = {
      type: 'playingList/addItemToCurPlayingList',
      payload: {
        trackList: tracks,
        trackFrom,
        options: { clear: false, play: false, playId: queue[0].id, offset: 0 },
        triggerScene: 'search',
        triggerAction: 'addToPlayList',
      },
    }
    await cdpEval(`(async () => {
      const d = __gpt_cm_require__(${JSON.stringify(storeId)}).a.getDispatch()
      await d(${JSON.stringify(action)})
      return true
    })()`, true, 15000)
    return true
  } catch {
    return false
  }
}

async function restartNetEaseWithControl(ctx) {
  const exe = await findNetEaseExe(ctx)
  if (!exe) {
    return { ok: false, error: '没有找到网易云音乐的可执行文件。' }
  }
  await runPowerShell(ctx, 'Get-Process cloudmusic -ErrorAction SilentlyContinue | Stop-Process -Force', 6000)
  await new Promise((resolve) => setTimeout(resolve, 1400))
  if (!(await launchNetEaseWithControl(ctx, exe))) {
    return { ok: false, error: '网易云音乐没有启动成功。' }
  }
  const ready = await waitForCdp(15000)
  return ready
    ? { ok: true, background: true, exe }
    : { ok: false, error: '网易云音乐已启动，但后台控制端口没有就绪。' }
}

function knownExecutables() {
  const candidates = []
  const local = process.env.LOCALAPPDATA
  const roaming = process.env.APPDATA
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (local) {
    candidates.push({ id: 'netease', name: '网易云音乐', path: path.join(local, 'Programs', 'Netease', 'CloudMusic', 'cloudmusic.exe'), exact: true })
    candidates.push({ id: 'qqmusic', name: 'QQ音乐', path: path.join(local, 'Programs', 'QQMusic', 'QQMusic.exe'), exact: false })
  }
  if (roaming) candidates.push({ id: 'spotify', name: 'Spotify', path: path.join(roaming, 'Spotify', 'Spotify.exe'), exact: false })
  for (const base of [programFiles, programFilesX86]) {
    if (!base) continue
    candidates.push({ id: 'netease', name: '网易云音乐', path: path.join(base, 'Netease', 'CloudMusic', 'cloudmusic.exe'), exact: true })
    candidates.push({ id: 'qqmusic', name: 'QQ音乐', path: path.join(base, 'Tencent', 'QQMusic', 'QQMusic.exe'), exact: false })
    candidates.push({ id: 'kugou', name: '酷狗音乐', path: path.join(base, 'KuGou', 'KGMusic', 'KuGou.exe'), exact: false })
    candidates.push({ id: 'kuwo', name: '酷我音乐', path: path.join(base, 'Kuwo', 'KuwoMusic', 'kwmusic.exe'), exact: false })
  }
  return candidates
}

const APP_DEFINITIONS = [
  {
    id: 'netease',
    name: '网易云音乐',
    protocol: 'orpheus',
    exact: true,
    uri: (song) => orpheusUri(song),
    args: (song) => [`--webcmd=${orpheusUri(song)}`],
  },
  {
    id: 'qqmusic',
    name: 'QQ音乐',
    protocol: 'qqmusic',
    exact: false,
    uri: () => 'qqmusic://',
    args: () => [],
  },
  {
    id: 'spotify',
    name: 'Spotify',
    protocol: 'spotify',
    exact: false,
    uri: (song) => `spotify:search:${encodeURIComponent(`${song.title} ${song.artist}`)}`,
    args: () => [],
  },
]

async function launchSong(ctx, song, queue = [song]) {
  let background = await playViaCdp(ctx, song, queue)
  // A cold start can take longer than the first CDP window. Restart once with
  // the control channel rather than silently falling back to a popup deep link.
  if (!background.played && (background.reason === 'cdp-not-ready' || background.reason === 'cdp-launch-failed')) {
    const restarted = await restartNetEaseWithControl(ctx)
    if (restarted.ok) background = await playViaCdp(ctx, song, queue)
  }
  if (background.played) {
    return {
      id: 'netease',
      name: '网易云音乐',
      protocol: 'cdp',
      uri: null,
      launched: true,
      exact: true,
      background: true,
      warning: null,
      control: 'background',
      queueLength: queue.length,
    }
  }

  for (const app of APP_DEFINITIONS) {
    if (!(await hasProtocol(ctx, app.protocol))) continue
    const uri = app.uri(song)
    const result = await openUri(ctx, uri)
    const fallbackWarning = background.reason === 'running-without-cdp'
      ? '后台控制未开启；本次用深链播放，可能弹出网易云窗口。可在面板里一键开启后台切歌。'
      : result.code === 0
        ? (app.exact ? null : '已打开应用，但需要在应用里确认播放。')
        : (result.error ?? `启动失败（exit ${result.code}）`)
    return {
      id: app.id,
      name: app.name,
      protocol: app.protocol,
      uri,
      launched: result.code === 0,
      exact: app.exact,
      background: false,
      reason: background.reason ?? null,
      control: 'deeplink',
      warning: fallbackWarning,
      queueLength: 1,
    }
  }

  for (const candidate of knownExecutables()) {
    if (!fs.existsSync(candidate.path)) continue
    const args = candidate.id === 'netease'
      ? [`--webcmd=${orpheusUri(song)}`]
      : []
    const result = await runCommand(ctx, [candidate.path, ...args], 6000)
    return {
      id: candidate.id,
      name: candidate.name,
      protocol: 'executable',
      uri: candidate.path,
      launched: result.code === 0,
      exact: candidate.exact,
      background: false,
      reason: background.reason ?? null,
      control: 'executable',
      warning: result.code === 0
        ? (candidate.exact ? null : '已打开应用，请在应用里确认播放。')
        : (result.error ?? `启动失败（exit ${result.code}）`),
      queueLength: 1,
    }
  }

  return {
    id: 'none',
    name: '未找到音乐软件',
    protocol: null,
    uri: null,
    launched: false,
    exact: false,
    background: false,
    reason: background.reason ?? null,
    control: 'none',
    warning: '没有检测到网易云音乐、QQ音乐或 Spotify。请先安装并登录一个音乐客户端。',
    queueLength: 0,
  }
}

function rememberProgram(state, program) {
  const ids = program.map((song) => Number(song.id)).filter((id) => id > 0)
  state.recentProgramIds = [...new Set([...ids, ...(state.recentProgramIds ?? [])])].slice(0, 40)
  saveState(state)
}

function recordPlay(state, song, mood, app) {
  state.history.unshift({
    at: Date.now(),
    songId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    tags: song.tags,
    mood: mood.id,
    moodLabel: mood.label,
    app: app.id,
    verdict: null,
  })
  state.history = state.history.slice(0, 60)
  state.lastSongId = song.id
  state.plays = (state.plays ?? 0) + 1
  saveState(state)
}

function applyFeedback(state, songId, verdict) {
  const entry = state.history.find((item) => item.songId === Number(songId))
  if (entry) entry.verdict = verdict
  saveState(state)
}

function publicHistory(state, limit = 8) {
  return state.history.slice(0, limit).map((entry) => ({
    at: entry.at,
    songId: entry.songId,
    title: entry.title,
    artist: entry.artist,
    mood: entry.mood,
    moodLabel: entry.moodLabel,
    tags: entry.tags ?? [],
    verdict: entry.verdict ?? null,
  }))
}

async function buildPayload(ctx, body, state) {
  const sessions = ctx.get('sessions')
  if (!sessions) {
    throw Object.assign(new Error('会话服务不可用，无法读取当前对话。'), { code: 'NO_SESSIONS' })
  }
  const session = latestSession(sessions, body.sessionId)
  const conversation = collectConversation(session)
  const analysis = scoreEntries(conversation.entries)
  const now = new Date()
  const forcedMood = typeof body.mood === 'string' && MOODS[body.mood] ? body.mood : null
  const semantic = await semanticAnalysis(ctx, session, conversation, state)
  const mood = buildMood(analysis, state, now, forcedMood, semantic)
  const initialProfile = profileFromState(state)
  const topicSongs = await resolveTopicSongs(ctx, semantic, state)
  const discoverySongs = await resolveDiscoverySongs(ctx, mood, state)
  const program = chooseProgram(mood, initialProfile, state, now, {
    avoid: Array.isArray(body.avoid) ? body.avoid : [],
    songId: body.songId,
    direction: body.direction,
  }, 5, [...topicSongs, ...discoverySongs])
  const song = program[0]
  const reason = buildReason(mood, song, mood.basis, state, semantic)
  const preview = body.preview === true
  const append = body.append === true
  let app
  if (preview) {
    app = { id: 'preview', name: '预览模式', protocol: null, uri: null, launched: true, exact: true, warning: null, queueLength: program.length }
  } else if (append) {
    const appended = await appendViaCdp(ctx, program)
    app = appended
      ? {
          id: 'netease',
          name: '网易云音乐',
          protocol: 'cdp',
          uri: null,
          launched: true,
          exact: true,
          background: true,
          warning: null,
          control: 'append',
          appended: true,
          queueLength: program.length,
        }
      : {
          ...(await launchSong(ctx, song, program)),
          appended: false,
          warning: '追加队列失败，已改为播放新的一批。',
        }
  } else {
    app = await launchSong(ctx, song, program)
  }
  if (!preview && app.launched && song.free !== true && app.warning === null) {
    app.warning = '这首歌可能需要黑胶 VIP；非会员会自动进入试听。'
  }

  if (!preview && !append && app.launched) recordPlay(state, song, mood, app)
  if (!preview && app.launched) rememberProgram(state, program)
  if (!preview && !app.launched) saveState(state)
  const finalProfile = profileFromState(state)

  return {
    mood: {
      id: mood.id,
      label: mood.label,
      short: mood.short,
      subtitle: mood.subtitle,
      line: mood.line,
      tags: mood.tags,
      colorA: mood.colorA,
      colorB: mood.colorB,
      valence: mood.valence,
      arousal: mood.arousal,
      confidence: mood.confidence,
      basis: mood.basis,
      cues: mood.cues,
      categories: mood.categories,
      summary: mood.summary,
      ai: mood.ai,
      topics: semantic?.topics ?? [],
    },
    song: {
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      tags: song.tags,
      valence: song.valence,
      arousal: song.arousal,
      free: song.free === true,
      source: song.source ?? 'library',
      sourceLabel: sourceLabel(song),
    },
    reason,
    app,
    profile: {
      ...finalProfile,
      history: publicHistory(state),
    },
    history: publicHistory(state),
    queue: program.slice(1).map((item) => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      durationSec: item.durationSec,
      playableDurationSec: item.playableDurationSec,
      source: item.source ?? 'library',
      sourceLabel: sourceLabel(item),
    })),
    queuePreview: program.some((item) => item.free !== true),
    queueDurationSec: program.reduce((sum, item) => sum + (item.playableDurationSec ?? 30), 0),
    conversation: {
      messages: conversation.entries.length,
      userMessages: conversation.userMessages,
      sessionId: session?.id ?? null,
      lastUserSeq: [...conversation.entries].reverse().find((entry) => entry.role === 'user')?.seq ?? null,
      hasEmotionSignal: analysis.signal,
    },
    playedAt: Date.now(),
    preview,
  }
}

/** Strong, user-authored emotional cues that deserve an immediate song. */
function detectEmotionCue(text) {
  const cleaned = String(text ?? '').replace(/麻烦/g, '')
  if (cleaned.length > 160 && !/好烦|烦死|想哭|崩溃/.test(cleaned)) return null
  const match = cleaned.match(/好烦|烦死|烦人|烦躁|心烦|心累|好累|累死|难受|崩溃|焦虑|压力(?:好|很|太)?大|不开心|难过|想哭|失眠|孤独|委屈|气死|生气|无聊|害怕|紧张|开心|高兴|太好了|爽|舒服/)
  return match ? match[0] : null
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  })
  res.end(payload)
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function methodNotAllowed(res, allowed) {
  res.writeHead(405, { allow: allowed.join(', '), 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: `Use ${allowed.join(' or ')}.` } }))
}

/**
 * Plugin entry. The web server is optional so a headless profile never fails
 * to load just because this is a browser-facing bundle.
 */
export function apply(ctx) {
  let radioTimer = null
  let radioRefilling = false

  const clearRadioTimer = () => {
    if (radioTimer !== null) {
      clearInterval(radioTimer)
      radioTimer = null
    }
  }

  const leadMsFor = (durationMs) => clamp(durationMs * 0.12, 60_000, 150_000)

  async function playbackSnapshot(ctx) {
    if (process.platform !== 'win32' || !(await cdpReady())) return null
    try {
      await cdpEval(CDP_BOOTSTRAP, true, 5000)
      const storeId = String(await cdpEval(CDP_FIND_STORE, false, 5000) ?? '')
      if (!storeId) return null
      const raw = await cdpEval(`(() => {
        const s = __gpt_cm_require__(${JSON.stringify(storeId)}).a.getStore()
        const p = s.playing
        const queue = (s.playingList || {}).curPlayingList || []
        const currentId = String(p.curPlaying?.track?.id ?? '')
        const index = queue.findIndex((item) => String(item?.track?.id ?? item?.resourceId ?? '') === currentId)
        return JSON.stringify({
          current: p.curPlaying?.track?.name ?? null,
          id: p.curPlaying?.track?.id ?? null,
          status: p.playingState,
          durationSec: p.resourceDuration ?? null,
          queueLength: queue.length,
          currentIndex: index,
          remaining: index >= 0 ? queue.length - index - 1 : queue.length,
        })
      })()`, false, 7000)
      return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      return null
    }
  }

  async function startRadio(ctx, sessionId) {
    const state = loadState()
    if (state.radio?.enabled && (!sessionId || state.radio.sessionId === sessionId)) {
      armRadioTimer(ctx)
      return { already: true, radio: state.radio }
    }
    const data = await buildPayload(ctx, { sessionId }, state)
    const durationMs = Math.max(60_000, Number(data.queueDurationSec ?? 0) * 1000)
    const now = Date.now()
    const fresh = loadState()
    const previewBatch = data.queuePreview === true
    fresh.radio = {
      enabled: true,
      autoRefill: true,
      sessionId: data.conversation.sessionId,
      startedAt: now,
      queueEndsAt: now + durationMs,
      nextRefillAt: now + durationMs - (previewBatch ? 0 : leadMsFor(durationMs)),
      lastRefillAt: now,
      lastUserSeq: data.conversation.lastUserSeq ?? null,
      lastCueAt: null,
      queueDurationSec: Math.round(durationMs / 1000),
      previewBatch,
      status: data.app?.launched === false ? 'error' : 'playing',
    }
    saveState(fresh)
    armRadioTimer(ctx)
    return { already: false, radio: fresh.radio, data }
  }

  function stopRadio(ctx) {
    clearRadioTimer()
    const state = loadState()
    if (state.radio) {
      state.radio.enabled = false
      state.radio.status = 'stopped'
      state.radio.stoppedAt = Date.now()
      saveState(state)
    }
    return state.radio
  }

  async function refillRadio(ctx, replace = false) {
    if (radioRefilling) return
    radioRefilling = true
    try {
      const state = loadState()
      const r = state.radio
      if (!r?.enabled || r.autoRefill === false) return
      r.status = 'refilling'
      saveState(state)
      const data = await buildPayload(ctx, {
        sessionId: r.sessionId,
        append: !replace,
      }, state)
      const durationMs = Math.max(60_000, Number(data.queueDurationSec ?? 0) * 1000)
      const fresh = loadState()
      if (!fresh.radio) return
      const appended = data.app?.appended === true
      const base = appended
        ? Math.max(Date.now(), Number(fresh.radio.queueEndsAt) || Date.now())
        : Date.now()
      fresh.radio.queueEndsAt = base + durationMs
      fresh.radio.nextRefillAt = fresh.radio.queueEndsAt - leadMsFor(durationMs)
      fresh.radio.lastRefillAt = Date.now()
      fresh.radio.lastUserSeq = data.conversation.lastUserSeq ?? fresh.radio.lastUserSeq
      fresh.radio.queueDurationSec = Math.round(durationMs / 1000)
      fresh.radio.previewBatch = data.queuePreview === true
      fresh.radio.status = data.app?.launched === false ? 'error' : 'playing'
      saveState(fresh)
    } catch {
      const state = loadState()
      if (state.radio?.enabled) {
        state.radio.status = 'error'
        state.radio.nextRefillAt = Date.now() + 60_000
        saveState(state)
      }
    } finally {
      radioRefilling = false
    }
  }

  async function tickRadio(ctx) {
    if (radioRefilling) return
    const state = loadState()
    const r = state.radio
    if (!r?.enabled || r.status === 'stopped') {
      clearRadioTimer()
      return
    }
    if (r.autoRefill === false) return
    const snap = await playbackSnapshot(ctx)
    if (snap) {
      if (snap.status === 1) {
        // Preview batches end in a paused state. Only refill when the queue is
        // actually exhausted; a user pausing halfway must be respected.
        if ((snap.remaining ?? snap.queueLength ?? 0) <= 0) await refillRadio(ctx, true)
        return
      }
      if (snap.status === 0 || (snap.queueLength ?? 0) === 0) {
        await refillRadio(ctx, true)
        return
      }
      if (!r.previewBatch && (snap.queueLength ?? 0) <= 1) {
        await refillRadio(ctx, false)
        return
      }
    }
    if (Date.now() >= Number(r.nextRefillAt ?? 0)) {
      // For VIP preview batches, do not replace the last preview while it is
      // still playing; wait for its natural paused/stopped end.
      if (r.previewBatch && snap?.status === 2) return
      await refillRadio(ctx, r.previewBatch === true)
    }
  }

  function armRadioTimer(ctx) {
    if (radioTimer !== null) return
    radioTimer = setInterval(() => { void tickRadio(ctx) }, 10_000)
  }

  ctx.effect(() => () => clearRadioTimer(), 'mood-dj: radio timer')

  const bootState = loadState()
  if (bootState.radio?.enabled) armRadioTimer(ctx)

  // A strong cue only updates the collection window. The next batch is chosen
  // at the refill boundary, so the current song is never cut off mid-way.
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return
    const message = event.data
    if (message?.source?.kind !== 'user') return
    const cue = detectEmotionCue(textFromContent(message.content))
    if (!cue) return
    const state = loadState()
    if (!state.radio?.enabled) return
    state.radio.lastCueAt = Date.now()
    state.radio.lastCueCue = cue
    saveState(state)
  }), 'mood-dj: emotional cue collection')

  ctx.inject(['webServer'], (webCtx) => {
    const make = (methods, handler) => async (req, res) => {
      if (req.method === 'OPTIONS') {
        json(res, 204, {})
        return
      }
      if (!methods.includes(req.method ?? '')) {
        methodNotAllowed(res, methods)
        return
      }
      try {
        const body = req.method === 'POST' ? await readJson(req) : {}
        json(res, 200, await handler(body))
      } catch (error) {
        const code = error && error.code ? error.code : 'MOOD_DJ_FAILED'
        json(res, 200, {
          ok: false,
          error: {
            code,
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
    }

    webCtx.effect(() => {
      const routes = [
        [`${ROUTE}/state`, make(['GET'], async () => {
          const state = loadState()
          return { ok: true, data: { profile: profileFromState(state), history: publicHistory(state) } }
        })],
        [`${ROUTE}/run`, make(['POST'], async (body) => {
          const state = loadState()
          const data = await buildPayload(ctx, body, state)
          return { ok: true, data }
        })],
        [`${ROUTE}/radio/start`, make(['POST'], async (body) => {
          const result = await startRadio(ctx, body.sessionId)
          return { ok: true, data: { radio: result.radio, program: result.data ?? null } }
        })],
        [`${ROUTE}/radio/stop`, make(['POST'], async () => {
          const radio = stopRadio(ctx)
          return { ok: true, data: { radio } }
        })],
        [`${ROUTE}/radio/status`, make(['GET'], async () => {
          const state = loadState()
          return { ok: true, data: { radio: state.radio ?? null } }
        })],
        [`${ROUTE}/radio/autorefill`, make(['POST'], async (body) => {
          const state = loadState()
          if (!state.radio) {
            return { ok: false, error: { code: 'RADIO_NOT_STARTED', message: '先开启情绪采集。' } }
          }
          state.radio.autoRefill = body.enabled !== false
          if (state.radio.autoRefill) armRadioTimer(ctx)
          saveState(state)
          return { ok: true, data: { radio: state.radio } }
        })],
        [`${ROUTE}/now`, make(['GET'], async () => {
          const snap = await playbackSnapshot(ctx)
          if (!snap) return { ok: true, data: { song: null, status: 'unknown', queueLength: 0 } }
          const known = SONGS.find((song) => song.id === Number(snap.id))
          return {
            ok: true,
            data: {
              song: known
                ? {
                    id: known.id,
                    title: known.title,
                    artist: known.artist,
                    album: known.album,
                    tags: known.tags,
                    free: known.free === true,
                  }
                : snap.current
                  ? { id: Number(snap.id) || null, title: snap.current, artist: null, album: null, tags: [] }
                  : null,
              status: snap.status,
              queueLength: snap.queueLength,
            },
          }
        })],
        [`${ROUTE}/restart`, make(['POST'], async () => {
          const result = await restartNetEaseWithControl(ctx)
          if (!result.ok) {
            return { ok: false, error: { code: 'RESTART_FAILED', message: result.error } }
          }
          return { ok: true, data: { background: true, exe: result.exe } }
        })],
        [`${ROUTE}/feedback`, make(['POST'], async (body) => {
          const verdict = body.verdict === 'like' ? 'like' : body.verdict === 'skip' ? 'skip' : null
          if (!verdict || body.songId === undefined) {
            return { ok: false, error: { code: 'BAD_FEEDBACK', message: 'feedback needs songId and verdict=like|skip' } }
          }
          const state = loadState()
          applyFeedback(state, body.songId, verdict)
          return { ok: true, data: { profile: profileFromState(state), history: publicHistory(state) } }
        })],
      ]
      const disposers = routes.map(([routePath, handler]) => webCtx.webServer.register({
        kind: 'exact',
        path: routePath,
        handler,
      }))
      return () => { for (const dispose of disposers) dispose() }
    }, 'mood-dj: sidebar routes')
  })
}
