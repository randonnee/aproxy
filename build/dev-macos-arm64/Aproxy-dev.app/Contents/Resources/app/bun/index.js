// @bun
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __moduleCache = /* @__PURE__ */ new WeakMap;
var __toCommonJS = (from) => {
  var entry = __moduleCache.get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function")
    __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
      get: () => from[key],
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    }));
  __moduleCache.set(from, entry);
  return entry;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __promiseAll = (args) => Promise.all(args);

// node_modules/electrobun/dist/api/bun/events/event.ts
class ElectrobunEvent {
  name;
  data;
  _response;
  responseWasSet = false;
  constructor(name, data) {
    this.name = name;
    this.data = data;
  }
  get response() {
    return this._response;
  }
  set response(value) {
    this._response = value;
    this.responseWasSet = true;
  }
  clearResponse() {
    this._response = undefined;
    this.responseWasSet = false;
  }
}

// node_modules/electrobun/dist/api/bun/events/windowEvents.ts
var windowEvents_default;
var init_windowEvents = __esm(() => {
  windowEvents_default = {
    close: (data) => new ElectrobunEvent("close", data),
    resize: (data) => new ElectrobunEvent("resize", data),
    move: (data) => new ElectrobunEvent("move", data),
    focus: (data) => new ElectrobunEvent("focus", data)
  };
});

// node_modules/electrobun/dist/api/bun/events/webviewEvents.ts
var webviewEvents_default;
var init_webviewEvents = __esm(() => {
  webviewEvents_default = {
    willNavigate: (data) => new ElectrobunEvent("will-navigate", data),
    didNavigate: (data) => new ElectrobunEvent("did-navigate", data),
    didNavigateInPage: (data) => new ElectrobunEvent("did-navigate-in-page", data),
    didCommitNavigation: (data) => new ElectrobunEvent("did-commit-navigation", data),
    domReady: (data) => new ElectrobunEvent("dom-ready", data),
    newWindowOpen: (data) => new ElectrobunEvent("new-window-open", data),
    hostMessage: (data) => new ElectrobunEvent("host-message", data),
    downloadStarted: (data) => new ElectrobunEvent("download-started", data),
    downloadProgress: (data) => new ElectrobunEvent("download-progress", data),
    downloadCompleted: (data) => new ElectrobunEvent("download-completed", data),
    downloadFailed: (data) => new ElectrobunEvent("download-failed", data)
  };
});

// node_modules/electrobun/dist/api/bun/events/trayEvents.ts
var trayEvents_default;
var init_trayEvents = __esm(() => {
  trayEvents_default = {
    trayClicked: (data) => new ElectrobunEvent("tray-clicked", data)
  };
});

// node_modules/electrobun/dist/api/bun/events/ApplicationEvents.ts
var ApplicationEvents_default;
var init_ApplicationEvents = __esm(() => {
  ApplicationEvents_default = {
    applicationMenuClicked: (data) => new ElectrobunEvent("application-menu-clicked", data),
    contextMenuClicked: (data) => new ElectrobunEvent("context-menu-clicked", data),
    openUrl: (data) => new ElectrobunEvent("open-url", data),
    beforeQuit: (data) => new ElectrobunEvent("before-quit", data)
  };
});

// node_modules/electrobun/dist/api/bun/events/eventEmitter.ts
import EventEmitter from "events";
var ElectrobunEventEmitter, electrobunEventEmitter, eventEmitter_default;
var init_eventEmitter = __esm(() => {
  init_windowEvents();
  init_webviewEvents();
  init_trayEvents();
  init_ApplicationEvents();
  ElectrobunEventEmitter = class ElectrobunEventEmitter extends EventEmitter {
    constructor() {
      super();
    }
    emitEvent(ElectrobunEvent2, specifier) {
      if (specifier) {
        this.emit(`${ElectrobunEvent2.name}-${specifier}`, ElectrobunEvent2);
      } else {
        this.emit(ElectrobunEvent2.name, ElectrobunEvent2);
      }
    }
    events = {
      window: {
        ...windowEvents_default
      },
      webview: {
        ...webviewEvents_default
      },
      tray: {
        ...trayEvents_default
      },
      app: {
        ...ApplicationEvents_default
      }
    };
  };
  electrobunEventEmitter = new ElectrobunEventEmitter;
  eventEmitter_default = electrobunEventEmitter;
});

// node_modules/electrobun/dist/api/shared/rpc.ts
function missingTransportMethodError(methods, action) {
  const methodsString = methods.map((m) => `"${m}"`).join(", ");
  return new Error(`This RPC instance cannot ${action} because the transport did not provide one or more of these methods: ${methodsString}`);
}
function createRPC(options = {}) {
  let debugHooks = {};
  let transport = {};
  let requestHandler = undefined;
  function setTransport(newTransport) {
    if (transport.unregisterHandler)
      transport.unregisterHandler();
    transport = newTransport;
    transport.registerHandler?.(handler);
  }
  function setRequestHandler(h) {
    if (typeof h === "function") {
      requestHandler = h;
      return;
    }
    requestHandler = (method, params) => {
      const handlerFn = h[method];
      if (handlerFn)
        return handlerFn(params);
      const fallbackHandler = h._;
      if (!fallbackHandler)
        throw new Error(`The requested method has no handler: ${String(method)}`);
      return fallbackHandler(method, params);
    };
  }
  const { maxRequestTime = DEFAULT_MAX_REQUEST_TIME } = options;
  if (options.transport)
    setTransport(options.transport);
  if (options.requestHandler)
    setRequestHandler(options.requestHandler);
  if (options._debugHooks)
    debugHooks = options._debugHooks;
  let lastRequestId = 0;
  function getRequestId() {
    if (lastRequestId <= MAX_ID)
      return ++lastRequestId;
    return lastRequestId = 0;
  }
  const requestListeners = new Map;
  const requestTimeouts = new Map;
  function requestFn(method, ...args) {
    const params = args[0];
    return new Promise((resolve, reject) => {
      if (!transport.send)
        throw missingTransportMethodError(["send"], "make requests");
      const requestId = getRequestId();
      const request2 = {
        type: "request",
        id: requestId,
        method,
        params
      };
      requestListeners.set(requestId, { resolve, reject });
      if (maxRequestTime !== Infinity)
        requestTimeouts.set(requestId, setTimeout(() => {
          requestTimeouts.delete(requestId);
          reject(new Error("RPC request timed out."));
        }, maxRequestTime));
      debugHooks.onSend?.(request2);
      transport.send(request2);
    });
  }
  const request = new Proxy(requestFn, {
    get: (target, prop, receiver) => {
      if (prop in target)
        return Reflect.get(target, prop, receiver);
      return (params) => requestFn(prop, params);
    }
  });
  const requestProxy = request;
  function sendFn(message, ...args) {
    const payload = args[0];
    if (!transport.send)
      throw missingTransportMethodError(["send"], "send messages");
    const rpcMessage = {
      type: "message",
      id: message,
      payload
    };
    debugHooks.onSend?.(rpcMessage);
    transport.send(rpcMessage);
  }
  const send = new Proxy(sendFn, {
    get: (target, prop, receiver) => {
      if (prop in target)
        return Reflect.get(target, prop, receiver);
      return (payload) => sendFn(prop, payload);
    }
  });
  const sendProxy = send;
  const messageListeners = new Map;
  const wildcardMessageListeners = new Set;
  function addMessageListener(message, listener) {
    if (!transport.registerHandler)
      throw missingTransportMethodError(["registerHandler"], "register message listeners");
    if (message === "*") {
      wildcardMessageListeners.add(listener);
      return;
    }
    if (!messageListeners.has(message))
      messageListeners.set(message, new Set);
    messageListeners.get(message).add(listener);
  }
  function removeMessageListener(message, listener) {
    if (message === "*") {
      wildcardMessageListeners.delete(listener);
      return;
    }
    messageListeners.get(message)?.delete(listener);
    if (messageListeners.get(message)?.size === 0)
      messageListeners.delete(message);
  }
  async function handler(message) {
    debugHooks.onReceive?.(message);
    if (!("type" in message))
      throw new Error("Message does not contain a type.");
    if (message.type === "request") {
      if (!transport.send || !requestHandler)
        throw missingTransportMethodError(["send", "requestHandler"], "handle requests");
      const { id, method, params } = message;
      let response;
      try {
        response = {
          type: "response",
          id,
          success: true,
          payload: await requestHandler(method, params)
        };
      } catch (error) {
        if (!(error instanceof Error))
          throw error;
        response = {
          type: "response",
          id,
          success: false,
          error: error.message
        };
      }
      debugHooks.onSend?.(response);
      transport.send(response);
      return;
    }
    if (message.type === "response") {
      const timeout = requestTimeouts.get(message.id);
      if (timeout != null)
        clearTimeout(timeout);
      const { resolve, reject } = requestListeners.get(message.id) ?? {};
      if (!message.success)
        reject?.(new Error(message.error));
      else
        resolve?.(message.payload);
      return;
    }
    if (message.type === "message") {
      for (const listener of wildcardMessageListeners)
        listener(message.id, message.payload);
      const listeners = messageListeners.get(message.id);
      if (!listeners)
        return;
      for (const listener of listeners)
        listener(message.payload);
      return;
    }
    throw new Error(`Unexpected RPC message type: ${message.type}`);
  }
  const proxy = { send: sendProxy, request: requestProxy };
  return {
    setTransport,
    setRequestHandler,
    request,
    requestProxy,
    send,
    sendProxy,
    addMessageListener,
    removeMessageListener,
    proxy
  };
}
function defineElectrobunRPC(_side, config) {
  const rpcOptions = {
    maxRequestTime: config.maxRequestTime,
    requestHandler: {
      ...config.handlers.requests,
      ...config.extraRequestHandlers
    },
    transport: {
      registerHandler: () => {}
    }
  };
  const rpc = createRPC(rpcOptions);
  const messageHandlers = config.handlers.messages;
  if (messageHandlers) {
    rpc.addMessageListener("*", (messageName, payload) => {
      const globalHandler = messageHandlers["*"];
      if (globalHandler) {
        globalHandler(messageName, payload);
      }
      const messageHandler = messageHandlers[messageName];
      if (messageHandler) {
        messageHandler(payload);
      }
    });
  }
  return rpc;
}
var MAX_ID = 10000000000, DEFAULT_MAX_REQUEST_TIME = 1000;

// node_modules/electrobun/dist/api/shared/platform.ts
import { platform, arch } from "os";
var platformName, archName, OS, ARCH;
var init_platform = __esm(() => {
  platformName = platform();
  archName = arch();
  OS = (() => {
    switch (platformName) {
      case "win32":
        return "win";
      case "darwin":
        return "macos";
      case "linux":
        return "linux";
      default:
        throw new Error(`Unsupported platform: ${platformName}`);
    }
  })();
  ARCH = (() => {
    if (OS === "win") {
      return "x64";
    }
    switch (archName) {
      case "arm64":
        return "arm64";
      case "x64":
        return "x64";
      default:
        throw new Error(`Unsupported architecture: ${archName}`);
    }
  })();
});

// node_modules/electrobun/dist/api/shared/naming.ts
function sanitizeAppName(appName) {
  return appName.replace(/ /g, "");
}
function getAppFileName(appName, buildEnvironment) {
  const sanitized = sanitizeAppName(appName);
  return buildEnvironment === "stable" ? sanitized : `${sanitized}-${buildEnvironment}`;
}
function getPlatformPrefix(buildEnvironment, os, arch2) {
  return `${buildEnvironment}-${os}-${arch2}`;
}
function getTarballFileName(appFileName, os) {
  return os === "macos" ? `${appFileName}.app.tar.zst` : `${appFileName}.tar.zst`;
}

// node_modules/electrobun/dist/api/bun/core/Utils.ts
var exports_Utils = {};
__export(exports_Utils, {
  showNotification: () => showNotification,
  showMessageBox: () => showMessageBox,
  showItemInFolder: () => showItemInFolder,
  quit: () => quit,
  paths: () => paths,
  openPath: () => openPath,
  openFileDialog: () => openFileDialog,
  openExternal: () => openExternal,
  moveToTrash: () => moveToTrash,
  clipboardWriteText: () => clipboardWriteText,
  clipboardWriteImage: () => clipboardWriteImage,
  clipboardReadText: () => clipboardReadText,
  clipboardReadImage: () => clipboardReadImage,
  clipboardClear: () => clipboardClear,
  clipboardAvailableFormats: () => clipboardAvailableFormats
});
import { homedir, tmpdir } from "os";
import { join } from "path";
import { readFileSync } from "fs";
function getLinuxXdgUserDirs() {
  try {
    const content = readFileSync(join(home, ".config", "user-dirs.dirs"), "utf-8");
    const dirs = {};
    for (const line of content.split(`
`)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("="))
        continue;
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx);
      let value = trimmed.slice(eqIdx + 1);
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      value = value.replace(/\$HOME/g, home);
      dirs[key] = value;
    }
    return dirs;
  } catch {
    return {};
  }
}
function xdgUserDir(key, fallbackName) {
  if (OS !== "linux")
    return "";
  if (!_xdgUserDirs)
    _xdgUserDirs = getLinuxXdgUserDirs();
  return _xdgUserDirs[key] || join(home, fallbackName);
}
function getVersionInfo() {
  if (_versionInfo)
    return _versionInfo;
  try {
    const resourcesDir = "Resources";
    const raw = readFileSync(join("..", resourcesDir, "version.json"), "utf-8");
    const parsed = JSON.parse(raw);
    _versionInfo = { identifier: parsed.identifier, channel: parsed.channel };
    return _versionInfo;
  } catch (error) {
    console.error("Failed to read version.json", error);
    throw error;
  }
}
function getAppDataDir() {
  switch (OS) {
    case "macos":
      return join(home, "Library", "Application Support");
    case "win":
      return process.env["LOCALAPPDATA"] || join(home, "AppData", "Local");
    case "linux":
      return process.env["XDG_DATA_HOME"] || join(home, ".local", "share");
  }
}
function getCacheDir() {
  switch (OS) {
    case "macos":
      return join(home, "Library", "Caches");
    case "win":
      return process.env["LOCALAPPDATA"] || join(home, "AppData", "Local");
    case "linux":
      return process.env["XDG_CACHE_HOME"] || join(home, ".cache");
  }
}
function getLogsDir() {
  switch (OS) {
    case "macos":
      return join(home, "Library", "Logs");
    case "win":
      return process.env["LOCALAPPDATA"] || join(home, "AppData", "Local");
    case "linux":
      return process.env["XDG_STATE_HOME"] || join(home, ".local", "state");
  }
}
function getConfigDir() {
  switch (OS) {
    case "macos":
      return join(home, "Library", "Application Support");
    case "win":
      return process.env["APPDATA"] || join(home, "AppData", "Roaming");
    case "linux":
      return process.env["XDG_CONFIG_HOME"] || join(home, ".config");
  }
}
function getUserDir(macName, winName, xdgKey, fallbackName) {
  switch (OS) {
    case "macos":
      return join(home, macName);
    case "win": {
      const userProfile = process.env["USERPROFILE"] || home;
      return join(userProfile, winName);
    }
    case "linux":
      return xdgUserDir(xdgKey, fallbackName);
  }
}
var moveToTrash = (path) => {
  return ffi.request.moveToTrash({ path });
}, showItemInFolder = (path) => {
  return ffi.request.showItemInFolder({ path });
}, openExternal = (url) => {
  return ffi.request.openExternal({ url });
}, openPath = (path) => {
  return ffi.request.openPath({ path });
}, showNotification = (options) => {
  const { title, body, subtitle, silent } = options;
  ffi.request.showNotification({ title, body, subtitle, silent });
}, isQuitting = false, quit = () => {
  if (isQuitting)
    return;
  isQuitting = true;
  const beforeQuitEvent = electrobunEventEmitter.events.app.beforeQuit({});
  electrobunEventEmitter.emitEvent(beforeQuitEvent);
  if (beforeQuitEvent.responseWasSet && beforeQuitEvent.response?.allow === false) {
    isQuitting = false;
    return;
  }
  native.symbols.stopEventLoop();
  native.symbols.waitForShutdownComplete(5000);
  native.symbols.forceExit(0);
}, openFileDialog = async (opts = {}) => {
  const optsWithDefault = {
    ...{
      startingFolder: "~/",
      allowedFileTypes: "*",
      canChooseFiles: true,
      canChooseDirectory: true,
      allowsMultipleSelection: true
    },
    ...opts
  };
  const result = await ffi.request.openFileDialog({
    startingFolder: optsWithDefault.startingFolder,
    allowedFileTypes: optsWithDefault.allowedFileTypes,
    canChooseFiles: optsWithDefault.canChooseFiles,
    canChooseDirectory: optsWithDefault.canChooseDirectory,
    allowsMultipleSelection: optsWithDefault.allowsMultipleSelection
  });
  const filePaths = result.split(",");
  return filePaths;
}, showMessageBox = async (opts = {}) => {
  const {
    type = "info",
    title = "",
    message = "",
    detail = "",
    buttons = ["OK"],
    defaultId = 0,
    cancelId = -1
  } = opts;
  const response = ffi.request.showMessageBox({
    type,
    title,
    message,
    detail,
    buttons,
    defaultId,
    cancelId
  });
  return { response };
}, clipboardReadText = () => {
  return ffi.request.clipboardReadText();
}, clipboardWriteText = (text) => {
  ffi.request.clipboardWriteText({ text });
}, clipboardReadImage = () => {
  return ffi.request.clipboardReadImage();
}, clipboardWriteImage = (pngData) => {
  ffi.request.clipboardWriteImage({ pngData });
}, clipboardClear = () => {
  ffi.request.clipboardClear();
}, clipboardAvailableFormats = () => {
  return ffi.request.clipboardAvailableFormats();
}, home, _xdgUserDirs, _versionInfo, paths;
var init_Utils = __esm(async () => {
  init_eventEmitter();
  init_platform();
  await init_native();
  process.exit = (code) => {
    if (isQuitting) {
      native.symbols.forceExit(code ?? 0);
      return;
    }
    quit();
  };
  home = homedir();
  paths = {
    get home() {
      return home;
    },
    get appData() {
      return getAppDataDir();
    },
    get config() {
      return getConfigDir();
    },
    get cache() {
      return getCacheDir();
    },
    get temp() {
      return tmpdir();
    },
    get logs() {
      return getLogsDir();
    },
    get documents() {
      return getUserDir("Documents", "Documents", "XDG_DOCUMENTS_DIR", "Documents");
    },
    get downloads() {
      return getUserDir("Downloads", "Downloads", "XDG_DOWNLOAD_DIR", "Downloads");
    },
    get desktop() {
      return getUserDir("Desktop", "Desktop", "XDG_DESKTOP_DIR", "Desktop");
    },
    get pictures() {
      return getUserDir("Pictures", "Pictures", "XDG_PICTURES_DIR", "Pictures");
    },
    get music() {
      return getUserDir("Music", "Music", "XDG_MUSIC_DIR", "Music");
    },
    get videos() {
      return getUserDir("Movies", "Videos", "XDG_VIDEOS_DIR", "Videos");
    },
    get userData() {
      const { identifier, channel } = getVersionInfo();
      return join(getAppDataDir(), identifier, channel);
    },
    get userCache() {
      const { identifier, channel } = getVersionInfo();
      return join(getCacheDir(), identifier, channel);
    },
    get userLogs() {
      const { identifier, channel } = getVersionInfo();
      return join(getLogsDir(), identifier, channel);
    }
  };
});

