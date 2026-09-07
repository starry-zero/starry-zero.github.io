/* ============================================================================
 * endfield-contour.js — 等高线背景
 *
 * 移植自 ymh0000123/dsh-theme-endfield（DSH Web 主题插件），算法参数全部保留：
 *   场 = 22 个正负相间高斯凸起 + 3 道极缓长波正弦（BASE 0.62）
 *   线 = marching squares 在 20 层等值高度上提取（SPAN ±1.45）
 *   缝合 = 边 ID 邻接 Int32Array，缝合成连续折线
 *   平滑 = Chaikin ×3 预处理 + 约束 Catmull-Rom 三次曲线（0.32/0.62/0.4/0.55）
 *   过滤 = 可见长度 ≥54px、小环 ≤31.5px、相切发夹（底宽<2px 且转角>90°）摘除
 *   采样 = 分层抖动网格 + 接受-或-重抽校验（8×5 覆盖格，≥3 次穿越）
 *   动画 = 场相位漂移，每帧按标称帧推进，phase += (1/150) * speed
 *
 * 宿主适配（与算法无关的部分）：
 *   - 挂载：body 下 fixed 容器（样式由注入 CSS 提供），视口尺寸
 *   - 暗色模式：matchMedia('(prefers-color-scheme: dark)')（NexT 8 用媒体查询而非 body class）
 *   - 无 DSH 总开关/加载屏，移除对应联动；滚动暂停保留
 *   - 默认值按需求调整：等高线开、120 FPS、速度 1x（慢速）、谷地黄
 *   - localStorage 键与 endfield 完全一致，可随时覆盖
 * ========================================================================== */
