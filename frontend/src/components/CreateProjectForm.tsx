import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVidgenStore } from '../store/store'
import { Button } from '../ui/Button'

// Narration language defaults to Vietnamese — vidgen is a Vietnamese-first
// product. This is the content language of the script/voice/captions, distinct
// from the UI language (react-i18next).
const DEFAULTS = { idea: '', durationSec: 16, sceneCount: 2, tone: 'playful', language: 'Vietnamese' }

export function CreateProjectForm() {
  const { t } = useTranslation()
  const createProject = useVidgenStore((s) => s.createProject)
  const [idea, setIdea] = useState(DEFAULTS.idea)
  const [durationSec, setDurationSec] = useState(DEFAULTS.durationSec)
  const [sceneCount, setSceneCount] = useState(DEFAULTS.sceneCount)
  const [tone, setTone] = useState(DEFAULTS.tone)
  const [language, setLanguage] = useState(DEFAULTS.language)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = idea.trim().length > 0 && language.trim().length > 0 && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await createProject({ idea: idea.trim(), durationSec, sceneCount, tone: tone.trim(), language: language.trim() })
      setIdea(DEFAULTS.idea)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="vg-create" onSubmit={handleSubmit} aria-label={t('create.aria')}>
      <div className="vg-create__field vg-create__field--wide">
        <label htmlFor="create-idea">{t('create.idea')}</label>
        <textarea
          id="create-idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={t('create.ideaPlaceholder')}
          rows={2}
          required
        />
      </div>

      <div className="vg-create__field">
        <label htmlFor="create-language">{t('create.language')}</label>
        {/* Freeform: the script, voice, and captions all follow this language. */}
        <input
          id="create-language"
          type="text"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder={t('create.languagePlaceholder')}
          list="create-language-suggestions"
          aria-label={t('create.languageAria')}
        />
        <datalist id="create-language-suggestions">
          <option value="Vietnamese" />
          <option value="English" />
          <option value="Spanish" />
          <option value="French" />
          <option value="Japanese" />
        </datalist>
      </div>

      <div className="vg-create__field">
        <label htmlFor="create-tone">{t('create.tone')}</label>
        <input id="create-tone" type="text" value={tone} onChange={(e) => setTone(e.target.value)} aria-label={t('create.toneAria')} />
      </div>

      <div className="vg-create__field">
        <label htmlFor="create-duration">{t('create.duration')}</label>
        <input
          id="create-duration"
          type="number"
          min={5}
          max={90}
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.target.value))}
          aria-label={t('create.durationAria')}
        />
      </div>

      <div className="vg-create__field">
        <label htmlFor="create-scenes">{t('create.scenes')}</label>
        <input
          id="create-scenes"
          type="number"
          min={1}
          max={10}
          value={sceneCount}
          onChange={(e) => setSceneCount(Number(e.target.value))}
          aria-label={t('create.scenesAria')}
        />
      </div>

      <div className="vg-create__actions">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? t('create.submitting') : t('create.submit')}
        </Button>
      </div>
    </form>
  )
}