// node_modules/electrobun/dist/api/bun/core/Updater.ts
import { join as join2, dirname, resolve } from "path";
import { homedir as homedir2 } from "os";
import {
  renameSync,
  unlinkSync,
  mkdirSync,
  rmdirSync,
  statSync,
  readdirSync
} from "fs";
import { execSync } from "child_process";
function emitStatus(status, message, details) {
  const entry = {
    status,
    message,
    timestamp: Date.now(),
    details
  };
  statusHistory.push(entry);
  if (onStatusChangeCallback) {
    onStatusChangeCallback(entry);
  }
}
function getAppDataDir2() {
  switch (OS) {
    case "macos":
      return join2(homedir2(), "Library", "Application Support");
    case "win":
      return process.env["LOCALAPPDATA"] || join2(homedir2(), "AppData", "Local");
    case "linux":
      return process.env["XDG_DATA_HOME"] || join2(homedir2(), ".local", "share");
    default:
      return join2(homedir2(), ".config");
  }
}
function cleanupExtractionFolder(extractionFolder, keepTarHash) {
  const keepFile = `${keepTarHash}.tar`;
  try {
    const entries = readdirSync(extractionFolder);
    for (const entry of entries) {
      if (entry === keepFile)
        continue;
      const fullPath = join2(extractionFolder, entry);
      try {
        const s = statSync(fullPath);
        if (s.isDirectory()) {
          rmdirSync(fullPath, { recursive: true });
        } else {
          unlinkSync(fullPath);
        }
      } catch (e) {}
    }
  } catch (e) {}
}
var statusHistory, onStatusChangeCallback = null, localInfo, updateInfo, Updater;
var init_Updater = __esm(async () => {
  init_platform();
  await init_Utils();
  statusHistory = [];
  Updater = {
    updateInfo: () => {
      return updateInfo;
    },
    getStatusHistory: () => {
      return [...statusHistory];
    },
    clearStatusHistory: () => {
      statusHistory.length = 0;
    },
    onStatusChange: (callback) => {
      onStatusChangeCallback = callback;
    },
    checkForUpdate: async () => {
      emitStatus("checking", "Checking for updates...");
      const localInfo2 = await Updater.getLocallocalInfo();
      if (localInfo2.channel === "dev") {
        emitStatus("no-update", "Dev channel - updates disabled", {
          currentHash: localInfo2.hash
        });
        return {
          version: localInfo2.version,
          hash: localInfo2.hash,
          updateAvailable: false,
          updateReady: false,
          error: ""
        };
      }
      const cacheBuster = Math.random().toString(36).substring(7);
      const platformPrefix = getPlatformPrefix(localInfo2.channel, OS, ARCH);
      const updateInfoUrl = `${localInfo2.baseUrl.replace(/\/+$/, "")}/${platformPrefix}-update.json?${cacheBuster}`;
      try {
        const updateInfoResponse = await fetch(updateInfoUrl);
        if (updateInfoResponse.ok) {
          const responseText = await updateInfoResponse.text();
          try {
            updateInfo = JSON.parse(responseText);
          } catch {
            emitStatus("error", "Invalid update.json: failed to parse JSON", {
              url: updateInfoUrl
            });
            return {
              version: "",
              hash: "",
              updateAvailable: false,
              updateReady: false,
              error: `Invalid update.json: failed to parse JSON`
            };
          }
          if (!updateInfo.hash) {
            emitStatus("error", "Invalid update.json: missing hash", {
              url: updateInfoUrl
            });
            return {
              version: "",
              hash: "",
              updateAvailable: false,
              updateReady: false,
              error: `Invalid update.json: missing hash`
            };
          }
          if (updateInfo.hash !== localInfo2.hash) {
            updateInfo.updateAvailable = true;
            emitStatus("update-available", `Update available: ${localInfo2.hash.slice(0, 8)} \u2192 ${updateInfo.hash.slice(0, 8)}`, {
              currentHash: localInfo2.hash,
              latestHash: updateInfo.hash
            });
          } else {
            emitStatus("no-update", "Already on latest version", {
              currentHash: localInfo2.hash
            });
          }
        } else {
          emitStatus("error", `Failed to fetch update info (HTTP ${updateInfoResponse.status})`, { url: updateInfoUrl });
          return {
            version: "",
            hash: "",
            updateAvailable: false,
            updateReady: false,
            error: `Failed to fetch update info from ${updateInfoUrl}`
          };
        }
      } catch (error) {
        return {
          version: "",
          hash: "",
          updateAvailable: false,
          updateReady: false,
          error: `Failed to fetch update info from ${updateInfoUrl}`
        };
      }
      return updateInfo;
    },
    downloadUpdate: async () => {
      emitStatus("download-starting", "Starting update download...");
      const appDataFolder = await Updater.appDataFolder();
      await Updater.channelBucketUrl();
      const appFileName = localInfo.name;
      let currentHash = (await Updater.getLocallocalInfo()).hash;
      let latestHash = (await Updater.checkForUpdate()).hash;
      const extractionFolder = join2(appDataFolder, "self-extraction");
      if (!await Bun.file(extractionFolder).exists()) {
        mkdirSync(extractionFolder, { recursive: true });
      }
      let currentTarPath = join2(extractionFolder, `${currentHash}.tar`);
      const latestTarPath = join2(extractionFolder, `${latestHash}.tar`);
      const seenHashes = [];
      let patchesApplied = 0;
      let usedPatchPath = false;
      if (!await Bun.file(latestTarPath).exists()) {
        emitStatus("checking-local-tar", `Checking for local tar file: ${currentHash.slice(0, 8)}`, { currentHash });
        while (currentHash !== latestHash) {
          seenHashes.push(currentHash);
          const currentTar = Bun.file(currentTarPath);
          if (!await currentTar.exists()) {
            emitStatus("local-tar-missing", `Local tar not found for ${currentHash.slice(0, 8)}, will download full bundle`, { currentHash });
            break;
          }
          emitStatus("local-tar-found", `Found local tar for ${currentHash.slice(0, 8)}`, { currentHash });
          const platformPrefix = getPlatformPrefix(localInfo.channel, OS, ARCH);
          const patchUrl = `${localInfo.baseUrl.replace(/\/+$/, "")}/${platformPrefix}-${currentHash}.patch`;
          emitStatus("fetching-patch", `Checking for patch: ${currentHash.slice(0, 8)}`, { currentHash, url: patchUrl });
          const patchResponse = await fetch(patchUrl);
          if (!patchResponse.ok) {
            emitStatus("patch-not-found", `No patch available for ${currentHash.slice(0, 8)}, will download full bundle`, { currentHash });
            break;
          }
          emitStatus("patch-found", `Patch found for ${currentHash.slice(0, 8)}`, { currentHash });
          emitStatus("downloading-patch", `Downloading patch for ${currentHash.slice(0, 8)}...`, { currentHash });
          const patchFilePath = join2(appDataFolder, "self-extraction", `${currentHash}.patch`);
          await Bun.write(patchFilePath, await patchResponse.arrayBuffer());
          const tmpPatchedTarFilePath = join2(appDataFolder, "self-extraction", `from-${currentHash}.tar`);
          const bunBinDir = dirname(process.execPath);
          const bspatchBinName = OS === "win" ? "bspatch.exe" : "bspatch";
          const bspatchPath = join2(bunBinDir, bspatchBinName);
          emitStatus("applying-patch", `Applying patch ${patchesApplied + 1} for ${currentHash.slice(0, 8)}...`, {
            currentHash,
            patchNumber: patchesApplied + 1
          });
          if (!statSync(bspatchPath, { throwIfNoEntry: false })) {
            emitStatus("patch-failed", `bspatch binary not found at ${bspatchPath}`, {
              currentHash,
              errorMessage: `bspatch not found: ${bspatchPath}`
            });
            console.error("bspatch not found:", bspatchPath);
            break;
          }
          if (!statSync(currentTarPath, { throwIfNoEntry: false })) {
            emitStatus("patch-failed", `Old tar not found at ${currentTarPath}`, {
              currentHash,
              errorMessage: `old tar not found: ${currentTarPath}`
            });
            console.error("old tar not found:", currentTarPath);
            break;
          }
          if (!statSync(patchFilePath, { throwIfNoEntry: false })) {
            emitStatus("patch-failed", `Patch file not found at ${patchFilePath}`, {
              currentHash,
              errorMessage: `patch not found: ${patchFilePath}`
            });
            console.error("patch file not found:", patchFilePath);
            break;
          }
          try {
            const patchResult = Bun.spawnSync([
              bspatchPath,
              currentTarPath,
              tmpPatchedTarFilePath,
              patchFilePath
            ]);
            if (patchResult.exitCode !== 0 || patchResult.success === false) {
              const stderr = patchResult.stderr ? patchResult.stderr.toString() : "";
              const stdout = patchResult.stdout ? patchResult.stdout.toString() : "";
              if (updateInfo) {
                updateInfo.error = stderr || `bspatch failed with exit code ${patchResult.exitCode}`;
              }
              emitStatus("patch-failed", `Patch application failed: ${stderr || `exit code ${patchResult.exitCode}`}`, {
                currentHash,
                errorMessage: stderr || `exit code ${patchResult.exitCode}`
              });
              console.error("bspatch failed", {
                exitCode: patchResult.exitCode,
                stdout,
                stderr,
                bspatchPath,
                oldTar: currentTarPath,
                newTar: tmpPatchedTarFilePath,
                patch: patchFilePath
              });
              break;
            }
          } catch (error) {
            emitStatus("patch-failed", `Patch threw exception: ${error.message}`, {
              currentHash,
              errorMessage: error.message
            });
            console.error("bspatch threw", error, { bspatchPath });
            break;
          }
          patchesApplied++;
          emitStatus("patch-applied", `Patch ${patchesApplied} applied successfully`, {
            currentHash,
            patchNumber: patchesApplied
          });
          emitStatus("extracting-version", "Extracting version info from patched tar...", { currentHash });
          let hashFilePath = "";
          const resourcesDir = "Resources";
          const patchedTarBytes = await Bun.file(tmpPatchedTarFilePath).arrayBuffer();
          const patchedArchive = new Bun.Archive(patchedTarBytes);
          const patchedFiles = await patchedArchive.files();
          for (const [filePath] of patchedFiles) {
            if (filePath.endsWith(`${resourcesDir}/version.json`) || filePath.endsWith("metadata.json")) {
              hashFilePath = filePath;
              break;
            }
          }
          if (!hashFilePath) {
            emitStatus("error", "Could not find version/metadata file in patched tar", { currentHash });
            console.error("Neither Resources/version.json nor metadata.json found in patched tar:", tmpPatchedTarFilePath);
            break;
          }
          const hashFile = patchedFiles.get(hashFilePath);
          const hashFileJson = JSON.parse(await hashFile.text());
          const nextHash = hashFileJson.hash;
          if (seenHashes.includes(nextHash)) {
            emitStatus("error", "Cyclical update detected, falling back to full download", { currentHash: nextHash });
            console.log("Warning: cyclical update detected");
            break;
          }
          seenHashes.push(nextHash);
          if (!nextHash) {
            emitStatus("error", "Could not determine next hash from patched tar", { currentHash });
            break;
          }
          const updatedTarPath = join2(appDataFolder, "self-extraction", `${nextHash}.tar`);
          renameSync(tmpPatchedTarFilePath, updatedTarPath);
          unlinkSync(currentTarPath);
          unlinkSync(patchFilePath);
          currentHash = nextHash;
          currentTarPath = join2(appDataFolder, "self-extraction", `${currentHash}.tar`);
          emitStatus("patch-applied", `Patched to ${nextHash.slice(0, 8)}, checking for more patches...`, {
            currentHash: nextHash,
            toHash: latestHash,
            totalPatchesApplied: patchesApplied
          });
        }
        if (currentHash === latestHash && patchesApplied > 0) {
          usedPatchPath = true;
          emitStatus("patch-chain-complete", `Patch chain complete! Applied ${patchesApplied} patches`, {
            totalPatchesApplied: patchesApplied,
            currentHash: latestHash,
            usedPatchPath: true
          });
        }
        if (currentHash !== latestHash) {
          emitStatus("downloading-full-bundle", "Downloading full update bundle...", {
            currentHash,
            latestHash,
            usedPatchPath: false
          });
          const cacheBuster = Math.random().toString(36).substring(7);
          const platformPrefix = getPlatformPrefix(localInfo.channel, OS, ARCH);
          const tarballName = getTarballFileName(appFileName, OS);
          const urlToLatestTarball = `${localInfo.baseUrl.replace(/\/+$/, "")}/${platformPrefix}-${tarballName}`;
          const prevVersionCompressedTarballPath = join2(appDataFolder, "self-extraction", "latest.tar.zst");
          emitStatus("download-progress", `Fetching ${tarballName}...`, {
            url: urlToLatestTarball
          });
          const response = await fetch(urlToLatestTarball + `?${cacheBuster}`);
          if (response.ok && response.body) {
            const contentLength = response.headers.get("content-length");
            const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;
            let bytesDownloaded = 0;
            const reader = response.body.getReader();
            const writer = Bun.file(prevVersionCompressedTarballPath).writer();
            while (true) {
              const { done, value } = await reader.read();
              if (done)
                break;
              await writer.write(value);
              bytesDownloaded += value.length;
              if (bytesDownloaded % 500000 < value.length) {
                emitStatus("download-progress", `Downloading: ${(bytesDownloaded / 1024 / 1024).toFixed(1)} MB`, {
                  bytesDownloaded,
                  totalBytes,
                  progress: totalBytes ? Math.round(bytesDownloaded / totalBytes * 100) : undefined
                });
              }
            }
            await writer.flush();
            writer.end();
            emitStatus("download-progress", `Download complete: ${(bytesDownloaded / 1024 / 1024).toFixed(1)} MB`, {
              bytesDownloaded,
              totalBytes,
              progress: 100
            });
          } else {
            emitStatus("error", `Failed to download: ${urlToLatestTarball}`, {
              url: urlToLatestTarball
            });
            console.log("latest version not found at: ", urlToLatestTarball);
          }
          emitStatus("decompressing", "Decompressing update bundle...");
          const bunBinDir = dirname(process.execPath);
          const zstdBinName = OS === "win" ? "zig-zstd.exe" : "zig-zstd";
          const zstdPath = join2(bunBinDir, zstdBinName);
          if (!statSync(zstdPath, { throwIfNoEntry: false })) {
            updateInfo.error = `zig-zstd not found: ${zstdPath}`;
            emitStatus("error", updateInfo.error, { zstdPath });
            console.error("zig-zstd not found:", zstdPath);
          } else {
            const decompressResult = Bun.spawnSync([
              zstdPath,
              "decompress",
              "-i",
              prevVersionCompressedTarballPath,
              "-o",
              latestTarPath,
              "--no-timing"
            ], {
              cwd: extractionFolder,
              stdout: "inherit",
              stderr: "inherit"
            });
            if (!decompressResult.success) {
              updateInfo.error = `zig-zstd failed with exit code ${decompressResult.exitCode}`;
              emitStatus("error", updateInfo.error, {
                zstdPath,
                exitCode: decompressResult.exitCode
              });
              console.error("zig-zstd failed", {
                exitCode: decompressResult.exitCode,
                zstdPath
              });
            } else {
              emitStatus("decompressing", "Decompression complete");
            }
          }
          unlinkSync(prevVersionCompressedTarballPath);
        }
      }
      if (await Bun.file(latestTarPath).exists()) {
        updateInfo.updateReady = true;
        emitStatus("download-complete", `Update ready to install (used ${usedPatchPath ? "patch" : "full download"} path)`, {
          latestHash,
          usedPatchPath,
          totalPatchesApplied: patchesApplied
        });
      } else {
        updateInfo.error = "Failed to download latest version";
        emitStatus("error", "Failed to download latest version", { latestHash });
      }
      cleanupExtractionFolder(extractionFolder, latestHash);
    },
    applyUpdate: async () => {
      if (updateInfo?.updateReady) {
        emitStatus("applying", "Starting update installation...");
        const appDataFolder = await Updater.appDataFolder();
        const extractionFolder = join2(appDataFolder, "self-extraction");
        if (!await Bun.file(extractionFolder).exists()) {
          mkdirSync(extractionFolder, { recursive: true });
        }
        let latestHash = (await Updater.checkForUpdate()).hash;
        const latestTarPath = join2(extractionFolder, `${latestHash}.tar`);
        let appBundleSubpath = "";
        if (await Bun.file(latestTarPath).exists()) {
          emitStatus("extracting", `Extracting update to ${latestHash.slice(0, 8)}...`, { latestHash });
          const extractionDir = OS === "win" ? join2(extractionFolder, `temp-${latestHash}`) : extractionFolder;
          if (OS === "win") {
            mkdirSync(extractionDir, { recursive: true });
          }
          const latestTarBytes = await Bun.file(latestTarPath).arrayBuffer();
          const latestArchive = new Bun.Archive(latestTarBytes);
          await latestArchive.extract(extractionDir);
          if (OS === "macos") {
            const extractedFiles = readdirSync(extractionDir);
            for (const file of extractedFiles) {
              if (file.endsWith(".app")) {
                appBundleSubpath = file + "/";
                break;
              }
            }
          } else {
            appBundleSubpath = "./";
          }
          console.log(`Tar extraction completed. Found appBundleSubpath: ${appBundleSubpath}`);
          if (!appBundleSubpath) {
            console.error("Failed to find app in tarball");
            return;
          }
          const extractedAppPath = resolve(join2(extractionDir, appBundleSubpath));
          let newAppBundlePath;
          if (OS === "linux") {
            const extractedFiles = readdirSync(extractionDir);
            const appBundleDir = extractedFiles.find((file) => {
              const filePath = join2(extractionDir, file);
              return statSync(filePath).isDirectory() && !file.endsWith(".tar");
            });
            if (!appBundleDir) {
              console.error("Could not find app bundle directory in extraction");
              return;
            }
            newAppBundlePath = join2(extractionDir, appBundleDir);
            const bundleStats = statSync(newAppBundlePath, { throwIfNoEntry: false });
            if (!bundleStats || !bundleStats.isDirectory()) {
              console.error(`App bundle directory not found at: ${newAppBundlePath}`);
              console.log("Contents of extraction directory:");
              try {
                const files = readdirSync(extractionDir);
                for (const file of files) {
                  console.log(`  - ${file}`);
                  const subPath = join2(extractionDir, file);
                  if (statSync(subPath).isDirectory()) {
                    const subFiles = readdirSync(subPath);
                    for (const subFile of subFiles) {
                      console.log(`    - ${subFile}`);
                    }
                  }
                }
              } catch (e) {
                console.log("Could not list directory contents:", e);
              }
              return;
            }
          } else if (OS === "win") {
            const appBundleName = getAppFileName(localInfo.name, localInfo.channel);
            newAppBundlePath = join2(extractionDir, appBundleName);
            if (!statSync(newAppBundlePath, { throwIfNoEntry: false })) {
              console.error(`Extracted app not found at: ${newAppBundlePath}`);
              console.log("Contents of extraction directory:");
              try {
                const files = readdirSync(extractionDir);
                for (const file of files) {
                  console.log(`  - ${file}`);
                }
              } catch (e) {
                console.log("Could not list directory contents:", e);
              }
              return;
            }
          } else {
            newAppBundlePath = extractedAppPath;
          }
          let runningAppBundlePath;
          const appDataFolder2 = await Updater.appDataFolder();
          if (OS === "macos") {
            runningAppBundlePath = resolve(dirname(process.execPath), "..", "..");
          } else if (OS === "linux" || OS === "win") {
            runningAppBundlePath = join2(appDataFolder2, "app");
          } else {
            throw new Error(`Unsupported platform: ${OS}`);
          }
          try {
            emitStatus("replacing-app", "Removing old version...");
            if (OS === "macos") {
              if (statSync(runningAppBundlePath, { throwIfNoEntry: false })) {
                rmdirSync(runningAppBundlePath, { recursive: true });
              }
              emitStatus("replacing-app", "Installing new version...");
              renameSync(newAppBundlePath, runningAppBundlePath);
              try {
                execSync(`xattr -r -d com.apple.quarantine "${runningAppBundlePath}"`, { stdio: "ignore" });
              } catch (e) {}
            } else if (OS === "linux") {
              const appBundleDir = join2(appDataFolder2, "app");
              if (statSync(appBundleDir, { throwIfNoEntry: false })) {
                rmdirSync(appBundleDir, { recursive: true });
              }
              renameSync(newAppBundlePath, appBundleDir);
              const launcherPath = join2(appBundleDir, "bin", "launcher");
              if (statSync(launcherPath, { throwIfNoEntry: false })) {
                execSync(`chmod +x "${launcherPath}"`);
              }
              const bunPath = join2(appBundleDir, "bin", "bun");
              if (statSync(bunPath, { throwIfNoEntry: false })) {
                execSync(`chmod +x "${bunPath}"`);
              }
            }
            if (OS !== "win") {
              cleanupExtractionFolder(extractionFolder, latestHash);
            }
            if (OS === "win") {
              const parentDir = dirname(runningAppBundlePath);
              const updateScriptPath = join2(parentDir, "update.bat");
              const launcherPath = join2(runningAppBundlePath, "bin", "launcher.exe");
              const runningAppWin = runningAppBundlePath.replace(/\//g, "\\");
              const newAppWin = newAppBundlePath.replace(/\//g, "\\");
              const extractionDirWin = extractionDir.replace(/\//g, "\\");
              const launcherPathWin = launcherPath.replace(/\//g, "\\");
              const updateScript = `@echo off
setlocal

:: Wait for the app to fully exit (check if launcher.exe is still running)
:waitloop
tasklist /FI "IMAGENAME eq launcher.exe" 2>NUL | find /I /N "launcher.exe">NUL
if "%ERRORLEVEL%"=="0" (
    timeout /t 1 /nobreak >nul
    goto waitloop
)

:: Small extra delay to ensure all file handles are released
timeout /t 2 /nobreak >nul

:: Remove current app folder
if exist "${runningAppWin}" (
    rmdir /s /q "${runningAppWin}"
)

:: Move new app to current location
move "${newAppWin}" "${runningAppWin}"

:: Clean up extraction directory
rmdir /s /q "${extractionDirWin}" 2>nul

:: Launch the new app
start "" "${launcherPathWin}"

:: Clean up scheduled tasks starting with ElectrobunUpdate_
for /f "tokens=1" %%t in ('schtasks /query /fo list ^| findstr /i "ElectrobunUpdate_"') do (
    schtasks /delete /tn "%%t" /f >nul 2>&1
)

:: Delete this update script after a short delay
ping -n 2 127.0.0.1 >nul
del "%~f0"
`;
              await Bun.write(updateScriptPath, updateScript);
              const scriptPathWin = updateScriptPath.replace(/\//g, "\\");
              const taskName = `ElectrobunUpdate_${Date.now()}`;
              execSync(`schtasks /create /tn "${taskName}" /tr "cmd /c \\"${scriptPathWin}\\"" /sc once /st 00:00 /f`, { stdio: "ignore" });
              execSync(`schtasks /run /tn "${taskName}"`, { stdio: "ignore" });
              quit();
            }
          } catch (error) {
            emitStatus("error", `Failed to replace app: ${error.message}`, {
              errorMessage: error.message
            });
            console.error("Failed to replace app with new version", error);
            return;
          }
          emitStatus("launching-new-version", "Launching updated version...");
          if (OS === "macos") {
            const pid = process.pid;
            Bun.spawn([
              "sh",
              "-c",
              `while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done; sleep 1; open "${runningAppBundlePath}"`
            ], {
              detached: true,
              stdio: ["ignore", "ignore", "ignore"]
            });
          } else if (OS === "linux") {
            const launcherPath = join2(runningAppBundlePath, "bin", "launcher");
            Bun.spawn(["sh", "-c", `"${launcherPath}" &`], {
              detached: true
            });
          }
          emitStatus("complete", "Update complete, restarting application...");
          quit();
        }
      }
    },
    channelBucketUrl: async () => {
      await Updater.getLocallocalInfo();
      return localInfo.baseUrl;
    },
    appDataFolder: async () => {
      await Updater.getLocallocalInfo();
      const appDataFolder = join2(getAppDataDir2(), localInfo.identifier, localInfo.channel);
      return appDataFolder;
    },
    localInfo: {
      version: async () => {
        return (await Updater.getLocallocalInfo()).version;
      },
      hash: async () => {
        return (await Updater.getLocallocalInfo()).hash;
      },
      channel: async () => {
        return (await Updater.getLocallocalInfo()).channel;
      },
      baseUrl: async () => {
        return (await Updater.getLocallocalInfo()).baseUrl;
      }
    },
    getLocallocalInfo: async () => {
      if (localInfo) {
        return localInfo;
      }
      try {
        const resourcesDir = "Resources";
        localInfo = await Bun.file(`../${resourcesDir}/version.json`).json();
        return localInfo;
      } catch (error) {
        console.error("Failed to read version.json", error);
        throw error;
      }
    }
  };
});

// node_modules/electrobun/dist/api/bun/core/BuildConfig.ts
var buildConfig = null, BuildConfig;
var init_BuildConfig = __esm(() => {
  BuildConfig = {
    get: async () => {
      if (buildConfig) {
        return buildConfig;
      }
      try {
        const resourcesDir = "Resources";
        buildConfig = await Bun.file(`../${resourcesDir}/build.json`).json();
        return buildConfig;
      } catch (error) {
        buildConfig = {
          defaultRenderer: "native",
          availableRenderers: ["native"]
        };
        return buildConfig;
      }
    },
    getCached: () => buildConfig
  };
});

// node_modules/electrobun/dist/api/bun/core/Socket.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
function base64ToUint8Array(base64) {
  {
    return new Uint8Array(atob(base64).split("").map((char) => char.charCodeAt(0)));
  }
}
function encrypt(secretKey, text) {
  const iv = new Uint8Array(randomBytes(12));
  const cipher = createCipheriv("aes-256-gcm", secretKey, iv);
  const encrypted = Buffer.concat([
    new Uint8Array(cipher.update(text, "utf8")),
    new Uint8Array(cipher.final())
  ]).toString("base64");
  const tag = cipher.getAuthTag().toString("base64");
  return { encrypted, iv: Buffer.from(iv).toString("base64"), tag };
}
function decrypt(secretKey, encryptedData, iv, tag) {
  const decipher = createDecipheriv("aes-256-gcm", secretKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    new Uint8Array(decipher.update(encryptedData)),
    new Uint8Array(decipher.final())
  ]);
  return decrypted.toString("utf8");
}
var socketMap, startRPCServer = () => {
  const startPort = 50000;
  const endPort = 65535;
  const payloadLimit = 1024 * 1024 * 500;
  let port = startPort;
  let server = null;
  while (port <= endPort) {
    try {
      server = Bun.serve({
        port,
        fetch(req, server2) {
          const url = new URL(req.url);
          if (url.pathname === "/socket") {
            const webviewIdString = url.searchParams.get("webviewId");
            if (!webviewIdString) {
              return new Response("Missing webviewId", { status: 400 });
            }
            const webviewId = parseInt(webviewIdString, 10);
            const success = server2.upgrade(req, { data: { webviewId } });
            return success ? undefined : new Response("Upgrade failed", { status: 500 });
          }
          console.log("unhandled RPC Server request", req.url);
        },
        websocket: {
          idleTimeout: 960,
          maxPayloadLength: payloadLimit,
          backpressureLimit: payloadLimit * 2,
          open(ws) {
            if (!ws?.data) {
              return;
            }
            const { webviewId } = ws.data;
            if (!socketMap[webviewId]) {
              socketMap[webviewId] = { socket: ws, queue: [] };
            } else {
              socketMap[webviewId].socket = ws;
            }
          },
          close(ws, _code, _reason) {
            if (!ws?.data) {
              return;
            }
            const { webviewId } = ws.data;
            if (socketMap[webviewId]) {
              socketMap[webviewId].socket = null;
            }
          },
          message(ws, message) {
            if (!ws?.data) {
              return;
            }
            const { webviewId } = ws.data;
            const browserView = BrowserView.getById(webviewId);
            if (!browserView) {
              return;
            }
            if (browserView.rpcHandler) {
              if (typeof message === "string") {
                try {
                  const encryptedPacket = JSON.parse(message);
                  const decrypted = decrypt(browserView.secretKey, base64ToUint8Array(encryptedPacket.encryptedData), base64ToUint8Array(encryptedPacket.iv), base64ToUint8Array(encryptedPacket.tag));
                  browserView.rpcHandler(JSON.parse(decrypted));
                } catch (error) {
                  console.log("Error handling message:", error);
                }
              } else if (message instanceof ArrayBuffer) {
                console.log("TODO: Received ArrayBuffer message:", message);
              }
            }
          }
        }
      });
      break;
    } catch (error) {
      if (error.code === "EADDRINUSE") {
        console.log(`Port ${port} in use, trying next port...`);
        port++;
      } else {
        throw error;
      }
    }
  }
  return { rpcServer: server, rpcPort: port };
}, rpcServer, rpcPort, sendMessageToWebviewViaSocket = (webviewId, message) => {
  const rpc = socketMap[webviewId];
  const browserView = BrowserView.getById(webviewId);
  if (!browserView)
    return false;
  if (rpc?.socket?.readyState === WebSocket.OPEN) {
    try {
      const unencryptedString = JSON.stringify(message);
      const encrypted = encrypt(browserView.secretKey, unencryptedString);
      const encryptedPacket = {
        encryptedData: encrypted.encrypted,
        iv: encrypted.iv,
        tag: encrypted.tag
      };
      const encryptedPacketString = JSON.stringify(encryptedPacket);
      rpc.socket.send(encryptedPacketString);
      return true;
    } catch (error) {
      console.error("Error sending message to webview via socket:", error);
    }
  }
  return false;
};
var init_Socket = __esm(async () => {
  await init_BrowserView();
  socketMap = {};
  ({ rpcServer, rpcPort } = startRPCServer());
  console.log("Server started at", rpcServer?.url.origin);
});

// node_modules/electrobun/dist/api/bun/core/BrowserView.ts
import { randomBytes as randomBytes2 } from "crypto";

class BrowserView {
  id = nextWebviewId++;
  ptr;
  hostWebviewId;
  windowId;
  renderer;
  url = null;
  html = null;
  preload = null;
  partition = null;
  autoResize = true;
  frame = {
    x: 0,
    y: 0,
    width: 800,
    height: 600
  };
  pipePrefix;
  inStream;
  outStream;
  secretKey;
  rpc;
  rpcHandler;
  navigationRules = null;
  sandbox = false;
  startTransparent = false;
  startPassthrough = false;
  constructor(options = defaultOptions) {
    this.url = options.url || defaultOptions.url || null;
    this.html = options.html || defaultOptions.html || null;
    this.preload = options.preload || defaultOptions.preload || null;
    this.frame = {
      x: options.frame?.x ?? defaultOptions.frame.x,
      y: options.frame?.y ?? defaultOptions.frame.y,
      width: options.frame?.width ?? defaultOptions.frame.width,
      height: options.frame?.height ?? defaultOptions.frame.height
    };
    this.rpc = options.rpc;
    this.secretKey = new Uint8Array(randomBytes2(32));
    this.partition = options.partition || null;
    this.pipePrefix = `/private/tmp/electrobun_ipc_pipe_${hash}_${randomId}_${this.id}`;
    this.hostWebviewId = options.hostWebviewId;
    this.windowId = options.windowId ?? 0;
    this.autoResize = options.autoResize === false ? false : true;
    this.navigationRules = options.navigationRules || null;
    this.renderer = options.renderer ?? defaultOptions.renderer ?? "native";
    this.sandbox = options.sandbox ?? false;
    this.startTransparent = options.startTransparent ?? false;
    this.startPassthrough = options.startPassthrough ?? false;
    BrowserViewMap[this.id] = this;
    this.ptr = this.init();
    if (this.html) {
      console.log(`DEBUG: BrowserView constructor triggering loadHTML for webview ${this.id}`);
      setTimeout(() => {
        console.log(`DEBUG: BrowserView delayed loadHTML for webview ${this.id}`);
        this.loadHTML(this.html);
      }, 100);
    } else {
      console.log(`DEBUG: BrowserView constructor - no HTML provided for webview ${this.id}`);
    }
  }
  init() {
    this.createStreams();
    return ffi.request.createWebview({
      id: this.id,
      windowId: this.windowId,
      renderer: this.renderer,
      rpcPort,
      secretKey: this.secretKey.toString(),
      hostWebviewId: this.hostWebviewId || null,
      pipePrefix: this.pipePrefix,
      partition: this.partition,
      url: this.html ? null : this.url,
      html: this.html,
      preload: this.preload,
      frame: {
        width: this.frame.width,
        height: this.frame.height,
        x: this.frame.x,
        y: this.frame.y
      },
      autoResize: this.autoResize,
      navigationRules: this.navigationRules,
      sandbox: this.sandbox,
      startTransparent: this.startTransparent,
      startPassthrough: this.startPassthrough
    });
  }
  createStreams() {
    if (!this.rpc) {
      this.rpc = BrowserView.defineRPC({
        handlers: { requests: {}, messages: {} }
      });
    }
    this.rpc.setTransport(this.createTransport());
  }
  sendMessageToWebviewViaExecute(jsonMessage) {
    const stringifiedMessage = typeof jsonMessage === "string" ? jsonMessage : JSON.stringify(jsonMessage);
    const wrappedMessage = `window.__electrobun.receiveMessageFromBun(${stringifiedMessage})`;
    this.executeJavascript(wrappedMessage);
  }
  sendInternalMessageViaExecute(jsonMessage) {
    const stringifiedMessage = typeof jsonMessage === "string" ? jsonMessage : JSON.stringify(jsonMessage);
    const wrappedMessage = `window.__electrobun.receiveInternalMessageFromBun(${stringifiedMessage})`;
    this.executeJavascript(wrappedMessage);
  }
  executeJavascript(js) {
    ffi.request.evaluateJavascriptWithNoCompletion({ id: this.id, js });
  }
  loadURL(url) {
    console.log(`DEBUG: loadURL called for webview ${this.id}: ${url}`);
    this.url = url;
    native.symbols.loadURLInWebView(this.ptr, toCString(this.url));
  }
  loadHTML(html) {
    this.html = html;
    console.log(`DEBUG: Setting HTML content for webview ${this.id}:`, html.substring(0, 50) + "...");
    if (this.renderer === "cef") {
      native.symbols.setWebviewHTMLContent(this.id, toCString(html));
      this.loadURL("views://internal/index.html");
    } else {
      native.symbols.loadHTMLInWebView(this.ptr, toCString(html));
    }
  }
  setNavigationRules(rules) {
    this.navigationRules = JSON.stringify(rules);
    const rulesJson = JSON.stringify(rules);
    native.symbols.setWebviewNavigationRules(this.ptr, toCString(rulesJson));
  }
  findInPage(searchText, options) {
    const forward = options?.forward ?? true;
    const matchCase = options?.matchCase ?? false;
    native.symbols.webviewFindInPage(this.ptr, toCString(searchText), forward, matchCase);
  }
  stopFindInPage() {
    native.symbols.webviewStopFind(this.ptr);
  }
  openDevTools() {
    native.symbols.webviewOpenDevTools(this.ptr);
  }
  closeDevTools() {
    native.symbols.webviewCloseDevTools(this.ptr);
  }
  toggleDevTools() {
    native.symbols.webviewToggleDevTools(this.ptr);
  }
  on(name, handler) {
    const specificName = `${name}-${this.id}`;
    eventEmitter_default.on(specificName, handler);
  }
  createTransport = () => {
    const that = this;
    return {
      send(message) {
        const sentOverSocket = sendMessageToWebviewViaSocket(that.id, message);
        if (!sentOverSocket) {
          try {
            const messageString = JSON.stringify(message);
            that.sendMessageToWebviewViaExecute(messageString);
          } catch (error) {
            console.error("bun: failed to serialize message to webview", error);
          }
        }
      },
      registerHandler(handler) {
        that.rpcHandler = handler;
      }
    };
  };
  static getById(id) {
    return BrowserViewMap[id];
  }
  static getAll() {
    return Object.values(BrowserViewMap);
  }
  static defineRPC(config) {
    return defineElectrobunRPC("bun", config);
  }
}
var BrowserViewMap, nextWebviewId = 1, hash, buildConfig2, defaultOptions, randomId;
var init_BrowserView = __esm(async () => {
  init_eventEmitter();
  init_BuildConfig();
  await __promiseAll([
    init_native(),
    init_Updater(),
    init_Socket()
  ]);
  BrowserViewMap = {};
  hash = await Updater.localInfo.hash();
  buildConfig2 = await BuildConfig.get();
  defaultOptions = {
    url: null,
    html: null,
    preload: null,
    renderer: buildConfig2.defaultRenderer,
    frame: {
      x: 0,
      y: 0,
      width: 800,
      height: 600
    }
  };
  randomId = Math.random().toString(36).substring(7);
});

// node_modules/electrobun/dist/api/bun/core/Paths.ts
import { resolve as resolve2 } from "path";
var RESOURCES_FOLDER, VIEWS_FOLDER;
var init_Paths = __esm(() => {
  RESOURCES_FOLDER = resolve2("../Resources/");
  VIEWS_FOLDER = resolve2(RESOURCES_FOLDER, "app/views");
});

// node_modules/electrobun/dist/api/bun/core/Tray.ts
import { join as join3 } from "path";

class Tray {
  id = nextTrayId++;
  ptr = null;
  constructor({
    title = "",
    image = "",
    template = true,
    width = 16,
    height = 16
  } = {}) {
    try {
      this.ptr = ffi.request.createTray({
        id: this.id,
        title,
        image: this.resolveImagePath(image),
        template,
        width,
        height
      });
    } catch (error) {
      console.warn("Tray creation failed:", error);
      console.warn("System tray functionality may not be available on this platform");
      this.ptr = null;
    }
    TrayMap[this.id] = this;
  }
  resolveImagePath(imgPath) {
    if (imgPath.startsWith("views://")) {
      return join3(VIEWS_FOLDER, imgPath.replace("views://", ""));
    } else {
      return imgPath;
    }
  }
  setTitle(title) {
    if (!this.ptr)
      return;
    ffi.request.setTrayTitle({ id: this.id, title });
  }
  setImage(imgPath) {
    if (!this.ptr)
      return;
    ffi.request.setTrayImage({
      id: this.id,
      image: this.resolveImagePath(imgPath)
    });
  }
  setMenu(menu) {
    if (!this.ptr)
      return;
    const menuWithDefaults = menuConfigWithDefaults(menu);
    ffi.request.setTrayMenu({
      id: this.id,
      menuConfig: JSON.stringify(menuWithDefaults)
    });
  }
  on(name, handler) {
    const specificName = `${name}-${this.id}`;
    eventEmitter_default.on(specificName, handler);
  }
  remove() {
    console.log("Tray.remove() called for id:", this.id);
    if (this.ptr) {
      ffi.request.removeTray({ id: this.id });
    }
    delete TrayMap[this.id];
    console.log("Tray removed from TrayMap");
  }
  static getById(id) {
    return TrayMap[id];
  }
  static getAll() {
    return Object.values(TrayMap);
  }
  static removeById(id) {
    const tray = TrayMap[id];
    if (tray) {
      tray.remove();
    }
  }
}
var nextTrayId = 1, TrayMap, menuConfigWithDefaults = (menu) => {
  return menu.map((item) => {
    if (item.type === "divider" || item.type === "separator") {
      return { type: "divider" };
    } else {
      const menuItem = item;
      const actionWithDataId = ffi.internal.serializeMenuAction(menuItem.action || "", menuItem.data);
      return {
        label: menuItem.label || "",
        type: menuItem.type || "normal",
        action: actionWithDataId,
        enabled: menuItem.enabled === false ? false : true,
        checked: Boolean(menuItem.checked),
        hidden: Boolean(menuItem.hidden),
        tooltip: menuItem.tooltip || undefined,
        ...menuItem.submenu ? { submenu: menuConfigWithDefaults(menuItem.submenu) } : {}
      };
    }
  });
};
var init_Tray = __esm(async () => {
  init_eventEmitter();
  init_Paths();
  await init_native();
  TrayMap = {};
});

// node_modules/electrobun/dist/api/bun/preload/.generated/compiled.ts
var preloadScript = `(() => {
  // src/bun/preload/encryption.ts
  function base64ToUint8Array(base64) {
    return new Uint8Array(atob(base64).split("").map((char) => char.charCodeAt(0)));
  }
  function uint8ArrayToBase64(uint8Array) {
    let binary = "";
    for (let i = 0;i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }
  async function generateKeyFromBytes(rawKey) {
    return await window.crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  }
  async function initEncryption() {
    const secretKey = await generateKeyFromBytes(new Uint8Array(window.__electrobunSecretKeyBytes));
    const encryptString = async (plaintext) => {
      const encoder = new TextEncoder;
      const encodedText = encoder.encode(plaintext);
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encryptedBuffer = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, secretKey, encodedText);
      const encryptedData = new Uint8Array(encryptedBuffer.slice(0, -16));
      const tag = new Uint8Array(encryptedBuffer.slice(-16));
      return {
        encryptedData: uint8ArrayToBase64(encryptedData),
        iv: uint8ArrayToBase64(iv),
        tag: uint8ArrayToBase64(tag)
      };
    };
    const decryptString = async (encryptedDataB64, ivB64, tagB64) => {
      const encryptedData = base64ToUint8Array(encryptedDataB64);
      const iv = base64ToUint8Array(ivB64);
      const tag = base64ToUint8Array(tagB64);
      const combinedData = new Uint8Array(encryptedData.length + tag.length);
      combinedData.set(encryptedData);
      combinedData.set(tag, encryptedData.length);
      const decryptedBuffer = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, secretKey, combinedData);
      const decoder = new TextDecoder;
      return decoder.decode(decryptedBuffer);
    };
    window.__electrobun_encrypt = encryptString;
    window.__electrobun_decrypt = decryptString;
  }

  // src/bun/preload/internalRpc.ts
  var pendingRequests = {};
  var requestId = 0;
  var isProcessingQueue = false;
  var sendQueue = [];
  function processQueue() {
    if (isProcessingQueue) {
      setTimeout(processQueue);
      return;
    }
    if (sendQueue.length === 0)
      return;
    isProcessingQueue = true;
    const batch = JSON.stringify(sendQueue);
    sendQueue.length = 0;
    window.__electrobunInternalBridge?.postMessage(batch);
    setTimeout(() => {
      isProcessingQueue = false;
    }, 2);
  }
  function send(type, payload) {
    sendQueue.push(JSON.stringify({ type: "message", id: type, payload }));
    processQueue();
  }
  function request(type, payload) {
    return new Promise((resolve, reject) => {
      const id = \`req_\${++requestId}_\${Date.now()}\`;
      pendingRequests[id] = { resolve, reject };
      sendQueue.push(JSON.stringify({
        type: "request",
        method: type,
        id,
        params: payload,
        hostWebviewId: window.__electrobunWebviewId
      }));
      processQueue();
      setTimeout(() => {
        if (pendingRequests[id]) {
          delete pendingRequests[id];
          reject(new Error(\`Request timeout: \${type}\`));
        }
      }, 1e4);
    });
  }
  function handleResponse(msg) {
    if (msg && msg.type === "response" && msg.id) {
      const pending = pendingRequests[msg.id];
      if (pending) {
        delete pendingRequests[msg.id];
        if (msg.success)
          pending.resolve(msg.payload);
        else
          pending.reject(msg.payload);
      }
    }
  }

  // src/bun/preload/dragRegions.ts
  function isAppRegionDrag(e) {
    const target = e.target;
    if (!target || !target.closest)
      return false;
    const draggableByStyle = target.closest('[style*="app-region"][style*="drag"]');
    const draggableByClass = target.closest(".electrobun-webkit-app-region-drag");
    return !!(draggableByStyle || draggableByClass);
  }
  function initDragRegions() {
    document.addEventListener("mousedown", (e) => {
      if (isAppRegionDrag(e)) {
        send("startWindowMove", { id: window.__electrobunWindowId });
      }
    });
    document.addEventListener("mouseup", (e) => {
      if (isAppRegionDrag(e)) {
        send("stopWindowMove", { id: window.__electrobunWindowId });
      }
    });
  }

  // src/bun/preload/webviewTag.ts
  var webviewRegistry = {};

  class ElectrobunWebviewTag extends HTMLElement {
    webviewId = null;
    maskSelectors = new Set;
    lastRect = { x: 0, y: 0, width: 0, height: 0 };
    resizeObserver = null;
    positionCheckLoop = null;
    transparent = false;
    passthroughEnabled = false;
    hidden = false;
    sandboxed = false;
    _eventListeners = {};
    constructor() {
      super();
    }
    connectedCallback() {
      requestAnimationFrame(() => this.initWebview());
    }
    disconnectedCallback() {
      if (this.webviewId !== null) {
        send("webviewTagRemove", { id: this.webviewId });
        delete webviewRegistry[this.webviewId];
      }
      if (this.resizeObserver)
        this.resizeObserver.disconnect();
      if (this.positionCheckLoop)
        clearInterval(this.positionCheckLoop);
    }
    async initWebview() {
      const rect = this.getBoundingClientRect();
      this.lastRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
      const url = this.getAttribute("src");
      const html = this.getAttribute("html");
      const preload = this.getAttribute("preload");
      const partition = this.getAttribute("partition");
      const renderer = this.getAttribute("renderer") || "native";
      const masks = this.getAttribute("masks");
      const sandbox = this.hasAttribute("sandbox");
      this.sandboxed = sandbox;
      const transparent = this.hasAttribute("transparent");
      const passthrough = this.hasAttribute("passthrough");
      this.transparent = transparent;
      this.passthroughEnabled = passthrough;
      if (transparent)
        this.style.opacity = "0";
      if (passthrough)
        this.style.pointerEvents = "none";
      if (masks) {
        masks.split(",").forEach((s) => this.maskSelectors.add(s.trim()));
      }
      try {
        const webviewId = await request("webviewTagInit", {
          hostWebviewId: window.__electrobunWebviewId,
          windowId: window.__electrobunWindowId,
          renderer,
          url,
          html,
          preload,
          partition,
          frame: {
            width: rect.width,
            height: rect.height,
            x: rect.x,
            y: rect.y
          },
          navigationRules: null,
          sandbox,
          transparent,
          passthrough
        });
        this.webviewId = webviewId;
        this.id = \`electrobun-webview-\${webviewId}\`;
        webviewRegistry[webviewId] = this;
        this.setupObservers();
        this.syncDimensions(true);
        requestAnimationFrame(() => {
          Object.values(webviewRegistry).forEach((webview) => {
            if (webview !== this && webview.webviewId !== null) {
              webview.syncDimensions(true);
            }
          });
        });
      } catch (err) {
        console.error("Failed to init webview:", err);
      }
    }
    setupObservers() {
      this.resizeObserver = new ResizeObserver(() => this.syncDimensions());
      this.resizeObserver.observe(this);
      this.positionCheckLoop = setInterval(() => this.syncDimensions(), 100);
    }
    syncDimensions(force = false) {
      if (this.webviewId === null)
        return;
      const rect = this.getBoundingClientRect();
      const newRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
      if (newRect.width === 0 && newRect.height === 0) {
        return;
      }
      if (!force && newRect.x === this.lastRect.x && newRect.y === this.lastRect.y && newRect.width === this.lastRect.width && newRect.height === this.lastRect.height) {
        return;
      }
      this.lastRect = newRect;
      const masks = [];
      this.maskSelectors.forEach((selector) => {
        try {
          document.querySelectorAll(selector).forEach((el) => {
            const mr = el.getBoundingClientRect();
            masks.push({
              x: mr.x - rect.x,
              y: mr.y - rect.y,
              width: mr.width,
              height: mr.height
            });
          });
        } catch (_e) {}
      });
      send("webviewTagResize", {
        id: this.webviewId,
        frame: newRect,
        masks: JSON.stringify(masks)
      });
    }
    loadURL(url) {
      if (this.webviewId === null)
        return;
      this.setAttribute("src", url);
      send("webviewTagUpdateSrc", { id: this.webviewId, url });
    }
    loadHTML(html) {
      if (this.webviewId === null)
        return;
      send("webviewTagUpdateHtml", { id: this.webviewId, html });
    }
    reload() {
      if (this.webviewId !== null)
        send("webviewTagReload", { id: this.webviewId });
    }
    goBack() {
      if (this.webviewId !== null)
        send("webviewTagGoBack", { id: this.webviewId });
    }
    goForward() {
      if (this.webviewId !== null)
        send("webviewTagGoForward", { id: this.webviewId });
    }
    async canGoBack() {
      if (this.webviewId === null)
        return false;
      return await request("webviewTagCanGoBack", {
        id: this.webviewId
      });
    }
    async canGoForward() {
      if (this.webviewId === null)
        return false;
      return await request("webviewTagCanGoForward", {
        id: this.webviewId
      });
    }
    toggleTransparent(value) {
      if (this.webviewId === null)
        return;
      this.transparent = value !== undefined ? value : !this.transparent;
      this.style.opacity = this.transparent ? "0" : "";
      send("webviewTagSetTransparent", {
        id: this.webviewId,
        transparent: this.transparent
      });
    }
    togglePassthrough(value) {
      if (this.webviewId === null)
        return;
      this.passthroughEnabled = value !== undefined ? value : !this.passthroughEnabled;
      this.style.pointerEvents = this.passthroughEnabled ? "none" : "";
      send("webviewTagSetPassthrough", {
        id: this.webviewId,
        enablePassthrough: this.passthroughEnabled
      });
    }
    toggleHidden(value) {
      if (this.webviewId === null)
        return;
      this.hidden = value !== undefined ? value : !this.hidden;
      send("webviewTagSetHidden", { id: this.webviewId, hidden: this.hidden });
    }
    addMaskSelector(selector) {
      this.maskSelectors.add(selector);
      this.syncDimensions(true);
    }
    removeMaskSelector(selector) {
      this.maskSelectors.delete(selector);
      this.syncDimensions(true);
    }
    setNavigationRules(rules) {
      if (this.webviewId !== null) {
        send("webviewTagSetNavigationRules", { id: this.webviewId, rules });
      }
    }
    findInPage(searchText, options) {
      if (this.webviewId === null)
        return;
      const forward = options?.forward !== false;
      const matchCase = options?.matchCase || false;
      send("webviewTagFindInPage", {
        id: this.webviewId,
        searchText,
        forward,
        matchCase
      });
    }
    stopFindInPage() {
      if (this.webviewId !== null)
        send("webviewTagStopFind", { id: this.webviewId });
    }
    openDevTools() {
      if (this.webviewId !== null)
        send("webviewTagOpenDevTools", { id: this.webviewId });
    }
    closeDevTools() {
      if (this.webviewId !== null)
        send("webviewTagCloseDevTools", { id: this.webviewId });
    }
    toggleDevTools() {
      if (this.webviewId !== null)
        send("webviewTagToggleDevTools", { id: this.webviewId });
    }
    on(event, listener) {
      if (!this._eventListeners[event])
        this._eventListeners[event] = [];
      this._eventListeners[event].push(listener);
    }
    off(event, listener) {
      if (!this._eventListeners[event])
        return;
      const idx = this._eventListeners[event].indexOf(listener);
      if (idx !== -1)
        this._eventListeners[event].splice(idx, 1);
    }
    emit(event, detail) {
      const listeners = this._eventListeners[event];
      if (listeners) {
        const customEvent = new CustomEvent(event, { detail });
        listeners.forEach((fn) => fn(customEvent));
      }
    }
    get src() {
      return this.getAttribute("src");
    }
    set src(value) {
      if (value) {
        this.setAttribute("src", value);
        if (this.webviewId !== null)
          this.loadURL(value);
      } else {
        this.removeAttribute("src");
      }
    }
    get html() {
      return this.getAttribute("html");
    }
    set html(value) {
      if (value) {
        this.setAttribute("html", value);
        if (this.webviewId !== null)
          this.loadHTML(value);
      } else {
        this.removeAttribute("html");
      }
    }
    get preload() {
      return this.getAttribute("preload");
    }
    set preload(value) {
      if (value)
        this.setAttribute("preload", value);
      else
        this.removeAttribute("preload");
    }
    get renderer() {
      return this.getAttribute("renderer") || "native";
    }
    set renderer(value) {
      this.setAttribute("renderer", value);
    }
    get sandbox() {
      return this.sandboxed;
    }
  }
  function initWebviewTag() {
    if (!customElements.get("electrobun-webview")) {
      customElements.define("electrobun-webview", ElectrobunWebviewTag);
    }
    const injectStyles = () => {
      const style = document.createElement("style");
      style.textContent = \`
electrobun-webview {
	display: block;
	width: 800px;
	height: 300px;
	background: #fff;
	background-repeat: no-repeat !important;
	overflow: hidden;
}
\`;
      if (document.head?.firstChild) {
        document.head.insertBefore(style, document.head.firstChild);
      } else if (document.head) {
        document.head.appendChild(style);
      }
    };
    if (document.head) {
      injectStyles();
    } else {
      document.addEventListener("DOMContentLoaded", injectStyles);
    }
  }

  // src/bun/preload/events.ts
  function emitWebviewEvent(eventName, detail) {
    setTimeout(() => {
      const bridge = window.__electrobunEventBridge || window.__electrobunInternalBridge;
      bridge?.postMessage(JSON.stringify({
        id: "webviewEvent",
        type: "message",
        payload: {
          id: window.__electrobunWebviewId,
          eventName,
          detail
        }
      }));
    });
  }
  function initLifecycleEvents() {
    window.addEventListener("load", () => {
      if (window === window.top) {
        emitWebviewEvent("dom-ready", document.location.href);
      }
    });
    window.addEventListener("popstate", () => {
      emitWebviewEvent("did-navigate-in-page", window.location.href);
    });
    window.addEventListener("hashchange", () => {
      emitWebviewEvent("did-navigate-in-page", window.location.href);
    });
  }
  var cmdKeyHeld = false;
  var cmdKeyTimestamp = 0;
  var CMD_KEY_THRESHOLD_MS = 500;
  function isCmdHeld() {
    if (cmdKeyHeld)
      return true;
    return Date.now() - cmdKeyTimestamp < CMD_KEY_THRESHOLD_MS && cmdKeyTimestamp > 0;
  }
  function initCmdClickHandling() {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Meta" || event.metaKey) {
        cmdKeyHeld = true;
        cmdKeyTimestamp = Date.now();
      }
    }, true);
    window.addEventListener("keyup", (event) => {
      if (event.key === "Meta") {
        cmdKeyHeld = false;
        cmdKeyTimestamp = Date.now();
      }
    }, true);
    window.addEventListener("blur", () => {
      cmdKeyHeld = false;
    });
    window.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey) {
        const anchor = event.target?.closest?.("a");
        if (anchor && anchor.href) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          emitWebviewEvent("new-window-open", JSON.stringify({
            url: anchor.href,
            isCmdClick: true,
            isSPANavigation: false
          }));
        }
      }
    }, true);
  }
  function initSPANavigationInterception() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function(state, title, url) {
      if (isCmdHeld() && url) {
        const resolvedUrl = new URL(String(url), window.location.href).href;
        emitWebviewEvent("new-window-open", JSON.stringify({
          url: resolvedUrl,
          isCmdClick: true,
          isSPANavigation: true
        }));
        return;
      }
      return originalPushState.apply(this, [state, title, url]);
    };
    history.replaceState = function(state, title, url) {
      if (isCmdHeld() && url) {
        const resolvedUrl = new URL(String(url), window.location.href).href;
        emitWebviewEvent("new-window-open", JSON.stringify({
          url: resolvedUrl,
          isCmdClick: true,
          isSPANavigation: true
        }));
        return;
      }
      return originalReplaceState.apply(this, [state, title, url]);
    };
  }
  function initOverscrollPrevention() {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.type = "text/css";
      style.appendChild(document.createTextNode("html, body { overscroll-behavior: none; }"));
      document.head.appendChild(style);
    });
  }

  // src/bun/preload/index.ts
  initEncryption().catch((err) => console.error("Failed to initialize encryption:", err));
  var internalMessageHandler = (msg) => {
    handleResponse(msg);
  };
  if (!window.__electrobun) {
    window.__electrobun = {
      receiveInternalMessageFromBun: internalMessageHandler,
      receiveMessageFromBun: (msg) => {
        console.log("receiveMessageFromBun (no handler):", msg);
      }
    };
  } else {
    window.__electrobun.receiveInternalMessageFromBun = internalMessageHandler;
    window.__electrobun.receiveMessageFromBun = (msg) => {
      console.log("receiveMessageFromBun (no handler):", msg);
    };
  }
  window.__electrobunSendToHost = (message) => {
    emitWebviewEvent("host-message", JSON.stringify(message));
  };
  initLifecycleEvents();
  initCmdClickHandling();
  initSPANavigationInterception();
  initOverscrollPrevention();
  initDragRegions();
  initWebviewTag();
})();
`, preloadScriptSandboxed = `(() => {
  // src/bun/preload/events.ts
  function emitWebviewEvent(eventName, detail) {
    setTimeout(() => {
      const bridge = window.__electrobunEventBridge || window.__electrobunInternalBridge;
      bridge?.postMessage(JSON.stringify({
        id: "webviewEvent",
        type: "message",
        payload: {
          id: window.__electrobunWebviewId,
          eventName,
          detail
        }
      }));
    });
  }
  function initLifecycleEvents() {
    window.addEventListener("load", () => {
      if (window === window.top) {
        emitWebviewEvent("dom-ready", document.location.href);
      }
    });
    window.addEventListener("popstate", () => {
      emitWebviewEvent("did-navigate-in-page", window.location.href);
    });
    window.addEventListener("hashchange", () => {
      emitWebviewEvent("did-navigate-in-page", window.location.href);
    });
  }
  var cmdKeyHeld = false;
  var cmdKeyTimestamp = 0;
  var CMD_KEY_THRESHOLD_MS = 500;
  function isCmdHeld() {
    if (cmdKeyHeld)
      return true;
    return Date.now() - cmdKeyTimestamp < CMD_KEY_THRESHOLD_MS && cmdKeyTimestamp > 0;
  }
  function initCmdClickHandling() {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Meta" || event.metaKey) {
        cmdKeyHeld = true;
        cmdKeyTimestamp = Date.now();
      }
    }, true);
    window.addEventListener("keyup", (event) => {
      if (event.key === "Meta") {
        cmdKeyHeld = false;
        cmdKeyTimestamp = Date.now();
      }
    }, true);
    window.addEventListener("blur", () => {
      cmdKeyHeld = false;
    });
    window.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey) {
        const anchor = event.target?.closest?.("a");
        if (anchor && anchor.href) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          emitWebviewEvent("new-window-open", JSON.stringify({
            url: anchor.href,
            isCmdClick: true,
            isSPANavigation: false
          }));
        }
      }
    }, true);
  }
  function initSPANavigationInterception() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function(state, title, url) {
      if (isCmdHeld() && url) {
        const resolvedUrl = new URL(String(url), window.location.href).href;
        emitWebviewEvent("new-window-open", JSON.stringify({
          url: resolvedUrl,
          isCmdClick: true,
          isSPANavigation: true
        }));
        return;
      }
      return originalPushState.apply(this, [state, title, url]);
    };
    history.replaceState = function(state, title, url) {
      if (isCmdHeld() && url) {
        const resolvedUrl = new URL(String(url), window.location.href).href;
        emitWebviewEvent("new-window-open", JSON.stringify({
          url: resolvedUrl,
          isCmdClick: true,
          isSPANavigation: true
        }));
        return;
      }
      return originalReplaceState.apply(this, [state, title, url]);
    };
  }
  function initOverscrollPrevention() {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.type = "text/css";
      style.appendChild(document.createTextNode("html, body { overscroll-behavior: none; }"));
      document.head.appendChild(style);
    });
  }

  // src/bun/preload/index-sandboxed.ts
  initLifecycleEvents();
  initCmdClickHandling();
  initSPANavigationInterception();
  initOverscrollPrevention();
})();
`;

// node_modules/electrobun/dist/api/bun/proc/native.ts
import { join as join4 } from "path";
import {
  dlopen,
  suffix,
  JSCallback,
  CString,
  ptr,
  FFIType,
  toArrayBuffer
} from "bun:ffi";
function storeMenuData(data) {
  const id = `menuData_${++menuDataCounter}`;
  menuDataRegistry.set(id, data);
  return id;
}
function getMenuData(id) {
  return menuDataRegistry.get(id);
}
function clearMenuData(id) {
  menuDataRegistry.delete(id);
}
function serializeMenuAction(action, data) {
  const dataId = storeMenuData(data);
  return `${ELECTROBUN_DELIMITER}${dataId}|${action}`;
}
function deserializeMenuAction(encodedAction) {
  let actualAction = encodedAction;
  let data = undefined;
  if (encodedAction.startsWith(ELECTROBUN_DELIMITER)) {
    const parts = encodedAction.split("|");
    if (parts.length >= 4) {
      const dataId = parts[2];
      actualAction = parts.slice(3).join("|");
      data = getMenuData(dataId);
      clearMenuData(dataId);
    }
  }
  return { action: actualAction, data };
}
function toCString(jsString, addNullTerminator = true) {
  let appendWith = "";
  if (addNullTerminator && !jsString.endsWith("\x00")) {
    appendWith = "\x00";
  }
  const buff = Buffer.from(jsString + appendWith, "utf8");
  return ptr(buff);
}
var menuDataRegistry, menuDataCounter = 0, ELECTROBUN_DELIMITER = "|EB|", native, ffi, windowCloseCallback, windowMoveCallback, windowResizeCallback, windowFocusCallback, getMimeType, getHTMLForWebviewSync, urlOpenCallback, quitRequestedCallback, globalShortcutHandlers, globalShortcutCallback, sessionCache, webviewDecideNavigation, webviewEventHandler = (id, eventName, detail) => {
  const webview = BrowserView.getById(id);
  if (!webview) {
    console.error("[webviewEventHandler] No webview found for id:", id);
    return;
  }
  if (webview.hostWebviewId) {
    const hostWebview = BrowserView.getById(webview.hostWebviewId);
    if (!hostWebview) {
      console.error("[webviewEventHandler] No webview found for id:", id);
      return;
    }
    let js;
    if (eventName === "new-window-open" || eventName === "host-message") {
      js = `document.querySelector('#electrobun-webview-${id}').emit(${JSON.stringify(eventName)}, ${detail});`;
    } else {
      js = `document.querySelector('#electrobun-webview-${id}').emit(${JSON.stringify(eventName)}, ${JSON.stringify(detail)});`;
    }
    native.symbols.evaluateJavaScriptWithNoCompletion(hostWebview.ptr, toCString(js));
  }
  const eventMap = {
    "will-navigate": "willNavigate",
    "did-navigate": "didNavigate",
    "did-navigate-in-page": "didNavigateInPage",
    "did-commit-navigation": "didCommitNavigation",
    "dom-ready": "domReady",
    "new-window-open": "newWindowOpen",
    "host-message": "hostMessage",
    "download-started": "downloadStarted",
    "download-progress": "downloadProgress",
    "download-completed": "downloadCompleted",
    "download-failed": "downloadFailed",
    "load-started": "loadStarted",
    "load-committed": "loadCommitted",
    "load-finished": "loadFinished"
  };
  const mappedName = eventMap[eventName];
  const handler = mappedName ? eventEmitter_default.events.webview[mappedName] : undefined;
  if (!handler) {
    return { success: false };
  }
  let parsedDetail = detail;
  if (eventName === "new-window-open" || eventName === "host-message" || eventName === "download-started" || eventName === "download-progress" || eventName === "download-completed" || eventName === "download-failed") {
    try {
      parsedDetail = JSON.parse(detail);
    } catch (e) {
      console.error("[webviewEventHandler] Failed to parse JSON:", e);
      parsedDetail = detail;
    }
  }
  const event = handler({
    detail: parsedDetail
  });
  eventEmitter_default.emitEvent(event);
  eventEmitter_default.emitEvent(event, id);
}, webviewEventJSCallback, bunBridgePostmessageHandler, eventBridgeHandler, internalBridgeHandler, trayItemHandler, applicationMenuHandler, contextMenuHandler, internalRpcHandlers;
var init_native = __esm(async () => {
  init_eventEmitter();
  await __promiseAll([
    init_BrowserView(),
    init_Tray(),
    init_BrowserWindow()
  ]);
  menuDataRegistry = new Map;
  native = (() => {
    try {
      const nativeWrapperPath = join4(process.cwd(), `libNativeWrapper.${suffix}`);
      return dlopen(nativeWrapperPath, {
        createWindowWithFrameAndStyleFromWorker: {
          args: [
            FFIType.u32,
            FFIType.f64,
            FFIType.f64,
            FFIType.f64,
            FFIType.f64,
            FFIType.u32,
            FFIType.cstring,
            FFIType.bool,
            FFIType.function,
            FFIType.function,
            FFIType.function,
            FFIType.function
          ],
          returns: FFIType.ptr
        },
        setWindowTitle: {
          args: [
            FFIType.ptr,
            FFIType.cstring
          ],
          returns: FFIType.void
        },
        showWindow: {
          args: [
            FFIType.ptr
          ],
          returns: FFIType.void
        },
        closeWindow: {
          args: [
            FFIType.ptr
          ],
          returns: FFIType.void
        },
        minimizeWindow: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        restoreWindow: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        isWindowMinimized: {
          args: [FFIType.ptr],
          returns: FFIType.bool
        },
        maximizeWindow: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        unmaximizeWindow: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        isWindowMaximized: {
          args: [FFIType.ptr],
          returns: FFIType.bool
        },
        setWindowFullScreen: {
          args: [FFIType.ptr, FFIType.bool],
          returns: FFIType.void
        },
        isWindowFullScreen: {
          args: [FFIType.ptr],
          returns: FFIType.bool
        },
        setWindowAlwaysOnTop: {
          args: [FFIType.ptr, FFIType.bool],
          returns: FFIType.void
        },
        isWindowAlwaysOnTop: {
          args: [FFIType.ptr],
          returns: FFIType.bool
        },
        setWindowPosition: {
          args: [FFIType.ptr, FFIType.f64, FFIType.f64],
          returns: FFIType.void
        },
        setWindowSize: {
          args: [FFIType.ptr, FFIType.f64, FFIType.f64],
          returns: FFIType.void
        },
        setWindowFrame: {
          args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
          returns: FFIType.void
        },
        getWindowFrame: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.void
        },
        initWebview: {
          args: [
            FFIType.u32,
            FFIType.ptr,
            FFIType.cstring,
            FFIType.cstring,
            FFIType.f64,
            FFIType.f64,
            FFIType.f64,
            FFIType.f64,
            FFIType.bool,
            FFIType.cstring,
            FFIType.function,
            FFIType.function,
            FFIType.function,
            FFIType.function,
            FFIType.function,
            FFIType.cstring,
            FFIType.cstring,
            FFIType.bool,
            FFIType.bool
          ],
          returns: FFIType.ptr
        },
        setNextWebviewFlags: {
          args: [
            FFIType.bool,
            FFIType.bool
          ],
          returns: FFIType.void
        },
        webviewCanGoBack: {
          args: [FFIType.ptr],
          returns: FFIType.bool
        },
        webviewCanGoForward: {
          args: [FFIType.ptr],
          returns: FFIType.bool
        },
        resizeWebview: {
          args: [
            FFIType.ptr,
            FFIType.f64,
            FFIType.f64,
            FFIType.f64,
            FFIType.f64,
            FFIType.cstring
          ],
          returns: FFIType.void
        },
        loadURLInWebView: {
          args: [FFIType.ptr, FFIType.cstring],
          returns: FFIType.void
        },
        loadHTMLInWebView: {
          args: [FFIType.ptr, FFIType.cstring],
          returns: FFIType.void
        },
        updatePreloadScriptToWebView: {
          args: [
            FFIType.ptr,
            FFIType.cstring,
            FFIType.cstring,
            FFIType.bool
          ],
          returns: FFIType.void
        },
        webviewGoBack: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        webviewGoForward: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        webviewReload: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        webviewRemove: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        setWebviewHTMLContent: {
          args: [FFIType.u32, FFIType.cstring],
          returns: FFIType.void
        },
        startWindowMove: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        stopWindowMove: {
          args: [],
          returns: FFIType.void
        },
        webviewSetTransparent: {
          args: [FFIType.ptr, FFIType.bool],
          returns: FFIType.void
        },
        webviewSetPassthrough: {
          args: [FFIType.ptr, FFIType.bool],
          returns: FFIType.void
        },
        webviewSetHidden: {
          args: [FFIType.ptr, FFIType.bool],
          returns: FFIType.void
        },
        setWebviewNavigationRules: {
          args: [FFIType.ptr, FFIType.cstring],
          returns: FFIType.void
        },
        webviewFindInPage: {
          args: [FFIType.ptr, FFIType.cstring, FFIType.bool, FFIType.bool],
          returns: FFIType.void
        },
        webviewStopFind: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        evaluateJavaScriptWithNoCompletion: {
          args: [FFIType.ptr, FFIType.cstring],
          returns: FFIType.void
        },
        webviewOpenDevTools: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        webviewCloseDevTools: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        webviewToggleDevTools: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        createTray: {
          args: [
            FFIType.u32,
            FFIType.cstring,
            FFIType.cstring,
            FFIType.bool,
            FFIType.u32,
            FFIType.u32,
            FFIType.function
          ],
          returns: FFIType.ptr
        },
        setTrayTitle: {
          args: [FFIType.ptr, FFIType.cstring],
          returns: FFIType.void
        },
        setTrayImage: {
          args: [FFIType.ptr, FFIType.cstring],
          returns: FFIType.void
        },
        setTrayMenu: {
          args: [FFIType.ptr, FFIType.cstring],
          returns: FFIType.void
        },
        removeTray: {
          args: [FFIType.ptr],
          returns: FFIType.void
        },
        setApplicationMenu: {
          args: [FFIType.cstring, FFIType.function],
          returns: FFIType.void
        },
        showContextMenu: {
          args: [FFIType.cstring, FFIType.function],
          returns: FFIType.void
        },
        moveToTrash: {
          args: [FFIType.cstring],
          returns: FFIType.bool
        },
        showItemInFolder: {
          args: [FFIType.cstring],
          returns: FFIType.void
        },
        openExternal: {
          args: [FFIType.cstring],
          returns: FFIType.bool
        },
        openPath: {
          args: [FFIType.cstring],
          returns: FFIType.bool
        },
        showNotification: {
          args: [
            FFIType.cstring,
            FFIType.cstring,
            FFIType.cstring,
            FFIType.bool
          ],
          returns: FFIType.void
        },
        setGlobalShortcutCallback: {
          args: [FFIType.function],
          returns: FFIType.void
        },
        registerGlobalShortcut: {
          args: [FFIType.cstring],
          returns: FFIType.bool
        },
        unregisterGlobalShortcut: {
          args: [FFIType.cstring],
          returns: FFIType.bool
        },
        unregisterAllGlobalShortcuts: {
          args: [],
          returns: FFIType.void
        },
        isGlobalShortcutRegistered: {
          args: [FFIType.cstring],
          returns: FFIType.bool
        },
        getAllDisplays: {
          args: [],
          returns: FFIType.cstring
        },
        getPrimaryDisplay: {
          args: [],
          returns: FFIType.cstring
        },
        getCursorScreenPoint: {
          args: [],
          returns: FFIType.cstring
        },
        openFileDialog: {
          args: [
            FFIType.cstring,
            FFIType.cstring,
            FFIType.int,
            FFIType.int,
            FFIType.int
          ],
          returns: FFIType.cstring
        },
        showMessageBox: {
          args: [
            FFIType.cstring,
            FFIType.cstring,
            FFIType.cstring,
            FFIType.cstring,
            FFIType.cstring,
            FFIType.int,
            FFIType.int
          ],
          returns: FFIType.int
        },
        clipboardReadText: {
          args: [],
          returns: FFIType.cstring
        },
        clipboardWriteText: {
          args: [FFIType.cstring],
          returns: FFIType.void
        },
        clipboardReadImage: {
          args: [FFIType.ptr],
          returns: FFIType.ptr
        },
        clipboardWriteImage: {
          args: [FFIType.ptr, FFIType.u64],
          returns: FFIType.void
        },
        clipboardClear: {
          args: [],
          returns: FFIType.void
        },
        clipboardAvailableFormats: {
          args: [],
          returns: FFIType.cstring
        },
        sessionGetCookies: {
          args: [FFIType.cstring, FFIType.cstring],
          returns: FFIType.cstring
        },
        sessionSetCookie: {
          args: [FFIType.cstring, FFIType.cstring],
          returns: FFIType.bool
        },
        sessionRemoveCookie: {
          args: [FFIType.cstring, FFIType.cstring, FFIType.cstring],
          returns: FFIType.bool
        },
        sessionClearCookies: {
          args: [FFIType.cstring],
          returns: FFIType.void
        },
        sessionClearStorageData: {
          args: [FFIType.cstring, FFIType.cstring],
          returns: FFIType.void
        },
        setURLOpenHandler: {
          args: [FFIType.function],
          returns: FFIType.void
        },
        getWindowStyle: {
          args: [
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool,
            FFIType.bool
          ],
          returns: FFIType.u32
        },
        setJSUtils: {
          args: [
            FFIType.function,
            FFIType.function
          ],
          returns: FFIType.void
        },
        setWindowIcon: {
          args: [
            FFIType.ptr,
            FFIType.cstring
          ],
          returns: FFIType.void
        },
        killApp: {
          args: [],
          returns: FFIType.void
        },
        stopEventLoop: {
          args: [],
          returns: FFIType.void
        },
        waitForShutdownComplete: {
          args: [FFIType.i32],
          returns: FFIType.void
        },
        forceExit: {
          args: [FFIType.i32],
          returns: FFIType.void
        },
        setQuitRequestedHandler: {
          args: [FFIType.function],
          returns: FFIType.void
        },
        testFFI2: {
          args: [FFIType.function],
          returns: FFIType.void
        }
      });
    } catch (err) {
      console.log("FATAL Error opening native FFI:", err.message);
      console.log("This may be due to:");
      console.log("  - Missing libNativeWrapper.dll/so/dylib");
      console.log("  - Architecture mismatch (ARM64 vs x64)");
      console.log("  - Missing WebView2 or CEF dependencies");
      if (suffix === "so") {
        console.log("  - Missing system libraries (try: ldd ./libNativeWrapper.so)");
      }
      console.log("Check that the build process completed successfully for your architecture.");
      process.exit();
    }
  })();
  ffi = {
    request: {
      createWindow: (params) => {
        const {
          id,
          url: _url,
          title,
          frame: { x, y, width, height },
          styleMask: {
            Borderless,
            Titled,
            Closable,
            Miniaturizable,
            Resizable,
            UnifiedTitleAndToolbar,
            FullScreen,
            FullSizeContentView,
            UtilityWindow,
            DocModalWindow,
            NonactivatingPanel,
            HUDWindow
          },
          titleBarStyle,
          transparent
        } = params;
        const styleMask = native.symbols.getWindowStyle(Borderless, Titled, Closable, Miniaturizable, Resizable, UnifiedTitleAndToolbar, FullScreen, FullSizeContentView, UtilityWindow, DocModalWindow, NonactivatingPanel, HUDWindow);
        const windowPtr = native.symbols.createWindowWithFrameAndStyleFromWorker(id, x, y, width, height, styleMask, toCString(titleBarStyle), transparent, windowCloseCallback, windowMoveCallback, windowResizeCallback, windowFocusCallback);
        if (!windowPtr) {
          throw "Failed to create window";
        }
        native.symbols.setWindowTitle(windowPtr, toCString(title));
        native.symbols.showWindow(windowPtr);
        return windowPtr;
      },
      setTitle: (params) => {
        const { winId, title } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't add webview to window. window no longer exists`;
        }
        native.symbols.setWindowTitle(windowPtr, toCString(title));
      },
      closeWindow: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't close window. Window no longer exists`;
        }
        native.symbols.closeWindow(windowPtr);
      },
      focusWindow: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't focus window. Window no longer exists`;
        }
        native.symbols.showWindow(windowPtr);
      },
      minimizeWindow: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't minimize window. Window no longer exists`;
        }
        native.symbols.minimizeWindow(windowPtr);
      },
      restoreWindow: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't restore window. Window no longer exists`;
        }
        native.symbols.restoreWindow(windowPtr);
      },
      isWindowMinimized: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          return false;
        }
        return native.symbols.isWindowMinimized(windowPtr);
      },
      maximizeWindow: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't maximize window. Window no longer exists`;
        }
        native.symbols.maximizeWindow(windowPtr);
      },
      unmaximizeWindow: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't unmaximize window. Window no longer exists`;
        }
        native.symbols.unmaximizeWindow(windowPtr);
      },
      isWindowMaximized: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          return false;
        }
        return native.symbols.isWindowMaximized(windowPtr);
      },
      setWindowFullScreen: (params) => {
        const { winId, fullScreen } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't set fullscreen. Window no longer exists`;
        }
        native.symbols.setWindowFullScreen(windowPtr, fullScreen);
      },
      isWindowFullScreen: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          return false;
        }
        return native.symbols.isWindowFullScreen(windowPtr);
      },
      setWindowAlwaysOnTop: (params) => {
        const { winId, alwaysOnTop } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't set always on top. Window no longer exists`;
        }
        native.symbols.setWindowAlwaysOnTop(windowPtr, alwaysOnTop);
      },
      isWindowAlwaysOnTop: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          return false;
        }
        return native.symbols.isWindowAlwaysOnTop(windowPtr);
      },
      setWindowPosition: (params) => {
        const { winId, x, y } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't set window position. Window no longer exists`;
        }
        native.symbols.setWindowPosition(windowPtr, x, y);
      },
      setWindowSize: (params) => {
        const { winId, width, height } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't set window size. Window no longer exists`;
        }
        native.symbols.setWindowSize(windowPtr, width, height);
      },
      setWindowFrame: (params) => {
        const { winId, x, y, width, height } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          throw `Can't set window frame. Window no longer exists`;
        }
        native.symbols.setWindowFrame(windowPtr, x, y, width, height);
      },
      getWindowFrame: (params) => {
        const { winId } = params;
        const windowPtr = BrowserWindow.getById(winId)?.ptr;
        if (!windowPtr) {
          return { x: 0, y: 0, width: 0, height: 0 };
        }
        const xBuf = new Float64Array(1);
        const yBuf = new Float64Array(1);
        const widthBuf = new Float64Array(1);
        const heightBuf = new Float64Array(1);
        native.symbols.getWindowFrame(windowPtr, ptr(xBuf), ptr(yBuf), ptr(widthBuf), ptr(heightBuf));
        return {
          x: xBuf[0],
          y: yBuf[0],
          width: widthBuf[0],
          height: heightBuf[0]
        };
      },
      createWebview: (params) => {
        const {
          id,
          windowId,
          renderer,
          rpcPort: rpcPort2,
          secretKey,
          url,
          partition,
          preload,
          frame: { x, y, width, height },
          autoResize,
          sandbox,
          startTransparent,
          startPassthrough
        } = params;
        const parentWindow = BrowserWindow.getById(windowId);
        const windowPtr = parentWindow?.ptr;
        const transparent = parentWindow?.transparent ?? false;
        if (!windowPtr) {
          throw `Can't add webview to window. window no longer exists`;
        }
        let dynamicPreload;
        let selectedPreloadScript;
        if (sandbox) {
          dynamicPreload = `
window.__electrobunWebviewId = ${id};
window.__electrobunWindowId = ${windowId};
window.__electrobunEventBridge = window.__electrobunEventBridge || window.webkit?.messageHandlers?.eventBridge || window.eventBridge || window.chrome?.webview?.hostObjects?.eventBridge;
window.__electrobunInternalBridge = window.__electrobunInternalBridge || window.webkit?.messageHandlers?.internalBridge || window.internalBridge || window.chrome?.webview?.hostObjects?.internalBridge;
`;
          selectedPreloadScript = preloadScriptSandboxed;
        } else {
          dynamicPreload = `
window.__electrobunWebviewId = ${id};
window.__electrobunWindowId = ${windowId};
window.__electrobunRpcSocketPort = ${rpcPort2};
window.__electrobunSecretKeyBytes = [${secretKey}];
window.__electrobunEventBridge = window.__electrobunEventBridge || window.webkit?.messageHandlers?.eventBridge || window.eventBridge || window.chrome?.webview?.hostObjects?.eventBridge;
window.__electrobunInternalBridge = window.__electrobunInternalBridge || window.webkit?.messageHandlers?.internalBridge || window.internalBridge || window.chrome?.webview?.hostObjects?.internalBridge;
window.__electrobunBunBridge = window.__electrobunBunBridge || window.webkit?.messageHandlers?.bunBridge || window.bunBridge || window.chrome?.webview?.hostObjects?.bunBridge;
`;
          selectedPreloadScript = preloadScript;
        }
        const electrobunPreload = dynamicPreload + selectedPreloadScript;
        const customPreload = preload;
        native.symbols.setNextWebviewFlags(startTransparent, startPassthrough);
        const webviewPtr = native.symbols.initWebview(id, windowPtr, toCString(renderer), toCString(url || ""), x, y, width, height, autoResize, toCString(partition || "persist:default"), webviewDecideNavigation, webviewEventJSCallback, eventBridgeHandler, bunBridgePostmessageHandler, internalBridgeHandler, toCString(electrobunPreload), toCString(customPreload || ""), transparent, sandbox);
        if (!webviewPtr) {
          throw "Failed to create webview";
        }
        return webviewPtr;
      },
      evaluateJavascriptWithNoCompletion: (params) => {
        const { id, js } = params;
        const webview = BrowserView.getById(id);
        if (!webview?.ptr) {
          return;
        }
        native.symbols.evaluateJavaScriptWithNoCompletion(webview.ptr, toCString(js));
      },
      createTray: (params) => {
        const { id, title, image, template, width, height } = params;
        const trayPtr = native.symbols.createTray(id, toCString(title), toCString(image), template, width, height, trayItemHandler);
        if (!trayPtr) {
          throw "Failed to create tray";
        }
        return trayPtr;
      },
      setTrayTitle: (params) => {
        const { id, title } = params;
        const tray = Tray.getById(id);
        if (!tray)
          return;
        native.symbols.setTrayTitle(tray.ptr, toCString(title));
      },
      setTrayImage: (params) => {
        const { id, image } = params;
        const tray = Tray.getById(id);
        if (!tray)
          return;
        native.symbols.setTrayImage(tray.ptr, toCString(image));
      },
      setTrayMenu: (params) => {
        const { id, menuConfig } = params;
        const tray = Tray.getById(id);
        if (!tray)
          return;
        native.symbols.setTrayMenu(tray.ptr, toCString(menuConfig));
      },
      removeTray: (params) => {
        const { id } = params;
        const tray = Tray.getById(id);
        if (!tray) {
          throw `Can't remove tray. Tray no longer exists`;
        }
        native.symbols.removeTray(tray.ptr);
      },
      setApplicationMenu: (params) => {
        const { menuConfig } = params;
        native.symbols.setApplicationMenu(toCString(menuConfig), applicationMenuHandler);
      },
      showContextMenu: (params) => {
        const { menuConfig } = params;
        native.symbols.showContextMenu(toCString(menuConfig), contextMenuHandler);
      },
      moveToTrash: (params) => {
        const { path } = params;
        return native.symbols.moveToTrash(toCString(path));
      },
      showItemInFolder: (params) => {
        const { path } = params;
        native.symbols.showItemInFolder(toCString(path));
      },
      openExternal: (params) => {
        const { url } = params;
        return native.symbols.openExternal(toCString(url));
      },
      openPath: (params) => {
        const { path } = params;
        return native.symbols.openPath(toCString(path));
      },
      showNotification: (params) => {
        const { title, body = "", subtitle = "", silent = false } = params;
        native.symbols.showNotification(toCString(title), toCString(body), toCString(subtitle), silent);
      },
      openFileDialog: (params) => {
        const {
          startingFolder,
          allowedFileTypes,
          canChooseFiles,
          canChooseDirectory,
          allowsMultipleSelection
        } = params;
        const filePath = native.symbols.openFileDialog(toCString(startingFolder), toCString(allowedFileTypes), canChooseFiles ? 1 : 0, canChooseDirectory ? 1 : 0, allowsMultipleSelection ? 1 : 0);
        return filePath.toString();
      },
      showMessageBox: (params) => {
        const {
          type = "info",
          title = "",
          message = "",
          detail = "",
          buttons = ["OK"],
          defaultId = 0,
          cancelId = -1
        } = params;
        const buttonsStr = buttons.join(",");
        return native.symbols.showMessageBox(toCString(type), toCString(title), toCString(message), toCString(detail), toCString(buttonsStr), defaultId, cancelId);
      },
      clipboardReadText: () => {
        const result = native.symbols.clipboardReadText();
        if (!result)
          return null;
        return result.toString();
      },
      clipboardWriteText: (params) => {
        native.symbols.clipboardWriteText(toCString(params.text));
      },
      clipboardReadImage: () => {
        const sizeBuffer = new BigUint64Array(1);
        const dataPtr = native.symbols.clipboardReadImage(ptr(sizeBuffer));
        if (!dataPtr)
          return null;
        const size = Number(sizeBuffer[0]);
        if (size === 0)
          return null;
        const result = new Uint8Array(size);
        const sourceView = new Uint8Array(toArrayBuffer(dataPtr, 0, size));
        result.set(sourceView);
        return result;
      },
      clipboardWriteImage: (params) => {
        const { pngData } = params;
        native.symbols.clipboardWriteImage(ptr(pngData), BigInt(pngData.length));
      },
      clipboardClear: () => {
        native.symbols.clipboardClear();
      },
      clipboardAvailableFormats: () => {
        const result = native.symbols.clipboardAvailableFormats();
        if (!result)
          return [];
        const formatsStr = result.toString();
        if (!formatsStr)
          return [];
        return formatsStr.split(",").filter((f) => f.length > 0);
      }
    },
    internal: {
      storeMenuData,
      getMenuData,
      clearMenuData,
      serializeMenuAction,
      deserializeMenuAction
    }
  };
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception in worker:", err);
    native.symbols.stopEventLoop();
    native.symbols.waitForShutdownComplete(5000);
    native.symbols.forceExit(1);
  });
  process.on("unhandledRejection", (reason, _promise) => {
    console.error("Unhandled rejection in worker:", reason);
  });
  process.on("SIGINT", () => {
    console.log("[electrobun] Received SIGINT, running quit sequence...");
    const { quit: quit2 } = (init_Utils(), __toCommonJS(exports_Utils));
    quit2();
  });
  process.on("SIGTERM", () => {
    console.log("[electrobun] Received SIGTERM, running quit sequence...");
    const { quit: quit2 } = (init_Utils(), __toCommonJS(exports_Utils));
    quit2();
  });
  windowCloseCallback = new JSCallback((id) => {
    const handler = eventEmitter_default.events.window.close;
    const event = handler({
      id
    });
    eventEmitter_default.emitEvent(event, id);
    eventEmitter_default.emitEvent(event);
  }, {
    args: ["u32"],
    returns: "void",
    threadsafe: true
  });
  windowMoveCallback = new JSCallback((id, x, y) => {
    const handler = eventEmitter_default.events.window.move;
    const event = handler({
      id,
      x,
      y
    });
    eventEmitter_default.emitEvent(event);
    eventEmitter_default.emitEvent(event, id);
  }, {
    args: ["u32", "f64", "f64"],
    returns: "void",
    threadsafe: true
  });
  windowResizeCallback = new JSCallback((id, x, y, width, height) => {
    const handler = eventEmitter_default.events.window.resize;
    const event = handler({
      id,
      x,
      y,
      width,
      height
    });
    eventEmitter_default.emitEvent(event);
    eventEmitter_default.emitEvent(event, id);
  }, {
    args: ["u32", "f64", "f64", "f64", "f64"],
    returns: "void",
    threadsafe: true
  });
  windowFocusCallback = new JSCallback((id) => {
    const handler = eventEmitter_default.events.window.focus;
    const event = handler({
      id
    });
    eventEmitter_default.emitEvent(event);
    eventEmitter_default.emitEvent(event, id);
  }, {
    args: ["u32"],
    returns: "void",
    threadsafe: true
  });
  getMimeType = new JSCallback((filePath) => {
    const _filePath = new CString(filePath).toString();
    const mimeType = Bun.file(_filePath).type;
    return toCString(mimeType.split(";")[0]);
  }, {
    args: [FFIType.cstring],
    returns: FFIType.cstring
  });
  getHTMLForWebviewSync = new JSCallback((webviewId) => {
    const webview = BrowserView.getById(webviewId);
    return toCString(webview?.html || "");
  }, {
    args: [FFIType.u32],
    returns: FFIType.cstring
  });
  native.symbols.setJSUtils(getMimeType, getHTMLForWebviewSync);
  urlOpenCallback = new JSCallback((urlPtr) => {
    const url = new CString(urlPtr).toString();
    const handler = eventEmitter_default.events.app.openUrl;
    const event = handler({ url });
    eventEmitter_default.emitEvent(event);
  }, {
    args: [FFIType.cstring],
    returns: "void",
    threadsafe: true
  });
  if (process.platform === "darwin") {
    native.symbols.setURLOpenHandler(urlOpenCallback);
  }
  quitRequestedCallback = new JSCallback(() => {
    const { quit: quit2 } = (init_Utils(), __toCommonJS(exports_Utils));
    quit2();
  }, {
    args: [],
    returns: "void",
    threadsafe: true
  });
  native.symbols.setQuitRequestedHandler(quitRequestedCallback);
  globalShortcutHandlers = new Map;
  globalShortcutCallback = new JSCallback((acceleratorPtr) => {
    const accelerator = new CString(acceleratorPtr).toString();
    const handler = globalShortcutHandlers.get(accelerator);
    if (handler) {
      handler();
    }
  }, {
    args: [FFIType.cstring],
    returns: "void",
    threadsafe: true
  });
  native.symbols.setGlobalShortcutCallback(globalShortcutCallback);
  sessionCache = new Map;
  webviewDecideNavigation = new JSCallback((_webviewId, _url) => {
    return true;
  }, {
    args: [FFIType.u32, FFIType.cstring],
    returns: FFIType.u32,
    threadsafe: true
  });
  webviewEventJSCallback = new JSCallback((id, _eventName, _detail) => {
    let eventName = "";
    let detail = "";
    try {
      eventName = new CString(_eventName).toString();
      detail = new CString(_detail).toString();
    } catch (err) {
      console.error("[webviewEventJSCallback] Error converting strings:", err);
      console.error("[webviewEventJSCallback] Raw values:", {
        _eventName,
        _detail
      });
      return;
    }
    webviewEventHandler(id, eventName, detail);
  }, {
    args: [FFIType.u32, FFIType.cstring, FFIType.cstring],
    returns: FFIType.void,
    threadsafe: true
  });
  bunBridgePostmessageHandler = new JSCallback((id, msg) => {
    try {
      const msgStr = new CString(msg);
      if (!msgStr.length) {
        return;
      }
      const msgJson = JSON.parse(msgStr.toString());
      const webview = BrowserView.getById(id);
      if (!webview)
        return;
      webview.rpcHandler?.(msgJson);
    } catch (err) {
      console.error("error sending message to bun: ", err);
      console.error("msgString: ", new CString(msg));
    }
  }, {
    args: [FFIType.u32, FFIType.cstring],
    returns: FFIType.void,
    threadsafe: true
  });
  eventBridgeHandler = new JSCallback((_id, msg) => {
    try {
      const message = new CString(msg);
      const jsonMessage = JSON.parse(message.toString());
      if (jsonMessage.id === "webviewEvent") {
        const { payload } = jsonMessage;
        webviewEventHandler(payload.id, payload.eventName, payload.detail);
      }
    } catch (err) {
      console.error("error in eventBridgeHandler: ", err);
    }
  }, {
    args: [FFIType.u32, FFIType.cstring],
    returns: FFIType.void,
    threadsafe: true
  });
  internalBridgeHandler = new JSCallback((_id, msg) => {
    try {
      const batchMessage = new CString(msg);
      const jsonBatch = JSON.parse(batchMessage.toString());
      if (jsonBatch.id === "webviewEvent") {
        const { payload } = jsonBatch;
        webviewEventHandler(payload.id, payload.eventName, payload.detail);
        return;
      }
      jsonBatch.forEach((msgStr) => {
        const msgJson = JSON.parse(msgStr);
        if (msgJson.type === "message") {
          const handler = internalRpcHandlers.message[msgJson.id];
          handler?.(msgJson.payload);
        } else if (msgJson.type === "request") {
          const hostWebview = BrowserView.getById(msgJson.hostWebviewId);
          const handler = internalRpcHandlers.request[msgJson.method];
          const payload = handler?.(msgJson.params);
          const resultObj = {
            type: "response",
            id: msgJson.id,
            success: true,
            payload
          };
          if (!hostWebview) {
            console.log("--->>> internal request in bun: NO HOST WEBVIEW FOUND");
            return;
          }
          hostWebview.sendInternalMessageViaExecute(resultObj);
        }
      });
    } catch (err) {
      console.error("error in internalBridgeHandler: ", err);
    }
  }, {
    args: [FFIType.u32, FFIType.cstring],
    returns: FFIType.void,
    threadsafe: true
  });
  trayItemHandler = new JSCallback((id, action) => {
    const actionString = (new CString(action).toString() || "").trim();
    const { action: actualAction, data } = deserializeMenuAction(actionString);
    const event = eventEmitter_default.events.tray.trayClicked({
      id,
      action: actualAction,
      data
    });
    eventEmitter_default.emitEvent(event);
    eventEmitter_default.emitEvent(event, id);
  }, {
    args: [FFIType.u32, FFIType.cstring],
    returns: FFIType.void,
    threadsafe: true
  });
  applicationMenuHandler = new JSCallback((id, action) => {
    const actionString = new CString(action).toString();
    const { action: actualAction, data } = deserializeMenuAction(actionString);
    const event = eventEmitter_default.events.app.applicationMenuClicked({
      id,
      action: actualAction,
      data
    });
    eventEmitter_default.emitEvent(event);
  }, {
    args: [FFIType.u32, FFIType.cstring],
    returns: FFIType.void,
    threadsafe: true
  });
  contextMenuHandler = new JSCallback((_id, action) => {
    const actionString = new CString(action).toString();
    const { action: actualAction, data } = deserializeMenuAction(actionString);
    const event = eventEmitter_default.events.app.contextMenuClicked({
      action: actualAction,
      data
    });
    eventEmitter_default.emitEvent(event);
  }, {
    args: [FFIType.u32, FFIType.cstring],
    returns: FFIType.void,
    threadsafe: true
  });
  internalRpcHandlers = {
    request: {
      webviewTagInit: (params) => {
        const {
          hostWebviewId,
          windowId,
          renderer,
          html,
          preload,
          partition,
          frame,
          navigationRules,
          sandbox,
          transparent,
          passthrough
        } = params;
        const url = !params.url && !html ? "https://electrobun.dev" : params.url;
        const webviewForTag = new BrowserView({
          url,
          html,
          preload,
          partition,
          frame,
          hostWebviewId,
          autoResize: false,
          windowId,
          renderer,
          navigationRules,
          sandbox,
          startTransparent: transparent,
          startPassthrough: passthrough
        });
        return webviewForTag.id;
      },
      webviewTagCanGoBack: (params) => {
        const { id } = params;
        const webviewPtr = BrowserView.getById(id)?.ptr;
        if (!webviewPtr) {
          console.error("no webview ptr");
          return false;
        }
        return native.symbols.webviewCanGoBack(webviewPtr);
      },
      webviewTagCanGoForward: (params) => {
        const { id } = params;
        const webviewPtr = BrowserView.getById(id)?.ptr;
        if (!webviewPtr) {
          console.error("no webview ptr");
          return false;
        }
        return native.symbols.webviewCanGoForward(webviewPtr);
      }
    },
    message: {
      webviewTagResize: (params) => {
        const browserView = BrowserView.getById(params.id);
        const webviewPtr = browserView?.ptr;
        if (!webviewPtr) {
          console.log("[Bun] ERROR: webviewTagResize - no webview ptr found for id:", params.id);
          return;
        }
        const { x, y, width, height } = params.frame;
        native.symbols.resizeWebview(webviewPtr, x, y, width, height, toCString(params.masks));
      },
      webviewTagUpdateSrc: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagUpdateSrc: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.loadURLInWebView(webview.ptr, toCString(params.url));
      },
      webviewTagUpdateHtml: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagUpdateHtml: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.setWebviewHTMLContent(webview.id, toCString(params.html));
        webview.loadHTML(params.html);
        webview.html = params.html;
      },
      webviewTagUpdatePreload: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagUpdatePreload: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.updatePreloadScriptToWebView(webview.ptr, toCString("electrobun_custom_preload_script"), toCString(params.preload), true);
      },
      webviewTagGoBack: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagGoBack: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewGoBack(webview.ptr);
      },
      webviewTagGoForward: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagGoForward: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewGoForward(webview.ptr);
      },
      webviewTagReload: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagReload: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewReload(webview.ptr);
      },
      webviewTagRemove: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagRemove: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewRemove(webview.ptr);
      },
      startWindowMove: (params) => {
        const window = BrowserWindow.getById(params.id);
        if (!window)
          return;
        native.symbols.startWindowMove(window.ptr);
      },
      stopWindowMove: (_params) => {
        native.symbols.stopWindowMove();
      },
      webviewTagSetTransparent: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagSetTransparent: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewSetTransparent(webview.ptr, params.transparent);
      },
      webviewTagSetPassthrough: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagSetPassthrough: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewSetPassthrough(webview.ptr, params.enablePassthrough);
      },
      webviewTagSetHidden: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagSetHidden: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewSetHidden(webview.ptr, params.hidden);
      },
      webviewTagSetNavigationRules: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagSetNavigationRules: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        const rulesJson = JSON.stringify(params.rules);
        native.symbols.setWebviewNavigationRules(webview.ptr, toCString(rulesJson));
      },
      webviewTagFindInPage: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagFindInPage: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewFindInPage(webview.ptr, toCString(params.searchText), params.forward, params.matchCase);
      },
      webviewTagStopFind: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagStopFind: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewStopFind(webview.ptr);
      },
      webviewTagOpenDevTools: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagOpenDevTools: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewOpenDevTools(webview.ptr);
      },
      webviewTagCloseDevTools: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagCloseDevTools: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewCloseDevTools(webview.ptr);
      },
      webviewTagToggleDevTools: (params) => {
        const webview = BrowserView.getById(params.id);
        if (!webview || !webview.ptr) {
          console.error(`webviewTagToggleDevTools: BrowserView not found or has no ptr for id ${params.id}`);
          return;
        }
        native.symbols.webviewToggleDevTools(webview.ptr);
      },
      webviewEvent: (params) => {
        console.log("-----------------+webviewEvent", params);
      }
    }
  };
});

