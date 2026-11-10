export const PR_STATE_COLOR = { OPEN: 'blue', MERGED: 'green', DECLINED: 'red', SUPERSEDED: 'gray' } as const
export const prStateColor = (s: string) => PR_STATE_COLOR[s as keyof typeof PR_STATE_COLOR] ?? 'gray'

export const BUILD_COLOR = { SUCCESSFUL: 'green', FAILED: 'red', INPROGRESS: 'blue', STOPPED: 'gray' } as const
export const buildColor = (s: string) => BUILD_COLOR[s as keyof typeof BUILD_COLOR] ?? 'gray'
