import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVidgenStore } from '../store/store'
import { Button } from '../ui/Button'
import { LanguageSwitcher } from './LanguageSwitcher'

// Full-screen auth gate. Form-local credential state is ephemeral and never
// shared across components, so useState is the right tool here (this file is
// on the no-react-usestate ast-grep allowlist alongside CreateProjectForm).
export function LoginForm() {
  const { t } = useTranslation()
  const login = useVidgenStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(false)
    try {
      const ok = await login(username.trim(), password)
      if (!ok) setError(true)
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="vg-login">
      <div className="vg-login__bar">
        <span className="vg-login__brand">{t('app.title')}</span>
        <LanguageSwitcher />
      </div>
      <form className="vg-login__card" onSubmit={handleSubmit} aria-label={t('login.aria')}>
        <div className="vg-login__head">
          <h1 className="vg-login__title">{t('login.title')}</h1>
          <p className="vg-login__subtitle">{t('login.subtitle')}</p>
        </div>
        <div className="vg-create__field">
          <label htmlFor="login-username">{t('login.username')}</label>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="vg-create__field">
          <label htmlFor="login-password">{t('login.password')}</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="vg-login__error" role="alert">
            {t('login.error')}
          </p>
        )}
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>
    </main>
  )
}
