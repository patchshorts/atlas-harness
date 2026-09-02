import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ATSH_HOME_DISPLAY,
  ATSH_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultAtshHome,
  atshHomeDisplay,
  atshHomePath,
  expandHomePath,
  resolveDshHome,
} from '@atlasai/atsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('atsh path helpers', () => {
  it('owns the shared default ATSH home directory name', () => {
    expect(ATSH_HOME_DIR_NAME).toBe('.atsh')
    expect(DEFAULT_ATSH_HOME_DISPLAY).toBe('~/.atsh')
    expect(defaultAtshHome()).toBe(join(homedir(), '.atsh'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.atsh')).toBe(join(homedir(), '.atsh'))
    expect(expandHomePath('~\\.dsh')).toBe(join(homedir(), '.atsh'))
    expect(expandHomePath('/tmp/.dsh')).toBe('/tmp/.dsh')
    expect(expandHomePath('~other/.dsh')).toBe('~other/.dsh')
  })

  it('resolves explicit path before ATSH_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dsh')

    expect(resolveDshHome('/tmp/explicit-dsh', { ATSH_HOME: '~/env-dsh' })).toBe(resolve('/tmp/explicit-dsh'))
    expect(resolveDshHome(undefined, { ATSH_HOME: '~/env-dsh' })).toBe(envHome)
    expect(resolveDshHome(undefined, {})).toBe(defaultAtshHome())
  })

  it('treats an empty or whitespace-only ATSH_HOME as unset', () => {
    expect(resolveDshHome(undefined, { ATSH_HOME: '' })).toBe(defaultAtshHome())
    expect(resolveDshHome(undefined, { ATSH_HOME: '   ' })).toBe(defaultAtshHome())
  })

  it('joins child segments onto the resolved ATSH_HOME', () => {
    vi.stubEnv('ATSH_HOME', '~/env-dsh')
    expect(atshHomePath()).toBe(join(homedir(), 'env-dsh'))
    expect(atshHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dsh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(atshHomeDisplay(resolve(defaultAtshHome()))).toBe('~/.atsh')
    expect(atshHomeDisplay('/some/other/root')).toBe('$ATSH_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
