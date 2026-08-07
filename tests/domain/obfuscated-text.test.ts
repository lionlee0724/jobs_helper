import { describe, it, expect } from 'vitest'
import {
  decodePuaDigits,
  isPlausibleSalary,
  readSalary,
  hasPuaChars,
  PUA_DIGIT_BASE,
} from '../../extension/content/adapter/boss/obfuscated-text'

/** 用观测基准构造私有区字符串，等价于实页 span.job-salary 的 textContent */
function pua(digits: string): string {
  return Array.from(digits)
    .map((d) => String.fromCodePoint(PUA_DIGIT_BASE + Number(d)))
    .join('')
}

describe('decodePuaDigits — 实页样本还原', () => {
  it('U+E032 U+E033 - U+E032 U+E036 K → 12-15K', () => {
    const raw = '\uE032\uE033-\uE032\uE036K'
    expect(decodePuaDigits(raw).text).toBe('12-15K')
  })

  it('带年终薪样本 → 15-25K·13薪', () => {
    const raw = '\uE032\uE036-\uE033\uE036K·\uE032\uE034薪'
    expect(decodePuaDigits(raw).text).toBe('15-25K·13薪')
  })

  it('纯文本不受影响', () => {
    const r = decodePuaDigits('10年以上')
    expect(r.text).toBe('10年以上')
    expect(r.hadPua).toBe(false)
  })

  it('映射轮换（超出 base..base+9）时返回 null 并记录未映射码位', () => {
    const raw = '\uE100\uE101K'
    const r = decodePuaDigits(raw)
    expect(r.text).toBeNull()
    expect(r.hadPua).toBe(true)
    expect(r.unmapped.length).toBe(2)
  })
})

describe('decodePuaDigits — 标定映射优先于静态基准', () => {
  it('映射轮换后，标定表仍能正确解码', () => {
    // 假设字体改成 U+E100='1', U+E101='2'
    const map = new Map([
      [0xe100, '1'],
      [0xe101, '2'],
    ])
    const raw = '\uE100\uE101K'
    expect(decodePuaDigits(raw).text).toBeNull() // 静态基准失效
    expect(decodePuaDigits(raw, { map }).text).toBe('12K')
  })

  it('标定表缺少某码位时不静默回退到基准', () => {
    const map = new Map([[0xe032, '1']])
    // E033 不在表中 → 必须记为 unmapped，而不是用 base 猜
    const r = decodePuaDigits('\uE032\uE033K', { map })
    expect(r.text).toBeNull()
    expect(r.unmapped).toContain('U+E033')
  })
})

describe('isPlausibleSalary — 拒绝不可解释的值', () => {
  it('接受常见形态', () => {
    expect(isPlausibleSalary('12-15K')).toBe(true)
    expect(isPlausibleSalary('15-25K·13薪')).toBe(true)
    expect(isPlausibleSalary('面议')).toBe(true)
    expect(isPlausibleSalary('200-300元/天')).toBe(true)
  })

  it('拒绝 min>max / 越界 / 异常薪月数', () => {
    expect(isPlausibleSalary('25-15K')).toBe(false)
    expect(isPlausibleSalary('12-9999K')).toBe(false)
    expect(isPlausibleSalary('12-15K·30薪')).toBe(false)
  })

  it('拒绝仍含私有区字符的文本', () => {
    expect(isPlausibleSalary('\uE032\uE033-K')).toBe(false)
  })

  it('拒绝未解码的原始形态 "-K"', () => {
    expect(isPlausibleSalary('-K')).toBe(false)
  })
})

describe('readSalary — 解码与校验的组合闸门', () => {
  it('私有区薪资可还原', () => {
    expect(readSalary(pua('12') + '-' + pua('15') + 'K')).toBe('12-15K')
  })

  it('字体轮换导致解不出 → null（宁缺勿错）', () => {
    expect(readSalary('\uE100\uE101K')).toBeNull()
  })

  it('解出但形状不合理 → null', () => {
    // 25-15K：min>max
    expect(readSalary(pua('25') + '-' + pua('15') + 'K')).toBeNull()
  })

  it('空值安全', () => {
    expect(readSalary(undefined)).toBeNull()
    expect(readSalary('')).toBeNull()
  })
})

describe('hasPuaChars', () => {
  it('识别私有区字符', () => {
    expect(hasPuaChars('\uE032')).toBe(true)
    expect(hasPuaChars('12-15K')).toBe(false)
  })
})
