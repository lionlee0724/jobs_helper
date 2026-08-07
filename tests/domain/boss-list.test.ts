import { describe, expect, it } from 'vitest'
// tab match helpers (pure) — imported from list module without DOM
import { isRealJobDetailHref, jobDetailUrl } from '../../extension/content/adapter/boss/detail'
import {
  detectSourceFromUrl,
  isJobListUrl,
  isSamePageUrl,
  normalizePageUrl,
} from '../../extension/shared/boss-urls'
import {
  isPlausibleJobCard,
  looksLikeCompanyName,
  looksLikeSalary,
  scoreListTabMatch,
} from '../../extension/content/adapter/boss/list'

describe('scoreListTabMatch', () => {
  it('matches truncated 项目经理 tab', () => {
    expect(scoreListTabMatch('项目经理/主管', '项目经理/主…')).toBeGreaterThanOrEqual(60)
    expect(scoreListTabMatch('项目经理/主管', '项目经理/主管')).toBe(100)
  })

  it('does not confuse 销售经理 with 项目经理', () => {
    expect(scoreListTabMatch('项目经理/主管', '销售经理/主管')).toBeLessThan(60)
  })

  it('does not match 推荐 when targeting 项目经理', () => {
    expect(scoreListTabMatch('项目经理/主管', '推荐')).toBe(0)
  })
})

describe('job detail url policy', () => {
  it('never fabricates job_detail from id', () => {
    expect(jobDetailUrl('abcEncrypt123456')).toBeNull()
    expect(jobDetailUrl('hash:123')).toBeNull()
  })

  it('accepts only real job_detail hrefs', () => {
    expect(
      isRealJobDetailHref('https://www.zhipin.com/job_detail/abcEncrypt123456.html'),
    ).toBe(true)
    expect(isRealJobDetailHref('/web/geek/job')).toBe(false)
    expect(isRealJobDetailHref('javascript:;')).toBe(false)
    expect(isRealJobDetailHref(undefined)).toBe(false)
  })
})

describe('list url matching (no refresh loop)', () => {
  it('treats /jobs and /job as list pages without prefix collision', () => {
    expect(isJobListUrl('https://www.zhipin.com/web/geek/jobs')).toBe(true)
    expect(isJobListUrl('https://www.zhipin.com/web/geek/job')).toBe(true)
    expect(isJobListUrl('https://www.zhipin.com/web/geek/job-recommend')).toBe(true)
    expect(isJobListUrl('https://www.zhipin.com/web/geek/chat')).toBe(false)
    expect(isJobListUrl('https://www.zhipin.com/job_detail/xxx.html')).toBe(false)
  })

  it('same page ignores hash and trailing slash', () => {
    expect(
      isSamePageUrl(
        'https://www.zhipin.com/web/geek/jobs',
        'https://www.zhipin.com/web/geek/jobs/',
      ),
    ).toBe(true)
    expect(
      isSamePageUrl(
        'https://www.zhipin.com/web/geek/jobs#x',
        'https://www.zhipin.com/web/geek/jobs',
      ),
    ).toBe(true)
    expect(
      isSamePageUrl(
        'https://www.zhipin.com/web/geek/jobs',
        'https://www.zhipin.com/web/geek/job-recommend',
      ),
    ).toBe(false)
  })

  it('normalizePageUrl is stable', () => {
    expect(normalizePageUrl('https://www.zhipin.com/web/geek/jobs/#a')).toBe(
      'https://www.zhipin.com/web/geek/jobs',
    )
  })

  it('detectSourceFromUrl for jobs is current not forced recommend', () => {
    expect(detectSourceFromUrl('https://www.zhipin.com/web/geek/jobs')).toBe('current')
    expect(detectSourceFromUrl('https://www.zhipin.com/web/geek/job-recommend')).toBe(
      'recommend',
    )
  })
})

describe('job card vs company row', () => {
  it('detects salary text', () => {
    expect(looksLikeSalary('10-15K')).toBe(true)
    expect(looksLikeSalary('9-13K')).toBe(true)
    expect(looksLikeSalary('面议')).toBe(true)
    expect(looksLikeSalary('武汉 蔡甸区')).toBe(false)
  })

  it('detects company-like titles', () => {
    expect(looksLikeCompanyName('武汉浩煌实业')).toBe(true)
    expect(looksLikeCompanyName('武汉光焱科技有限公司')).toBe(true)
    expect(looksLikeCompanyName('装修项目经理（建造师）')).toBe(false)
    expect(looksLikeCompanyName('实施顾问')).toBe(false)
  })

  it('rejects company rows mistaken as jobs', () => {
    expect(
      isPlausibleJobCard({
        title: '武汉浩煌实业',
        company: '武汉浩煌实业',
        salary: undefined,
      }),
    ).toBe(false)
    expect(
      isPlausibleJobCard({
        title: '武汉光焱科技有限公司',
        company: '武汉光焱科技有限公司',
        salary: undefined,
        hasJobTitleEl: true,
      }),
    ).toBe(false)
    expect(
      isPlausibleJobCard({
        title: '达梦数据库',
        company: '达梦数据库',
        salary: undefined,
      }),
    ).toBe(false)
  })

  it('accepts real job cards', () => {
    expect(
      isPlausibleJobCard({
        title: '装修项目经理（建造师）',
        company: '武汉浩煌实业',
        salary: '10-15K',
        hasJobTitleEl: true,
      }),
    ).toBe(true)
    expect(
      isPlausibleJobCard({
        title: '实施顾问',
        company: '武汉光焱科技有限公司',
        salary: '10-15K',
        hasJobTitleEl: true,
      }),
    ).toBe(true)
    expect(
      isPlausibleJobCard({
        title: '项目管理工程师',
        company: '达梦数据库',
        salary: '9-13K',
        href: 'https://www.zhipin.com/job_detail/abc123.html',
        hasJobTitleEl: true,
      }),
    ).toBe(true)
  })
})