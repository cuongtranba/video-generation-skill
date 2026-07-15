import { useEffect, useRef, useState } from 'react'
import { useVidgenStore, type TuneInput, type UploadedAsset } from '../store/store'
import { DEFAULT_STYLE } from '../store/events'

const VOICES: Array<{ id: string; label: string }> = [
  { id: 'banmai', label: 'banmai — northern female' },
  { id: 'thuminh', label: 'thuminh — northern female' },
  { id: 'lannhi', label: 'lannhi — southern female' },
  { id: 'linhsan', label: 'linhsan — southern female' },
  { id: 'leminh', label: 'leminh — northern male' },
  { id: 'giahuy', label: 'giahuy — central male' },
  { id: 'myan', label: 'myan — central female' },
]

interface TunePanelProps {
  projectId: string
  disabled: boolean
}

export function TunePanel({ projectId, disabled }: TunePanelProps) {
  const style = useVidgenStore((s) => s.projects[projectId]?.style)
  const tuneProject = useVidgenStore((s) => s.tuneProject)
  const uploadAssets = useVidgenStore((s) => s.uploadAssets)
  const fetchAssets = useVidgenStore((s) => s.fetchAssets)

  const cur = style ?? DEFAULT_STYLE

  // Text fields are draft-then-commit: fully-controlled inputs with an
  // onChange that ignored keystrokes would be impossible to type into, so the
  // draft lives in local state and commits (dispatches TuneProject) on blur.
  const [fontName, setFontName] = useState(cur.captionStyle.fontName)
  const [fontSize, setFontSize] = useState(String(cur.captionStyle.fontSize))
  const [musicSearch, setMusicSearch] = useState(cur.music?.search ?? '')

  // Re-seed drafts when the folded style changes underneath us (another tune
  // event, a projection replay). Keyed on the committed values, not the drafts.
  useEffect(() => { setFontName(cur.captionStyle.fontName) }, [cur.captionStyle.fontName])
  useEffect(() => { setFontSize(String(cur.captionStyle.fontSize)) }, [cur.captionStyle.fontSize])
  useEffect(() => { setMusicSearch(cur.music?.search ?? '') }, [cur.music?.search])

  const [assets, setAssets] = useState<UploadedAsset[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function commit(patch: Omit<TuneInput, 'projectId'>) {
    if (disabled) return
    void tuneProject({ projectId, ...patch })
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || disabled) return
    setUploading(true)
    setUploadError(null)
    try {
      await uploadAssets(projectId, Array.from(files))
      setAssets(await fetchAssets(projectId))
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <fieldset className="vg-tune-panel" disabled={disabled} aria-label="Tune settings">
      <legend className="vg-tune-panel__legend">Tune</legend>
      {disabled && (
        <p className="vg-tune-panel__lock" data-testid="tune-panel-lock">
          Locked. Voice, captions, and music are frozen once the storyboard is approved.
        </p>
      )}

      <div className="vg-tune-panel__field">
        <label htmlFor={`voice-${projectId}`}>Voice</label>
        <select
          id={`voice-${projectId}`}
          value={cur.voice}
          onChange={(e) => commit({ voice: e.target.value })}
          aria-label="voice"
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </div>

      <div className="vg-tune-panel__field">
        <label htmlFor={`speed-${projectId}`}>Speed ({cur.speed > 0 ? `+${cur.speed}` : cur.speed})</label>
        <input
          id={`speed-${projectId}`}
          type="range"
          min={-3}
          max={3}
          step={1}
          value={cur.speed}
          onChange={(e) => commit({ speed: Number(e.target.value) })}
          aria-label="speed"
        />
      </div>

      <div className="vg-tune-panel__field">
        <label htmlFor={`font-${projectId}`}>Caption font</label>
        <input
          id={`font-${projectId}`}
          type="text"
          value={fontName}
          onChange={(e) => setFontName(e.target.value)}
          onBlur={() => {
            const name = fontName.trim()
            if (name && name !== cur.captionStyle.fontName) {
              commit({ captionStyle: { ...cur.captionStyle, fontName: name } })
            }
          }}
          aria-label="caption font name"
        />
        <input
          type="number"
          min={8}
          max={200}
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
          onBlur={() => {
            const size = Number(fontSize)
            if (Number.isFinite(size) && size !== cur.captionStyle.fontSize) {
              commit({ captionStyle: { ...cur.captionStyle, fontSize: size } })
            }
          }}
          aria-label="caption font size"
        />
      </div>

      <div className="vg-tune-panel__field">
        <label htmlFor={`music-${projectId}`}>Music search</label>
        <input
          id={`music-${projectId}`}
          type="text"
          placeholder="e.g. upbeat acoustic"
          value={musicSearch}
          onChange={(e) => setMusicSearch(e.target.value)}
          onBlur={() => {
            const search = musicSearch.trim()
            if (search === (cur.music?.search ?? '')) return
            commit({ music: search ? { search, volume: cur.music?.volume ?? 0.3 } : null })
          }}
          aria-label="music search"
        />
        {cur.music && (
          <label className="vg-tune-panel__volume">
            Volume ({Math.round(cur.music.volume * 100)}%)
            <input
              type="range"
              min={0.01}
              max={1}
              step={0.01}
              value={cur.music.volume}
              onChange={(e) => commit({ music: { search: cur.music!.search, volume: Number(e.target.value) } })}
              aria-label="music volume"
            />
          </label>
        )}
      </div>

      <div className="vg-tune-panel__field" data-testid="asset-dropzone">
        <label htmlFor={`assets-${projectId}`}>Local assets (used per scene, in upload order)</label>
        <input
          id={`assets-${projectId}`}
          ref={fileRef}
          type="file"
          accept=".mp4,.mov,.jpg,.jpeg,.png"
          multiple
          disabled={disabled || uploading}
          onChange={(e) => void handleFiles(e.target.files)}
          aria-label="upload local assets"
        />
        {uploading && <span className="vg-tune-panel__status">Uploading…</span>}
        {uploadError && <span className="vg-tune-panel__error" role="alert">{uploadError}</span>}
        {assets.length > 0 && (
          <ul className="vg-tune-panel__assets">
            {assets.map((a) => (
              <li key={a.filename}>{a.filename} ({Math.round(a.sizeBytes / 1024)} KB)</li>
            ))}
          </ul>
        )}
      </div>
    </fieldset>
  )
}
