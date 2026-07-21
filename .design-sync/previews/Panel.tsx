import { Field, Panel } from 'frontend'

export function Tune() {
  return (
    <Panel legend="Tune">
      <Field label="Voice" htmlFor="demo-voice">
        <select id="demo-voice" defaultValue="banmai">
          <option value="banmai">banmai — northern female</option>
          <option value="giahuy">giahuy — central male</option>
        </select>
      </Field>
      <Field label="Speed (+1)" htmlFor="demo-speed">
        <input id="demo-speed" type="range" min={-3} max={3} defaultValue={1} />
      </Field>
    </Panel>
  )
}

export function Locked() {
  return (
    <Panel legend="Tune" disabled>
      <Field label="Voice" htmlFor="demo-voice-2">
        <select id="demo-voice-2" defaultValue="banmai">
          <option value="banmai">banmai — northern female</option>
        </select>
      </Field>
    </Panel>
  )
}