// node_modules/electrobun/dist/api/bun/core/BrowserWindow.ts
class BrowserWindow {
  id = nextWindowId++;
  ptr;
  title = "Electrobun";
  state = "creating";
  url = null;
  html = null;
  preload = null;
  renderer = "native";
  transparent = false;
  navigationRules = null;
  sandbox = false;
  frame = {
    x: 0,
    y: 0,
    width: 800,
    height: 600
  };
  webviewId;
  constructor(options = defaultOptions2) {
    this.title = options.title || "New Window";
    this.frame = options.frame ? { ...defaultOptions2.frame, ...options.frame } : { ...defaultOptions2.frame };
    this.url = options.url || null;
    this.html = options.html || null;
    this.preload = options.preload || null;
    this.renderer = options.renderer || defaultOptions2.renderer;
    this.transparent = options.transparent ?? false;
    this.navigationRules = options.navigationRules || null;
    this.sandbox = options.sandbox ?? false;
    this.init(options);
  }
  init({
    rpc,
    styleMask,
    titleBarStyle,
    transparent
  }) {
    this.ptr = ffi.request.createWindow({
      id: this.id,
      title: this.title,
      url: this.url || "",
      frame: {
        width: this.frame.width,
        height: this.frame.height,
        x: this.frame.x,
        y: this.frame.y
      },
      styleMask: {
        Borderless: false,
        Titled: true,
        Closable: true,
        Miniaturizable: true,
        Resizable: true,
        UnifiedTitleAndToolbar: false,
        FullScreen: false,
        FullSizeContentView: false,
        UtilityWindow: false,
        DocModalWindow: false,
        NonactivatingPanel: false,
        HUDWindow: false,
        ...styleMask || {},
        ...titleBarStyle === "hiddenInset" ? {
          Titled: true,
          FullSizeContentView: true
        } : {},
        ...titleBarStyle === "hidden" ? {
          Titled: false,
          FullSizeContentView: true
        } : {}
      },
      titleBarStyle: titleBarStyle || "default",
      transparent: transparent ?? false
    });
    BrowserWindowMap[this.id] = this;
    const webview = new BrowserView({
      url: this.url,
      html: this.html,
      preload: this.preload,
      renderer: this.renderer,
      frame: {
        x: 0,
        y: 0,
        width: this.frame.width,
        height: this.frame.height
      },
      rpc,
      windowId: this.id,
      navigationRules: this.navigationRules,
      sandbox: this.sandbox
    });
    console.log("setting webviewId: ", webview.id);
    this.webviewId = webview.id;
  }
  get webview() {
    return BrowserView.getById(this.webviewId);
  }
  static getById(id) {
    return BrowserWindowMap[id];
  }
  setTitle(title) {
    this.title = title;
    return ffi.request.setTitle({ winId: this.id, title });
  }
  close() {
    return ffi.request.closeWindow({ winId: this.id });
  }
  focus() {
    return ffi.request.focusWindow({ winId: this.id });
  }
  show() {
    return ffi.request.focusWindow({ winId: this.id });
  }
  minimize() {
    return ffi.request.minimizeWindow({ winId: this.id });
  }
  unminimize() {
    return ffi.request.restoreWindow({ winId: this.id });
  }
  isMinimized() {
    return ffi.request.isWindowMinimized({ winId: this.id });
  }
  maximize() {
    return ffi.request.maximizeWindow({ winId: this.id });
  }
  unmaximize() {
    return ffi.request.unmaximizeWindow({ winId: this.id });
  }
  isMaximized() {
    return ffi.request.isWindowMaximized({ winId: this.id });
  }
  setFullScreen(fullScreen) {
    return ffi.request.setWindowFullScreen({ winId: this.id, fullScreen });
  }
  isFullScreen() {
    return ffi.request.isWindowFullScreen({ winId: this.id });
  }
  setAlwaysOnTop(alwaysOnTop) {
    return ffi.request.setWindowAlwaysOnTop({ winId: this.id, alwaysOnTop });
  }
  isAlwaysOnTop() {
    return ffi.request.isWindowAlwaysOnTop({ winId: this.id });
  }
  setPosition(x, y) {
    this.frame.x = x;
    this.frame.y = y;
    return ffi.request.setWindowPosition({ winId: this.id, x, y });
  }
  setSize(width, height) {
    this.frame.width = width;
    this.frame.height = height;
    return ffi.request.setWindowSize({ winId: this.id, width, height });
  }
  setFrame(x, y, width, height) {
    this.frame = { x, y, width, height };
    return ffi.request.setWindowFrame({ winId: this.id, x, y, width, height });
  }
  getFrame() {
    const frame = ffi.request.getWindowFrame({ winId: this.id });
    this.frame = frame;
    return frame;
  }
  getPosition() {
    const frame = this.getFrame();
    return { x: frame.x, y: frame.y };
  }
  getSize() {
    const frame = this.getFrame();
    return { width: frame.width, height: frame.height };
  }
  on(name, handler) {
    const specificName = `${name}-${this.id}`;
    eventEmitter_default.on(specificName, handler);
  }
}
var buildConfig3, nextWindowId = 1, defaultOptions2, BrowserWindowMap;
var init_BrowserWindow = __esm(async () => {
  init_eventEmitter();
  init_BuildConfig();
  await __promiseAll([
    init_native(),
    init_BrowserView(),
    init_Utils()
  ]);
  buildConfig3 = await BuildConfig.get();
  defaultOptions2 = {
    title: "Electrobun",
    frame: {
      x: 0,
      y: 0,
      width: 800,
      height: 600
    },
    url: "https://electrobun.dev",
    html: null,
    preload: null,
    renderer: buildConfig3.defaultRenderer,
    titleBarStyle: "default",
    transparent: false,
    navigationRules: null,
    sandbox: false
  };
  BrowserWindowMap = {};
  eventEmitter_default.on("close", (event) => {
    delete BrowserWindowMap[event.data.id];
    const exitOnLastWindowClosed = buildConfig3.runtime?.exitOnLastWindowClosed ?? true;
    if (exitOnLastWindowClosed && Object.keys(BrowserWindowMap).length === 0) {
      quit();
    }
  });
});

