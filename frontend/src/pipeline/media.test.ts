import { describe, expect, it } from 'bun:test'
import { mediaUrl } from './media'

describe('mediaUrl', () => {
  it('maps an absolute container path to the /media route', () => {
    expect(mediaUrl('proj_8f3ka2', '/app/media/proj_8f3ka2/material0.mp4')).toBe('/media/proj_8f3ka2/material0.mp4')
  })

  it('maps a relative media path', () => {
    expect(mediaUrl('proj_8f3ka2', 'media/proj_8f3ka2/output.mp4')).toBe('/media/proj_8f3ka2/output.mp4')
  })

  it('preserves a nested assets subdirectory', () => {
    expect(mediaUrl('p1', '/app/media/p1/assets/clip.mov')).toBe('/media/p1/assets/clip.mov')
  })

  it('returns undefined when the path does not contain the project segment', () => {
    expect(mediaUrl('p1', '/somewhere/else/file.mp4')).toBeUndefined()
    expect(mediaUrl('p1', undefined)).toBeUndefined()
  })
})
