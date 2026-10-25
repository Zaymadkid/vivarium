import { contextBridge, ipcRenderer } from "electron";
import { PROVIDER_CATALOG } from "../shared/providers";
import type { ChatEvent, VivApi } from "../shared/types";

const api: VivApi = {
  info: () => ipcRenderer.invoke("viv:info"),
  settings: {
    get: () => ipcRenderer.invoke("viv:settings:get"),
    set: (patch) => ipcRenderer.invoke("viv:settings:set", patch),
    setKey: (key) => ipcRenderer.invoke("viv:settings:setKey", key),
    pickRoot: () => ipcRenderer.invoke("viv:settings:pickRoot"),
  },
  agents: {
    list: () => ipcRenderer.invoke("viv:agents:list"),
    save: (agents) => ipcRenderer.invoke("viv:agents:save", agents),
    setState: (id, state) => ipcRenderer.invoke("viv:agents:state", id, state),
  },
  chat: {
    history: (agentId) => ipcRenderer.invoke("viv:chat:history", agentId),
    send: (agentId, text, spoken) => ipcRenderer.invoke("viv:chat:send", agentId, text, spoken),
    cancel: (runId) => ipcRenderer.invoke("viv:chat:cancel", runId),
    steer: (runId, text) => ipcRenderer.invoke("viv:chat:steer", runId, text),
    clear: () => ipcRenderer.invoke("viv:chat:clear"),
    onEvent: (cb) => {
      const handler = (_e: unknown, payload: ChatEvent) => cb(payload);
      ipcRenderer.on("viv:chat:event", handler);
      return () => ipcRenderer.removeListener("viv:chat:event", handler);
    },
  },
  overlay: {
    show: () => ipcRenderer.invoke("viv:overlay:show"),
    hide: () => ipcRenderer.invoke("viv:overlay:hide"),
    toggle: () => ipcRenderer.invoke("viv:overlay:toggle"),
    talk: () => ipcRenderer.invoke("viv:overlay:talk"),
    resize: (width, height) => ipcRenderer.invoke("viv:overlay:resize", width, height),
    island: (on) => ipcRenderer.invoke("viv:overlay:island", on),
    status: () => ipcRenderer.invoke("viv:overlay:status"),
    onTalk: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("viv:overlay:talk", handler);
      return () => ipcRenderer.removeListener("viv:overlay:talk", handler);
    },
    onPoint: (cb) => {
      const handler = (_e: unknown, payload: { prompt: string }) => cb(payload);
      ipcRenderer.on("viv:overlay:point", handler);
      return () => ipcRenderer.removeListener("viv:overlay:point", handler);
    },
    onNotice: (cb) => {
      const handler = (_e: unknown, text: string) => cb(text);
      ipcRenderer.on("viv:overlay:notice", handler);
      return () => ipcRenderer.removeListener("viv:overlay:notice", handler);
    },
  },
  tools: {
    decide: (requestId, decision) => ipcRenderer.invoke("viv:tools:decide", requestId, decision),
  },
  feedback: {
    rate: (runId, value) => ipcRenderer.invoke("viv:feedback:rate", runId, value),
  },
  memory: {
    list: () => ipcRenderer.invoke("viv:memory:list"),
    add: (text) => ipcRenderer.invoke("viv:memory:add", text),
    update: (id, text) => ipcRenderer.invoke("viv:memory:update", id, text),
    forget: (id) => ipcRenderer.invoke("viv:memory:forget", id),
  },
  skills: {
    list: () => ipcRenderer.invoke("viv:skills:list"),
    save: (skill) => ipcRenderer.invoke("viv:skills:save", skill),
    remove: (id) => ipcRenderer.invoke("viv:skills:remove", id),
  },
  integrations: {
    scan: () => ipcRenderer.invoke("viv:integrations:scan"),
  },
  screen: {
    preview: () => ipcRenderer.invoke("viv:screen:preview"),
    live: () => ipcRenderer.invoke("viv:screen:live"),
    status: () => ipcRenderer.invoke("viv:screen:status"),
    click: (x, y, window) => ipcRenderer.invoke("viv:screen:click", x, y, window),
    type: (text, submit, window) => ipcRenderer.invoke("viv:screen:type", text, submit, window),
    key: (keys, window) => ipcRenderer.invoke("viv:screen:key", keys, window),
    windows: () => ipcRenderer.invoke("viv:screen:windows"),
    ask: () => ipcRenderer.invoke("viv:screen:ask"),
  },
  guide: {
    show: (payload) => ipcRenderer.invoke("viv:guide:show", payload),
    hide: () => ipcRenderer.invoke("viv:guide:hide"),
    status: () => ipcRenderer.invoke("viv:guide:status"),
    step: (delta) => ipcRenderer.invoke("viv:guide:step", delta),
    onState: (cb) => {
      const handler = (_e: unknown, state: Parameters<typeof cb>[0]) => cb(state);
      ipcRenderer.on("viv:guide:state", handler);
      return () => ipcRenderer.removeListener("viv:guide:state", handler);
    },
  },
  vault: {
    list: () => ipcRenderer.invoke("viv:vault:list"),
    add: (input) => ipcRenderer.invoke("viv:vault:add", input),
    import: () => ipcRenderer.invoke("viv:vault:import"),
    importFolder: () => ipcRenderer.invoke("viv:vault:importFolder"),
    search: (query) => ipcRenderer.invoke("viv:vault:search", query),
    read: (id) => ipcRenderer.invoke("viv:vault:read", id),
    forget: (id) => ipcRenderer.invoke("viv:vault:forget", id),
    status: () => ipcRenderer.invoke("viv:vault:status"),
  },
  packs: {
    list: () => ipcRenderer.invoke("viv:packs:list"),
    save: (pack) => ipcRenderer.invoke("viv:packs:save", pack),
    remove: (id) => ipcRenderer.invoke("viv:packs:remove", id),
    attach: (id) => ipcRenderer.invoke("viv:packs:attach", id),
    attached: () => ipcRenderer.invoke("viv:packs:attached"),
  },
  routines: {
    list: () => ipcRenderer.invoke("viv:routines:list"),
    save: (routine) => ipcRenderer.invoke("viv:routines:save", routine),
    remove: (id) => ipcRenderer.invoke("viv:routines:remove", id),
    run: (id) => ipcRenderer.invoke("viv:routines:run", id),
    onFire: (cb) => {
      const handler = (_e: unknown, payload: { title: string; body: string }) => cb(payload);
      ipcRenderer.on("viv:routine:fire", handler);
      return () => ipcRenderer.removeListener("viv:routine:fire", handler);
    },
  },
  usage: {
    get: () => ipcRenderer.invoke("viv:usage:get"),
  },
  audit: {
    list: () => ipcRenderer.invoke("viv:audit:list"),
  },
  data: {
    exportAll: () => ipcRenderer.invoke("viv:data:export"),
    openDataDir: () => ipcRenderer.invoke("viv:data:open"),
    reset: () => ipcRenderer.invoke("viv:data:reset"),
  },
  files: {
    list: () => ipcRenderer.invoke("viv:files:list"),
    read: (target) => ipcRenderer.invoke("viv:files:read", target),
    image: (target) => ipcRenderer.invoke("viv:files:image", target),
    open: (target) => ipcRenderer.invoke("viv:files:open", target),
  },
  voice: {
    status: () => ipcRenderer.invoke("viv:voice:status"),
    setKey: (key) => ipcRenderer.invoke("viv:voice:setKey", key),
    list: () => ipcRenderer.invoke("viv:voice:list"),
    speak: (text) => ipcRenderer.invoke("viv:voice:speak", text),
    transcribe: (bytes, mime) => ipcRenderer.invoke("viv:voice:transcribe", bytes, mime),
    systemVoices: () => ipcRenderer.invoke("viv:voice:systemVoices"),
    systemSpeak: (text, voice) => ipcRenderer.invoke("viv:voice:systemSpeak", text, voice),
    neural: (text, style) => ipcRenderer.invoke("viv:voice:neural", text, style),
    installStt: () => ipcRenderer.invoke("viv:voice:installStt"),
    /** Fast spoken commands that should not wait for a model. */
    action: (text) => ipcRenderer.invoke("viv:voice:action", text),
  },
  providers: PROVIDER_CATALOG,
};

contextBridge.exposeInMainWorld("viv", api);
