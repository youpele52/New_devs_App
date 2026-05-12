// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

describe('dom test', () => {
  it('document is available', () => {
    expect(document).toBeDefined()
    const { container } = render(<div data-testid="x">hello</div>)
    expect(container.textContent).toBe('hello')
  })
})