// src/eventBus.ts
class EventBus {
  listeners = new Set;
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event) {
    for (const listener of this.listeners)
      listener(event);
  }
}

// src/errors.ts
import { Data } from "effect";
var RulesLoadError, RequestError, ProxyError, CertError, CommandError;
var init_errors = __esm(() => {
  RulesLoadError = class RulesLoadError extends Data.TaggedError("RulesLoadError") {
  };
  RequestError = class RequestError extends Data.TaggedError("RequestError") {
  };
  ProxyError = class ProxyError extends Data.TaggedError("ProxyError") {
  };
  CertError = class CertError extends Data.TaggedError("CertError") {
  };
  CommandError = class CommandError extends Data.TaggedError("CommandError") {
    get message() {
      return `${this.command} ${this.args.join(" ")} exited with ${this.exitCode}: ${this.stderr}`;
    }
  };
});

// src/http.ts
import { Effect } from "effect";
function stripHopByHop(headers) {
  for (const name of hopByHopHeaders)
    headers.delete(name);
}
function headersToRecord(headers) {
  const record = {};
  for (const [key, value] of headers)
    record[key] = value;
  return record;
}
function createSseStream(abortSignal, eventBus, listRulesEvent, listViewsEvent) {
  const sseClients = new Set;
  const unsubscribe = eventBus.on((event) => emitSse(event, sseClients));
  return new ReadableStream({
    start(controller) {
      sseClients.add(controller);
      controller.enqueue(`data: {"type":"hello","status":"ok"}

`);
      controller.enqueue(`data: ${JSON.stringify(listRulesEvent())}

`);
      controller.enqueue(`data: ${JSON.stringify(listViewsEvent())}

`);
      abortSignal.addEventListener("abort", () => {
        sseClients.delete(controller);
        unsubscribe();
        controller.close();
      }, { once: true });
    }
  });
}
function emitSse(event, sseClients) {
  const payload = `data: ${JSON.stringify(event)}

`;
  for (const controller of sseClients)
    controller.enqueue(payload);
}
function parseJsonBody(req) {
  return Effect.tryPromise(() => req.json());
}
var hopByHopHeaders;
var init_http = __esm(() => {
  hopByHopHeaders = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "proxy-connection"
  ]);
});

