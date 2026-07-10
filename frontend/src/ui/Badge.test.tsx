import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge tone="good">Live</Badge>)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})
