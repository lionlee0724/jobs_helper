/**
 * 私有区字体自动标定。
 *
 * 问题：BOSS 用 `kanzhun-mix` 把薪资数字映射到私有区码位。静态基准
 * （U+E031='0'）在观测时成立，但这类字体常按会话轮换映射。轮换后解码值会
 * **整体偏移且仍能通过形状校验**（真实 12-15K 解成 23-26K，两者形状都合法），
 * 属于校验无法证伪的失效模式。
 *
 * 解法：不猜映射，直接比字形。把私有区字符与 0-9 用**同一字体**渲染到
 * canvas，比对位图签名得出真实对应关系。
 *
 * 失败即放弃：任一环节不可靠（字体未加载 / 字体不含 ASCII 数字 / 签名重复
 * 或距离过大）一律返回 null，交由上层按「薪资缺失」处理。
 */

const CANVAS_SIZE = 48
const FONT_PX = 36
/** 汉明距离阈值：签名共 SIG_BITS 位，超过此比例视为不同字形 */
const MAX_HAMMING_RATIO = 0.06
const GRID = 16
const SIG_BITS = GRID * GRID

type Signature = Uint8Array

let ctx2d: CanvasRenderingContext2D | null | undefined

function getCtx(): CanvasRenderingContext2D | null {
  if (ctx2d !== undefined) return ctx2d
  try {
    const c = document.createElement('canvas')
    c.width = CANVAS_SIZE
    c.height = CANVAS_SIZE
    ctx2d = c.getContext('2d', { willReadFrequently: true })
  } catch {
    ctx2d = null
  }
  return ctx2d
}

/** 渲染单字符并降采样为 16x16 二值签名 */
function signatureOf(ch: string, font: string): Signature | null {
  const ctx = getCtx()
  if (!ctx) return null
  try {
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    ctx.fillStyle = '#000'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.font = `${FONT_PX}px ${font}`
    ctx.fillText(ch, CANVAS_SIZE / 2, CANVAS_SIZE / 2)

    const img = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    const sig = new Uint8Array(SIG_BITS)
    const cell = CANVAS_SIZE / GRID
    let ink = 0
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        let sum = 0
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const px = Math.floor(gx * cell + x)
            const py = Math.floor(gy * cell + y)
            sum += img.data[(py * CANVAS_SIZE + px) * 4 + 3] // alpha
          }
        }
        const on = sum / (cell * cell) > 40 ? 1 : 0
        sig[gy * GRID + gx] = on
        ink += on
      }
    }
    // 空白字形（字体缺该字符且无 fallback）→ 不可用
    if (ink === 0) return null
    return sig
  } catch {
    return null
  }
}

function hamming(a: Signature, b: Signature): number {
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

const cache = new Map<string, ReadonlyMap<number, string> | null>()

/**
 * 为给定字体与观测到的私有区码位建立映射。
 *
 * @param fontFamily 取自 getComputedStyle(el).fontFamily
 * @param codepoints 页面上实际出现的私有区码位
 */
export function calibratePuaDigits(
  fontFamily: string,
  codepoints: readonly number[],
): ReadonlyMap<number, string> | null {
  if (!fontFamily || !codepoints.length) return null

  const key = fontFamily + '|' + [...codepoints].sort((a, b) => a - b).join(',')
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const result = computeMap(fontFamily, codepoints)
  cache.set(key, result)
  return result
}

function computeMap(
  fontFamily: string,
  codepoints: readonly number[],
): ReadonlyMap<number, string> | null {
  // 1) 基准：同字体下的 0-9 字形
  const digitSigs: Array<{ d: string; sig: Signature }> = []
  for (let d = 0; d <= 9; d++) {
    const sig = signatureOf(String(d), fontFamily)
    if (!sig) return null // 字体不含 ASCII 数字 → 无法比对
    digitSigs.push({ d: String(d), sig })
  }

  // 2) 基准自检：10 个数字字形必须两两可区分，否则渲染不可信
  for (let i = 0; i < digitSigs.length; i++) {
    for (let j = i + 1; j < digitSigs.length; j++) {
      if (hamming(digitSigs[i].sig, digitSigs[j].sig) <= SIG_BITS * MAX_HAMMING_RATIO) {
        return null
      }
    }
  }

  // 3) 逐个私有区码位取最近字形
  const map = new Map<number, string>()
  const used = new Set<string>()
  for (const cp of codepoints) {
    const sig = signatureOf(String.fromCodePoint(cp), fontFamily)
    if (!sig) return null

    let best = -1
    let bestD = Number.POSITIVE_INFINITY
    let secondD = Number.POSITIVE_INFINITY
    for (let i = 0; i < digitSigs.length; i++) {
      const d = hamming(sig, digitSigs[i].sig)
      if (d < bestD) {
        secondD = bestD
        bestD = d
        best = i
      } else if (d < secondD) {
        secondD = d
      }
    }

    // 距离过大 → 该字形不是数字；与次优过于接近 → 判定不稳
    if (best < 0 || bestD > SIG_BITS * MAX_HAMMING_RATIO) return null
    if (secondD - bestD < SIG_BITS * 0.02) return null

    const digit = digitSigs[best].d
    // 同一数字被两个码位命中 → 映射不自洽
    if (used.has(digit)) return null
    used.add(digit)
    map.set(cp, digit)
  }

  return map
}

/** 收集文本中出现的私有区码位 */
export function collectPuaCodepoints(text: string): number[] {
  const out = new Set<number>()
  for (const ch of Array.from(text || '')) {
    const cp = ch.codePointAt(0)
    if (cp != null && cp >= 0xe000 && cp <= 0xf8ff) out.add(cp)
  }
  return [...out]
}

/** 确保字体已加载，避免标定时命中 fallback 字体 */
export async function ensureFontReady(fontFamily: string): Promise<void> {
  try {
    const first = fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
    if (!first) return
    await document.fonts.load(`${FONT_PX}px "${first}"`, '0123456789')
    await document.fonts.ready
  } catch {
    /* 忽略：标定失败会自行返回 null */
  }
}