(function () {
  'use strict'

  /* ---------------- 设置项（键名与 endfield 一致） ---------------- */
  const CONTOUR_KEY = 'dsh-theme-endfield-contour'
  const CONTOUR_ANIM_KEY = 'dsh-theme-endfield-contour-anim'
  const CONTOUR_FPS_KEY = 'dsh-theme-endfield-contour-fps'
  const CONTOUR_SPEED_KEY = 'dsh-theme-endfield-contour-speed'
  const CONTOUR_SCROLL_PAUSE_KEY = 'dsh-theme-endfield-contour-scroll-pause'
  const CONTOUR_PALETTE_KEY = 'dsh-theme-endfield-palette'
  const CONTOUR_FPS_OPTIONS = [24, 60, 120]
  const CONTOUR_SPEED_OPTIONS = [1, 2, 4]
  const CONTOUR_PHASE_STEP = 1 / 150

  /* 博客无总开关；等高线默认开（未设置即开，==='0' 才关）。
     FPS/速度默认按需求：120fps / 1x（慢速）。 */
  const isContourOn = () => (typeof localStorage !== 'undefined' && localStorage.getItem(CONTOUR_KEY)) !== '0'
  const isContourAnimOn = () => (typeof localStorage !== 'undefined' && localStorage.getItem(CONTOUR_ANIM_KEY)) !== '0'
  const readContourFps = () => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CONTOUR_FPS_KEY) : null
    const fps = Number(raw)
    return CONTOUR_FPS_OPTIONS.includes(fps) ? fps : 60
  }
  const readContourSpeed = () => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CONTOUR_SPEED_KEY) : null
    const speed = Number(raw)
    return CONTOUR_SPEED_OPTIONS.includes(speed) ? speed : 1
  }
  const isContourScrollPauseOn = () => (typeof localStorage !== 'undefined'
    && localStorage.getItem(CONTOUR_SCROLL_PAUSE_KEY)) !== '0'
  const isWulingPalette = () => (typeof localStorage !== 'undefined'
    && localStorage.getItem(CONTOUR_PALETTE_KEY)) === 'wuling'

  const isDarkScheme = () => typeof document !== 'undefined'
    && document.documentElement
    && document.documentElement.classList.contains('endfield-dark')
  const prefersReducedMotion = () => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const contourWantsAnim = () => isContourAnimOn() && !prefersReducedMotion() && !contourScrollPaused

  /* ---------------- 状态 ---------------- */
  let contourWrap = null      // fixed 定位容器（body 直接子节点）
  let contourLineCv = null
  let contourRaf = null
  let contourRo = null        // ResizeObserver（视口尺寸变化）
  let contourPaths = []
  let contourGeom = null      // { w, h, cols, rows, step }
  let contourField = null
  let contourLastField = -1
  let contourPhase = 0
  let contourSwitchSig = ''
  let contourScrollPaused = false
  let contourScrollTimer = null
  let contourResizePending = false
  const contourHasScrollEnd = typeof window !== 'undefined' && 'onscrollend' in window

  /* ---------------- 算法常量（与 endfield 完全一致） ---------------- */
  const CONTOUR_STEP = 6      // 1px 描边下平衡采样/细节的网格步长
  const CONTOUR_LEVELS = 20
  const CONTOUR_SPAN = 1.45   // levels span [-SPAN, +SPAN]
  const CONTOUR_MIN_LEN = 40      // 可见描边长度下限（低于此读作碎屑）
  const CONTOUR_MIN_RING_BOX = 21 // 一条中位线距（21px）；小环读作“点”
  const CONTOUR_KEEP_LEN = CONTOUR_MIN_LEN * 1.35   // 绘制几何比判定几何略短，留余量
  const CONTOUR_KEEP_RING = CONTOUR_MIN_RING_BOX * 1.5
  const CONTOUR_MIN_CROSSINGS = 3 // 每覆盖格至少穿越的高度带数

  /* ---------------- 确定性 PRNG（mulberry32），每次加载一抽种子 ---------------- */
  const contourRng = (seed) => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6D2B79F5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const contourSeed = (() => {
    let s = 0
    const c = (typeof crypto !== 'undefined' && crypto
      && typeof crypto.getRandomValues === 'function') ? crypto : null
    if (c !== null) {
      try {
        const buf = new Uint32Array(1)
        c.getRandomValues(buf)
        s = buf[0]
      } catch (e) { s = 0 }
    }
    if (s === 0) {
      const t = (typeof Date !== 'undefined' && typeof Date.now === 'function') ? Date.now() : 0
      const r = (typeof Math !== 'undefined' && typeof Math.random === 'function') ? Math.random() : 0
      s = ((t ^ Math.floor(r * 0xFFFFFFFF)) >>> 0)
    }
    return (s >>> 0) || 0x5eed4242
  })()

  /* ---------------- 构建：接受-或-重抽 ---------------- */
  const contourBuild = (w, h) => {
    const attempts = 32
    let best = null
    for (let attempt = 0; attempt < attempts; attempt++) {
      const cand = contourBuildCandidate(w, h, attempt)
      const score = contourCoverageScore(cand, w, h)
      if (best === null || score.worst > best.score.worst) best = { cand, score }
      if (score.ok) break
    }
    contourField = best.cand.field
    contourGeom = { w, h, cols: best.cand.cols, rows: best.cand.rows, step: CONTOUR_STEP }
  }

  const contourBuildCandidate = (w, h, salt) => {
    const step = CONTOUR_STEP
    const cols = Math.ceil(w / step) + 1
    const rows = Math.ceil(h / step) + 1
    const K = 22                       // 凸起数：按参考图的岛屿密度调
    const rnd = contourRng((contourSeed + salt * 0x9E3779B1) >>> 0)
    const m = Math.min(w, h)
    const bx = new Float32Array(K), by = new Float32Array(K)
    const ba = new Float32Array(K), bs = new Float32Array(K)
    const dx = new Float32Array(K), dy = new Float32Array(K)
    // 分层采样：视口切成 ≥K 格的近方形格阵，每个凸起落在自己格内随机点；Fisher-Yates 打乱格序
    const gx = Math.max(1, Math.round(Math.sqrt(K * (w / Math.max(1, h)))))
    const gy = Math.max(1, Math.ceil(K / gx))
    const cells = []
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) cells.push(i + j * gx)
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = cells[i]; cells[i] = cells[j]; cells[j] = t
    }
    const spanX = 1.2 * w, spanY = 1.2 * h
    for (let k = 0; k < K; k++) {
      const cell = cells[k % cells.length]
      const ci = cell % gx
      const cj = Math.floor(cell / gx)
      bx[k] = -0.1 * w + ((ci + rnd()) / gx) * spanX
      by[k] = -0.1 * h + ((cj + rnd()) / gy) * spanY
      ba[k] = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.9)   // 正负相间：峰与洼地
      bs[k] = (0.05 + rnd() * 0.09) * m
      dx[k] = rnd() * 2 - 1
      dy[k] = rnd() * 2 - 1
    }
    // 三道极缓长波正弦：填平高斯之间的零值空隙，使岛屿连成一片地形
    const W2 = new Float32Array(9)
    for (let i = 0; i < 3; i++) {
      W2[i * 3] = (0.35 + rnd() * 0.5) * (Math.PI * 2) / Math.max(1, w)
      W2[i * 3 + 1] = (0.35 + rnd() * 0.5) * (Math.PI * 2) / Math.max(1, h)
      W2[i * 3 + 2] = rnd() * Math.PI * 2
    }
    const hCount = (cols - 1) * rows
    const eCount = hCount + cols * (rows - 1)
    const field = {
      cols, rows, step, K, bx, by, ba, bs, dx, dy, hCount, W2,
      F: new Float32Array(cols * rows),
      previous: new Float32Array(cols * rows),
      hasPrevious: false,
      smooth: new Float32Array(cols * rows),
      ex: new Float32Array(eCount),
      ey: new Float32Array(eCount),
      es: new Int32Array(eCount).fill(-1),
      n1: new Int32Array(eCount).fill(-1),
      n2: new Int32Array(eCount).fill(-1),
      seen: new Int32Array(eCount).fill(-1),
      touched: new Int32Array(eCount),
      seq: 0,
    }
    return { field, cols, rows }
  }

  /* 覆盖评分：在 8×5 覆盖格上统计场穿越的高度带数（不提取不绘制） */
  const contourCoverageScore = (cand, w, h) => {
    const f = cand.field
    const prev = contourField
    contourField = f
    contourEvaluate(0)
    contourField = prev
    const { cols, rows, F } = f
    const GX = 8, GY = 5
    const span = CONTOUR_SPAN
    const levelStep = (span * 2) / CONTOUR_LEVELS
    let worst = Infinity
    let ok = true
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const i0 = Math.floor(gx * (cols - 1) / GX), i1 = Math.ceil((gx + 1) * (cols - 1) / GX)
        const j0 = Math.floor(gy * (rows - 1) / GY), j1 = Math.ceil((gy + 1) * (rows - 1) / GY)
        let mn = Infinity, mx = -Infinity
        for (let j = j0; j <= j1 && j < rows; j++) {
          const row = j * cols
          for (let i = i0; i <= i1 && i < cols; i++) {
            const v = F[row + i]
            if (v < mn) mn = v
            if (v > mx) mx = v
          }
        }
        const lo = Math.max(mn, -span), hi = Math.min(mx, span)
        const crossings = hi <= lo ? 0
          : Math.floor(hi / levelStep) - Math.ceil(lo / levelStep) + 1
        if (crossings < worst) worst = crossings
        if (crossings < CONTOUR_MIN_CROSSINGS) ok = false
      }
    }
    return { ok, worst }
  }

  /* 场求值：有界散射（每个凸起只写自己 2.6σ 包围盒内）+ 5 遍 1-2-1 平滑 + 时间混合 */
  const contourEvaluate = (phase) => {
    const f = contourField
    if (f === null) return
    const { cols, rows, step, K, bx, by, ba, bs, dx, dy, F, W2 } = f
    const BASE = 0.62
    for (let i = 0; i < 3; i++) {
      const fx = W2[i * 3], fy = W2[i * 3 + 1], ph = W2[i * 3 + 2] + phase * 0.11
      const amp = BASE / 3
      for (let j = 0; j < rows; j++) {
        const yb = fy * (j * step) + ph
        const sy = Math.sin(yb), cy2 = Math.cos(yb)
        const row = j * cols
        for (let c2 = 0; c2 < cols; c2++) {
          const xb = fx * (c2 * step)
          const v = Math.sin(xb) * cy2 + Math.cos(xb) * sy
          if (i === 0) F[row + c2] = amp * v
          else F[row + c2] += amp * v
        }
      }
    }
    for (let k = 0; k < K; k++) {
      const s = bs[k]
      const amp = s * 0.55
      const cx = bx[k] + Math.sin(phase * dx[k] + k * 1.7) * amp
      const cy = by[k] + Math.cos(phase * dy[k] + k * 2.3) * amp
      const a = ba[k]
      const inv = 1 / (2 * s * s)
      const rad = 2.6 * s
      let i0 = Math.floor((cx - rad) / step)
      let i1 = Math.ceil((cx + rad) / step)
      let j0 = Math.floor((cy - rad) / step)
      let j1 = Math.ceil((cy + rad) / step)
      if (i0 < 0) i0 = 0
      if (j0 < 0) j0 = 0
      if (i1 > cols - 1) i1 = cols - 1
      if (j1 > rows - 1) j1 = rows - 1
      for (let j = j0; j <= j1; j++) {
        const ddy = j * step - cy
        const dy2 = ddy * ddy
        const row = j * cols
        for (let i = i0; i <= i1; i++) {
          const ddx = i * step - cx
          const q = (ddx * ddx + dy2) * inv
          if (q < 6.76) {
            let weight = Math.exp(-q)
            if (q > 4.8) {
              const t = (q - 4.8) / (6.76 - 4.8)
              const fade = 1 - t * t * (3 - 2 * t)
              weight *= fade
            }
            F[row + i] += a * weight
          }
        }
      }
    }
    const smooth = f.smooth
    for (let pass = 0; pass < 5; pass++) {
      for (let j = 0; j < rows; j++) {
        const row = j * cols
        for (let i = 0; i < cols; i++) {
          const left = F[row + Math.max(0, i - 1)]
          const center = F[row + i]
          const right = F[row + Math.min(cols - 1, i + 1)]
          smooth[row + i] = (left + 2 * center + right) * 0.25
        }
      }
      for (let j = 0; j < rows; j++) {
        const row = j * cols
        const up = Math.max(0, j - 1) * cols
        const down = Math.min(rows - 1, j + 1) * cols
        for (let i = 0; i < cols; i++) {
          F[row + i] = (smooth[up + i] + 2 * smooth[row + i] + smooth[down + i]) * 0.25
        }
      }
    }
    // 时间混合：把采样间的场变化抹匀，避免鞍点穿越层时整条线瞬移
    if (f.hasPrevious && f.previous !== undefined) {
      for (let i = 0; i < F.length; i++) {
        f.previous[i] = f.previous[i] * 0.65 + F[i] * 0.35
        F[i] = f.previous[i]
      }
    } else if (f.previous !== undefined) {
      f.previous.set(F)
    }
    f.hasPrevious = true
  }

  /* Marching squares 单层提取 + 边 ID 缝合 */
  const contourExtractLevel = (L, out) => {
    const f = contourField
    const { cols, rows, step, F, ex, ey, es, n1, n2, seen, touched, hCount } = f
    const st = ++f.seq
    let tn = 0
    const pt = (id, i0, j0, i1, j1) => {
      if (es[id] === st) return id
      const a = F[j0 * cols + i0]
      const b = F[j1 * cols + i1]
      let t = (L - a) / (b - a)
      if (!(t >= 0)) t = 0
      else if (t > 1) t = 1
      ex[id] = (i0 + (i1 - i0) * t) * step
      ey[id] = (j0 + (j1 - j0) * t) * step
      es[id] = st
      n1[id] = -1
      n2[id] = -1
      touched[tn++] = id
      return id
    }
    const link = (a, b) => {
      if (n1[a] < 0) n1[a] = b
      else if (n2[a] < 0) n2[a] = b
      if (n1[b] < 0) n1[b] = a
      else if (n2[b] < 0) n2[b] = a
    }
    for (let j = 0; j < rows - 1; j++) {
      const row = j * cols
      for (let i = 0; i < cols - 1; i++) {
        const p0 = row + i
        const p1 = p0 + 1
        const p3 = p0 + cols
        const p2 = p3 + 1
        const v0 = F[p0], v1 = F[p1], v2 = F[p2], v3 = F[p3]
        let mn = v0, mx = v0
        if (v1 < mn) mn = v1; else if (v1 > mx) mx = v1
        if (v2 < mn) mn = v2; else if (v2 > mx) mx = v2
        if (v3 < mn) mn = v3; else if (v3 > mx) mx = v3
        if (L <= mn || L > mx) continue
        const idx = (v0 > L ? 1 : 0) | (v1 > L ? 2 : 0) | (v2 > L ? 4 : 0) | (v3 > L ? 8 : 0)
        const T = () => pt(j * (cols - 1) + i, i, j, i + 1, j)
        const B = () => pt((j + 1) * (cols - 1) + i, i, j + 1, i + 1, j + 1)
        const Le = () => pt(hCount + j * cols + i, i, j, i, j + 1)
        const Ri = () => pt(hCount + j * cols + i + 1, i + 1, j, i + 1, j + 1)
        switch (idx) {
          case 1: case 14: link(T(), Le()); break
          case 2: case 13: link(T(), Ri()); break
          case 3: case 12: link(Le(), Ri()); break
          case 4: case 11: link(Ri(), B()); break
          case 6: case 9: link(T(), B()); break
          case 7: case 8: link(Le(), B()); break
          // 鞍点歧义：双线性渐近判定（a*c - b*d 的符号决定对角高低区如何连通）
          case 5: {
            const a = v0 - L, b = v1 - L, c = v2 - L, d = v3 - L
            const saddle = a * c - b * d
            if (saddle > 0) { link(T(), Ri()); link(Le(), B()) }
            else { link(T(), Le()); link(Ri(), B()) }
            break
          }
          case 10: {
            const a = v0 - L, b = v1 - L, c = v2 - L, d = v3 - L
            const saddle = a * c - b * d
            if (saddle < 0) { link(T(), Le()); link(Ri(), B()) }
            else { link(T(), Ri()); link(Le(), B()) }
            break
          }
        }
      }
    }
    const walk = (start) => {
      const path = []
      let cur = start
      let prev = -1
      for (;;) {
        path.push(ex[cur], ey[cur])
        seen[cur] = st
        const a = n1[cur]
        const b = n2[cur]
        let nx = -1
        if (a >= 0 && a !== prev && seen[a] !== st) nx = a
        else if (b >= 0 && b !== prev && seen[b] !== st) nx = b
        if (nx < 0) {
          if ((a === start || b === start) && path.length > 4) path.push(ex[start], ey[start])
          break
        }
        prev = cur
        cur = nx
      }
      return path
    }
    const W = contourGeom !== null ? contourGeom.w : 0
    const H = contourGeom !== null ? contourGeom.h : 0
    /* 碎屑过滤：按画布内几何判定（可见长度、包围盒、小闭环） */
    const keep = (p) => {
      if (p.length < 8) return false
      let vis = 0
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
      let seenIn = false
      for (let k = 0; k < p.length; k += 2) {
        const x = p[k], y = p[k + 1]
        const inside = x >= 0 && x <= W && y >= 0 && y <= H
        if (inside) {
          seenIn = true
          if (x < minx) minx = x
          if (x > maxx) maxx = x
          if (y < miny) miny = y
          if (y > maxy) maxy = y
        }
        if (k >= 2) {
          const px2 = p[k - 2], py2 = p[k - 1]
          const prevIn = px2 >= 0 && px2 <= W && py2 >= 0 && py2 <= H
          if (inside && prevIn) {
            const dx = x - px2, dy = y - py2
            vis += Math.sqrt(dx * dx + dy * dy)
          }
        }
      }
      if (!seenIn) return false
      if (vis < CONTOUR_KEEP_LEN) return false
      const gapx = p[0] - p[p.length - 2]
      const gapy = p[1] - p[p.length - 1]
      const closed = (gapx * gapx + gapy * gapy) < 4
      if (closed && (maxx - minx) < CONTOUR_KEEP_RING
        && (maxy - miny) < CONTOUR_KEEP_RING) return false
      return true
    }
    /* 相切发夹摘除：底宽 <2px 且转角 >90° 的折返整体压平 */
    const deneedle = (p) => {
      const n = p.length / 2
      if (n < 4) return p
      let found = false
      for (let k = 1; k < n - 1; k++) {
        const bx = p[(k + 1) * 2] - p[(k - 1) * 2]
        const by = p[(k + 1) * 2 + 1] - p[(k - 1) * 2 + 1]
        if (bx * bx + by * by >= 4) continue
        const ax = p[k * 2] - p[(k - 1) * 2]
        const ay = p[k * 2 + 1] - p[(k - 1) * 2 + 1]
        const cx = p[(k + 1) * 2] - p[k * 2]
        const cy = p[(k + 1) * 2 + 1] - p[k * 2 + 1]
        if (ax * cx + ay * cy < 0) { found = true; break }
      }
      if (!found) return p
      const gx = p[0] - p[(n - 1) * 2]
      const gy = p[1] - p[(n - 1) * 2 + 1]
      const closed = (gx * gx + gy * gy) < 4
      const q = [p[0], p[1]]
      let k = 1
      while (k < n - 1) {
        const px = q[q.length - 2], py = q[q.length - 1]
        const bx = p[(k + 1) * 2] - px, by = p[(k + 1) * 2 + 1] - py
        if (bx * bx + by * by < 4) {
          const ax = p[k * 2] - px, ay = p[k * 2 + 1] - py
          const cx = p[(k + 1) * 2] - p[k * 2], cy = p[(k + 1) * 2 + 1] - p[k * 2 + 1]
          if (ax * cx + ay * cy < 0) {
            if (k + 1 < n - 1) {
              q[q.length - 2] = (px + p[(k + 1) * 2]) / 2
              q[q.length - 1] = (py + p[(k + 1) * 2 + 1]) / 2
              k += 2
              continue
            }
            k += 1
            continue
          }
        }
        q.push(p[k * 2], p[k * 2 + 1])
        k += 1
      }
      q.push(p[(n - 1) * 2], p[(n - 1) * 2 + 1])
      if (closed) {
        q[q.length - 2] = q[0]
        q[q.length - 1] = q[1]
      }
      return q
    }
    // 开放链先走（有自由端），再走闭环，避免环被从中截断
    for (let k = 0; k < tn; k++) {
      const id = touched[k]
      if (seen[id] !== st && n2[id] < 0) {
        const p = deneedle(walk(id))
        if (keep(p)) out.push(p)
      }
    }
    for (let k = 0; k < tn; k++) {
      const id = touched[k]
      if (seen[id] !== st) {
        const p = deneedle(walk(id))
        if (keep(p)) out.push(p)
      }
    }
  }

  const contourExtract = (phase) => {
    if (contourField === null) return
    contourEvaluate(phase)
    contourPaths = []
    const span = CONTOUR_SPAN
    const stepL = (span * 2) / CONTOUR_LEVELS
    for (let n = 0; n <= CONTOUR_LEVELS; n++) {
      contourExtractLevel(-span + n * stepL, contourPaths)
    }
  }

  /* 描边颜色：与 endfield 相同的实测值（亮色用压暗的橄榄黄、暗色用信号黄，alpha 各自调参） */
  const contourStroke = () => {
    const cyan = isWulingPalette()
    if (isDarkScheme()) {
      return cyan ? '#14d0d045' : '#fff50033'   // 暗色：谷地黄 0.20 / 武陵青 0.27
    }
    return cyan ? '#14d0d07a' : '#beaf006b'     // 亮色：谷地黄 0.42 / 武陵青 0.48
  }

  const contourDrawLines = () => {
    if (contourLineCv === null || contourGeom === null) return
    const ctx = contourLineCv.getContext('2d')
    if (!ctx) return
    const { w, h } = contourGeom
    const scale = (w > 0 && typeof contourLineCv.width === 'number' && contourLineCv.width > 0 && contourLineCv.width !== w)
      ? contourLineCv.width / w : 1
    if (scale !== 1 && typeof ctx.setTransform === 'function') ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = contourStroke()
    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    /* Chaikin ×3 预处理 + 约束 Catmull-Rom 三次曲线（切向 0.32、手柄上限 0.62×、端点 0.4/0.55×） */
    const smoothPath = (source) => {
      const count = source.length / 2
      if (count < 3) return source
      let points = []
      for (let k = 0; k < source.length; k += 2) points.push([source[k], source[k + 1]])
      const closed = (points[0][0] - points[points.length - 1][0]) ** 2
        + (points[0][1] - points[points.length - 1][1]) ** 2 < 4
      if (closed) points.pop()
      for (let pass = 0; pass < 3; pass++) {
        const next = []
        const limit = closed ? points.length : points.length - 1
        if (!closed) next.push(points[0])
        for (let k = 0; k < limit; k++) {
          const a = points[k]
          const b = points[(k + 1) % points.length]
          next.push([
            a[0] * 0.75 + b[0] * 0.25,
            a[1] * 0.75 + b[1] * 0.25,
          ], [
            a[0] * 0.25 + b[0] * 0.75,
            a[1] * 0.25 + b[1] * 0.75,
          ])
        }
        if (!closed) next.push(points[points.length - 1])
        points = next
      }
      const result = []
      for (const point of points) result.push(point[0], point[1])
      if (closed) result.push(result[0], result[1])
      return result
    }
    const drawSmoothPath = (source) => {
      const count = source.length / 2
      if (count < 3) {
        ctx.moveTo(source[0], source[1])
        for (let k = 2; k < source.length; k += 2) ctx.lineTo(source[k], source[k + 1])
        return
      }
      const closed = (source[0] - source[source.length - 2]) ** 2
        + (source[1] - source[source.length - 1]) ** 2 < 4
      const limit = closed ? count - 1 : count
      const point = (index) => {
        const k = closed
          ? (index + limit) % limit
          : Math.max(0, Math.min(limit - 1, index))
        return [source[k * 2], source[k * 2 + 1]]
      }
      const tangent = (index) => {
        const current = point(index)
        const previous = point(index - 1)
        const next = point(index + 1)
        let tx, ty, cap
        const incomingX = current[0] - previous[0]
        const incomingY = current[1] - previous[1]
        const outgoingX = next[0] - current[0]
        const outgoingY = next[1] - current[1]
        if (!closed && index === 0) {
          tx = outgoingX * 0.4
          ty = outgoingY * 0.4
          cap = Math.hypot(outgoingX, outgoingY) * 0.55
        } else if (!closed && index === limit - 1) {
          tx = incomingX * 0.4
          ty = incomingY * 0.4
          cap = Math.hypot(incomingX, incomingY) * 0.55
        } else {
          tx = (next[0] - previous[0]) * 0.32
          ty = (next[1] - previous[1]) * 0.32
          cap = Math.min(
            Math.hypot(incomingX, incomingY),
            Math.hypot(outgoingX, outgoingY),
          ) * 0.62
        }
        const length = Math.hypot(tx, ty)
        if (length > cap && length > 0) {
          tx *= cap / length
          ty *= cap / length
        }
        return [tx, ty]
      }
      ctx.moveTo(source[0], source[1])
      const segments = closed ? limit : limit - 1
      for (let k = 0; k < segments; k++) {
        const start = point(k)
        const end = point(k + 1)
        const startTangent = tangent(k)
        const endTangent = tangent(k + 1)
        ctx.bezierCurveTo(
          start[0] + startTangent[0], start[1] + startTangent[1],
          end[0] - endTangent[0], end[1] - endTangent[1],
          end[0], end[1],
        )
      }
      if (closed) ctx.closePath()
    }
    ctx.beginPath()
    for (let i = 0; i < contourPaths.length; i++) drawSmoothPath(smoothPath(contourPaths[i]))
    ctx.stroke()
  }

  /* ---------------- 尺寸：视口大小，DPR 封顶 2 ---------------- */
  const contourSizeTo = () => {
    const w = Math.max(1, Math.round(window.innerWidth))
    const h = Math.max(1, Math.round(window.innerHeight))
    const ratio = (typeof window !== 'undefined'
      && typeof window.devicePixelRatio === 'number'
      && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1
    const dpr = Math.min(2, ratio)
    const bw = Math.max(1, Math.round(w * dpr))
    const bh = Math.max(1, Math.round(h * dpr))
    if (contourGeom !== null && contourGeom.w === w && contourGeom.h === h
      && (contourLineCv === null || (contourLineCv.width === bw && contourLineCv.height === bh))) return false
    contourBuild(w, h)
    if (contourLineCv !== null) {
      contourLineCv.width = bw
      contourLineCv.height = bh
      contourLineCv.style.width = w + 'px'
      contourLineCv.style.height = h + 'px'
    }
    return true
  }

  /* ---------------- 动画循环 ---------------- */
  const contourFrame = () => {
    if (contourWrap === null) {
      contourRaf = null
      return
    }
    if (!contourWantsAnim()) {
      contourRaf = null
      return
    }
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now() : Date.now()
    const fps = readContourFps()
    if (contourLastField < 0 || now - contourLastField >= 1000 / fps) {
      contourLastField = now
      contourPhase += CONTOUR_PHASE_STEP * readContourSpeed()   // 速度改漂移速率，不改刷新率
      contourExtract(contourPhase)
      contourDrawLines()
    }
    contourRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(contourFrame) : null
  }
  const contourStartLoop = () => {
    if (contourRaf !== null) return
    if (typeof requestAnimationFrame !== 'function') return
    if (!contourWantsAnim()) return
    contourLastField = -1
    contourRaf = requestAnimationFrame(contourFrame)
  }
  const contourStopLoop = () => {
    if (contourRaf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(contourRaf)
    contourRaf = null
  }

  const contourTeardown = () => {
    contourStopLoop()
    if (contourRo !== null) {
      contourRo.disconnect()
      contourRo = null
    }
    if (contourWrap !== null && contourWrap.parentNode) contourWrap.parentNode.removeChild(contourWrap)
    contourWrap = null
    contourLineCv = null
    contourPaths = []
    contourField = null
    contourGeom = null
    contourPhase = 0
    contourSwitchSig = ''
  }

  /* 开关调和（动画开/关、滚动暂停恢复时调用） */
  const contourApplySwitches = () => {
    const anim = contourWantsAnim()
    const sig = anim ? 'a' : '-'
    if (sig === contourSwitchSig) return
    contourSwitchSig = sig
    if (!anim && contourWrap !== null && contourGeom !== null) contourDrawLines()
    if (anim) contourStartLoop()
    else contourStopLoop()
  }

  /* ---------------- 滚动暂停（与 endfield 一致） ---------------- */
  const contourPauseOnScroll = () => {
    if (contourWrap === null || !isContourScrollPauseOn() || !isContourAnimOn()) return
    if (!contourScrollPaused) {
      contourScrollPaused = true
      contourSwitchSig = ''
      contourStopLoop()
    }
    if (!contourHasScrollEnd && typeof setTimeout === 'function') {
      if (contourScrollTimer !== null && typeof clearTimeout === 'function') clearTimeout(contourScrollTimer)
      contourScrollTimer = setTimeout(() => {
        contourScrollTimer = null
        contourScrollPaused = false
        contourSwitchSig = ''
        contourApplySwitches()
      }, 10)
    }
  }
  const contourResumeAfterScroll = () => {
    if (!contourScrollPaused) return
    if (contourScrollTimer !== null && typeof clearTimeout === 'function') clearTimeout(contourScrollTimer)
    const resume = () => {
      contourScrollTimer = null
      contourScrollPaused = false
      contourSwitchSig = ''
      if (contourResizePending) {
        contourResizePending = false
        if (contourSizeTo()) {
          contourExtract(contourPhase)
          contourDrawLines()
        }
      }
      contourApplySwitches()
    }
    if (typeof setTimeout === 'function') contourScrollTimer = setTimeout(resume, 10)
    else resume()
  }
  const onContourScroll = () => { contourPauseOnScroll() }
  const onContourScrollEnd = () => { contourResumeAfterScroll() }

  /* ---------------- 挂载（博客宿主） ---------------- */
  const mount = () => {
    if (!isContourOn()) return
    if (typeof document === 'undefined' || document.body === null) return
    if (contourWrap !== null) return
    const wrap = document.createElement('div')
    wrap.id = 'endfield-contour'
    wrap.setAttribute('aria-hidden', 'true')
    const line = document.createElement('canvas')
    wrap.appendChild(line)
    contourLineCv = line
    document.body.appendChild(wrap)
    contourWrap = wrap
    contourSizeTo()
    contourExtract(contourPhase)
    contourDrawLines()
    contourSwitchSig = ''
    // 视口尺寸变化 → 重建
    if (typeof ResizeObserver !== 'undefined') {
      contourRo = new ResizeObserver(() => {
        if (contourScrollPaused) {
          contourResizePending = true
          return
        }
        if (contourSizeTo()) {
          contourExtract(contourPhase)
          contourDrawLines()
        }
      })
      contourRo.observe(document.documentElement)
    }
    // 滚动暂停
    window.addEventListener('scroll', onContourScroll, true)
    window.addEventListener('scrollend', onContourScrollEnd, true)
    // 暗色模式（prefers-color-scheme）与配色 class 变化 → 重绘描边
    if (typeof window.matchMedia === 'function') {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (contourWrap !== null) contourDrawLines()
      })
    }
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        if (contourWrap !== null) contourDrawLines()
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
    }
    contourApplySwitches()
  }

  if (typeof document !== 'undefined') {
    if (document.body !== null) mount()
    else document.addEventListener('DOMContentLoaded', mount, { once: true })
  }

  /* 暴露给设置面板的接口（实时生效，直接调内部 mount/teardown/开关调和） */
  window.endfieldContour = {
    isOn: isContourOn,
    isAnimOn: isContourAnimOn,
    readFps: readContourFps,
    setEnabled (on) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(CONTOUR_KEY, on ? '1' : '0')
      if (on) mount()
      else if (contourWrap !== null) contourTeardown()
    },
    setAnim (on) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(CONTOUR_ANIM_KEY, on ? '1' : '0')
      contourApplySwitches()
    },
    setFps (fps) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(CONTOUR_FPS_KEY, String(fps))
      contourApplySwitches()
    }
  }
})()
