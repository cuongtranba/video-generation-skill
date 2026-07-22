import { afterEach, describe, expect, it } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n, { setLanguage } from '../i18n'
import { LanguageSwitcher } from './LanguageSwitcher'

afterEach(() => {
  // Reset to the product default so language state does not leak across tests.
  setLanguage('vi')
})

describe('LanguageSwitcher', () => {
  it('renders VI and EN with Vietnamese active by default', () => {
    render(<LanguageSwitcher />)
    const vi = screen.getByRole('button', { name: /tiếng việt/i })
    const en = screen.getByRole('button', { name: /english/i })
    expect(vi).toHaveAttribute('aria-pressed', 'true')
    expect(en).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches the active language to English on click', () => {
    render(<LanguageSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /english/i }))
    expect(i18n.resolvedLanguage).toBe('en')
  })
})
