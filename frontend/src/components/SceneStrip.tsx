import { useVidgenStore } from '../store/store'

interface SceneStripProps {
  projectId: string
}

export function SceneStrip({ projectId }: SceneStripProps) {
  // `?? []` stays OUTSIDE the selector: returning a fresh [] from the selector
  // makes zustand v5's Object.is equality re-render every commit (infinite loop).
  const scenes = useVidgenStore((state) => state.projects[projectId]?.scenes) ?? []

  if (scenes.length === 0) {
    return <p className="vg-scene-strip vg-scene-strip--empty">No scenes yet</p>
  }

  return (
    <ol className="vg-scene-strip">
      {scenes.map((scene) => (
        <li key={scene.idx} className="vg-scene-strip__item">
          <strong>Scene {scene.idx + 1}</strong>
          <p>{scene.narration}</p>
          <em>{scene.visual}</em>
        </li>
      ))}
    </ol>
  )
}
