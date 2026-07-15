import { useState } from 'react'
import { useVidgenStore } from '../store/store'
import { Button } from '../ui/Button'

const DEFAULTS = { idea: '', durationSec: 16, sceneCount: 2, tone: 'playful', language: 'English' }

export function CreateProjectForm() {
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
    <form className="vg-create" onSubmit={handleSubmit} aria-label="Create project">
      <div className="vg-create__field vg-create__field--wide">
        <label htmlFor="create-idea">Idea</label>
        <textarea
          id="create-idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g. a calico cat learns to surf at sunrise"
          rows={2}
          required
        />
      </div>

      <div className="vg-create__field">
        <label htmlFor="create-language">Language</label>
        {/* Freeform: the script, voice, and captions all follow this language. */}
        <input
          id="create-language"
          type="text"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="English, Vietnamese, Français…"
          list="create-language-suggestions"
          aria-label="narration language"
        />
        <datalist id="create-language-suggestions">
          <option value="English" />
          <option value="Vietnamese" />
          <option value="Spanish" />
          <option value="French" />
          <option value="Japanese" />
        </datalist>
      </div>

      <div className="vg-create__field">
        <label htmlFor="create-tone">Tone</label>
        <input id="create-tone" type="text" value={tone} onChange={(e) => setTone(e.target.value)} aria-label="tone" />
      </div>

      <div className="vg-create__field">
        <label htmlFor="create-duration">Duration (s)</label>
        <input
          id="create-duration"
          type="number"
          min={5}
          max={90}
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.target.value))}
          aria-label="duration seconds"
        />
      </div>

      <div className="vg-create__field">
        <label htmlFor="create-scenes">Scenes</label>
        <input
          id="create-scenes"
          type="number"
          min={1}
          max={10}
          value={sceneCount}
          onChange={(e) => setSceneCount(Number(e.target.value))}
          aria-label="scene count"
        />
      </div>

      <div className="vg-create__actions">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? 'Creating…' : 'Create project'}
        </Button>
      </div>
    </form>
  )
}
