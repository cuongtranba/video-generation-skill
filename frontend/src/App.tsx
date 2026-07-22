import { useTranslation } from 'react-i18next'
import { useVidgenStore } from './store/store'
import { Board } from './components/Board'
import { ConnectionStatus } from './components/ConnectionStatus'
import { CreateProjectForm } from './components/CreateProjectForm'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { LoginForm } from './components/LoginForm'
import { Button } from './ui/Button'

export default function App() {
  const { t } = useTranslation()
  const auth = useVidgenStore((s) => s.auth)
  const logout = useVidgenStore((s) => s.logout)

  // Hold the shell blank until the session probe resolves, so the login gate
  // never flashes for an already-authenticated visitor.
  if (auth === 'unknown') return <div className="vg-app vg-app--loading" aria-busy="true" />
  if (auth === 'anonymous') return <LoginForm />

  return (
    <main className="vg-app">
      <header className="vg-app__header">
        <h1>{t('app.title')}</h1>
        <ConnectionStatus />
        <LanguageSwitcher />
        <Button variant="secondary" onClick={() => void logout()}>
          {t('auth.logout')}
        </Button>
      </header>
      <CreateProjectForm />
      <Board />
    </main>
  )
}
