import { describe, expect, it } from 'vitest'
import { sanitizeClipboardHTML } from './paste'

describe('rich-text clipboard sanitization', () => {
  it('keeps supported formatting and removes remote resources and active content', () => {
    const result = sanitizeClipboardHTML(
      '<p style="font-size:14pt;color:red;background-image:url(https://bad.test/x)">Hi <strong>there</strong></p><img src="https://bad.test/x"><script>alert(1)</script><iframe src="https://bad.test"></iframe>',
    )
    expect(result).toContain('<strong>there</strong>')
    expect(result).toContain('14pt')
    expect(result).not.toMatch(/img|script|iframe|https:|url\(/)
  })

  it('keeps useful formatting from office clipboard markup and removes noisy metadata', () => {
    const result = sanitizeClipboardHTML(`
      <!--[if gte mso 9]><xml>settings</xml><![endif]-->
      <p class="MsoNormal" style="mso-margin-top-alt:auto;text-align:center">
        <span style="font-weight:700;font-style:italic;text-decoration:underline;color:#123456;font-size:16px">Formatted</span>
        <o:p>&nbsp;</o:p>
      </p>
      <style>.MsoNormal { behavior: url(evil) }</style>
    `)
    expect(result).toContain('Formatted')
    expect(result).toContain('font-weight: 700')
    expect(result).toContain('font-style: italic')
    expect(result).toContain('text-decoration: underline')
    expect(result).toMatch(/color: (?:#123456|rgb\(18, 52, 86\))/)
    expect(result).toContain('font-size: 12pt')
    expect(result).toContain('text-align: center')
    expect(result).not.toMatch(/Mso|class=|behavior|<style|<xml/i)
  })

  it('keeps safe web links and strips unsafe links, classes and tracking pixels', () => {
    const result = sanitizeClipboardHTML(`
      <p class="article"><a href="https://example.test/path">Safe</a>
      <a href="javascript:alert(1)">Unsafe</a>
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" width="1" height="1"></p>
    `)
    expect(result).toContain('href="https://example.test/path"')
    expect(result).toContain('rel="noopener noreferrer"')
    expect(result).toContain('Unsafe')
    expect(result).not.toMatch(/javascript:|data:image|<img|class=/i)
  })
})
