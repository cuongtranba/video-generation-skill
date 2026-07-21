import { Field } from 'frontend'

export function Text() {
  return (
    <Field label="Tone" htmlFor="demo-tone">
      <input id="demo-tone" type="text" defaultValue="playful" />
    </Field>
  )
}

export function Wide() {
  return (
    <Field label="Idea" htmlFor="demo-idea" wide>
      <textarea
        id="demo-idea"
        rows={2}
        defaultValue="a calico cat learns to surf at sunrise"
      />
    </Field>
  )
}

export function Number() {
  return (
    <Field label="Duration (s)" htmlFor="demo-duration">
      <input id="demo-duration" type="number" defaultValue={16} min={5} max={90} />
    </Field>
  )
}
