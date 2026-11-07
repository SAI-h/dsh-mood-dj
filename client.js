/**
 * 心绪电台 / Mood Radio — Client half.
 *
 * A global panel icon in the left sidebar opens a full page that asks the Host
 * half to read the latest conversation, choose a song, and hand it to NetEase
 * Cloud Music (or another installed player). The page intentionally runs the
 * first request on open: opening the radio is the user's "play" gesture.
 */

window.__ModuleLoader__.load({
  id: 'mood-dj',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const h = React.createElement

    const ROUTE = '/mood-dj'
    const BASIS_LABEL = {
      conversation: '从刚才的对话里听出来的',
      'last-song': '顺着上一首的余温',
      history: '按你以往的偏好',
      time: '按此刻的时间与光线',
      manual: '你手动选的氛围',
    }

    async function request(path, options = {}) {
      const response = await fetch(`${ROUTE}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload === null) {
        throw new Error(`心绪电台暂时没有回应（HTTP ${response.status}）`)
      }
      if (payload.ok === false) {
        throw new Error(payload.error?.message ?? '心绪电台没有完成这次播放')
      }
      return payload.data
    }

    function clamp(value) {
      return Math.min(100, Math.max(0, Number(value) || 0))
    }

    function relativeTime(timestamp) {
      if (!timestamp) return ''
      const diff = Date.now() - timestamp
      if (diff < 60_000) return '刚刚'
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
      const date = new Date(timestamp)
      return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }

    /** Custom side-rail glyph: a small record + note, not a shipped icon. */
    function MusicGlyph({ size = 18, active = false }) {
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: { display: 'block', flex: 'none' },
      },
      h('circle', { cx: 10, cy: 13, r: 6.2, stroke: color, strokeWidth: 1.7, opacity: active ? 1 : 0.9 }),
      h('circle', { cx: 10, cy: 13, r: 1.7, fill: color }),
      h('path', {
        d: 'M16.2 4.4v8.4M16.2 4.4l4.1-1v8.1',
        stroke: color,
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 18.4, cy: 14.4, r: 2.2, stroke: color, strokeWidth: 1.7 }),
      h('path', { d: 'M16.2 8.1l4.1-1', stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    function SongArt({ mood, song }) {
      return h('div', {
        className: 'mdj-art',
        style: { '--mdj-a': mood.colorA, '--mdj-b': mood.colorB },
        'aria-hidden': 'true',
      },
      h('div', { className: 'mdj-art-glow' }),
      h('div', { className: 'mdj-vinyl' },
        h('span', { className: 'mdj-groove mdj-groove-one' }),
        h('span', { className: 'mdj-groove mdj-groove-two' }),
        h('span', { className: 'mdj-groove mdj-groove-three' }),
        h('div', { className: 'mdj-label' },
          h('span', { className: 'mdj-label-top' }, mood.short),
          h('span', { className: 'mdj-label-rule' }),
          h('span', { className: 'mdj-label-bottom' }, 'MOOD RADIO')),
        h('span', { className: 'mdj-spindle' })),
      h('div', { className: 'mdj-art-caption' },
        h('span', null, mood.label),
        h('span', { className: 'mdj-art-id' }, `NO.${String(song.id).slice(-4)}`)))
    }

    function Meter({ label, value, hint }) {
      return h('div', { className: 'mdj-meter' },
        h('div', { className: 'mdj-meter-head' },
          h('span', null, label),
          h('span', { className: 'mdj-meter-value' }, `${clamp(value)}${hint ? ` · ${hint}` : ''}`)),
        h('div', {
          className: 'mdj-meter-track',
          role: 'progressbar',
          'aria-label': label,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': clamp(value),
        }, h('span', { className: 'mdj-meter-fill', style: { width: `${clamp(value)}%` } })))
    }

    function Tag({ children, subtle = false }) {
      return h('span', { className: subtle ? 'mdj-tag mdj-tag-subtle' : 'mdj-tag' }, children)
    }

    function LoadingCard() {
      return h('section', { className: 'mdj-loading', 'aria-label': '正在听你的对话' },
        h('div', { className: 'mdj-loading-art' }),
        h('div', { className: 'mdj-loading-lines' },
          h('span', { className: 'mdj-skeleton mdj-skeleton-short' }),
          h('span', { className: 'mdj-skeleton mdj-skeleton-title' }),
          h('span', { className: 'mdj-skeleton' }),
          h('span', { className: 'mdj-skeleton mdj-skeleton-soft' })),
        h('p', { className: 'mdj-loading-copy' }, '正在读最近的对话，选一首适合此刻的歌…'))
    }

    function ErrorCard({ message, onRetry }) {
      return h('section', { className: 'mdj-empty' },
        h('div', { className: 'mdj-empty-mark' }, h(MusicGlyph, { size: 32 })),
        h('h2', null, '这次没接上'),
        h('p', null, message),
        h('p', { className: 'mdj-muted' }, '播放需要本机音乐客户端和 DSH 的本地服务同时在线。'),
        h('button', { type: 'button', className: 'mdj-btn mdj-btn-primary', onClick: onRetry }, '再试一次'))
    }

    function RadioBar({ radio, busy, onToggle, autoRefillBusy, onToggleAutoRefill }) {
      const enabled = radio?.enabled === true
      const autoRefill = radio?.autoRefill !== false
      const refillAt = radio?.nextRefillAt
        ? new Date(radio.nextRefillAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : null
      const detail = enabled
        ? `采集中 · 队列约 ${Math.max(1, Math.round((radio?.queueDurationSec ?? 0) / 60))} 分钟${autoRefill && refillAt ? ` · ${refillAt} 补歌` : autoRefill ? '' : ' · 自动补歌已关闭'}`
        : '关闭时只在你点按钮后播放，不会自动采集对话'
      return h('div', { className: enabled ? 'mdj-radiobar is-on' : 'mdj-radiobar' },
        h('div', { className: 'mdj-radiobar-main' },
          h('div', { className: 'mdj-radiobar-copy' },
            h('strong', null, enabled ? '在对话中采集情绪' : '情绪采集已关闭'),
            h('span', null, detail)),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': enabled,
            'aria-label': '在对话中采集情绪',
            className: enabled ? 'mdj-switch is-on' : 'mdj-switch',
            onClick: onToggle,
            disabled: busy,
          }, h('span', { className: 'mdj-switch-thumb' }))),
        enabled && h('div', { className: 'mdj-radiobar-sub' },
          h('div', { className: 'mdj-radiobar-subcopy' },
            h('strong', null, '自动补歌'),
            h('span', null, autoRefill
              ? '队列快结束时自动分析并接下一批'
              : '已关闭，当前队列播完就停')),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': autoRefill,
            'aria-label': '自动补歌',
            className: autoRefill ? 'mdj-switch mdj-switch-small is-on' : 'mdj-switch mdj-switch-small',
            onClick: onToggleAutoRefill,
            disabled: autoRefillBusy,
          }, h('span', { className: 'mdj-switch-thumb' }))))
    }

    function AppStatus({ app, queueLength, onEnableBackground, backgroundBusy }) {
      const warning = app?.warning
      const live = Boolean(app?.launched)
      const background = app?.background === true
      const canEnable = live && app?.reason === 'running-without-cdp' && typeof onEnableBackground === 'function'
      const tone = live && (background || !canEnable) ? 'mdj-app-ok' : 'mdj-app-warn'
      const queueCount = Number(queueLength ?? app?.queueLength ?? 0)
      return h('div', { className: `mdj-app ${tone}` },
        h('span', { className: 'mdj-app-dot', 'aria-hidden': 'true' }),
        h('div', { className: 'mdj-app-copy' },
          h('strong', null, live
            ? (background
              ? `已在 ${app.name} 后台播放`
              : app.exact ? `已交给 ${app.name} 播放` : `已打开 ${app.name}`)
            : '音乐软件没有启动'),
          h('span', null, warning ?? (background
            ? `切歌不会把客户端带到前台。${queueCount > 1 ? ` 队列 ${queueCount} 首，播完自动续。` : ''}`
            : app.exact
              ? '桌面客户端会从这首歌开始播放。'
              : '应用已打开，请在客户端里确认播放。'))),
        canEnable && h('button', {
          type: 'button',
          className: 'mdj-chip mdj-app-action',
          onClick: onEnableBackground,
          disabled: backgroundBusy,
        }, backgroundBusy ? '正在重启…' : '开启后台切歌'))
    }

    function HistoryList({ history, profile }) {
      if (!Array.isArray(history) || history.length === 0) {
        return h('div', { className: 'mdj-history-empty' },
          h(MusicGlyph, { size: 22 }),
          h('span', null, '还没有播放记录。第一首之后，这里会慢慢长出你的偏好。'))
      }
      return h('ul', { className: 'mdj-history-list' },
        history.map((entry) => h('li', { className: 'mdj-history-row', key: `${entry.at}-${entry.songId}` },
          h('span', { className: 'mdj-history-time' }, relativeTime(entry.at)),
          h('span', { className: 'mdj-history-dot', 'data-mood': entry.mood, 'aria-hidden': 'true' }),
          h('span', { className: 'mdj-history-song' },
            h('strong', null, entry.title),
            h('span', null, ` · ${entry.artist}`)),
          h('span', { className: 'mdj-history-mood' }, entry.moodLabel ?? ''),
          entry.verdict === 'like'
            ? h('span', { className: 'mdj-history-verdict' }, '喜欢')
            : entry.verdict === 'skip'
              ? h('span', { className: 'mdj-history-verdict mdj-history-verdict-skip' }, '跳过')
              : h('span', { className: 'mdj-history-verdict mdj-history-verdict-empty' }, ''))))
    }

    // Keep the last program across panel unmounts and page reloads. The sidebar
    // can reopen the same panel many times; that should not silently change the
    // song every time. A stale program expires after six hours so a new day
    // still gets a fresh read of the conversation.
    const PROGRAM_CACHE_KEY = 'mood-dj:last-program'
    const PROGRAM_CACHE_TTL = 6 * 60 * 60 * 1000

    function readCachedProgram() {
      try {
        const raw = window.localStorage.getItem(PROGRAM_CACHE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.at !== 'number' || Date.now() - parsed.at > PROGRAM_CACHE_TTL) {
          window.localStorage.removeItem(PROGRAM_CACHE_KEY)
          return null
        }
        return parsed.program ?? null
      } catch {
        return null
      }
    }

    function writeCachedProgram(program) {
      try {
        window.localStorage.setItem(PROGRAM_CACHE_KEY, JSON.stringify({ at: Date.now(), program }))
      } catch {
        // Storage can be unavailable under strict browser privacy settings.
      }
    }

    let lastProgram = readCachedProgram()
    let autoRunStarted = false

    function MoodPanel(props) {
      const [data, setData] = useState(lastProgram)
      const [phase, setPhase] = useState(lastProgram === null ? 'loading' : 'ready')
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState(null)
      const [radio, setRadio] = useState(null)
      const [radioBusy, setRadioBusy] = useState(false)
      const [autoRefillBusy, setAutoRefillBusy] = useState(false)
      const [now, setNow] = useState(null)
      const mounted = useRef(true)
      const usePanelInfo = typeof props?.usePanelInfo === 'function'
        ? props.usePanelInfo
        : (selector) => selector({ activePanelId: 'mood-dj' })
      const active = usePanelInfo((info) => info.activePanelId === 'mood-dj')

      useEffect(() => () => { mounted.current = false }, [])

      useEffect(() => {
        let alive = true
        request('/radio/status')
          .then((result) => { if (alive) setRadio(result.radio ?? null) })
          .catch(() => { /* status is optional until the user uses the switch */ })
        return () => { alive = false }
      }, [])

      useEffect(() => {
        if (!active) return undefined
        let alive = true
        const poll = async () => {
          try {
            const result = await request('/now')
            if (alive) setNow(result)
          } catch {
            // The client may be closed; keep the last known song.
          }
        }
        poll()
        const timer = window.setInterval(poll, 5000)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [active])

      const toggleRadio = useCallback(async () => {
        if (radioBusy) return
        setRadioBusy(true)
        setError(null)
        try {
          if (radio?.enabled) {
            const result = await request('/radio/stop', { method: 'POST', body: {} })
            if (!mounted.current) return
            setRadio(result.radio ?? null)
            setToast('已停止采集；当前这首会继续放完。')
          } else {
            const result = await request('/radio/start', { method: 'POST', body: {} })
            if (!mounted.current) return
            setRadio(result.radio ?? null)
            if (result.program) {
              lastProgram = result.program
              writeCachedProgram(result.program)
              setData(result.program)
              setPhase('ready')
            }
            setToast('情绪采集已开启：这批歌播完前会自动分析并补下一批。')
          }
        } catch (caught) {
          if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          if (mounted.current) setRadioBusy(false)
        }
      }, [radio, radioBusy])

      const toggleAutoRefill = useCallback(async () => {
        if (!radio?.enabled || autoRefillBusy) return
        setAutoRefillBusy(true)
        setError(null)
        try {
          const result = await request('/radio/autorefill', {
            method: 'POST',
            body: { enabled: radio.autoRefill === false },
          })
          if (!mounted.current) return
          setRadio(result.radio ?? null)
          setToast(result.radio?.autoRefill === false
            ? '自动补歌已关闭：当前队列播完就停。'
            : '自动补歌已开启。')
        } catch (caught) {
          if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          if (mounted.current) setAutoRefillBusy(false)
        }
      }, [autoRefillBusy, radio])

      useEffect(() => {
        if (!toast) return undefined
        const timer = window.setTimeout(() => setToast(null), 2800)
        return () => window.clearTimeout(timer)
      }, [toast])

      const run = useCallback(async (body) => {
        setBusy(true)
        setError(null)
        try {
          const next = await request('/run', { method: 'POST', body: { action: 'play', ...body } })
          if (!mounted.current) return
          lastProgram = next
          writeCachedProgram(next)
          setData(next)
          setPhase('ready')
        } catch (caught) {
          if (!mounted.current) return
          if (lastProgram === null) autoRunStarted = false
          setError(caught instanceof Error ? caught.message : String(caught))
          setPhase((current) => current === 'loading' ? 'error' : current)
        } finally {
          if (mounted.current) setBusy(false)
        }
      }, [])

      useEffect(() => {
        if (!active || autoRunStarted) return
        autoRunStarted = true
        if (lastProgram !== null) {
          setData(lastProgram)
          setPhase('ready')
          return
        }
        run({})
      }, [active, run])

      const currentSong = now?.song ?? data?.song ?? null
      const liveQueueLength = now?.queueLength ?? data?.app?.queueLength ?? 0
      const currentSource = data?.queue?.find((item) => String(item.id) === String(currentSong?.id))?.sourceLabel
        ?? currentSong?.sourceLabel
        ?? null

      const retry = useCallback(() => {
        setPhase('loading')
        setError(null)
        run({})
      }, [run])

      const nextSong = useCallback(() => {
        if (!data || !currentSong || busy) return
        run({ avoid: [currentSong.id], direction: 'auto' })
      }, [busy, currentSong, data, run])

      const quieter = useCallback(() => {
        if (!data || !currentSong || busy) return
        run({ mood: 'calm', direction: 'quieter', avoid: [currentSong.id] })
      }, [busy, currentSong, data, run])

      const replay = useCallback(() => {
        if (!data || !currentSong || busy) return
        run({ songId: currentSong.id })
      }, [busy, currentSong, data, run])

      const enableBackground = useCallback(async () => {
        if (!data || !currentSong || busy) return
        setBusy(true)
        setError(null)
        try {
          await request('/restart', { method: 'POST', body: {} })
          await run({ songId: currentSong.id })
          if (mounted.current) setToast('后台切歌已开启，之后换歌不会再把网易云带到前台。')
        } catch (caught) {
          if (mounted.current) {
            setError(caught instanceof Error ? caught.message : String(caught))
            setBusy(false)
          }
        }
      }, [busy, currentSong, data, run])

      const feedback = useCallback(async (verdict) => {
        if (!data || !currentSong || busy) return
        setBusy(true)
        try {
          const result = await request('/feedback', { method: 'POST', body: { songId: currentSong.id, verdict } })
          if (!mounted.current) return
          setData((current) => {
            if (current === null) return current
            const next = {
              ...current,
              profile: { ...current.profile, ...result.profile },
              history: result.history,
            }
            lastProgram = next
            writeCachedProgram(next)
            return next
          })
          setToast(verdict === 'like' ? '记下了，下次会更懂你一点。' : '记下了，下次避开这首歌。')
        } catch (caught) {
          if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          if (mounted.current) setBusy(false)
        }
      }, [busy, currentSong, data])

      const body = phase === 'loading' && data === null
        ? h(LoadingCard, null)
        : phase === 'error' && data === null
          ? h(ErrorCard, { message: error ?? '未知错误', onRetry: retry })
          : data === null
            ? h(LoadingCard, null)
            : h(React.Fragment, null,
              h('section', { className: 'mdj-hero' },
                h(SongArt, { mood: data.mood, song: currentSong }),
                h('div', { className: 'mdj-hero-copy' },
                  h('div', { className: 'mdj-eyebrow-row' },
                    h('span', { className: 'mdj-pill' }, data.mood.label),
                    h('span', { className: 'mdj-basis' }, BASIS_LABEL[data.mood.basis] ?? data.mood.basis),
                    currentSource && h('span', { className: 'mdj-source' }, currentSource)),
                  h('h2', { className: 'mdj-song-title' }, currentSong.title),
                  h('p', { className: 'mdj-song-meta' },
                    `${currentSong.artist ?? '网易云音乐'}${currentSong.album ? ` · ${currentSong.album}` : ''}`),
                  h('p', { className: 'mdj-reason' }, data.reason),
                  h('div', { className: 'mdj-actions' },
                    h('button', {
                      type: 'button',
                      className: 'mdj-btn mdj-btn-primary',
                      onClick: replay,
                      disabled: busy,
                    }, busy ? '正在换…' : '重新播放'),
                    h('button', {
                      type: 'button',
                      className: 'mdj-btn',
                      onClick: nextSong,
                      disabled: busy,
                    }, '换一首'),
                    h('button', {
                      type: 'button',
                      className: 'mdj-btn mdj-btn-quiet',
                      onClick: quieter,
                      disabled: busy,
                    }, '安静一点'),
                    h('span', { className: 'mdj-autonote' },
                      liveQueueLength > 1
                        ? `队列 ${liveQueueLength} 首 · 再次打开不会自动换歌`
                        : '再次打开不会自动换歌')),
                  h(AppStatus, {
                    app: data.app,
                    queueLength: liveQueueLength,
                    onEnableBackground: enableBackground,
                    backgroundBusy: busy,
                  }))),
              error !== null && h('div', { className: 'mdj-inline-error', role: 'alert' },
                h('span', null, error),
                h('button', { type: 'button', className: 'mdj-chip', onClick: retry, disabled: busy }, '再试一次')),
              h('div', { className: 'mdj-grid' },
                h('section', { className: 'mdj-card' },
                  h('div', { className: 'mdj-card-head' },
                    h('h3', null, '此刻的情绪'),
                    h('span', null, `${data.mood.confidence}% 把握`)),
                  h(Meter, { label: '愉悦度', value: data.mood.valence, hint: data.mood.valence >= 60 ? '偏亮' : data.mood.valence <= 42 ? '偏沉' : '中间' }),
                  h(Meter, { label: '能量', value: data.mood.arousal, hint: data.mood.arousal >= 65 ? '偏高' : data.mood.arousal <= 35 ? '偏低' : '平稳' }),
                  h('div', { className: 'mdj-tags' },
                    data.mood.tags.map((tag) => h(Tag, { key: tag }, tag))),
                  data.mood.topics?.length > 0 && h('div', { className: 'mdj-topic-row' },
                    h('span', { className: 'mdj-topic-label' }, '聊到'),
                    data.mood.topics.map((topic) => h(Tag, { key: `${topic.type}-${topic.name}`, subtle: true }, topic.name))),
                  data.mood.summary && h('p', { className: 'mdj-summary' }, data.mood.summary),
                  h('p', { className: 'mdj-fineprint' },
                    data.mood.cues.length > 0
                      ? `我听到的信号：${data.mood.cues.map((cue) => `「${cue}」`).join(' ')}`
                      : `这次没有明显的新情绪，先按 ${BASIS_LABEL[data.mood.basis] ?? '当下的光线'} 来。`)),
                h('section', { className: 'mdj-card mdj-card-why' },
                  h('div', { className: 'mdj-card-head' },
                    h('h3', null, '为什么是这首'),
                    h('span', null, data.song.tags.slice(0, 2).join(' / '))),
                  h('p', { className: 'mdj-why-copy' }, data.reason),
                  h('div', { className: 'mdj-feedback' },
                    h('span', { className: 'mdj-feedback-label' }, '这首怎么样？'),
                    h('button', {
                      type: 'button',
                      className: 'mdj-chip',
                      onClick: () => feedback('like'),
                      disabled: busy,
                    }, '喜欢'),
                    h('button', {
                      type: 'button',
                      className: 'mdj-chip',
                      onClick: () => feedback('skip'),
                      disabled: busy,
                    }, '跳过')))),
              h('section', { className: 'mdj-card mdj-history' },
                h('div', { className: 'mdj-card-head' },
                  h('h3', null, '最近听过'),
                  h('span', null, data.profile?.plays ? `共 ${data.profile.plays} 次` : '从这一首开始')),
                h('div', { className: 'mdj-profile' },
                  h('span', { className: 'mdj-profile-label' },
                    data.profile?.topTags?.length > 0 ? '你的收听画像' : '你的收听画像还在形成'),
                  ...(data.profile?.topTags ?? []).slice(0, 4).map((tag) => h(Tag, { key: tag, subtle: true }, tag))),
                h(HistoryList, { history: data.history, profile: data.profile })),
              h('p', { className: 'mdj-privacy' }, '情绪只在本机读取和分析，不会上传。音乐在你的客户端里播放。'))

      return h('div', { className: 'mdj-root' },
        h('style', null, CSS),
        h('div', { className: 'mdj-shell' },
          h('header', { className: 'mdj-head' },
            h('div', { className: 'mdj-kicker' },
              h('span', { className: 'mdj-signal', 'aria-hidden': 'true' }),
              'MOOD RADIO / 心绪电台'),
            h('h1', null, '此刻，听点对的。'),
            h('p', { className: 'mdj-intro' }, '我会读一读最近的对话，接住当下的情绪，再把一首歌交给你的音乐客户端。没有明显的情绪时，就顺着你以前听过的东西来。')),
          h(RadioBar, {
            radio,
            busy: radioBusy,
            onToggle: toggleRadio,
            autoRefillBusy,
            onToggleAutoRefill: toggleAutoRefill,
          }),
          body,
          toast !== null && h('div', { className: 'mdj-toast', role: 'status' }, toast)))
    }

    const CSS = `
      .mdj-root {
        min-height: 100%;
        height: 100%;
        overflow: auto;
        background:
          radial-gradient(1200px 420px at 18% -10%, color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent), transparent 62%),
          var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
      }
      .mdj-shell {
        width: min(100%, 1040px);
        margin: 0 auto;
        padding: 44px 36px 56px;
        box-sizing: border-box;
      }
      .mdj-head { margin-bottom: 28px; }
      .mdj-kicker {
        display: flex;
        align-items: center;
        gap: 9px;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: .15em;
        text-transform: uppercase;
      }
      .mdj-signal {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: var(--dsw-alias-brand-primary);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
      }
      .mdj-head h1 {
        margin: 10px 0 8px;
        font-size: clamp(30px, 4.2vw, 46px);
        line-height: 1.08;
        letter-spacing: -.035em;
        font-weight: 680;
      }
      .mdj-intro {
        max-width: 720px;
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 14px;
        line-height: 1.75;
      }
      .mdj-radiobar {
        margin: 0 0 18px;
        overflow: hidden;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .mdj-radiobar.is-on {
        border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, var(--dsw-alias-border-l1));
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, var(--dsw-alias-bg-layer-1));
      }
      .mdj-radiobar-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 13px 16px;
      }
      .mdj-radiobar-sub {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 11px 16px;
        border-top: 1px solid var(--dsw-alias-border-l1);
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, transparent);
      }
      .mdj-radiobar-copy,
      .mdj-radiobar-subcopy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .mdj-radiobar-copy strong,
      .mdj-radiobar-subcopy strong { font-size: 12px; font-weight: 650; }
      .mdj-radiobar-copy span,
      .mdj-radiobar-subcopy span { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
      .mdj-radiobar-subcopy strong { font-size: 11px; }
      .mdj-switch {
        position: relative;
        width: 38px;
        height: 22px;
        flex: none;
        padding: 0;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
        cursor: pointer;
        transition: background .18s ease, border-color .18s ease;
      }
      .mdj-switch.is-on {
        background: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
      }
      .mdj-switch-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: 0 1px 3px color-mix(in srgb, var(--dsw-alias-label-primary) 25%, transparent);
        transition: transform .18s ease;
      }
      .mdj-switch.is-on .mdj-switch-thumb { transform: translateX(16px); }
      .mdj-switch-small { width: 30px; height: 18px; }
      .mdj-switch-small .mdj-switch-thumb { width: 12px; height: 12px; }
      .mdj-switch-small.is-on .mdj-switch-thumb { transform: translateX(12px); }
      .mdj-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .mdj-switch:disabled { opacity: .55; cursor: progress; }
      .mdj-hero {
        display: grid;
        grid-template-columns: 252px minmax(0, 1fr);
        gap: 32px;
        align-items: center;
        padding: 28px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 26px;
        background:
          linear-gradient(150deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent), transparent 45%),
          var(--dsw-alias-bg-layer-1);
        box-shadow: 0 24px 70px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
      }
      .mdj-art {
        position: relative;
        aspect-ratio: 1;
        border-radius: 22px;
        overflow: hidden;
        background:
          radial-gradient(circle at 70% 10%, color-mix(in srgb, var(--mdj-b) 82%, white), transparent 55%),
          linear-gradient(145deg, var(--mdj-a), var(--mdj-b));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, white 22%, transparent);
      }
      .mdj-art-glow {
        position: absolute;
        inset: -30%;
        background: radial-gradient(circle, color-mix(in srgb, white 30%, transparent), transparent 58%);
        transform: translate(30%, -35%);
        filter: blur(8px);
        animation: mdj-breathe 7s ease-in-out infinite;
      }
      .mdj-vinyl {
        position: absolute;
        width: 78%;
        height: 78%;
        left: 11%;
        top: 11%;
        border-radius: 50%;
        background:
          repeating-radial-gradient(circle at 50% 50%, rgba(10, 12, 16, .95) 0 2px, rgba(43, 46, 54, .9) 3px 5px, rgba(8, 9, 12, .96) 6px 7px);
        box-shadow: 0 18px 35px rgba(0, 0, 0, .34), inset 0 0 0 1px rgba(255, 255, 255, .08);
      }
      .mdj-groove {
        position: absolute;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, .12);
      }
      .mdj-groove-one { inset: 9%; }
      .mdj-groove-two { inset: 22%; border-color: rgba(255, 255, 255, .08); }
      .mdj-groove-three { inset: 35%; border-color: rgba(255, 255, 255, .1); }
      .mdj-label {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 42%;
        height: 42%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 5px;
        background: linear-gradient(145deg, var(--mdj-a), var(--mdj-b));
        color: rgba(255, 255, 255, .92);
        text-align: center;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .2);
      }
      .mdj-label-top { font-size: 9px; letter-spacing: .14em; opacity: .9; }
      .mdj-label-rule { width: 20px; height: 1px; background: rgba(255, 255, 255, .5); }
      .mdj-label-bottom { font-size: 7px; letter-spacing: .12em; opacity: .72; }
      .mdj-spindle {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 7px;
        height: 7px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: #16181d;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, .18);
      }
      .mdj-art-caption {
        position: absolute;
        left: 16px;
        right: 16px;
        bottom: 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: rgba(255, 255, 255, .88);
        font-size: 10px;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .mdj-art-id { opacity: .65; }
      .mdj-hero-copy { min-width: 0; }
      .mdj-eyebrow-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
      .mdj-pill {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 10px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
        color: var(--dsw-alias-brand-primary);
        font-size: 12px;
        font-weight: 600;
      }
      .mdj-basis { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .mdj-source {
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        letter-spacing: .04em;
      }
      .mdj-song-title {
        margin: 0 0 6px;
        font-size: clamp(26px, 3.3vw, 38px);
        line-height: 1.15;
        letter-spacing: -.025em;
      }
      .mdj-song-meta { margin: 0 0 16px; color: var(--dsw-alias-label-secondary); font-size: 14px; }
      .mdj-reason {
        margin: 0 0 22px;
        max-width: 640px;
        font-size: 14px;
        line-height: 1.8;
        color: var(--dsw-alias-label-primary);
        opacity: .86;
      }
      .mdj-actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
      .mdj-autonote { margin-left: 4px; color: var(--dsw-alias-label-secondary); font-size: 10px; opacity: .72; }
      .mdj-btn {
        appearance: none;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        border-radius: 10px;
        min-height: 36px;
        padding: 0 14px;
        font: inherit;
        font-size: 13px;
        font-weight: 550;
        cursor: pointer;
        transition: background .16s ease, border-color .16s ease, transform .16s ease;
      }
      .mdj-btn:hover:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, var(--dsw-alias-bg-layer-2));
        border-color: var(--dsw-alias-border-l2);
      }
      .mdj-btn:active:not(:disabled) { transform: translateY(1px); }
      .mdj-btn:disabled { opacity: .55; cursor: progress; }
      .mdj-btn-primary {
        background: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-bg-layer-1);
        font-weight: 650;
      }
      .mdj-btn-primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, var(--dsw-alias-label-primary));
        border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, var(--dsw-alias-label-primary));
      }
      .mdj-btn-quiet { color: var(--dsw-alias-label-secondary); }
      .mdj-btn:focus-visible, .mdj-chip:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .mdj-app {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--dsw-alias-border-l1);
        font-size: 12px;
        line-height: 1.55;
        color: var(--dsw-alias-label-secondary);
      }
      .mdj-app-dot {
        width: 7px;
        height: 7px;
        margin-top: 5px;
        flex: none;
        border-radius: 50%;
        background: var(--dsw-alias-state-success-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent);
      }
      .mdj-app-warn .mdj-app-dot {
        background: var(--dsw-alias-state-warn-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 15%, transparent);
      }
      .mdj-app-copy { display: flex; flex-direction: column; gap: 2px; }
      .mdj-app-copy strong { color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 600; }
      .mdj-app-action { margin-left: auto; flex: none; white-space: nowrap; }
      .mdj-grid {
        display: grid;
        grid-template-columns: minmax(0, .95fr) minmax(0, 1.15fr);
        gap: 18px;
        margin-top: 18px;
      }
      .mdj-card {
        padding: 22px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 18px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .mdj-card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
      }
      .mdj-card-head h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 650;
        letter-spacing: -.01em;
      }
      .mdj-card-head > span { color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .mdj-meter + .mdj-meter { margin-top: 16px; }
      .mdj-meter-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 7px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
      }
      .mdj-meter-value { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
      .mdj-meter-track {
        height: 7px;
        overflow: hidden;
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
      }
      .mdj-meter-fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--dsw-alias-brand-primary), color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-state-success-primary)));
        transition: width .5s ease;
      }
      .mdj-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 18px; }
      .mdj-topic-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
      .mdj-topic-label { color: var(--dsw-alias-label-secondary); font-size: 10px; }
      .mdj-tag {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 0 8px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
      }
      .mdj-tag-subtle { opacity: .8; }
      .mdj-summary {
        margin: 16px 0 0;
        padding: 10px 12px;
        border-left: 2px solid var(--dsw-alias-brand-primary);
        border-radius: 0 8px 8px 0;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, transparent);
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        line-height: 1.75;
      }
      .mdj-fineprint {
        margin: 16px 0 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 1.6;
      }
      .mdj-why-copy {
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 1.8;
      }
      .mdj-inline-error {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 14px;
        padding: 11px 14px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l1));
        border-radius: 12px;
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, var(--dsw-alias-bg-layer-1));
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1.6;
      }
      .mdj-feedback {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        margin-top: 18px;
        padding-top: 16px;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .mdj-feedback-label { margin-right: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .mdj-chip {
        appearance: none;
        min-height: 26px;
        padding: 0 9px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
      }
      .mdj-chip:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
      }
      .mdj-chip:disabled { opacity: .5; cursor: progress; }
      .mdj-history { margin-top: 18px; }
      .mdj-profile {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin: -6px 0 14px;
      }
      .mdj-profile-label { color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .mdj-history-list { list-style: none; margin: 0; padding: 0; }
      .mdj-history-row {
        display: grid;
        grid-template-columns: 58px 8px minmax(0, 1fr) auto 42px;
        align-items: center;
        gap: 10px;
        padding: 10px 0;
        border-top: 1px solid var(--dsw-alias-border-l1);
        font-size: 12px;
      }
      .mdj-history-row:first-child { border-top: none; padding-top: 0; }
      .mdj-history-row:last-child { padding-bottom: 0; }
      .mdj-history-time { color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
      .mdj-history-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-brand-primary); opacity: .7; }
      .mdj-history-dot[data-mood="comfort"] { background: #c98b7a; }
      .mdj-history-dot[data-mood="calm"] { background: #9db8ad; }
      .mdj-history-dot[data-mood="warm"] { background: #e0a86f; }
      .mdj-history-dot[data-mood="focus"] { background: #8fa3bf; }
      .mdj-history-dot[data-mood="uplift"] { background: #f2c14e; }
      .mdj-history-dot[data-mood="release"] { background: #c25b4e; }
      .mdj-history-song { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mdj-history-song strong { font-weight: 600; }
      .mdj-history-song span { color: var(--dsw-alias-label-secondary); }
      .mdj-history-mood { color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
      .mdj-history-verdict { color: var(--dsw-alias-state-success-primary); font-size: 11px; text-align: right; }
      .mdj-history-verdict-skip { color: var(--dsw-alias-state-warn-primary); }
      .mdj-history-verdict-empty { color: transparent; }
      .mdj-history-empty {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1.6;
      }
      .mdj-privacy { margin: 18px 0 0; color: var(--dsw-alias-label-secondary); font-size: 10px; opacity: .75; text-align: center; }
      .mdj-toast {
        position: sticky;
        bottom: 18px;
        width: fit-content;
        margin: 18px auto 0;
        padding: 10px 16px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        background: var(--dsw-alias-bg-overlay);
        box-shadow: 0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent);
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        z-index: 2;
      }
      .mdj-loading {
        display: grid;
        grid-template-columns: 160px minmax(0, 1fr);
        gap: 28px;
        align-items: center;
        padding: 28px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 26px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .mdj-loading-art {
        aspect-ratio: 1;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent), transparent 55%), var(--dsw-alias-bg-layer-2);
        animation: mdj-pulse 1.7s ease-in-out infinite;
      }
      .mdj-loading-lines { display: flex; flex-direction: column; gap: 12px; }
      .mdj-skeleton {
        display: block;
        width: 78%;
        height: 12px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
        animation: mdj-pulse 1.7s ease-in-out infinite;
      }
      .mdj-skeleton-short { width: 30%; height: 10px; }
      .mdj-skeleton-title { width: 58%; height: 26px; }
      .mdj-skeleton-soft { width: 64%; opacity: .55; }
      .mdj-loading-copy { grid-column: 1 / -1; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .mdj-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 10px;
        padding: 42px 24px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 22px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .mdj-empty-mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 58px;
        height: 58px;
        margin-bottom: 4px;
        border-radius: 18px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
        color: var(--dsw-alias-brand-primary);
      }
      .mdj-empty h2 { margin: 0; font-size: 20px; }
      .mdj-empty p { max-width: 520px; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.7; }
      .mdj-empty .mdj-btn { margin-top: 8px; }
      .mdj-muted { opacity: .72; font-size: 11px !important; }
      @keyframes mdj-breathe {
        0%, 100% { opacity: .42; transform: translate(30%, -35%) scale(1); }
        50% { opacity: .75; transform: translate(24%, -30%) scale(1.08); }
      }
      @keyframes mdj-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) {
        .mdj-art-glow { animation: none; }
        .mdj-loading-art, .mdj-skeleton { animation: none; }
        .mdj-btn, .mdj-meter-fill { transition: none; }
      }
      @media (max-width: 760px) {
        .mdj-shell { padding: 30px 20px 40px; }
        .mdj-hero { grid-template-columns: 1fr; gap: 24px; padding: 20px; }
        .mdj-art { width: min(100%, 320px); margin: 0 auto; }
        .mdj-grid { grid-template-columns: 1fr; }
        .mdj-loading { grid-template-columns: 110px minmax(0, 1fr); padding: 20px; }
        .mdj-history-row { grid-template-columns: 52px 8px minmax(0, 1fr) auto; }
        .mdj-history-mood { display: none; }
      }
      @media (max-width: 440px) {
        .mdj-history-row { grid-template-columns: 8px minmax(0, 1fr) 36px; }
        .mdj-history-time { display: none; }
        .mdj-history-verdict-empty { display: none; }
      }
    `

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'mood-dj',
        order: 20,
        label: '心绪电台',
      }, MusicGlyph))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'mood-dj',
      }, MoodPanel))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