// src/tunnel.ts
async function handleConnect(clientSocket, host, port, pendingData, emitEvent) {
  const tunnelId = crypto.randomUUID();
  const startedAt = Date.now();
  emitEvent({
    type: "request",
    id: tunnelId,
    method: "CONNECT",
    url: `${host}:${port}`,
    headers: {},
    timestamp: startedAt
  });
  try {
    await Bun.connect({
      hostname: host,
      port,
      socket: {
        open(socket) {
          socket.data = { peer: clientSocket };
          clientSocket.data.peer = socket;
          clientSocket.write(`HTTP/1.1 200 Connection Established\r
\r
`);
          for (const buf of pendingData) {
            socket.write(buf);
          }
          pendingData.length = 0;
        },
        data(socket, data) {
          socket.data.peer?.write(data);
        },
        close(socket) {
          socket.data.peer?.end();
        },
        error(socket, error) {
          console.error(`[tunnel] upstream error for ${host}:${port}:`, error?.message ?? error);
          socket.data.peer?.end();
        },
        connectError(_socket, error) {
          console.error(`[tunnel] connect failed for ${host}:${port}:`, error?.message ?? error);
          clientSocket.write(`HTTP/1.1 502 Bad Gateway\r
\r
`);
          clientSocket.end();
          emitEvent({
            type: "error",
            id: tunnelId,
            message: `CONNECT failed: ${error?.message ?? "unknown error"}`,
            timestamp: Date.now()
          });
        }
      }
    });
    emitEvent({
      type: "response",
      id: tunnelId,
      status: 200,
      headers: {},
      durationMs: Date.now() - startedAt,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error(`[tunnel] failed to open connection to ${host}:${port}:`, err?.message ?? err);
    clientSocket.write(`HTTP/1.1 502 Bad Gateway\r
\r
`);
    clientSocket.end();
    emitEvent({
      type: "error",
      id: tunnelId,
      message: `CONNECT failed: ${err?.message ?? "unknown error"}`,
      timestamp: Date.now()
    });
  }
}

// src/ca.ts
import { Effect as Effect2 } from "effect";
import { existsSync, mkdirSync as mkdirSync2, unlinkSync as unlinkSync2 } from "fs";
import { join as join5 } from "path";
import { homedir as homedir3 } from "os";
function runOpenssl(args) {
  return Effect2.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["openssl", ...args], {
        stdout: "pipe",
        stderr: "pipe"
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
      ]);
      if (exitCode !== 0) {
        throw { stderr: stderr.trim() || stdout.trim(), exitCode };
      }
      return stdout;
    },
    catch: (err) => new CommandError({
      command: "openssl",
      args,
      stderr: err?.stderr ?? String(err),
      exitCode: err?.exitCode ?? 1
    })
  });
}
async function runOpensslAsync(args) {
  const proc = Bun.spawn(["openssl", ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  if (exitCode !== 0) {
    throw new CommandError({
      command: "openssl",
      args,
      stderr: stderr.trim() || stdout.trim(),
      exitCode
    });
  }
  return stdout;
}
function ensureCa() {
  return Effect2.gen(function* (_) {
    mkdirSync2(CA_DIR, { recursive: true });
    if (!existsSync(CA_KEY_PATH) || !existsSync(CA_CERT_PATH)) {
      console.log("[ca] Generating new root CA certificate...");
      yield* _(generateCa());
      console.log(`[ca] Root CA saved to ${CA_CERT_PATH}`);
      console.log(`[ca] Trust it: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${CA_CERT_PATH}`);
    }
    const keyPem = yield* _(Effect2.tryPromise({
      try: () => Bun.file(CA_KEY_PATH).text(),
      catch: (err) => new CommandError({ command: "read", args: [CA_KEY_PATH], stderr: String(err), exitCode: 1 })
    }));
    const certPem = yield* _(Effect2.tryPromise({
      try: () => Bun.file(CA_CERT_PATH).text(),
      catch: (err) => new CommandError({ command: "read", args: [CA_CERT_PATH], stderr: String(err), exitCode: 1 })
    }));
    return { keyPem, certPem, keyPath: CA_KEY_PATH, certPath: CA_CERT_PATH };
  });
}
function generateCa() {
  return Effect2.gen(function* (_) {
    yield* _(runOpenssl([
      "genrsa",
      "-out",
      CA_KEY_PATH,
      "2048"
    ]));
    yield* _(runOpenssl([
      "req",
      "-new",
      "-x509",
      "-key",
      CA_KEY_PATH,
      "-out",
      CA_CERT_PATH,
      "-days",
      String(CA_DAYS),
      "-subj",
      "/CN=aproxy CA/O=aproxy/C=US",
      "-sha256"
    ]));
  });
}
async function getHostCert(hostname, ca) {
  const cached = hostCertCache.get(hostname);
  if (cached)
    return cached;
  const inflight = hostCertInflight.get(hostname);
  if (inflight)
    return inflight;
  const promise = generateHostCert(hostname, ca).then((cert) => {
    hostCertCache.set(hostname, cert);
    hostCertInflight.delete(hostname);
    return cert;
  }).catch((err) => {
    hostCertInflight.delete(hostname);
    throw err;
  });
  hostCertInflight.set(hostname, promise);
  return promise;
}
async function generateHostCert(hostname, ca) {
  const tmpDir = join5(CA_DIR, "tmp");
  mkdirSync2(tmpDir, { recursive: true });
  const id = crypto.randomUUID().slice(0, 8);
  const base = `${sanitizeFilename(hostname)}-${id}`;
  const leafKeyPath = join5(tmpDir, `${base}-key.pem`);
  const leafCsrPath = join5(tmpDir, `${base}.csr`);
  const leafCertPath = join5(tmpDir, `${base}.pem`);
  const extPath = join5(tmpDir, `${base}.ext`);
  try {
    await runOpensslAsync([
      "genrsa",
      "-out",
      leafKeyPath,
      "2048"
    ]);
    await runOpensslAsync([
      "req",
      "-new",
      "-key",
      leafKeyPath,
      "-out",
      leafCsrPath,
      "-subj",
      `/CN=${hostname}`
    ]);
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
    const sanLine = isIp ? `IP:${hostname}` : `DNS:${hostname}`;
    await Bun.write(extPath, [
      "authorityKeyIdentifier=keyid,issuer",
      "basicConstraints=CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=${sanLine}`
    ].join(`
`));
    await runOpensslAsync([
      "x509",
      "-req",
      "-in",
      leafCsrPath,
      "-CA",
      ca.certPath,
      "-CAkey",
      ca.keyPath,
      "-CAcreateserial",
      "-out",
      leafCertPath,
      "-days",
      String(LEAF_DAYS),
      "-sha256",
      "-extfile",
      extPath
    ]);
    const keyPem = await Bun.file(leafKeyPath).text();
    const certPem = await Bun.file(leafCertPath).text();
    return { keyPem, certPem };
  } finally {
    for (const f of [leafKeyPath, leafCsrPath, leafCertPath, extPath]) {
      try {
        unlinkSync2(f);
      } catch {}
    }
  }
}
function sanitizeFilename(hostname) {
  return hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
}
var CA_DIR, CA_KEY_PATH, CA_CERT_PATH, CA_SERIAL_PATH, CA_DAYS = 3650, LEAF_DAYS = 825, hostCertCache, hostCertInflight;
var init_ca = __esm(() => {
  init_errors();
  CA_DIR = join5(homedir3(), ".aproxy");
  CA_KEY_PATH = join5(CA_DIR, "ca-key.pem");
  CA_CERT_PATH = join5(CA_DIR, "ca.pem");
  CA_SERIAL_PATH = join5(CA_DIR, "ca.srl");
  hostCertCache = new Map;
  hostCertInflight = new Map;
});

// src/mitm.ts
import { Effect as Effect3 } from "effect";
async function handleMitm(clientSocket, host, port, pendingData, emitEvent, ca, fetchHandler) {
  const tunnelId = crypto.randomUUID();
  const startedAt = Date.now();
  emitEvent({
    type: "request",
    id: tunnelId,
    method: "CONNECT",
    url: `${host}:${port}`,
    headers: {},
    timestamp: startedAt
  });
  try {
    const hostCert = await getHostCert(host, ca);
    const ctx = {
      buffer: Buffer.alloc(0),
      hostname: host,
      port,
      emitEvent,
      fetchHandler,
      processing: false
    };
    const tlsListener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: {
        key: hostCert.keyPem,
        cert: hostCert.certPem + `
` + ca.certPem
      },
      socket: {
        open(_socket) {},
        data(socket, data) {
          handleDecryptedData(socket, data, ctx);
        },
        close(_socket) {},
        error(_socket, error) {
          console.error(`[mitm] TLS socket error for ${host}:${port}:`, error?.message ?? error);
        }
      }
    });
    const localPort = tlsListener.port;
    await Bun.connect({
      hostname: "127.0.0.1",
      port: localPort,
      socket: {
        open(bridgeSocket) {
          bridgeSocket.data = { peer: clientSocket };
          clientSocket.data.peer = bridgeSocket;
          clientSocket.write(`HTTP/1.1 200 Connection Established\r
\r
`);
          for (const buf of pendingData) {
            bridgeSocket.write(buf);
          }
          pendingData.length = 0;
        },
        data(bridgeSocket, data) {
          bridgeSocket.data.peer?.write(data);
        },
        close(bridgeSocket) {
          bridgeSocket.data.peer?.end();
          tlsListener.stop();
        },
        error(bridgeSocket, error) {
          console.error(`[mitm] bridge error for ${host}:${port}:`, error?.message ?? error);
          bridgeSocket.data.peer?.end();
          tlsListener.stop();
        },
        connectError(_socket, error) {
          console.error(`[mitm] bridge connect failed for ${host}:${port}:`, error?.message ?? error);
          clientSocket.write(`HTTP/1.1 502 Bad Gateway\r
\r
`);
          clientSocket.end();
          tlsListener.stop();
          emitEvent({
            type: "error",
            id: tunnelId,
            message: `MITM bridge failed: ${error?.message ?? "unknown error"}`,
            timestamp: Date.now()
          });
        }
      }
    });
    emitEvent({
      type: "response",
      id: tunnelId,
      status: 200,
      headers: {},
      durationMs: Date.now() - startedAt,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error(`[mitm] failed to set up MITM for ${host}:${port}:`, err?.message ?? err);
    clientSocket.write(`HTTP/1.1 502 Bad Gateway\r
\r
`);
    clientSocket.end();
    emitEvent({
      type: "error",
      id: tunnelId,
      message: `MITM setup failed: ${err?.message ?? "unknown error"}`,
      timestamp: Date.now()
    });
  }
}
async function handleDecryptedData(socket, data, ctx) {
  const { hostname, port, fetchHandler } = ctx;
  ctx.buffer = Buffer.concat([ctx.buffer, Buffer.from(data)]);
  if (ctx.processing)
    return;
  const headerEnd = ctx.buffer.indexOf(`\r
\r
`);
  if (headerEnd === -1) {
    if (ctx.buffer.length > 65536) {
      socket.write(`HTTP/1.1 431 Request Header Fields Too Large\r
\r
`);
      socket.end();
    }
    return;
  }
  ctx.processing = true;
  const headerSection = ctx.buffer.subarray(0, headerEnd).toString("utf-8");
  const bodyStart = ctx.buffer.subarray(headerEnd + 4);
  ctx.buffer = Buffer.alloc(0);
  const lines = headerSection.split(`\r
`);
  const firstLine = lines[0];
  const parts = firstLine.split(" ");
  const method = parts[0];
  const path = parts[1] ?? "/";
  const headers = new Headers;
  for (let i = 1;i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(":");
    if (colonIdx > 0) {
      const name = lines[i].substring(0, colonIdx).trim();
      const value = lines[i].substring(colonIdx + 1).trim();
      headers.append(name, value);
    }
  }
  const url = `https://${hostname}${port !== 443 ? `:${port}` : ""}${path}`;
  const contentLength = headers.get("content-length");
  const hasBody = method !== "GET" && method !== "HEAD" && contentLength && parseInt(contentLength, 10) > 0;
  let requestBody;
  if (hasBody) {
    const expectedLength = parseInt(contentLength, 10);
    if (bodyStart.length >= expectedLength) {
      requestBody = Buffer.from(bodyStart.subarray(0, expectedLength));
      if (bodyStart.length > expectedLength) {
        ctx.buffer = Buffer.from(bodyStart.subarray(expectedLength));
      }
    } else {
      requestBody = Buffer.from(bodyStart);
    }
  }
  const request = new Request(url, {
    method,
    headers,
    body: requestBody ? new Uint8Array(requestBody) : undefined
  });
  try {
    const response = await Effect3.runPromise(fetchHandler(request));
    const statusText = response.statusText || "OK";
    let headerStr = `HTTP/1.1 ${response.status} ${statusText}\r
`;
    response.headers.forEach((value, key) => {
      headerStr += `${key}: ${value}\r
`;
    });
    if (response.body) {
      const reader = response.body.getReader();
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      if (!response.headers.has("content-length")) {
        headerStr += `content-length: ${totalLength}\r
`;
      }
      headerStr += `\r
`;
      socket.write(headerStr);
      for (const chunk of chunks) {
        socket.write(chunk);
      }
    } else {
      if (!response.headers.has("content-length")) {
        headerStr += `content-length: 0\r
`;
      }
      headerStr += `\r
`;
      socket.write(headerStr);
    }
  } catch (err) {
    console.error(`[mitm] proxy error for ${method} ${url}:`, err?.message ?? err);
    socket.write(`HTTP/1.1 502 Bad Gateway\r
Content-Length: 0\r
\r
`);
  }
  ctx.processing = false;
  if (ctx.buffer.length > 0) {
    handleDecryptedData(socket, Buffer.alloc(0), ctx);
  }
}
var init_mitm = __esm(() => {
  init_ca();
});

// src/tcpProxy.ts
import { Effect as Effect4 } from "effect";
function createTcpProxy(opts) {
  const { port, hostname, fetchHandler, emitEvent, ca } = opts;
  return Bun.listen({
    hostname,
    port,
    socket: {
      open(socket) {
        socket.data = {
          state: "parsing",
          buffer: Buffer.alloc(0),
          peer: null,
          pendingData: []
        };
      },
      data(socket, data) {
        if (socket.data.state === "tunnel") {
          const peer = socket.data.peer;
          if (peer) {
            peer.write(data);
          } else {
            socket.data.pendingData.push(Buffer.from(data));
          }
          return;
        }
        if (socket.data.state === "http") {
          return;
        }
        if (socket.data.state === "body") {
          socket.data.bodyBuffer = Buffer.concat([socket.data.bodyBuffer, Buffer.from(data)]);
          if (socket.data.bodyBuffer.length >= socket.data.expectedBodyLength) {
            socket.data.state = "http";
            handleHttpRequest(socket, socket.data.headerSection, socket.data.bodyBuffer, socket.data.method, socket.data.target, fetchHandler);
          }
          return;
        }
        socket.data.buffer = Buffer.concat([socket.data.buffer, Buffer.from(data)]);
        const headerEnd = socket.data.buffer.indexOf(`\r
\r
`);
        if (headerEnd === -1) {
          if (socket.data.buffer.length > 65536) {
            socket.write(`HTTP/1.1 431 Request Header Fields Too Large\r
\r
`);
            socket.end();
          }
          return;
        }
        const headerSection = socket.data.buffer.subarray(0, headerEnd).toString("utf-8");
        const bodyStart = socket.data.buffer.subarray(headerEnd + 4);
        const firstLine = headerSection.split(`\r
`)[0];
        const parts = firstLine.split(" ");
        const method = parts[0];
        const target = parts[1];
        if (method === "CONNECT") {
          socket.data.state = "tunnel";
          const colonIdx = target.lastIndexOf(":");
          const host = colonIdx > 0 ? target.substring(0, colonIdx) : target;
          const targetPort = colonIdx > 0 ? parseInt(target.substring(colonIdx + 1), 10) : 443;
          console.log(`[tunnel] CONNECT ${host}:${targetPort}${ca ? " (MITM)" : ""}`);
          const pending = [];
          if (bodyStart.length > 0) {
            pending.push(Buffer.from(bodyStart));
          }
          if (ca) {
            handleMitm(socket, host, targetPort, pending, emitEvent, ca, fetchHandler);
          } else {
            handleConnect(socket, host, targetPort, pending, emitEvent);
          }
        } else {
          const contentLengthHeader = headerSection.split(`\r
`).find((l) => l.toLowerCase().startsWith("content-length:"));
          const expectedBodyLength = contentLengthHeader ? parseInt(contentLengthHeader.split(":")[1].trim(), 10) : 0;
          if (expectedBodyLength > 0 && bodyStart.length < expectedBodyLength) {
            socket.data.state = "body";
            socket.data.headerSection = headerSection;
            socket.data.method = method;
            socket.data.target = target;
            socket.data.bodyBuffer = Buffer.from(bodyStart);
            socket.data.expectedBodyLength = expectedBodyLength;
          } else {
            socket.data.state = "http";
            handleHttpRequest(socket, headerSection, bodyStart, method, target, fetchHandler);
          }
        }
      },
      close(socket) {
        if (socket.data.state === "tunnel" && socket.data.peer) {
          socket.data.peer.end();
        }
      },
      error(socket, error) {
        console.error("[tcp] socket error:", error?.message ?? error);
        if (socket.data.state === "tunnel" && socket.data.peer) {
          socket.data.peer.end();
        }
      },
      drain(_socket) {}
    }
  });
}
async function handleHttpRequest(clientSocket, headerSection, body, method, target, fetchHandler) {
  try {
    const lines = headerSection.split(`\r
`);
    const headers = new Headers;
    for (let i = 1;i < lines.length; i++) {
      const colonIdx = lines[i].indexOf(":");
      if (colonIdx > 0) {
        const name = lines[i].substring(0, colonIdx).trim();
        const value = lines[i].substring(colonIdx + 1).trim();
        headers.append(name, value);
      }
    }
    let url;
    if (target.startsWith("http://") || target.startsWith("https://")) {
      url = target;
    } else {
      const host = headers.get("host") ?? "localhost";
      url = `http://${host}${target}`;
    }
    const contentLength = headers.get("content-length");
    const hasBody = method !== "GET" && method !== "HEAD" && contentLength && parseInt(contentLength, 10) > 0;
    const request = new Request(url, {
      method,
      headers,
      body: hasBody ? new Uint8Array(body) : undefined
    });
    const response = await Effect4.runPromise(fetchHandler(request));
    const statusText = response.statusText || "OK";
    let headerStr = `HTTP/1.1 ${response.status} ${statusText}\r
`;
    response.headers.forEach((value, key) => {
      headerStr += `${key}: ${value}\r
`;
    });
    headerStr += `\r
`;
    clientSocket.write(headerStr);
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          clientSocket.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    clientSocket.end();
  } catch (err) {
    console.error("[tcp] http handler error:", err?.message ?? err);
    try {
      clientSocket.write(`HTTP/1.1 502 Bad Gateway\r
Content-Length: 0\r
\r
`);
      clientSocket.end();
    } catch {}
  }
}
var init_tcpProxy = __esm(() => {
  init_mitm();
});

// src/server.ts
import { Effect as Effect5 } from "effect";
import { networkInterfaces } from "os";
import { existsSync as existsSync2, readFileSync as readFileSync2, readdirSync as readdirSync2, copyFileSync, mkdirSync as mkdirSync3, writeFileSync } from "fs";
import { join as join6, extname, basename } from "path";
function createServer(fetchHandler, emitEvent, ca) {
  return Effect5.try(() => createTcpProxy({
    hostname: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PROXY_PORT ?? 8080),
    fetchHandler,
    emitEvent,
    ca
  })).pipe(Effect5.mapError((cause) => new RequestError({ cause })));
}
function createRoutes(deps) {
  const controlHosts = listLocalHosts();
  return (req) => Effect5.gen(function* (_) {
    const hostHeader = req.headers.get("host") ?? "";
    const hostOnly = hostHeader.replace(/^\[/, "").split(":")[0].replace(/\]$/, "");
    const isControlHost = controlHosts.has(hostOnly);
    const url = (() => {
      try {
        return new URL(req.url);
      } catch {
        if (hostHeader) {
          try {
            return new URL(req.url, `http://${hostHeader}`);
          } catch {
            return null;
          }
        }
        return null;
      }
    })();
    const urlHost = url?.hostname ?? "";
    const isControlRequest = isControlHost && controlHosts.has(urlHost || hostOnly);
    yield* _(Effect5.sync(() => console.log(`[incoming] ${req.method} ${req.url} host=${hostHeader} control=${isControlRequest} urlHost=${urlHost || ""}`)));
    if (isControlRequest && url?.pathname === "/events" && req.method === "GET") {
      const stream = deps.createSse(req.signal);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        }
      });
    }
    if (isControlRequest && url?.pathname === "/" && req.method === "GET") {
      const html = existsSync2(uiIndexPath) ? readFileSync2(uiIndexPath, "utf-8") : readFileSync2(uiFallbackPath, "utf-8");
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8"
        }
      });
    }
    if (isControlRequest && url?.pathname === "/host" && req.method === "GET") {
      return Response.json({ host: getPreferredHost() });
    }
    if (isControlRequest && url?.pathname === "/scenarios" && req.method === "GET") {
      return Response.json({
        scenarios: deps.getScenarios(),
        activeScenarioId: deps.getActiveScenarioId()
      });
    }
    if (isControlRequest && url?.pathname === "/scenarios/active" && req.method === "PUT") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      deps.setActiveScenarioId(body.scenarioId ?? null);
      return Response.json({
        scenarios: deps.getScenarios(),
        activeScenarioId: deps.getActiveScenarioId()
      });
    }
    if (isControlRequest && url?.pathname === "/rules" && req.method === "GET") {
      return Response.json(deps.listRulesEvent());
    }
    if (isControlRequest && url?.pathname === "/rules/reload" && req.method === "POST") {
      yield* _(deps.loadRules().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json(deps.listRulesEvent());
    }
    if (isControlRequest && url?.pathname === "/scenarios/import" && req.method === "POST") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      const safeName = basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
      if (!existsSync2(deps.scenariosDir))
        mkdirSync3(deps.scenariosDir, { recursive: true });
      writeFileSync(join6(deps.scenariosDir, safeName), body.content, "utf-8");
      yield* _(deps.loadRules().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json({ imported: safeName, ...deps.listRulesEvent() });
    }
    if (isControlRequest && url?.pathname === "/views/import" && req.method === "POST") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      const safeName = basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
      if (!existsSync2(deps.viewsDir))
        mkdirSync3(deps.viewsDir, { recursive: true });
      writeFileSync(join6(deps.viewsDir, safeName), body.content, "utf-8");
      yield* _(deps.loadRules().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json({ imported: safeName });
    }
    if (isControlRequest && url?.pathname === "/examples/scenarios" && req.method === "GET") {
      const dir = join6(examplesDir, "scenarios");
      const files = existsSync2(dir) ? readdirSync2(dir).filter((f) => /\.(ts|js)$/.test(f)) : [];
      return Response.json({ files });
    }
    if (isControlRequest && url?.pathname === "/examples/views" && req.method === "GET") {
      const dir = join6(examplesDir, "views");
      const files = existsSync2(dir) ? readdirSync2(dir).filter((f) => /\.(ts|js)$/.test(f)) : [];
      return Response.json({ files });
    }
    if (isControlRequest && url?.pathname === "/examples/scenarios/import" && req.method === "POST") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      const safeName = basename(body.filename);
      const src = join6(examplesDir, "scenarios", safeName);
      if (!existsSync2(src)) {
        return Response.json({ error: `Example not found: ${safeName}` }, { status: 404 });
      }
      if (!existsSync2(deps.scenariosDir))
        mkdirSync3(deps.scenariosDir, { recursive: true });
      copyFileSync(src, join6(deps.scenariosDir, safeName));
      yield* _(deps.loadRules().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json({ imported: safeName });
    }
    if (isControlRequest && url?.pathname === "/examples/views/import" && req.method === "POST") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      const safeName = basename(body.filename);
      const src = join6(examplesDir, "views", safeName);
      if (!existsSync2(src)) {
        return Response.json({ error: `Example not found: ${safeName}` }, { status: 404 });
      }
      if (!existsSync2(deps.viewsDir))
        mkdirSync3(deps.viewsDir, { recursive: true });
      copyFileSync(src, join6(deps.viewsDir, safeName));
      yield* _(deps.loadRules().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json({ imported: safeName });
    }
    if (isControlRequest && url?.pathname === "/config/theme" && req.method === "GET") {
      return Response.json({ theme: deps.getConfig().theme ?? "dark" });
    }
    if (isControlRequest && url?.pathname === "/config/theme" && req.method === "PUT") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      const theme = body.theme === "light" ? "light" : "dark";
      deps.updateConfig({ theme });
      return Response.json({ theme: deps.getConfig().theme });
    }
    if (isControlRequest && url?.pathname === "/views" && req.method === "GET") {
      return Response.json({
        views: deps.getViews(),
        defaultViewId: deps.getConfig().defaultViewId
      });
    }
    if (isControlRequest && url?.pathname === "/views/default" && req.method === "PUT") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      deps.updateConfig({ defaultViewId: body.viewId ?? null });
      return Response.json({
        views: deps.getViews(),
        defaultViewId: deps.getConfig().defaultViewId
      });
    }
    if (isControlRequest && url?.pathname === "/proxy/enable" && req.method === "POST") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      const result = yield* _(deps.enableProxy(body).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json(result);
    }
    if (isControlRequest && url?.pathname === "/proxy/disable" && req.method === "POST") {
      const result = yield* _(deps.disableProxy().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json(result);
    }
    if (isControlRequest && url?.pathname === "/proxy/status" && req.method === "GET") {
      const result = yield* _(deps.proxyStatus().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json(result);
    }
    if (isControlRequest && url?.pathname === "/simulators" && req.method === "GET") {
      const simulators = yield* _(deps.listSimulators().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json({ simulators });
    }
    if (isControlRequest && url?.pathname === "/simulators/certs" && req.method === "POST") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      const simulator = yield* _(deps.installSimulatorCert(body).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json({ simulator, certPath: body.certPath });
    }
    if (isControlRequest && url?.pathname === "/ca/cert" && req.method === "GET") {
      const pem = deps.getCaCertPem();
      if (!pem) {
        return Response.json({ error: "CA not initialized" }, { status: 503 });
      }
      return new Response(pem, {
        headers: {
          "Content-Type": "application/x-pem-file",
          "Content-Disposition": 'attachment; filename="aproxy-ca.pem"'
        }
      });
    }
    if (isControlRequest && url?.pathname === "/ca/status" && req.method === "GET") {
      const certPath = deps.getCaCertPath();
      return Response.json({
        initialized: certPath !== null,
        certPath,
        trustCommand: certPath ? `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${certPath}` : null
      });
    }
    if (isControlRequest && url?.pathname === "/ca/trust" && req.method === "POST") {
      const alreadyTrusted = yield* _(deps.isCaTrusted().pipe(Effect5.catchAll(() => Effect5.succeed(false))));
      if (alreadyTrusted) {
        return Response.json({ trusted: true, alreadyTrusted: true });
      }
      const result = yield* _(deps.trustCaOnHost().pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json(result);
    }
    if (isControlRequest && url?.pathname === "/ca/trust/status" && req.method === "GET") {
      const trusted = yield* _(deps.isCaTrusted());
      return Response.json({ trusted });
    }
    if (isControlRequest && url?.pathname === "/simulators/trust-ca" && req.method === "POST") {
      const body = yield* _(parseJsonBody(req).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      const simulator = yield* _(deps.installCaOnSimulator(body.udid).pipe(Effect5.mapError((cause) => new RequestError({ cause }))));
      return Response.json({ simulator });
    }
    if (isControlRequest && url?.pathname && req.method === "GET") {
      const safePath = url.pathname.replace(/\.\./g, "");
      const filePath = join6(uiDistDir, safePath);
      if (existsSync2(filePath)) {
        const file = Bun.file(filePath);
        const ext = extname(safePath);
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        return new Response(file, {
          headers: { "Content-Type": contentType }
        });
      }
    }
    if (isControlRequest) {
      return new Response("Not Found", { status: 404 });
    }
    return yield* _(deps.handleProxy(req));
  }).pipe(Effect5.catchAll((err) => Effect5.sync(() => {
    const message = err instanceof CommandError ? err.message : err instanceof RequestError ? String(err.cause ?? err) : String(err);
    console.error(`[route error] ${message}`);
    return Response.json({ error: message }, { status: 400 });
  })));
}
function createSse(eventBus, listRulesEvent, listViewsEvent, signal) {
  return createSseStream(signal, eventBus, listRulesEvent, listViewsEvent);
}
var uiDistDir, uiIndexPath, uiFallbackPath, examplesDir, MIME_TYPES, listLocalHosts = () => {
  const hosts = new Set(["localhost", "127.0.0.1"]);
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal)
        continue;
      if (entry.address && entry.address !== "0.0.0.0")
        hosts.add(entry.address);
    }
  }
  return hosts;
}, getPreferredHost = () => {
  for (const host of listLocalHosts()) {
    if (host !== "localhost" && host !== "127.0.0.1")
      return host;
  }
  return "127.0.0.1";
};
var init_server = __esm(() => {
  init_errors();
  init_http();
  init_tcpProxy();
  uiDistDir = process.env.APROXY_UI_DIR ?? join6(import.meta.dir, "..", "ui", "dist");
  uiIndexPath = join6(uiDistDir, "index.html");
  uiFallbackPath = join6(import.meta.dir, "ui.html");
  examplesDir = process.env.APROXY_EXAMPLES_DIR ?? join6(import.meta.dir, "..", "examples");
  MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };
});

