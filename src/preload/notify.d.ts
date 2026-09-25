import type { NotifyState } from '@shared/types'

declare global {
  interface Window {
    notifyApi: {
      action: (action: string) => Promise<boolean>
      onState: (cb: (s: NotifyState) => void) => () => void
    }
  }
}

export {}