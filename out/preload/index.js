"use strict";
const electron = require("electron");
const types = require("./chunks/types-CL0W4lZX.js");
const api = {
  appInfo: () => electron.ipcRenderer.invoke(types.IPC.appInfo),
  getSettings: () => electron.ipcRenderer.invoke(types.IPC.settingsGetAll),
  setSetting: (key, value) => electron.ipcRenderer.invoke(types.IPC.settingsSet, key, value),
  listNotes: () => electron.ipcRenderer.invoke(types.IPC.notesList),
  getNote: (id) => electron.ipcRenderer.invoke(types.IPC.notesGet, id),
  createNote: (input) => electron.ipcRenderer.invoke(types.IPC.notesCreate, input),
  deleteNote: (id) => electron.ipcRenderer.invoke(types.IPC.notesDelete, id),
  /** Takvim etkinligine tiklaninca: notu acar/olusturur (kayit BASLATMAZ) */
  createNoteForEvent: (ev) => electron.ipcRenderer.invoke(types.IPC.notesCreateForEvent, ev),
  setRawNotes: (noteId, md) => electron.ipcRenderer.invoke(types.IPC.notesSetRaw, noteId, md),
  setNoteTitle: (noteId, title) => electron.ipcRenderer.invoke(types.IPC.notesSetTitle, noteId, title),
  search: (q) => electron.ipcRenderer.invoke(types.IPC.searchAll, q),
  listTemplates: () => electron.ipcRenderer.invoke(types.IPC.templatesList),
  /** Arayuz hazir sinyali: main, bekleyen isleri ve zamanlayicilari bundan sonra baslatir. */
  rendererReady: () => electron.ipcRenderer.invoke(types.IPC.rendererReady),
  pickAudio: () => electron.ipcRenderer.invoke(types.IPC.dialogPickAudio),
  pickIcs: () => electron.ipcRenderer.invoke(types.IPC.dialogPickIcs),
  importAudio: (req) => electron.ipcRenderer.invoke(types.IPC.notesImportAudio, req),
  // --- FAZ 2: canli kayit ------------------------------------------------
  recordingStart: (req) => electron.ipcRenderer.invoke(types.IPC.recordingStart, req),
  recordingChunk: (req) => electron.ipcRenderer.invoke(types.IPC.recordingChunk, req),
  recordingStop: (noteId) => electron.ipcRenderer.invoke(types.IPC.recordingStop, noteId),
  recordingCancel: (noteId) => electron.ipcRenderer.invoke(types.IPC.recordingCancel, noteId),
  notifyPauseState: (paused) => electron.ipcRenderer.invoke(types.IPC.recordingState, { paused }),
  // --- FAZ 3: otomatik tetikleme ----------------------------------------
  diagnostics: () => electron.ipcRenderer.invoke(types.IPC.diagnostics),
  calendarSync: () => electron.ipcRenderer.invoke(types.IPC.calendarSync),
  calendarEvents: (fromIso) => electron.ipcRenderer.invoke(types.IPC.calendarEvents, fromIso),
  googleStatus: () => electron.ipcRenderer.invoke(types.IPC.googleStatus),
  googlePickCredentials: () => electron.ipcRenderer.invoke(types.IPC.googlePickCredentials),
  googleConnect: () => electron.ipcRenderer.invoke(types.IPC.googleConnect),
  googleDisconnect: () => electron.ipcRenderer.invoke(types.IPC.googleDisconnect),
  googleProcessNote: (noteId) => electron.ipcRenderer.invoke(types.IPC.googleProcessNote, noteId),
  // --- FAZ 4: LLM zenginlestirme -----------------------------------------
  llmProviders: () => electron.ipcRenderer.invoke(types.IPC.llmProviders),
  /** API anahtarini kaydet (Ayarlar ekrani) */
  llmSetKey: (providerId, key) => electron.ipcRenderer.invoke(types.IPC.llmSetKey, providerId, key),
  /** Anahtari saglayiciya sorarak dogrula */
  llmTestKey: (providerId) => electron.ipcRenderer.invoke(types.IPC.llmTestKey, providerId),
  llmModels: (providerId) => electron.ipcRenderer.invoke(types.IPC.llmModels, providerId),
  enhancedVersions: (noteId) => electron.ipcRenderer.invoke(types.IPC.notesEnhancedVersions, noteId),
  enhanceNote: (noteId, templateId) => electron.ipcRenderer.invoke(types.IPC.notesEnhance, noteId, templateId),
  onEnhanceProgress: (cb) => {
    const listener = (_e, payload) => cb(payload);
    electron.ipcRenderer.on(types.IPC.enhanceProgress, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.enhanceProgress, listener);
  },
  // --- FAZ 5: dizin, etiketler, brief, kapsamli soru ----------------------
  directorySummary: () => electron.ipcRenderer.invoke(types.IPC.directorySummary),
  peopleList: (q) => electron.ipcRenderer.invoke(types.IPC.peopleList, q),
  personCreate: (input) => electron.ipcRenderer.invoke(types.IPC.peopleCreate, input),
  personGet: (id) => electron.ipcRenderer.invoke(types.IPC.peopleGet, id),
  personUpdate: (id, patch) => electron.ipcRenderer.invoke(types.IPC.peopleUpdate, id, patch),
  personMerge: (fromId, toId) => electron.ipcRenderer.invoke(types.IPC.peopleMerge, fromId, toId),
  peopleExtract: (noteId) => electron.ipcRenderer.invoke(types.IPC.peopleExtract, noteId),
  peopleDedupe: () => electron.ipcRenderer.invoke(types.IPC.peopleDedupe),
  companiesList: () => electron.ipcRenderer.invoke(types.IPC.companiesList),
  companyGet: (id) => electron.ipcRenderer.invoke(types.IPC.companiesGet, id),
  tagsList: () => electron.ipcRenderer.invoke(types.IPC.tagsList),
  tagAdd: (noteId, name) => electron.ipcRenderer.invoke(types.IPC.tagsAdd, noteId, name),
  tagRemove: (noteId, tagId) => electron.ipcRenderer.invoke(types.IPC.tagsRemove, noteId, tagId),
  transcriptDelete: (id) => electron.ipcRenderer.invoke(types.IPC.transcriptDelete, id),
  transcriptUpdateSpeaker: (id, label) => electron.ipcRenderer.invoke(types.IPC.transcriptUpdateSpeaker, id, label),
  briefGet: (target) => electron.ipcRenderer.invoke(types.IPC.briefGet, target),
  ask: (req) => electron.ipcRenderer.invoke(types.IPC.askScoped, req),
  // --- FAZ 6: sohbet + recipes -------------------------------------------
  chatThreads: () => electron.ipcRenderer.invoke(types.IPC.chatThreads),
  chatEnsureThread: (input) => electron.ipcRenderer.invoke(types.IPC.chatEnsureThread, input),
  chatMessages: (threadId) => electron.ipcRenderer.invoke(types.IPC.chatMessages, threadId),
  chatSend: (threadId, question) => electron.ipcRenderer.invoke(types.IPC.chatSend, threadId, question),
  chatDeleteThread: (threadId) => electron.ipcRenderer.invoke(types.IPC.chatDeleteThread, threadId),
  recipesList: () => electron.ipcRenderer.invoke(types.IPC.recipesList),
  recipesSave: (input) => electron.ipcRenderer.invoke(types.IPC.recipesSave, input),
  recipesDelete: (id) => electron.ipcRenderer.invoke(types.IPC.recipesDelete, id),
  recipesRun: (recipeId, scope) => electron.ipcRenderer.invoke(types.IPC.recipesRun, recipeId, scope),
  // --- FAZ 7: disa aktarma, jargon, guvenlik, saklama -------------------
  exportNotes: (req) => electron.ipcRenderer.invoke(types.IPC.exportNotes, req),
  pickDir: () => electron.ipcRenderer.invoke(types.IPC.dialogPickDir),
  jargonList: () => electron.ipcRenderer.invoke(types.IPC.jargonList),
  jargonSave: (input) => electron.ipcRenderer.invoke(types.IPC.jargonSave, input),
  jargonDelete: (id) => electron.ipcRenderer.invoke(types.IPC.jargonDelete, id),
  securityStatus: () => electron.ipcRenderer.invoke(types.IPC.securityStatus),
  securityEnable: () => electron.ipcRenderer.invoke(types.IPC.securityEnable),
  securityDisable: () => electron.ipcRenderer.invoke(types.IPC.securityDisable),
  securityBackup: () => electron.ipcRenderer.invoke(types.IPC.securityBackup),
  retentionRun: (dryRun) => electron.ipcRenderer.invoke(types.IPC.retentionRun, dryRun),
  deleteAllData: () => electron.ipcRenderer.invoke(types.IPC.deleteAllData),
  onImportProgress: (cb) => {
    const listener = (_e, payload) => cb(payload);
    electron.ipcRenderer.on(types.IPC.importProgress, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.importProgress, listener);
  },
  onRecordingEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    electron.ipcRenderer.on(types.IPC.recordingEvent, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.recordingEvent, listener);
  },
  /** main -> renderer: "kaydi otomatik baslat" */
  onAutoStart: (cb) => {
    const listener = (_e, payload) => cb(payload);
    electron.ipcRenderer.on(types.IPC.triggerAutoStart, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.triggerAutoStart, listener);
  },
  /** main -> renderer: duraklat/devam/durdur/iptal (bildirim penceresinden) */
  onRecorderCommand: (cb) => {
    const listener = (_e, payload) => cb(payload);
    electron.ipcRenderer.on(types.IPC.recorderCommand, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.recorderCommand, listener);
  },
  /** main -> renderer: su notu ac (bildirimden "notu ac") */
  onNoteFocus: (cb) => {
    const listener = (_e, noteId) => cb(noteId);
    electron.ipcRenderer.on(types.IPC.noteFocus, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.noteFocus, listener);
  },
  /** main -> renderer: takvim senkronu bitti (liste tazelensin) */
  onCalendarUpdated: (cb) => {
    const listener = (_e, payload) => cb(payload);
    electron.ipcRenderer.on(types.IPC.calendarUpdated, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.calendarUpdated, listener);
  },
  /** main -> renderer: bilgi bildirimi goster */
  onAppToast: (cb) => {
    const listener = (_e, payload) => cb(payload);
    electron.ipcRenderer.on(types.IPC.appToast, listener);
    return () => electron.ipcRenderer.removeListener(types.IPC.appToast, listener);
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