// src/simulators.ts
import { Effect as Effect6 } from "effect";
import { homedir as homedir4 } from "os";
import { join as join7 } from "path";
import { existsSync as existsSync3 } from "fs";
function runCommand(command, args) {
  return Effect6.tryPromise({
    try: async () => {
      const proc = Bun.spawn([command, ...args], {
        stdout: "pipe",
        stderr: "pipe"
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
      ]);
      if (exitCode !== 0) {
        throw { stderr: stderr.trim() || stdout.trim(), exitCode };
      }
      return stdout.trim();
    },
    catch: (err) => new CommandError({
      command,
      args,
      stderr: err?.stderr ?? String(err),
      exitCode: err?.exitCode ?? 1
    })
  });
}
function runCommandOptionalText(command, args) {
  return runCommand(command, args).pipe(Effect6.catchAll(() => Effect6.succeed("")));
}
function getActiveNetworkService() {
  return Effect6.gen(function* (_) {
    const routeOutput = yield* _(runCommand("route", ["-n", "get", "default"]));
    const ifaceMatch = routeOutput.match(/interface:\s*(\S+)/);
    if (!ifaceMatch) {
      return yield* _(Effect6.fail(new CommandError({ command: "route", args: ["-n", "get", "default"], stderr: "No default network interface found", exitCode: 1 })));
    }
    const iface = ifaceMatch[1];
    const servicesOutput = yield* _(runCommand("networksetup", ["-listallhardwareports"]));
    const blocks = servicesOutput.split(/\n\n/);
    for (const block of blocks) {
      const deviceMatch = block.match(/Device:\s*(\S+)/);
      const nameMatch = block.match(/Hardware Port:\s*(.+)/);
      if (deviceMatch && nameMatch && deviceMatch[1] === iface) {
        return nameMatch[1].trim();
      }
    }
    return yield* _(Effect6.fail(new CommandError({ command: "networksetup", args: ["-listallhardwareports"], stderr: `No network service found for interface ${iface}`, exitCode: 1 })));
  });
}
function isAvailableDevice(device) {
  if (typeof device.isAvailable === "boolean")
    return device.isAvailable;
  if (typeof device.availability === "string")
    return device.availability.includes("available");
  return true;
}
function listSimulators() {
  return Effect6.gen(function* (_) {
    const output = yield* _(runCommand("xcrun", ["simctl", "list", "devices", "-j"]));
    const parsed = JSON.parse(output);
    const devices = [];
    for (const [runtime, runtimeDevices] of Object.entries(parsed.devices ?? {})) {
      for (const device of runtimeDevices ?? []) {
        const available = isAvailableDevice(device);
        devices.push({
          udid: device.udid,
          name: device.name,
          state: device.state,
          runtime,
          available,
          isBooted: device.state === "Booted"
        });
      }
    }
    return devices.filter((device) => device.available);
  });
}
function ensureBootedSimulator(udid) {
  return Effect6.gen(function* (_) {
    const simulators = yield* _(listSimulators());
    const simulator = simulators.find((device) => device.udid === udid);
    if (!simulator) {
      return yield* _(Effect6.fail(new CommandError({ command: "simctl", args: ["list"], stderr: `Simulator ${udid} not found`, exitCode: 1 })));
    }
    if (!simulator.isBooted) {
      return yield* _(Effect6.fail(new CommandError({ command: "simctl", args: ["list"], stderr: `Simulator ${udid} is not booted`, exitCode: 1 })));
    }
    return simulator;
  });
}
function configureHostProxy(input) {
  return Effect6.gen(function* (_) {
    const host = input.proxyHost;
    const port = String(input.proxyPort);
    const service = yield* _(getActiveNetworkService());
    yield* _(runCommand("networksetup", ["-setwebproxy", service, host, port]));
    yield* _(runCommand("networksetup", ["-setsecurewebproxy", service, host, port]));
    yield* _(runCommand("networksetup", ["-setwebproxystate", service, "on"]));
    yield* _(runCommand("networksetup", ["-setsecurewebproxystate", service, "on"]));
    return { networkService: service, proxyHost: host, proxyPort: input.proxyPort, enabled: true };
  });
}
function readHostProxySettings() {
  return Effect6.gen(function* (_) {
    const service = yield* _(getActiveNetworkService());
    const httpOutput = yield* _(runCommandOptionalText("networksetup", ["-getwebproxy", service]));
    const httpsOutput = yield* _(runCommandOptionalText("networksetup", ["-getsecurewebproxy", service]));
    const settings = {};
    const parseNetworkSetup = (output, prefix) => {
      for (const line of output.split(`
`)) {
        const match = line.match(/^(\w[\w\s]*):\s*(.+)$/);
        if (match) {
          const key = prefix + match[1].trim().replace(/\s+/g, "");
          settings[key] = match[2].trim();
        }
      }
    };
    parseNetworkSetup(httpOutput, "HTTP");
    parseNetworkSetup(httpsOutput, "HTTPS");
    const raw = `--- HTTP Proxy (${service}) ---
${httpOutput}
--- HTTPS Proxy (${service}) ---
${httpsOutput}`;
    const enabled = settings["HTTPEnabled"] === "Yes";
    return { settings, raw, networkService: service, enabled };
  });
}
function disableHostProxy() {
  return Effect6.gen(function* (_) {
    const service = yield* _(getActiveNetworkService());
    yield* _(runCommand("networksetup", ["-setwebproxystate", service, "off"]));
    yield* _(runCommand("networksetup", ["-setsecurewebproxystate", service, "off"]));
    return { networkService: service, enabled: false };
  });
}
function installSimulatorCertificate(input) {
  return Effect6.gen(function* (_) {
    const simulator = yield* _(ensureBootedSimulator(input.udid));
    yield* _(runCommand("xcrun", ["simctl", "keychain", input.udid, "add-root-cert", input.certPath]));
    return simulator;
  });
}
function trustCaCertOnHost(certPath) {
  return Effect6.gen(function* (_) {
    const script = `do shell script "security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${certPath}" with administrator privileges`;
    yield* _(runCommand("osascript", ["-e", script]));
    return { trusted: true, certPath };
  });
}
function isCaTrustedOnHost(cn) {
  return runCommand("security", ["find-certificate", "-c", cn, "/Library/Keychains/System.keychain"]).pipe(Effect6.map(() => true), Effect6.catchAll(() => Effect6.succeed(false)));
}
function getCertSha256(certPath) {
  return runCommand("openssl", ["x509", "-in", certPath, "-noout", "-fingerprint", "-sha256"]).pipe(Effect6.map((output) => {
    const hex = output.replace(/.*=/, "").replace(/:/g, "").trim().toUpperCase();
    return hex;
  }));
}
function isCaInstalledOnSimulator(udid, certSha256) {
  const trustStorePath = join7(homedir4(), "Library/Developer/CoreSimulator/Devices", udid, "data/private/var/protected/trustd/private/TrustStore.sqlite3");
  if (!existsSync3(trustStorePath)) {
    return Effect6.succeed(false);
  }
  return runCommand("sqlite3", [
    trustStorePath,
    `SELECT count(*) FROM tsettings WHERE hex(sha256) = '${certSha256}'`
  ]).pipe(Effect6.map((output) => parseInt(output.trim(), 10) > 0), Effect6.catchAll(() => Effect6.succeed(false)));
}
var init_simulators = __esm(() => {
  init_errors();
});

