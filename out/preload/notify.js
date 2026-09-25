"use strict";
const electron = require("electron");
const types = require("./chunks/types-CL0W4lZX.js");
const notifyApi = {
  action: (action) => electron.ipcRenderer.invoke(types.IPC.notifyAction, action),
  onState: (cb) => {
    const listener = (_e, payload) => cb(payload);
    electron.ipcRenderer.on(types.IPC.notifyState, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.notifyState, listener);
  }
};
electron.contextBridge.exposeInMainWorld("notifyApi", notifyApi);
