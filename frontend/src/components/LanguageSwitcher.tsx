import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, setLanguage } from '../i18n'

// Compact mono segmented control (VI | EN) matching the control-room tally
// aesthetic. Language lives in the i18next instance + localStorage (see
// ../i18n), not component state — no cross-component store slice needed.
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const active = i18n.resolvedLanguage
  return (
    <div className="vg-lang" role="group" aria-label={t('nav.language')}>
      {SUPPORTED_LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          className={`vg-lang__opt${active === lng ? ' vg-lang__opt--active' : ''}`}
          aria-pressed={active === lng}
          aria-label={t(`lang.${lng}`)}
          onClick={() => setLanguage(lng)}
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