// src/rulesLoader.ts
import { Effect as Effect7 } from "effect";
import { watch, existsSync as existsSync4, mkdirSync as mkdirSync4 } from "fs";
function ensureDir(dir) {
  if (!existsSync4(dir))
    mkdirSync4(dir, { recursive: true });
}
function importModules(dir) {
  return Effect7.gen(function* (_) {
    ensureDir(dir);
    const entries = yield* _(Effect7.tryPromise(() => Array.fromAsync(new Bun.Glob("*.{ts,js}").scan(dir))).pipe(Effect7.mapError((cause) => new RulesLoadError({ cause }))));
    const modules = [];
    for (const entry of entries) {
      const filePath = `${dir}/${entry}`;
      const module = yield* _(Effect7.tryPromise(() => import(`${filePath}?t=${Date.now()}`)).pipe(Effect7.mapError((cause) => new RulesLoadError({ cause }))));
      modules.push({ module, filePath });
    }
    return modules;
  });
}
function loadScenarios(scenariosDir, setLoadedScenarios, setActiveScenarioId) {
  return Effect7.gen(function* (_) {
    const modules = yield* _(importModules(scenariosDir));
    const scenarios = [];
    for (const { module, filePath } of modules) {
      const exportedScenarios = module.scenarios ?? [];
      for (const factory of exportedScenarios) {
        const scenario = factory();
        scenarios.push({ ...scenario, filePath });
      }
    }
    setLoadedScenarios(scenarios);
  }).pipe(Effect7.catchAll(() => Effect7.sync(() => {
    setLoadedScenarios([]);
    setActiveScenarioId(null);
  })));
}
function loadViews(viewsDir, setLoadedViews) {
  return Effect7.gen(function* (_) {
    const modules = yield* _(importModules(viewsDir));
    const views = [];
    for (const { module, filePath } of modules) {
      const exportedViews = module.views ?? [];
      for (const factory of exportedViews) {
        const view = factory();
        views.push({ ...view, filePath });
      }
    }
    setLoadedViews(views);
  }).pipe(Effect7.catchAll(() => Effect7.sync(() => {
    setLoadedViews([]);
  })));
}
function watchDir(dir, onReload) {
  return Effect7.gen(function* (_) {
    ensureDir(dir);
    let debounce = null;
    watch(dir, { recursive: false }, () => {
      if (debounce)
        clearTimeout(debounce);
      debounce = setTimeout(() => {
        onReload();
      }, 50);
    });
  });
}
var init_rulesLoader = __esm(() => {
  init_errors();
});

