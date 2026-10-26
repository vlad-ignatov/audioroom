import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import releaseNotes from '../../scripts/release-notes.cjs'

const { notesFor } = releaseNotes

const CHANGELOG = `# Changelog

Intro text.

## [Unreleased]

### Fixed

- Something not released yet.

## [0.2.0] - 2026-12-01

### Added

- A new thing.

## [0.1.0] - 2026-10-26

The first release.

[Unreleased]: https://example/compare/v0.2.0...HEAD
[0.2.0]: https://example/compare/v0.1.0...v0.2.0
[0.1.0]: https://example/releases/tag/v0.1.0
`

const DOWNLOADS = '## Which file to download\n\nThe table.\n'

describe('release notes', () => {
  it("puts the version's entries above the download instructions", () => {
    const notes = notesFor('0.2.0', CHANGELOG, DOWNLOADS)!
    expect(notes).toMatch(/^## What's new\n\n### Added\n\n- A new thing\./)
    expect(notes).toContain('## Which file to download')
    expect(notes.indexOf('A new thing')).toBeLessThan(notes.indexOf('Which file'))
  })

  it('links the code changes since the previous release', () => {
    expect(notesFor('0.2.0', CHANGELOG, DOWNLOADS)).toContain('/compare/v0.1.0...v0.2.0')
  })

  it('has no compare link for the first release', () => {
    const notes = notesFor('0.1.0', CHANGELOG, DOWNLOADS)!
    expect(notes).toContain('The first release.')
    expect(notes).not.toContain('compare')
  })

  it('leaves out the link definitions at the end of the file', () => {
    expect(notesFor('0.1.0', CHANGELOG, DOWNLOADS)).not.toContain('[0.1.0]:')
  })

  it('refuses a version with no section, or an empty one', () => {
    expect(notesFor('0.3.0', CHANGELOG, DOWNLOADS)).toBeNull()
    expect(notesFor('0.2.0', CHANGELOG.replace('### Added\n\n- A new thing.', ''), DOWNLOADS)).toBeNull()
  })

  it('has notes for the version in package.json', () => {
    // The release workflow fails without them, after the tag is pushed.
    const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const changelog = fs.readFileSync('CHANGELOG.md', 'utf8')
    expect(notesFor(version, changelog, DOWNLOADS)).not.toBeNull()
  })
})
