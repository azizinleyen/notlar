import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { NotifyState } from '@shared/types'

/** Bildirim penceresine ozel, cok kucuk API yuzeyi. */
const notifyApi = {
  action: (action: string): Promise<boolean> => ipcRenderer.invoke(IPC.notifyAction, action),
  onState: (cb: (s: NotifyState) => void): (() => void) => {
    const listener = (_e: unknown, payload: NotifyState): void => cb(payload)
    ipcRenderer.on(IPC.notifyState, listener)
    return () => ipcRenderer.removeListener(IPC.notifyState, listener)
  }
}

contextBridge.exposeInMainWorld('notifyApi', notifyApi)