// src/proxy.ts
import { Effect as Effect8 } from "effect";
function resolveTargetUrl(req) {
  return Effect8.try(() => {
    if (req.url.startsWith("http://") || req.url.startsWith("https://")) {
      return new URL(req.url);
    }
    const host = req.headers.get("host");
    if (!host)
      throw new Error("Missing Host header");
    const path = req.url.startsWith("/") ? req.url : `/${req.url}`;
    return new URL(`http://${host}${path}`);
  }).pipe(Effect8.mapError((cause) => new ProxyError({ cause })));
}
function computeProxyOutcome(req, id, startedAt, applyRules) {
  return Effect8.gen(function* (_) {
    const ruleResponse = yield* _(applyRules({
      id,
      url: req.url,
      method: req.method,
      headers: headersToRecord(req.headers)
    }));
    if (ruleResponse) {
      const responseHeaders2 = new Headers(ruleResponse.headers);
      let bodyText2;
      const bodyBytes2 = yield* _(Effect8.tryPromise(() => ruleResponse.clone().arrayBuffer()).pipe(Effect8.catchAll(() => Effect8.succeed(undefined))));
      if (bodyBytes2) {
        try {
          bodyText2 = new TextDecoder().decode(bodyBytes2);
        } catch {}
      }
      const responseEvent2 = {
        type: "response",
        id,
        status: ruleResponse.status,
        headers: headersToRecord(responseHeaders2),
        durationMs: Date.now() - startedAt,
        timestamp: Date.now(),
        body: bodyText2,
        mocked: true
      };
      return { response: ruleResponse, event: responseEvent2 };
    }
    const targetRequest = {
      method: req.method,
      url: req.url,
      headers: new Headers(req.headers),
      body: req.body
    };
    const targetUrl = yield* _(resolveTargetUrl(new Request(targetRequest.url, {
      method: targetRequest.method,
      headers: targetRequest.headers
    })));
    const outgoingHeaders = new Headers(targetRequest.headers);
    stripHopByHop(outgoingHeaders);
    const upstreamResponse = yield* _(Effect8.tryPromise(() => fetch(targetUrl, {
      method: targetRequest.method,
      headers: outgoingHeaders,
      body: targetRequest.body,
      redirect: "manual"
    })).pipe(Effect8.mapError((cause) => new ProxyError({ cause }))));
    const responseHeaders = new Headers(upstreamResponse.headers);
    stripHopByHop(responseHeaders);
    const bodyBytes = yield* _(Effect8.tryPromise(() => upstreamResponse.arrayBuffer()).pipe(Effect8.mapError((cause) => new ProxyError({ cause }))));
    let bodyText;
    try {
      bodyText = new TextDecoder().decode(bodyBytes);
    } catch {}
    const responseEvent = {
      type: "response",
      id,
      status: upstreamResponse.status,
      headers: headersToRecord(responseHeaders),
      durationMs: Date.now() - startedAt,
      timestamp: Date.now(),
      body: bodyText
    };
    return {
      response: new Response(bodyBytes, {
        status: upstreamResponse.status,
        headers: responseHeaders
      }),
      event: responseEvent
    };
  });
}
function handleHttpProxy(req, emitEvent, applyRules) {
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  const controlPort = Number(process.env.PROXY_PORT ?? 8080);
  const isUiRequest = (() => {
    try {
      if (req.url.startsWith("http://") || req.url.startsWith("https://")) {
        const parsed = new URL(req.url);
        const port = parsed.port ? Number(parsed.port) : 80;
        if (Number.isNaN(port) || port !== controlPort)
          return false;
        return ["localhost", "127.0.0.1"].includes(parsed.hostname);
      }
      return true;
    } catch {
      return false;
    }
  })();
  const requestEvent = {
    type: "request",
    id,
    method: req.method,
    url: req.url,
    headers: headersToRecord(req.headers),
    timestamp: startedAt
  };
  return Effect8.gen(function* (_) {
    yield* _(Effect8.sync(() => emitEvent(requestEvent)));
    if (!isUiRequest) {
      yield* _(Effect8.sync(() => console.log(`[proxy] ${req.method} ${req.url}`)));
    }
    const outcome = yield* _(computeProxyOutcome(req, id, startedAt, applyRules));
    if (outcome.event) {
      const event = outcome.event;
      yield* _(Effect8.sync(() => emitEvent(event)));
    }
    return outcome.response;
  }).pipe(Effect8.catchAll((error) => {
    let message = "Unknown proxy error";
    try {
      if (error instanceof Error) {
        message = error.message;
      } else if (typeof error === "object" && error !== null) {
        const e = error;
        if (e.cause instanceof Error) {
          message = e.cause.message;
        } else if (e.cause?.cause instanceof Error) {
          message = e.cause.cause.message;
        } else if (e.cause) {
          message = String(e.cause);
        } else {
          message = JSON.stringify(error);
        }
      } else {
        message = String(error);
      }
    } catch {}
    console.error(`[proxy] error for ${req.method} ${req.url}:`, message);
    const errorEvent = {
      type: "error",
      id,
      message,
      timestamp: Date.now()
    };
    return Effect8.sync(() => {
      emitEvent(errorEvent);
      return new Response("Proxy error", { status: 502 });
    });
  }));
}
var init_proxy = __esm(() => {
  init_errors();
  init_http();
});

// src/config.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync5, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "fs";
import { join as join8 } from "path";
import { homedir as homedir5 } from "os";
function loadConfig() {
  try {
    if (!existsSync5(CONFIG_PATH))
      return { ...defaults };
    const raw = readFileSync3(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}
function saveConfig(config) {
  if (!existsSync5(CONFIG_DIR))
    mkdirSync5(CONFIG_DIR, { recursive: true });
  writeFileSync2(CONFIG_PATH, JSON.stringify(config, null, 2) + `
`, "utf-8");
}
var CONFIG_DIR, CONFIG_PATH, defaults;
var init_config = __esm(() => {
  CONFIG_DIR = join8(homedir5(), ".aproxy");
  CONFIG_PATH = join8(CONFIG_DIR, "config.json");
  defaults = {
    defaultViewId: null,
    theme: "dark"
  };
});

// src/index.ts
var exports_src = {};
__export(exports_src, {
  startProxy: () => startProxy
});
import { Effect as Effect9 } from "effect";
import { join as join9 } from "path";
import { homedir as homedir6 } from "os";
function startProxy() {
  return Effect9.runPromise(main);
}
var proxyPort, eventBus, loadedScenarios, activeScenarioId = null, loadedViews, proxyEnabled = false, config, aproxyDir, scenariosDir, viewsDir, listRulesEvent = () => ({
  type: "rules_list",
  rules: loadedScenarios.flatMap((scenario) => scenario.rules.map(({ id, name, description }) => ({ id, name, description }))),
  activeRuleIds: activeScenarioId ? loadedScenarios.find((scenario) => scenario.id === activeScenarioId)?.rules.map((rule) => rule.id) ?? [] : []
}), listViewsEvent = () => ({
  type: "views_list",
  views: loadedViews.map(({ id, name, description, filter }) => ({
    id,
    name,
    description,
    filter: filter.toString()
  })),
  defaultViewId: config.defaultViewId
}), setLoadedScenarios = (scenarios) => {
  loadedScenarios = scenarios;
}, setActiveScenarioId = (id) => {
  activeScenarioId = id;
}, setLoadedViews = (views) => {
  loadedViews = views;
}, getConfig = () => config, updateConfig = (patch) => {
  config = { ...config, ...patch };
  saveConfig(config);
}, applyRules = (context) => Effect9.gen(function* (_) {
  if (!proxyEnabled)
    return null;
  const activeScenario = loadedScenarios.find((scenario) => scenario.id === activeScenarioId);
  const rules = activeScenario?.rules ?? [];
  for (const rule of rules) {
    const result = yield* _(Effect9.tryPromise(() => Promise.resolve(rule.handle(context))).pipe(Effect9.mapError((cause) => new ProxyError({ cause }))));
    if (result)
      return result;
  }
  return null;
}), handleProxy = (req) => handleHttpProxy(req, (event) => eventBus.emit(event), applyRules), main;
var init_src = __esm(async () => {
  init_errors();
  init_server();
  init_simulators();
  init_rulesLoader();
  init_proxy();
  init_ca();
  init_config();
  proxyPort = Number(process.env.PROXY_PORT ?? 8080);
  eventBus = new EventBus;
  loadedScenarios = [];
  loadedViews = [];
  config = loadConfig();
  aproxyDir = join9(homedir6(), ".aproxy");
  scenariosDir = join9(aproxyDir, "scenarios");
  viewsDir = join9(aproxyDir, "views");
  main = Effect9.gen(function* (_) {
    const ca = yield* _(ensureCa());
    const loadScenariosEffect = loadScenarios(scenariosDir, setLoadedScenarios, setActiveScenarioId);
    const loadViewsEffect = loadViews(viewsDir, setLoadedViews);
    const loadAllRules = Effect9.all([loadScenariosEffect, loadViewsEffect], { concurrency: "unbounded" }).pipe(Effect9.asVoid);
    const routes = createRoutes({
      listRulesEvent,
      listViewsEvent,
      loadRules: () => loadAllRules,
      scenariosDir,
      viewsDir,
      handleProxy,
      createSse: (signal) => createSse(eventBus, listRulesEvent, listViewsEvent, signal),
      getActiveScenarioId: () => activeScenarioId,
      setActiveScenarioId,
      getScenarios: () => loadedScenarios.map(({ id, name, description, rules }) => ({
        id,
        name,
        description,
        rules: rules.map(({ id: id2, name: name2, description: description2 }) => ({ id: id2, name: name2, description: description2 }))
      })),
      getViews: () => loadedViews.map(({ id, name, description, filter }) => ({
        id,
        name,
        description,
        filter: filter.toString()
      })),
      getConfig,
      updateConfig,
      enableProxy: (input) => configureHostProxy(input).pipe(Effect9.tap(() => Effect9.sync(() => {
        proxyEnabled = true;
      }))),
      disableProxy: () => disableHostProxy().pipe(Effect9.tap(() => Effect9.sync(() => {
        proxyEnabled = false;
      }))),
      proxyStatus: () => readHostProxySettings().pipe(Effect9.tap((result) => Effect9.sync(() => {
        proxyEnabled = result.enabled;
      }))),
      listSimulators: () => Effect9.gen(function* (_2) {
        const simulators = yield* _2(listSimulators());
        const sha256 = yield* _2(getCertSha256(ca.certPath).pipe(Effect9.catchAll(() => Effect9.succeed(""))));
        if (sha256) {
          const booted = simulators.filter((s) => s.isBooted);
          const trustChecks = yield* _2(Effect9.all(booted.map((s) => isCaInstalledOnSimulator(s.udid, sha256)), { concurrency: "unbounded" }));
          booted.forEach((s, i) => {
            s.caTrusted = trustChecks[i];
          });
        }
        eventBus.emit({ type: "simulators_list", simulators });
        return simulators;
      }),
      installSimulatorCert: (input) => installSimulatorCertificate(input).pipe(Effect9.tap((simulator) => Effect9.sync(() => eventBus.emit({
        type: "simulator_configured",
        simulator,
        proxyHost: "",
        proxyPort: 0,
        certPath: input.certPath
      })))),
      getCaCertPem: () => ca.certPem,
      getCaCertPath: () => ca.certPath,
      trustCaOnHost: () => trustCaCertOnHost(ca.certPath),
      isCaTrusted: () => isCaTrustedOnHost("aproxy CA"),
      installCaOnSimulator: (udid) => installSimulatorCertificate({ udid, certPath: ca.certPath }).pipe(Effect9.tap((simulator) => Effect9.sync(() => eventBus.emit({
        type: "simulator_configured",
        simulator,
        proxyHost: "",
        proxyPort: 0,
        certPath: ca.certPath
      }))))
    });
    yield* _(createServer(routes, (event) => eventBus.emit(event), ca));
    yield* _(loadAllRules);
    yield* _(readHostProxySettings().pipe(Effect9.tap((result) => Effect9.sync(() => {
      proxyEnabled = result.enabled;
    })), Effect9.catchAll(() => Effect9.succeed(undefined))));
    const emitReload = () => {
      Effect9.runPromise(loadAllRules.pipe(Effect9.tap(() => Effect9.sync(() => {
        eventBus.emit(listRulesEvent());
        eventBus.emit(listViewsEvent());
      }))));
    };
    yield* _(watchDir(scenariosDir, emitReload));
    yield* _(watchDir(viewsDir, emitReload));
    console.log(`Proxy listening on :${proxyPort} (MITM enabled)`);
  });
  if (false) {}
});

// node_modules/electrobun/dist/api/bun/index.ts
init_eventEmitter();
await __promiseAll([
  init_BrowserWindow(),
  init_BrowserView(),
  init_Tray()
]);

// node_modules/electrobun/dist/api/bun/core/ApplicationMenu.ts
init_eventEmitter();
await init_native();
var exports_ApplicationMenu = {};
__export(exports_ApplicationMenu, {
  setApplicationMenu: () => setApplicationMenu,
  on: () => on
});

// node_modules/electrobun/dist/api/bun/core/menuRoles.ts
var roleLabelMap = {
  about: "About",
  quit: "Quit",
  hide: "Hide",
  hideOthers: "Hide Others",
  showAll: "Show All",
  minimize: "Minimize",
  zoom: "Zoom",
  close: "Close",
  bringAllToFront: "Bring All To Front",
  cycleThroughWindows: "Cycle Through Windows",
  enterFullScreen: "Enter Full Screen",
  exitFullScreen: "Exit Full Screen",
  toggleFullScreen: "Toggle Full Screen",
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  pasteAndMatchStyle: "Paste and Match Style",
  delete: "Delete",
  selectAll: "Select All",
  startSpeaking: "Start Speaking",
  stopSpeaking: "Stop Speaking",
  showHelp: "Show Help",
  moveForward: "Move Forward",
  moveBackward: "Move Backward",
  moveLeft: "Move Left",
  moveRight: "Move Right",
  moveUp: "Move Up",
  moveDown: "Move Down",
  moveWordForward: "Move Word Forward",
  moveWordBackward: "Move Word Backward",
  moveWordLeft: "Move Word Left",
  moveWordRight: "Move Word Right",
  moveToBeginningOfLine: "Move to Beginning of Line",
  moveToEndOfLine: "Move to End of Line",
  moveToLeftEndOfLine: "Move to Left End of Line",
  moveToRightEndOfLine: "Move to Right End of Line",
  moveToBeginningOfParagraph: "Move to Beginning of Paragraph",
  moveToEndOfParagraph: "Move to End of Paragraph",
  moveParagraphForward: "Move Paragraph Forward",
  moveParagraphBackward: "Move Paragraph Backward",
  moveToBeginningOfDocument: "Move to Beginning of Document",
  moveToEndOfDocument: "Move to End of Document",
  moveForwardAndModifySelection: "Move Forward and Modify Selection",
  moveBackwardAndModifySelection: "Move Backward and Modify Selection",
  moveLeftAndModifySelection: "Move Left and Modify Selection",
  moveRightAndModifySelection: "Move Right and Modify Selection",
  moveUpAndModifySelection: "Move Up and Modify Selection",
  moveDownAndModifySelection: "Move Down and Modify Selection",
  moveWordForwardAndModifySelection: "Move Word Forward and Modify Selection",
  moveWordBackwardAndModifySelection: "Move Word Backward and Modify Selection",
  moveWordLeftAndModifySelection: "Move Word Left and Modify Selection",
  moveWordRightAndModifySelection: "Move Word Right and Modify Selection",
  moveToBeginningOfLineAndModifySelection: "Move to Beginning of Line and Modify Selection",
  moveToEndOfLineAndModifySelection: "Move to End of Line and Modify Selection",
  moveToLeftEndOfLineAndModifySelection: "Move to Left End of Line and Modify Selection",
  moveToRightEndOfLineAndModifySelection: "Move to Right End of Line and Modify Selection",
  moveToBeginningOfParagraphAndModifySelection: "Move to Beginning of Paragraph and Modify Selection",
  moveToEndOfParagraphAndModifySelection: "Move to End of Paragraph and Modify Selection",
  moveParagraphForwardAndModifySelection: "Move Paragraph Forward and Modify Selection",
  moveParagraphBackwardAndModifySelection: "Move Paragraph Backward and Modify Selection",
  moveToBeginningOfDocumentAndModifySelection: "Move to Beginning of Document and Modify Selection",
  moveToEndOfDocumentAndModifySelection: "Move to End of Document and Modify Selection",
  pageUp: "Page Up",
  pageDown: "Page Down",
  pageUpAndModifySelection: "Page Up and Modify Selection",
  pageDownAndModifySelection: "Page Down and Modify Selection",
  scrollLineUp: "Scroll Line Up",
  scrollLineDown: "Scroll Line Down",
  scrollPageUp: "Scroll Page Up",
  scrollPageDown: "Scroll Page Down",
  scrollToBeginningOfDocument: "Scroll to Beginning of Document",
  scrollToEndOfDocument: "Scroll to End of Document",
  centerSelectionInVisibleArea: "Center Selection in Visible Area",
  deleteBackward: "Delete Backward",
  deleteForward: "Delete Forward",
  deleteBackwardByDecomposingPreviousCharacter: "Delete Backward by Decomposing Previous Character",
  deleteWordBackward: "Delete Word Backward",
  deleteWordForward: "Delete Word Forward",
  deleteToBeginningOfLine: "Delete to Beginning of Line",
  deleteToEndOfLine: "Delete to End of Line",
  deleteToBeginningOfParagraph: "Delete to Beginning of Paragraph",
  deleteToEndOfParagraph: "Delete to End of Paragraph",
  selectWord: "Select Word",
  selectLine: "Select Line",
  selectParagraph: "Select Paragraph",
  selectToMark: "Select to Mark",
  setMark: "Set Mark",
  swapWithMark: "Swap with Mark",
  deleteToMark: "Delete to Mark",
  capitalizeWord: "Capitalize Word",
  uppercaseWord: "Uppercase Word",
  lowercaseWord: "Lowercase Word",
  transpose: "Transpose",
  transposeWords: "Transpose Words",
  insertNewline: "Insert Newline",
  insertLineBreak: "Insert Line Break",
  insertParagraphSeparator: "Insert Paragraph Separator",
  insertTab: "Insert Tab",
  insertBacktab: "Insert Backtab",
  insertTabIgnoringFieldEditor: "Insert Tab Ignoring Field Editor",
  insertNewlineIgnoringFieldEditor: "Insert Newline Ignoring Field Editor",
  yank: "Yank",
  yankAndSelect: "Yank and Select",
  complete: "Complete",
  cancelOperation: "Cancel Operation",
  indent: "Indent"
};

// node_modules/electrobun/dist/api/bun/core/ApplicationMenu.ts
var setApplicationMenu = (menu) => {
  const menuWithDefaults = menuConfigWithDefaults2(menu);
  ffi.request.setApplicationMenu({
    menuConfig: JSON.stringify(menuWithDefaults)
  });
};
var on = (name, handler) => {
  const specificName = `${name}`;
  eventEmitter_default.on(specificName, handler);
};
var menuConfigWithDefaults2 = (menu) => {
  return menu.map((item) => {
    if (item.type === "divider" || item.type === "separator") {
      return { type: "divider" };
    } else {
      const menuItem = item;
      const actionWithDataId = ffi.internal.serializeMenuAction(menuItem.action || "", menuItem.data);
      return {
        label: menuItem.label || roleLabelMap[menuItem.role] || "",
        type: menuItem.type || "normal",
        ...menuItem.role ? { role: menuItem.role } : { action: actionWithDataId },
        enabled: menuItem.enabled === false ? false : true,
        checked: Boolean(menuItem.checked),
        hidden: Boolean(menuItem.hidden),
        tooltip: menuItem.tooltip || undefined,
        accelerator: menuItem.accelerator || undefined,
        ...menuItem.submenu ? { submenu: menuConfigWithDefaults2(menuItem.submenu) } : {}
      };
    }
  });
};

// node_modules/electrobun/dist/api/bun/core/ContextMenu.ts
init_eventEmitter();
await init_native();

// node_modules/electrobun/dist/api/bun/index.ts
init_Paths();
init_BuildConfig();
await __promiseAll([
  init_Updater(),
  init_Utils(),
  init_Socket(),
  init_native()
]);

// src/bun/index.ts
import { resolve as resolve3 } from "path";
var PROXY_PORT = Number(process.env.PROXY_PORT ?? 8080);
var resourcesDir = resolve3("../Resources/app");
process.env.APROXY_UI_DIR = resolve3(resourcesDir, "views", "mainview");
process.env.APROXY_EXAMPLES_DIR = resolve3(resourcesDir, "examples");
var { startProxy: startProxy2 } = await init_src().then(() => exports_src);
await startProxy2();
var mainWindow = new BrowserWindow({
  title: "Aproxy",
  url: `http://127.0.0.1:${PROXY_PORT}`,
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 200
  }
});
exports_ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit", role: "quit" }]
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" }
    ]
  }
]);
mainWindow.on("close", () => {
  exports_Utils.quit();
});
console.log(`Aproxy desktop app started (proxy on :${PROXY_PORT})`);
