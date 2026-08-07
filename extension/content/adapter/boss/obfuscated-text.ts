/**
 * BOSS 私有区字体混淆解码。
 *
 * 实页证据（2026-07 探针）：
 *   span.job-salary  text="-K"  fontFamily="kanzhun-mix, kanzhun-Regular"
 *   codepoints = U+E032 U+E033 U+002D U+E032 U+E036 U+004B
 *   innerHTML === text，::before/::after 均为 none，无子节点
 *
 * 即数字被替换为 Unicode 私有区码位，由自定义字体渲染成字形；
 * textContent 读不到真实数字。
 *
 * 关键风险：这类字体常按会话/页面轮换映射。因此本模块**不信任**静态映射的
 * 结果，必须经 `isPlausibleSalary` 形状与数值校验；校验不过一律返回 null，
 * 宁可没有薪资，也不能把错误数字喂给匹配决策。
 */

/** 观测基准：U+E031='0' … U+E03A='9' */
export const PUA_DIGIT_BASE = 0xe031

const PUA_START = 0xe000
const PUA_END = 0xf8ff

export function isPuaChar(ch: string): boolean {
  const cp = ch.codePointAt(0)
  return cp != null && cp >= PUA_START && cp <= PUA_END
}

export function hasPuaChars(text: string): boolean {
  return Array.from(text || '').some(isPuaChar)
}

export type DecodeResult = {
  /** 解码后的文本；存在无法映射的私有区字符时为 null */
  text: string | null
  /** 是否出现过私有区字符 */
  hadPua: boolean
  /** 无法映射的码位（用于诊断字体轮换） */
  unmapped: string[]
}

export type DecodeOptions = {
  /** 静态基准（无标定表时使用） */
  base?: number
  /**
   * 字形标定得到的码位→数字映射。
   * 优先于 base；存在时可抵御字体映射轮换。
   */
  map?: ReadonlyMap<number, string>
}

/**
 * 把私有区字符还原为数字。
 *
 * 优先用标定映射；无标定时回退到静态基准。
 * 任何无法映射的私有区码位 → 记为 unmapped 并返回 null。
 */
export function decodePuaDigits(
  text: string,
  opts: DecodeOptions = {},
): DecodeResult {
  const { base = PUA_DIGIT_BASE, map } = opts
  if (!text) return { text: text ?? '', hadPua: false, unmapped: [] }

  let hadPua = false
  const unmapped: string[] = []
  let out = ''

  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0)!
    if (cp < PUA_START || cp > PUA_END) {
      out += ch
      continue
    }
    hadPua = true
    const mapped = map?.get(cp)
    if (mapped != null) {
      out += mapped
      continue
    }
    const d = map ? -1 : cp - base
    if (d >= 0 && d <= 9) {
      out += String(d)
    } else {
      unmapped.push('U+' + cp.toString(16).toUpperCase().padStart(4, '0'))
      out += ch
    }
  }

  return { text: unmapped.length ? null : out, hadPua, unmapped }
}

/**
 * 薪资形状与数值校验。
 *
 * 只接受能明确解释的形态，例如：
 *   12-15K / 12-20K·13薪 / 8-10K / 100-150元/天 / 面议
 * 拒绝越界值（如 0 或 999K）与 min>max，避免字体轮换后解出的假数字通过。
 */
export function isPlausibleSalary(s: string | null | undefined): boolean {
  if (!s) return false
  const t = s.trim()
  if (!t) return false
  if (/面议/.test(t)) return true
  if (hasPuaChars(t)) return false

  // 12-15K·13薪 / 12-15K
  const kRange = t.match(/^(\d{1,4})\s*-\s*(\d{1,4})\s*[KkWw千万]?(?:·\s*(\d{1,2})\s*薪)?$/)
  if (kRange) {
    const min = Number(kRange[1])
    const max = Number(kRange[2])
    const months = kRange[3] ? Number(kRange[3]) : undefined
    if (!(min > 0 && max > 0 && min <= max)) return false
    if (max > 999) return false
    if (months != null && (months < 12 || months > 24)) return false
    return true
  }

  // 日结/元区间：100-150元/天
  if (/^\d{2,6}\s*-\s*\d{2,6}\s*元/.test(t)) return true

  return false
}

/**
 * 读取可能被字体混淆的文本。
 *
 * 返回 null 表示「读不到可信值」——调用方应当把它当作缺失，而不是空串。
 */
export function readObfuscatedText(
  raw: string,
  opts: DecodeOptions = {},
): {
  value: string | null
  hadPua: boolean
  unmapped: string[]
} {
  const r = decodePuaDigits(raw, opts)
  return { value: r.text, hadPua: r.hadPua, unmapped: r.unmapped }
}

/**
 * 专用于薪资：解码 + 校验，任何一步不过关都返回 null。
 */
export function readSalary(
  raw: string | null | undefined,
  opts: DecodeOptions = {},
): string | null {
  if (!raw) return null
  const { value } = readObfuscatedText(raw, opts)
  if (!value) return null
  const cleaned = value.replace(/\s+/g, '')
  return isPlausibleSalary(cleaned) ? cleaned : null
}
