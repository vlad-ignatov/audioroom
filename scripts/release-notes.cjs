// The notes for a GitHub release: the version's section of CHANGELOG.md,
// then the download instructions in .github/release-notes.md.
//
//   node scripts/release-notes.cjs 0.2.0 > notes.md
//
// Fails when the changelog has no entries for the version, so a release
// can't go out without saying what changed. The Release workflow runs it
// before building anything.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const REPO = 'https://github.com/vlad-ignatov/audioroom'

/** Each `## [x.y.z] - date` heading, with the text up to the next one. */
function sections(changelog) {
  const out = []
  const heading = /^## \[([^\]]+)\][^\n]*$/gm
  const found = [...changelog.matchAll(heading)]
  found.forEach((m, i) => {
    const start = m.index + m[0].length
    const end = i + 1 < found.length ? found[i + 1].index : changelog.length
    // The link definitions at the bottom of the file belong to no section.
    const body = changelog.slice(start, end).replace(/^\[[^\]]+\]: .*$/gm, '').trim()
    out.push({ version: m[1], body })
  })
  return out
}

/**
 * The release notes for `version`, or null when the changelog has no
 * entries for it.
 */
function notesFor(version, changelog, downloads) {
  const all = sections(changelog)
  const index = all.findIndex((s) => s.version === version)
  if (index < 0 || !all[index].body) return null
  // Sections run newest first; the next one down is the previous release.
  const previous = all.slice(index + 1).find((s) => s.version !== 'Unreleased')
  const compare = previous
    ? `\n\nEvery change in the code: [v${previous.version}...v${version}](${REPO}/compare/v${previous.version}...v${version})`
    : ''
  return `## What's new\n\n${all[index].body}${compare}\n\n${downloads.trim()}\n`
}

if (require.main === module) {
  const version = process.argv[2]?.replace(/^v/, '')
  if (!version) {
    console.error('Usage: node scripts/release-notes.cjs <version>')
    process.exit(2)
  }
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  const downloads = fs.readFileSync(path.join(ROOT, '.github', 'release-notes.md'), 'utf8')
  const notes = notesFor(version, changelog, downloads)
  if (!notes) {
    console.error(
      `CHANGELOG.md has no entries for ${version}. Move the Unreleased entries under\n` +
        `a "## [${version}] - YYYY-MM-DD" heading before releasing.`,
    )
    process.exit(1)
  }
  process.stdout.write(notes)
}

module.exports = { sections, notesFor }
