import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { Scene } from '../store/events'
import type { StepInfo, StepState } from '../pipeline/derive'

interface PipelineNodeProps {
  step: StepInfo
  scenes: Scene[]
  selected: boolean
  status: StepState
  onSelect: () => void
  /** Roving tabindex: 0 for the selected node, -1 for the rest (toolbar pattern). */
  tabIndex: number
}

// Static, deterministic viz geometry (no random, no local state — the design's
// motion is entirely CSS keyframes keyed off the node's data-state).
const TYPE_BARS = [86, 62, 78]
const NODE_WAVE = [30, 62, 45, 82, 55, 92, 40, 70, 50, 86, 34, 64]

function wellTag(scene: Scene | undefined, failed: boolean): string {
  if (failed) return '×'
  if (!scene?.materialSource) return '…'
  return scene.materialSource === 'pexels' ? 'PX' : 'LO'
}

function viz(step: StepInfo, scenes: Scene[], t: TFunction): ReactNode {
  switch (step.key) {
    case 'script':
      return (
        <div className="vg-node__typebars">
          {TYPE_BARS.map((w, i) => (
            <div key={i} className="vg-node__typebar" style={{ width: `${w}%`, animationDelay: `${i * 0.22}s` }} />
          ))}
        </div>
      )
    case 'material': {
      if (step.state === 'failed') {
        return <div className="vg-node__failed">{t('node.material.failed')}</div>
      }
      const wells = scenes.length > 0 ? scenes.slice(0, 2) : [undefined, undefined]
      return (
        <div className="vg-node__wells">
          {wells.map((scene, i) => (
            <div key={i} className="vg-node__well">
              <span className="vg-node__well-tag">{wellTag(scene, false)}</span>
            </div>
          ))}
        </div>
      )
    }
    case 'voice':
      return (
        <div className="vg-node__wave">
          {NODE_WAVE.map((h, i) => (
            <div key={i} className="vg-node__wavebar" style={{ height: `${h}%`, animationDelay: `${(i % 5) * 0.11}s` }} />
          ))}
        </div>
      )
    case 'captions': {
      const words = (scenes[0]?.narration ?? t('node.captions.placeholder')).split(' ').slice(0, 4)
      return (
        <div className="vg-node__words" style={{ ['--vg-karaoke-dur' as string]: `${words.length * 0.4}s` }}>
          {words.map((word, i) => (
            <span key={i} className="vg-node__word" style={{ animationDelay: `${i * 0.4}s` }}>
              {word}
            </span>
          ))}
        </div>
      )
    }
    case 'gate': {
      const text =
        step.state === 'awaiting' ? t('node.gate.review') : step.state === 'done' ? t('node.gate.approved') : t('node.gate.waits')
      const sub =
        step.state === 'awaiting'
          ? t('node.gate.reviewSub', { count: scenes.length })
          : step.state === 'done'
            ? t('node.gate.approvedSub')
            : t('node.gate.humanSub')
      return (
        <div className="vg-node__gate">
          <span className="vg-node__gate-text">{text}</span>
          <span className="vg-node__gate-sub">{sub}</span>
        </div>
      )
    }
    case 'render': {
      const pct =
        step.state === 'done' ? t('node.render.done') : step.state === 'running' ? t('node.render.running') : t('node.render.waits')
      return (
        <div className="vg-node__progress">
          <div className="vg-node__progress-track">
            <div className="vg-node__progress-fill" />
          </div>
          <span className="vg-node__progress-pct">{pct}</span>
        </div>
      )
    }
  }
}

export function PipelineNode({ step, scenes, selected, status, onSelect, tabIndex }: PipelineNodeProps) {
  const { t } = useTranslation()
  const classes = [
    'vg-node',
    `vg-node--${step.key}`,
    selected ? 'vg-node--selected' : '',
    status === 'running' ? 'vg-node--running' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="button"
      className={classes}
      data-state={status}
      data-testid={`pipeline-node-${step.key}`}
      tabIndex={tabIndex}
      onClick={onSelect}
    >
      <span className="vg-node__head">
        <span className="vg-node__tally" />
        <span className="vg-node__label">{t(`step.label.${step.key}`)}</span>
      </span>
      <span className="vg-node__viz">{viz(step, scenes, t)}</span>
      <span className="vg-node__foot">
        <span className="vg-node__engine">{step.engine}</span>
        <span className="vg-node__cost">{step.costUsd > 0 ? `$${step.costUsd.toFixed(4)}` : '$0'}</span>
      </span>
    </button>
  )
}
