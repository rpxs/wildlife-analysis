import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const APP = document.querySelector("#app");
const DIRECTION_BUTTON = document.querySelector("#direction-toggle");
const CAPTURE_BUTTON = document.querySelector("#capture-photo");
const COLOR_MODE_LABEL = document.querySelector("#color-mode-label");
const HOME_IMPORT_BUTTON = document.querySelector("#home-import-btn");
const HOME_IMPORT_INPUT = document.querySelector("#home-import-file");
const HOME_PLAYBACK_STATUS = document.querySelector("#home-playback-status");
const HOME_LOAD_LOCAL_BUTTON = document.querySelector("#home-load-local-btn");
const HOME_PANEL = document.querySelector("#home-panel");
const EDITOR_PLAY_BUTTON = document.querySelector("#editor-play-btn");
const EDITOR_RECORD_BUTTON = document.querySelector("#editor-record-btn");
const EDITOR_CLEAR_BUTTON = document.querySelector("#editor-clear-btn");
const EDITOR_SAVE_LOCAL_BUTTON = document.querySelector("#editor-save-local-btn");
const EDITOR_LOAD_LOCAL_BUTTON = document.querySelector("#editor-load-local-btn");
const EDITOR_EXPORT_BUTTON = document.querySelector("#editor-export-btn");
const EDITOR_IMPORT_BUTTON = document.querySelector("#editor-import-btn");
const EDITOR_IMPORT_INPUT = document.querySelector("#editor-import-file");
const EDITOR_STATUS = document.querySelector("#editor-status");
const EDITOR_TIMELINE = document.querySelector("#editor-timeline");
const PAGE_MODE = document.body?.dataset?.page === "editor" ? "editor" : "home";
const IS_EDITOR = PAGE_MODE === "editor";
const IS_HOME = !IS_EDITOR;
const EDIT_STORAGE_KEY = "wildlife:shangri:edits:v1";

let travelDirection = 1;
let birdSystem = null;
let linesVisible = false;
let introSystem = null;
let sceneTime = 0;
let captureInProgress = false;
const editState = {
  recording: false,
  events: [],
  playback: {
    active: false,
    events: [],
    nextIndex: 0,
    lastTimeMs: -1,
  },
};
const homeState = {
  hasCustomEdits: false,
  defaultAutoload: {
    timeoutId: null,
    intervalId: null,
    countdownEl: null,
    startedAt: 0,
    durationMs: 7000,
    active: false,
  },
};
const COLOR_MODES = ["infection", "family", "rainbow"];
let colorModeIndex = 0;
const audioState = {
  flight: null,
  shangri: null,
  flightVolumeCurrent: 0.25,
  unlockArmed: false,
};
const analysisState = {
  context: null,
  source: null,
  analyser: null,
  freqDb: null,
  timeData: null,
  linearMag: null,
  prevLinearMag: null,
  bands: null,
  peaks: [],
  fluxAvg: 0,
  fluxVar: 0,
  onsetTimes: [],
  bpm: 0,
  initialized: false,
  ui: null,
  prevSubValue: 0,
  was1336InRange: false,
  prevDominantHz: NaN,
  was47InRange: false,
  prevMiddlePeakHz: NaN,
  middlePeakBottomHits: 0,
  centerLoudnessDisplay: null,
};
const ANALYSIS_BANDS = [
  { key: "sub", label: "sub", low: 20, high: 60 },
  { key: "bass", label: "bass", low: 60, high: 250 },
  { key: "lowmid", label: "low-mid", low: 250, high: 500 },
  { key: "mid", label: "mid", low: 500, high: 2000 },
  { key: "highmid", label: "high-mid", low: 2000, high: 6000 },
  { key: "presence", label: "presence", low: 6000, high: 12000 },
  { key: "air", label: "air", low: 12000, high: 20000 },
];
const CAMERA_PRESETS = [
  {
    name: "birds-eye",
    // Preserve current azimuth while lifting up to avoid abrupt top-view spin.
    position: [0, 44, 0],
    target: [0, 0, 0],
    dynamicAzimuth: true,
    azimuthRadius: 1.0,
    duration: 1.8,
  },
  {
    name: "outer-middle",
    position: [29, 0.8, 0],
    target: [0, 0, 0],
    duration: 1.45,
  },
  {
    name: "low-glide",
    position: [-23, 4.5, 10],
    target: [0, 0.5, 0],
    duration: 1.5,
  },
  {
    name: "high-wide",
    position: [-10, 20, -26],
    target: [0, 1.2, 0],
    duration: 1.6,
  },
];

if (DIRECTION_BUTTON) {
  setDirectionButtonLabel();
  DIRECTION_BUTTON.addEventListener("click", () => {
    toggleTravelDirection();
  });
}

if (CAPTURE_BUTTON) {
  CAPTURE_BUTTON.addEventListener("click", () => {
    captureSquarePhoto();
  });
}

function setDirectionButtonLabel() {
  if (!DIRECTION_BUTTON) return;
  DIRECTION_BUTTON.textContent =
    travelDirection === 1 ? "Direction: CW" : "Direction: CCW";
}

function toggleTravelDirection() {
  travelDirection *= -1;
  setDirectionButtonLabel();
  if (birdSystem && typeof birdSystem.setFacingDirection === "function") {
    birdSystem.setFacingDirection(travelDirection);
  }
}

function toggleNatureVisibility() {
  natureState.target = natureState.target > 0.5 ? 0 : 1;
  ground.visible = true;
  TREES.visible = true;
}

function updateNatureAnimation(dt) {
  const damp = 8;
  const alpha = 1 - Math.exp(-damp * dt);
  natureState.current += (natureState.target - natureState.current) * alpha;
  if (Math.abs(natureState.target - natureState.current) < 1e-4) {
    natureState.current = natureState.target;
  }

  const p = clamp01(natureState.current);
  const showing = natureState.target > 0.5;

  // Grass animates as a single stage.
  const grassT = showing ? p / 0.22 : (1 - p) / 0.22;
  const grassLocal = clamp01(grassT);
  const grassFactor = showing
    ? easeOutBack(grassLocal)
    : 1 - clamp01(easeInBack(grassLocal));

  ground.scale.set(
    Math.max(0.001, grassFactor),
    Math.max(0.001, grassFactor),
    Math.max(0.001, grassFactor),
  );
  const opacity = showing ? grassLocal : 1 - grassLocal;
  if (ground.material && typeof ground.material.opacity === "number") {
    ground.material.opacity = opacity;
  }

  // Trees pop one-by-one with staggered timing.
  const trees = TREES.children;
  const duration = 0.22;
  const treesStart = 0.12;
  // Fit stagger so the last tree still gets a full animation window.
  const maxStart = Math.max(treesStart, 1 - duration);
  const stagger =
    trees.length > 1 ? (maxStart - treesStart) / (trees.length - 1) : 0;
  const seq = showing ? p : 1 - p;
  let visibleTreeCount = 0;

  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    const orderIndex = showing ? i : trees.length - 1 - i;
    const start = treesStart + orderIndex * stagger;
    const local = clamp01((seq - start) / duration);
    const factor = showing
      ? easeOutBack(local)
      : 1 - clamp01(easeInBack(local));
    const s = Math.max(0.001, factor) * (tree.userData.baseScale || 1);
    tree.scale.set(s, s, s);
    tree.visible = factor > 0.002;
    if (tree.visible) visibleTreeCount++;
  }

  const hidden = natureState.target === 0 && natureState.current <= 0.001;
  ground.visible = !hidden;
  TREES.visible = !hidden && visibleTreeCount > 0;
}

function getColorMode() {
  return COLOR_MODES[colorModeIndex];
}

function cycleColorMode() {
  colorModeIndex = (colorModeIndex + 1) % COLOR_MODES.length;
  updateColorModeIndicator();
}

function updateColorModeIndicator() {
  if (!COLOR_MODE_LABEL) return;
  COLOR_MODE_LABEL.textContent = getColorMode();
}

updateColorModeIndicator();

function isTextInputTarget(target) {
  const el = target;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A"
  ) {
    return true;
  }
  return Boolean(el.isContentEditable);
}

function initPageModeFeatures() {
  if (IS_EDITOR) {
    initEditorUI();
    return;
  }
  initHomePlaybackUI();
}

function initHomePlaybackUI() {
  positionHomePanelBelowAnalysis();
  window.addEventListener("resize", positionHomePanelBelowAnalysis);

  if (HOME_IMPORT_BUTTON && HOME_IMPORT_INPUT) {
    HOME_IMPORT_BUTTON.addEventListener("click", () => {
      HOME_IMPORT_INPUT.click();
    });
    HOME_IMPORT_INPUT.addEventListener("change", async () => {
      const file = HOME_IMPORT_INPUT.files?.[0];
      if (!file) return;
      try {
        const payload = await readJsonFile(file);
        const normalized = normalizeEditsPayload(payload);
        homeState.hasCustomEdits = true;
        cancelHomeDefaultAutoload();
        startEditPlayback(normalized.events, true);
        setHomePlaybackStatus(
          `loaded ${normalized.events.length} edits from ${file.name}`,
        );
      } catch (err) {
        console.warn("Import failed:", err);
        setHomePlaybackStatus("import failed");
      } finally {
        HOME_IMPORT_INPUT.value = "";
      }
    });
  }

  if (HOME_LOAD_LOCAL_BUTTON) {
    HOME_LOAD_LOCAL_BUTTON.addEventListener("click", () => {
      const loaded = loadEditsFromLocalStorage();
      if (!loaded || loaded.events.length === 0) {
        setHomePlaybackStatus("no saved edits in localStorage");
        return;
      }
      homeState.hasCustomEdits = true;
      cancelHomeDefaultAutoload();
      startEditPlayback(loaded.events, true);
      setHomePlaybackStatus(`loaded ${loaded.events.length} saved edits`);
    });
  }

  setHomePlaybackStatus("import edit json to start playback");
  startHomeDefaultAutoload();
}

function positionHomePanelBelowAnalysis() {
  if (!IS_HOME || !HOME_PANEL) return;
  const analysisRoot = analysisState.ui?.root;
  if (!analysisRoot) return;
  const rect = analysisRoot.getBoundingClientRect();
  HOME_PANEL.style.left = `${Math.round(rect.left)}px`;
  HOME_PANEL.style.top = `${Math.round(rect.bottom + 8)}px`;
}

function ensureHomeCountdownEl() {
  const state = homeState.defaultAutoload;
  if (state.countdownEl) return state.countdownEl;
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    color: "rgba(255,255,255,0.88)",
    font: "700 22px/1.1 Helvetica Neue, Helvetica, Arial, sans-serif",
    letterSpacing: "0.01em",
    textShadow: "0 0 14px rgba(0,0,0,0.55)",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: "40",
    display: "none",
  });
  document.body.appendChild(el);
  state.countdownEl = el;
  return el;
}

function startHomeDefaultAutoload() {
  if (!IS_HOME) return;
  const state = homeState.defaultAutoload;
  cancelHomeDefaultAutoload();
  state.startedAt = performance.now();
  state.active = true;
  const el = ensureHomeCountdownEl();
  el.style.display = "none";

  state.intervalId = window.setInterval(() => {
    if (!state.active) return;
    const now = performance.now();
    const remaining = Math.max(0, state.durationMs - (now - state.startedAt));
    if (remaining <= 3000 && remaining > 0) {
      const sec = Math.ceil(remaining / 1000);
      el.textContent = `${sec}`;
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
    if (remaining <= 0) {
      el.style.display = "none";
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }
  }, 100);

  state.timeoutId = window.setTimeout(async () => {
    state.active = false;
    if (!homeState.hasCustomEdits) {
      await loadDefaultEditsForHome();
    }
  }, state.durationMs);
}

function cancelHomeDefaultAutoload() {
  const state = homeState.defaultAutoload;
  state.active = false;
  if (state.timeoutId != null) {
    window.clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
  if (state.intervalId != null) {
    window.clearInterval(state.intervalId);
    state.intervalId = null;
  }
  if (state.countdownEl) {
    state.countdownEl.style.display = "none";
  }
}

async function loadDefaultEditsForHome() {
  try {
    const res = await fetch("/default.json", { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`default.json status ${res.status}`);
    }
    const payload = await res.json();
    const normalized = normalizeEditsPayload(payload);
    if (normalized.events.length <= 0) {
      setHomePlaybackStatus("default.json has no edits");
      return;
    }
    startEditPlayback(normalized.events, true);
    setHomePlaybackStatus(
      `loaded default edit (${normalized.events.length} events)`,
    );
  } catch (err) {
    console.warn("Could not load default.json:", err);
    setHomePlaybackStatus("default.json not found");
  }
}

function initEditorUI() {
  if (EDITOR_PLAY_BUTTON) {
    EDITOR_PLAY_BUTTON.addEventListener("click", () => {
      void playShangriLa(true);
    });
  }

  if (EDITOR_RECORD_BUTTON) {
    EDITOR_RECORD_BUTTON.addEventListener("click", () => {
      editState.recording = !editState.recording;
      if (editState.recording && audioState.shangri?.paused) {
        void playShangriLa(false);
      }
      setEditorRecordButtonLabel();
      updateEditorStatus();
    });
  }

  if (EDITOR_CLEAR_BUTTON) {
    EDITOR_CLEAR_BUTTON.addEventListener("click", () => {
      editState.events.length = 0;
      renderEditorTimeline();
      updateEditorStatus();
    });
  }

  if (EDITOR_SAVE_LOCAL_BUTTON) {
    EDITOR_SAVE_LOCAL_BUTTON.addEventListener("click", () => {
      saveEditsToLocalStorage(editState.events);
      updateEditorStatus("saved to localStorage");
    });
  }

  if (EDITOR_LOAD_LOCAL_BUTTON) {
    EDITOR_LOAD_LOCAL_BUTTON.addEventListener("click", () => {
      const loaded = loadEditsFromLocalStorage();
      if (!loaded || loaded.events.length === 0) {
        updateEditorStatus("no saved edits");
        return;
      }
      editState.events = loaded.events.slice();
      renderEditorTimeline();
      updateEditorStatus(`loaded ${editState.events.length} edits`);
    });
  }

  if (EDITOR_EXPORT_BUTTON) {
    EDITOR_EXPORT_BUTTON.addEventListener("click", () => {
      exportEditsJson(editState.events);
      updateEditorStatus("exported json");
    });
  }

  if (EDITOR_IMPORT_BUTTON && EDITOR_IMPORT_INPUT) {
    EDITOR_IMPORT_BUTTON.addEventListener("click", () => {
      EDITOR_IMPORT_INPUT.click();
    });
    EDITOR_IMPORT_INPUT.addEventListener("change", async () => {
      const file = EDITOR_IMPORT_INPUT.files?.[0];
      if (!file) return;
      try {
        const payload = await readJsonFile(file);
        const normalized = normalizeEditsPayload(payload);
        editState.events = normalized.events.slice();
        renderEditorTimeline();
        updateEditorStatus(
          `imported ${normalized.events.length} edits from ${file.name}`,
        );
      } catch (err) {
        console.warn("Editor import failed:", err);
        updateEditorStatus("import failed");
      } finally {
        EDITOR_IMPORT_INPUT.value = "";
      }
    });
  }

  setEditorRecordButtonLabel();
  renderEditorTimeline();
  updateEditorStatus("ready");
}

function setHomePlaybackStatus(text) {
  if (!HOME_PLAYBACK_STATUS) return;
  HOME_PLAYBACK_STATUS.textContent = text;
}

function setEditorRecordButtonLabel() {
  if (!EDITOR_RECORD_BUTTON) return;
  EDITOR_RECORD_BUTTON.textContent = editState.recording
    ? "Stop Recording"
    : "Start Recording";
}

function formatTimelineTimeMs(ms) {
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const msPart = total % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(msPart).padStart(3, "0")}`;
}

function renderEditorTimeline() {
  if (!EDITOR_TIMELINE) return;
  if (editState.events.length <= 0) {
    EDITOR_TIMELINE.textContent = "No edits yet.";
    return;
  }
  const lines = [];
  const sorted = editState.events
    .slice()
    .sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    lines.push(`${String(i + 1).padStart(4, "0")}  ${formatTimelineTimeMs(e.atMs)}  ${e.key}`);
  }
  EDITOR_TIMELINE.textContent = lines.join("\n");
}

function updateEditorStatus(extra = "") {
  if (!IS_EDITOR || !EDITOR_STATUS) return;
  const song = audioState.shangri;
  const nowMs = song ? Math.max(0, Math.round((song.currentTime || 0) * 1000)) : 0;
  const rec = editState.recording ? "recording" : "idle";
  const play = song && !song.paused && !song.ended ? "playing" : "stopped";
  EDITOR_STATUS.textContent =
    `audio ${play} | ${rec} | edits ${editState.events.length} | t ${formatTimelineTimeMs(nowMs)}` +
    (extra ? ` | ${extra}` : "");
}

function recordEditKey(code) {
  if (!IS_EDITOR || !editState.recording) return;
  const song = audioState.shangri;
  if (!song || song.paused || song.ended) return;
  const atMs = Math.max(0, Math.round((song.currentTime || 0) * 1000));
  editState.events.push({ atMs, key: code });
  renderEditorTimeline();
  updateEditorStatus();
}

function normalizeEditsPayload(payload) {
  const list = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(list)) {
    throw new Error("Invalid edits JSON: expected { events: [] }");
  }
  const events = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== "object") continue;
    const key = typeof item.key === "string" ? item.key : item.code;
    if (!key || typeof key !== "string") continue;
    let atMs = Number(item.atMs);
    if (!Number.isFinite(atMs)) {
      if (Number.isFinite(item.timeMs)) atMs = Number(item.timeMs);
      else if (Number.isFinite(item.t)) atMs = Number(item.t) * 1000;
      else if (Number.isFinite(item.time)) atMs = Number(item.time) * 1000;
    }
    if (!Number.isFinite(atMs)) continue;
    events.push({
      atMs: Math.max(0, Math.round(atMs)),
      key,
    });
  }
  events.sort((a, b) => a.atMs - b.atMs);
  return {
    version: 1,
    audio: "/shangri-la.mp3",
    events,
  };
}

function makeEditsPayload(events) {
  return {
    version: 1,
    audio: "/shangri-la.mp3",
    createdAt: new Date().toISOString(),
    events: events
      .slice()
      .sort((a, b) => a.atMs - b.atMs)
      .map((e) => ({ atMs: Math.max(0, Math.round(e.atMs)), key: e.key })),
  };
}

async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function saveEditsToLocalStorage(events) {
  const payload = makeEditsPayload(events);
  localStorage.setItem(EDIT_STORAGE_KEY, JSON.stringify(payload));
}

function loadEditsFromLocalStorage() {
  const raw = localStorage.getItem(EDIT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeEditsPayload(parsed);
  } catch (err) {
    console.warn("Could not parse saved edits:", err);
    return null;
  }
}

function exportEditsJson(events) {
  const payload = makeEditsPayload(events);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const stamp = formatCaptureStamp(new Date());
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shangri-edits-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function startEditPlayback(events, autoplay = true) {
  const sorted = events
    .slice()
    .map((e) => ({ atMs: Math.max(0, Math.round(e.atMs)), key: e.key }))
    .sort((a, b) => a.atMs - b.atMs);
  editState.playback.events = sorted;
  editState.playback.nextIndex = 0;
  editState.playback.lastTimeMs = -1;
  editState.playback.active = sorted.length > 0;
  if (autoplay && sorted.length > 0) {
    void playShangriLa(true);
  }
}

function updateEditPlayback() {
  if (!IS_HOME) return;
  if (!editState.playback.active) return;
  const song = audioState.shangri;
  if (!song || song.paused) return;

  const nowMs = Math.max(0, Math.round((song.currentTime || 0) * 1000));
  if (editState.playback.lastTimeMs >= 0 && nowMs + 150 < editState.playback.lastTimeMs) {
    editState.playback.nextIndex = 0;
  }
  editState.playback.lastTimeMs = nowMs;

  const events = editState.playback.events;
  while (
    editState.playback.nextIndex < events.length &&
    events[editState.playback.nextIndex].atMs <= nowMs
  ) {
    const event = events[editState.playback.nextIndex];
    executeKeyAction(event.key, "playback");
    editState.playback.nextIndex += 1;
  }

  if (editState.playback.nextIndex >= events.length) {
    editState.playback.active = false;
    setHomePlaybackStatus(`playback complete (${events.length} edits)`);
  } else {
    setHomePlaybackStatus(
      `playing edits ${editState.playback.nextIndex}/${events.length}`,
    );
  }
}

async function captureSquarePhoto() {
  if (captureInProgress) return;
  if (!renderer || !camera || !scene) return;
  captureInProgress = true;
  if (CAPTURE_BUTTON) CAPTURE_BUTTON.disabled = true;

  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevPixelRatio = renderer.getPixelRatio();
  const prevAspect = camera.aspect;

  try {
    const base = clamp(
      Math.round(Math.max(prevSize.x, prevSize.y) * 2),
      2048,
      4096,
    );
    let captureW = base;
    let captureH = base;
    if (prevSize.x >= prevSize.y) {
      captureH = Math.max(1, Math.round(base * (prevSize.y / prevSize.x)));
    } else {
      captureW = Math.max(1, Math.round(base * (prevSize.x / prevSize.y)));
    }

    renderer.setPixelRatio(1);
    renderer.setSize(captureW, captureH, false);
    camera.aspect = captureW / captureH;
    camera.updateProjectionMatrix();
    if (!cameraRig.active) controls.update();
    renderer.render(scene, camera);

    const squareSize = Math.min(captureW, captureH);
    const outCanvas = document.createElement("canvas");
    outCanvas.width = squareSize;
    outCanvas.height = squareSize;
    const ctx = outCanvas.getContext("2d");
    if (!ctx) throw new Error("Could not create capture canvas context");

    const sx = Math.floor((captureW - squareSize) * 0.5);
    const sy = Math.floor((captureH - squareSize) * 0.5);
    ctx.drawImage(
      renderer.domElement,
      sx,
      sy,
      squareSize,
      squareSize,
      0,
      0,
      squareSize,
      squareSize,
    );

    const blob = await new Promise((resolve) =>
      outCanvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("Could not encode captured image");

    const stamp = formatCaptureStamp(new Date());
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wildlife-capture-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.warn("Capture failed:", err);
  } finally {
    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    if (!cameraRig.active) controls.update();
    renderer.render(scene, camera);
    captureInProgress = false;
    if (CAPTURE_BUTTON) CAPTURE_BUTTON.disabled = false;
  }
}

function formatCaptureStamp(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function cycleCameraRigPreset() {
  if (CAMERA_PRESETS.length === 0) return;
  cameraRig.index = (cameraRig.index + 1) % CAMERA_PRESETS.length;
  const preset = CAMERA_PRESETS[cameraRig.index];

  cameraRig.fromPos.copy(camera.position);
  cameraRig.fromTarget.copy(controls.target);
  let toX = preset.position[0];
  let toY = preset.position[1];
  let toZ = preset.position[2];
  if (preset.dynamicAzimuth) {
    const ox = camera.position.x - controls.target.x;
    const oz = camera.position.z - controls.target.z;
    const len = Math.hypot(ox, oz);
    const dirX = len > 1e-5 ? ox / len : 1;
    const dirZ = len > 1e-5 ? oz / len : 0;
    const r = preset.azimuthRadius || 5.5;
    toX = preset.target[0] + dirX * r;
    toY = preset.position[1];
    toZ = preset.target[2] + dirZ * r;
  }
  cameraRig.toPos.set(toX, toY, toZ);
  cameraRig.toTarget.set(preset.target[0], preset.target[1], preset.target[2]);
  cameraRig.duration = preset.duration || 1.5;
  cameraRig.elapsed = 0;
  cameraRig.active = true;
}

function updateCameraRig(dt) {
  if (!cameraRig.active) return;
  cameraRig.elapsed = Math.min(cameraRig.elapsed + dt, cameraRig.duration);
  const u =
    cameraRig.duration > 1e-5 ? cameraRig.elapsed / cameraRig.duration : 1;
  const e = easeInOutCubic(clamp01(u));

  camera.position.lerpVectors(cameraRig.fromPos, cameraRig.toPos, e);
  controls.target.lerpVectors(cameraRig.fromTarget, cameraRig.toTarget, e);
  camera.lookAt(controls.target);

  if (u >= 1) {
    cameraRig.active = false;
  }
}

function executeKeyAction(code, source = "user") {
  if (code === "Space") {
    if (birdSystem) {
      linesVisible = !linesVisible;
      birdSystem.setLinesVisible(linesVisible);
      birdSystem.randomizeConnections();
    }
    return true;
  }
  if (code === "KeyG") {
    void playShangriLa();
    return true;
  }
  if (code === "KeyT") {
    if (introSystem) introSystem.restart(sceneTime);
    return true;
  }
  if (code === "KeyH") {
    cycleColorMode();
    return true;
  }
  if (code === "KeyJ") {
    toggleNatureVisibility();
    return true;
  }
  if (code === "KeyB") {
    if (birdSystem && birdSystem.toggleScatterFlight) {
      birdSystem.toggleScatterFlight();
    }
    return true;
  }
  if (code === "KeyV") {
    cycleCameraRigPreset();
    return true;
  }
  if (code === "KeyK") {
    if (birdSystem && typeof birdSystem.cycleRouteShape === "function") {
      birdSystem.cycleRouteShape();
    }
    return true;
  }
  if (code === "KeyD") {
    if (source === "user") {
      toggleTravelDirection();
      return true;
    }
  }
  return false;
}

function handleEditorKeydown(event) {
  if (!IS_EDITOR) return;
  if (event.repeat) return;
  if (isTextInputTarget(event.target)) return;
  if (event.code === "Space") event.preventDefault();
  executeKeyAction(event.code, "user");
  recordEditKey(event.code);
}

if (IS_EDITOR) {
  window.addEventListener("keydown", handleEditorKeydown);
}

const CFG = {
  count: 900,
  radius: 12,
  height: 14,
  speedMin: 0.08,
  speedMax: 0.35,
  spriteSizeMin: 0.18,
  spriteSizeMax: 0.55,
  flutter: 0.35,
  flutterSpeed: 0.6,
  yawMin: Math.PI / 18, // 10 degrees
  yawMax: Math.PI / 12, // 15 degrees
  yawSpeedMin: 2.0,
  yawSpeedMax: 3.4,
  birdFacingMaxOffCameraYaw: Math.PI / 4, // keep sprites readable (no edge-on thinness)
  birdSideFlipResponse: 7.0,
  birdSideFlipDeadzone: 0.06,
  birdTopViewPitchBlendStart: 12,
  birdTopViewPitchBlendEnd: 34,
  birdTopViewPitchStrength: 0.9,
  birdTopViewPitchMax: Math.PI / 3,
  facingFlipDuration: 0.32,
  rmsRotateTrigger: 0.4,
  rmsRotateMax: 0.75,
  rmsRotateMaxAngle: Math.PI / 7.5, // ~24 degrees
  rmsRotateResponse: 7.5,
  crestYRotateTrigger: 2.0,
  crestYRotateMax: 4.0,
  crestYRotateMaxAngle: Math.PI / 40, // ~4.5 degrees
  crestYRotateResponse: 6.5,
  middlePeakYRotateStep: Math.PI / 48, // 3.75 degrees per 270Hz trigger
  middlePeakYRotateMax: Math.PI / 16, // cap added wobble to ~11.25 degrees
  middlePeakYRotateResponse: 8.5,
  middlePeakYRotateDecay: 3.6,
  shapeTransitionSpeedFactor: 2.0,
  shapeInnerFraction: 0.36,
  shapeInnerRadiusFactor: 0.45,
  shapeInnerHeightFactor: 0.8,
  shapeInnerAngularRate: 1.0,
  shapeMobiusRadiusFactor: 0.74,
  shapeMobiusHalfWidth: 2.5,
  shapeMobiusFlutterMix: 0.24,
  shapeMobiusAngularRate: 1.0,
  routeMorphResponse: 2.8,
  scatterSpeedMin: 6.2,
  scatterSpeedMax: 10.8,
  scatterAccel: 0.0,
  scatterReturnSpeedMin: 16.0,
  scatterReturnSpeedMax: 28.0,
  scatterReturnSnapDistance: 0.08,
  lineBackOffsetFactor: 0.0,
  lineBackOffsetMin: 0.0,
  lineColor: 0xffffff,
  lineOpacity: 0.2,
  lineFraction: 0.25,
  flightMinVolume: 0.1,
  flightMaxVolume: 0.25,
  flightVolumeLerp: 0.08,
  directionTriggerHz: 1336,
  directionTriggerToleranceHz: 7,
  subColorTriggerThreshold: 0.04,
  perBirdColorTriggerHz: 47,
  perBirdColorTriggerToleranceHz: 4,
  middlePeakBottomTriggerHz: 270,
  bird2DTransitionDuration: 0.9,
  bird2DReturn2DDuration: 0.7,
  bird2DReturn3DDuration: 0.9,
  bird2DFlySpeedMin: 0.55,
  bird2DFlySpeedMax: 1.2,
  bird2DScreenMarginX: 0.7,
  bird2DScreenMarginY: 0.52,
  bird2DScreenDepthNdc: 0.15,
  bird2DScaleFactor: 0.32,
  bird2DVisualScale: 0.0267,
  treeCount: 36,
  treeMinRadius: 13.2,
  treeMaxRadius: 18.0,
  treeMinSpacing: 1.25,
  dprCap: 1.75,
  atlasMaxSize: 2048,
};

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 18, 60);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(0, 6, 26);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
APP.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 65;
controls.target.set(0, 0, 0);

const cameraRig = {
  index: -1,
  active: false,
  elapsed: 0,
  duration: 1.5,
  fromPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
};

scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const dir = new THREE.DirectionalLight(0xffffff, 0.75);
dir.position.set(10, 20, 10);
scene.add(dir);

const groundTexture = createGrassTexture();
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(CFG.radius * 1.55, 96),
  new THREE.MeshStandardMaterial({
    color: 0x4f9d3f,
    map: groundTexture,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    opacity: 1,
  }),
);
ground.rotation.x = -Math.PI / 2;
const GROUND_Y = -CFG.height * 0.5 - 0.25;
ground.position.y = GROUND_Y;
scene.add(ground);
const TREES = createLowPolyTrees();
scene.add(TREES);

const natureState = {
  target: 0,
  current: 0,
};

function clampDpr() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CFG.dprCap));
}

function resize() {
  const w = APP.clientWidth || window.innerWidth;
  const h = APP.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

clampDpr();
resize();
window.addEventListener("resize", () => {
  clampDpr();
  resize();
});

boot().catch((err) => {
  console.error(err);
  alert(
    "Failed to load birds. Ensure images and /birds/manifest.json exist, then run npm run dev again.",
  );
});

async function boot() {
  const urls = await loadManifest();
  const images = await loadImages(urls);
  const atlas = buildAtlas(images, CFG.atlasMaxSize);

  const texture = new THREE.CanvasTexture(atlas.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  const birds = makeInstancedBillboards({
    texture,
    rects: atlas.rects,
    count: CFG.count,
  });
  const intro = createIntroWords("");
  introSystem = intro;
  birdSystem = birds;
  birdSystem.setLinesVisible(linesVisible);
  if (birdSystem.setFacingDirection) {
    birdSystem.setFacingDirection(travelDirection);
  }
  scene.add(birds.lines);
  scene.add(birds.mesh);
  scene.add(intro.group);
  setupAudio();
  setupAudioAnalysisUI();
  initPageModeFeatures();

  const clock = new THREE.Clock();
  const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.033);
    const t = clock.elapsedTime;
    sceneTime = t;

    updateCameraRig(dt);
    if (!cameraRig.active) {
      controls.update();
    }
    birds.update(dt, t, camera);
    intro.update(t);
    updateFlightVolume();
    updateAudioAnalysis(dt, t);
    updateEditPlayback();
    updateEditorStatus();
    updateNatureAnimation(dt);
    renderer.render(scene, camera);
    birds.updateLabels(
      camera,
      APP.clientWidth || window.innerWidth,
      APP.clientHeight || window.innerHeight,
    );
    requestAnimationFrame(tick);
  };
  tick();
}

async function loadManifest() {
  const res = await fetch("/birds/manifest.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Could not load /birds/manifest.json (status ${res.status}).`,
    );
  }

  const data = await res.json();
  const files = Array.isArray(data) ? data : data?.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(
      "manifest.json has no files. Put images in /birds and rerun.",
    );
  }

  return files
    .map((value) => normalizeBirdUrl(value))
    .filter((value) => typeof value === "string");
}

function normalizeBirdUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^(https?:)?\/\//i.test(value)) return value;
  if (value.startsWith("/")) return value;

  const cleaned = value.replace(/^\.?[\\/]/, "").replace(/^birds[\\/]/i, "");
  return `/birds/${cleaned.replaceAll("\\", "/")}`;
}

async function loadImages(urls) {
  const loaded = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
      const blob = await res.blob();

      if ("createImageBitmap" in window) {
        const bmp = await createImageBitmap(blob, {
          premultiplyAlpha: "premultiply",
        });
        return { url, img: bmp, w: bmp.width, h: bmp.height };
      }

      const img = await new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(el);
        };
        el.onerror = (e) => {
          URL.revokeObjectURL(objectUrl);
          reject(e);
        };
        el.src = objectUrl;
      });
      return { url, img, w: img.width, h: img.height };
    }),
  );

  return loaded.filter((entry) => entry.w > 0 && entry.h > 0);
}

function getImageOpaqueMetrics(img, w, h, alphaThreshold = 8) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w, h, anchorX: 0, anchorY: 0 };
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  let data = null;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return { x: 0, y: 0, w, h, anchorX: 0, anchorY: 0 };
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let weightedX = 0;
  let weightedY = 0;
  let weightSum = 0;

  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const a = data[row + x * 4 + 3];
      if (a <= alphaThreshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const wa = a / 255;
      weightedX += (x + 0.5) * wa;
      weightedY += (y + 0.5) * wa;
      weightSum += wa;
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, w, h, anchorX: 0, anchorY: 0 };
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const centerX = minX + cropW * 0.5;
  const centerY = minY + cropH * 0.5;
  const centroidX = weightSum > 1e-8 ? weightedX / weightSum : centerX;
  const centroidY = weightSum > 1e-8 ? weightedY / weightSum : centerY;

  return {
    x: minX,
    y: minY,
    w: cropW,
    h: cropH,
    anchorX: (centroidX - centerX) / cropW,
    anchorY: (centerY - centroidY) / cropH,
  };
}

function buildAtlas(images, maxSize = 2048) {
  const targetMax = 256;

  const scaled = images.map((it) => {
    const metrics = getImageOpaqueMetrics(it.img, it.w, it.h);
    const scale = Math.min(1, targetMax / Math.max(metrics.w, metrics.h));
    return {
      ...it,
      cropX: metrics.x,
      cropY: metrics.y,
      cropW: metrics.w,
      cropH: metrics.h,
      anchorX: metrics.anchorX,
      anchorY: metrics.anchorY,
      sw: Math.max(1, Math.round(metrics.w * scale)),
      sh: Math.max(1, Math.round(metrics.h * scale)),
    };
  });

  const cellW = Math.max(...scaled.map((s) => s.sw));
  const cellH = Math.max(...scaled.map((s) => s.sh));
  const count = scaled.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  let atlasW = cols * cellW;
  let atlasH = rows * cellH;
  const scaleDown = Math.min(1, maxSize / Math.max(atlasW, atlasH));
  atlasW = Math.max(1, Math.floor(atlasW * scaleDown));
  atlasH = Math.max(1, Math.floor(atlasH * scaleDown));

  const canvas = document.createElement("canvas");
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.clearRect(0, 0, atlasW, atlasH);

  const rects = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x0 = Math.floor(c * cellW * scaleDown);
    const y0 = Math.floor(r * cellH * scaleDown);
    const sw = Math.max(1, Math.floor(scaled[i].sw * scaleDown));
    const sh = Math.max(1, Math.floor(scaled[i].sh * scaleDown));
    const cw = Math.floor(cellW * scaleDown);
    const ch = Math.floor(cellH * scaleDown);
    const cx = x0 + Math.floor((cw - sw) / 2);
    const cy = y0 + Math.floor((ch - sh) / 2);

    ctx.drawImage(
      scaled[i].img,
      scaled[i].cropX,
      scaled[i].cropY,
      scaled[i].cropW,
      scaled[i].cropH,
      cx,
      cy,
      sw,
      sh,
    );
    rects.push({
      u0: cx / atlasW,
      v0: cy / atlasH,
      us: sw / atlasW,
      vs: sh / atlasH,
      anchorX: scaled[i].anchorX,
      anchorY: scaled[i].anchorY,
    });
  }

  return { canvas, rects };
}

function makeInstancedBillboards({ texture, rects, count }) {
  const geom = new THREE.PlaneGeometry(1, 1, 1, 1);
  const lineCount = Math.min(
    Math.floor(count / 2),
    Math.floor(count * CFG.lineFraction * 0.5),
  );
  const lineBirdA = new Int32Array(lineCount);
  const lineBirdB = new Int32Array(lineCount);

  const linePositions = new Float32Array(lineCount * 2 * 3);
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute(
    "position",
    new THREE.BufferAttribute(linePositions, 3),
  );

  const lines = new THREE.LineSegments(
    lineGeom,
    new THREE.LineBasicMaterial({
      color: CFG.lineColor,
      transparent: true,
      opacity: CFG.lineOpacity,
      depthTest: false,
      depthWrite: false,
    }),
  );
  lines.frustumCulled = false;

  const uvTransform = new Float32Array(count * 4);
  const scales = new Float32Array(count);
  const rots = new Float32Array(count);
  const yawAmp = new Float32Array(count);
  const yawPhase = new Float32Array(count);
  const yawSpeed = new Float32Array(count);
  const yRotMul = new Float32Array(count);
  const tintRgb = new Float32Array(count * 3);

  const theta = new Float32Array(count);
  const speed = new Float32Array(count);
  const y0 = new Float32Array(count);
  const flutterPhase = new Float32Array(count);
  const ringX = new Float32Array(count);
  const ringY = new Float32Array(count);
  const ringZ = new Float32Array(count);
  const routeFollowX = new Float32Array(count);
  const routeFollowY = new Float32Array(count);
  const routeFollowZ = new Float32Array(count);
  const innerRingMask = new Uint8Array(count);
  const mobiusLane = new Float32Array(count);
  const faceDirX = new Float32Array(count);
  const faceDirZ = new Float32Array(count);
  const posX = new Float32Array(count);
  const posY = new Float32Array(count);
  const posZ = new Float32Array(count);
  const worldStartX = new Float32Array(count);
  const worldStartY = new Float32Array(count);
  const worldStartZ = new Float32Array(count);
  const screenStartX = new Float32Array(count);
  const screenStartY = new Float32Array(count);
  const screenTargetX = new Float32Array(count);
  const screenTargetY = new Float32Array(count);
  const screenNowX = new Float32Array(count);
  const screenNowY = new Float32Array(count);
  const screenVelX = new Float32Array(count);
  const screenVelY = new Float32Array(count);
  const scatterVelX = new Float32Array(count);
  const scatterVelY = new Float32Array(count);
  const scatterVelZ = new Float32Array(count);
  const flyOriginX = new Float32Array(count);
  const flyOriginY = new Float32Array(count);
  const tmpWorld = new THREE.Vector3();
  const tmpProject = new THREE.Vector3();
  let lastCamera = null;
  let visualScale = 1;
  let audioRotAmount = 0;
  let crestYRotAmount = 0;
  let middlePeakYRotAmount = 0;
  let middlePeakYRotTarget = 0;
  let middlePeakYRotDir = 1;
  const SHAPE_MODES = ["cylinder", "double-cylinder", "mobius", "cube"];
  const shapeState = {
    index: 0,
  };
  const routeState = {
    current: 0, // 0 = cylinder, 1 = cube-like square route
    target: 0,
  };
  const facingFlipState = {
    current: 1,
    from: 1,
    to: 1,
    elapsed: 0,
    active: false,
  };
  const transformState = {
    mode: "world3d", // world3d | to2d | fly2d | return2d | to3d | scatter3d | return3d
    timer: 0,
    reverseFly: false,
  };
  const infectionMask = new Uint8Array(count);
  const infectedIndices = [];
  const infectionState = {
    hue: Math.random(),
    infectedCount: 0,
  };
  const routePointA = { x: 0, y: 0, z: 0 };
  const routePointB = { x: 0, y: 0, z: 0 };

  const dummy = new THREE.Object3D();
  dummy.rotation.order = "YXZ";
  for (let i = 0; i < count; i++) {
    const idx = (Math.random() * rects.length) | 0;
    const rect = rects[idx];

    uvTransform[i * 4 + 0] = rect.u0;
    uvTransform[i * 4 + 1] = rect.v0;
    uvTransform[i * 4 + 2] = rect.us;
    uvTransform[i * 4 + 3] = rect.vs;

    scales[i] = lerp(CFG.spriteSizeMin, CFG.spriteSizeMax, Math.random());
    rots[i] = 1;
    yawAmp[i] = lerp(CFG.yawMin, CFG.yawMax, Math.random());
    yawPhase[i] = Math.random() * Math.PI * 2;
    yawSpeed[i] = lerp(CFG.yawSpeedMin, CFG.yawSpeedMax, Math.random());
    yRotMul[i] =
      (Math.random() < 0.5 ? -1 : 1) * lerp(0.6, 1.0, Math.random());
    tintRgb[i * 3 + 0] = 1;
    tintRgb[i * 3 + 1] = 1;
    tintRgb[i * 3 + 2] = 1;

    theta[i] = Math.random() * Math.PI * 2;
    speed[i] = lerp(CFG.speedMin, CFG.speedMax, Math.random());

    y0[i] = (Math.random() - 0.5) * CFG.height;
    flutterPhase[i] = Math.random() * Math.PI * 2;
    innerRingMask[i] = Math.random() < CFG.shapeInnerFraction ? 1 : 0;
    mobiusLane[i] = Math.random() * 2 - 1;
  }

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTex: { value: texture },
      uOpacity: { value: 1.0 },
      uTime: { value: 0.0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uGlobalScale: { value: 1.0 },
      uFacingFlip: { value: 1.0 },
      uAudioRot: { value: 0.0 },
      uCrestYRot: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uGlobalScale;
      uniform float uFacingFlip;
      uniform float uAudioRot;
      uniform float uCrestYRot;

      attribute vec4 aUvTransform;
      attribute float aScale;
      attribute float aRot;
      attribute float aYawAmp;
      attribute float aYawPhase;
      attribute float aYawSpeed;
      attribute float aYRotMul;
      attribute vec3 aTint;

      varying vec2 vUv;
      varying vec3 vTint;

      void main() {
        vUv = uv * aUvTransform.zw + aUvTransform.xy;
        vTint = aTint;

        vec2 local = position.xy * aScale * uGlobalScale;
        local.x *= (uFacingFlip * clamp(aRot, -1.0, 1.0));

        float sway = sin(uTime * aYawSpeed + aYawPhase) * aYawAmp;
        float audioSpin = sin(uTime * 7.5 + aYawPhase * 1.31) * uAudioRot;
        float angle = sway + audioSpin;
        float c = cos(angle);
        float s = sin(angle);
        local = mat2(c, -s, s, c) * local;

        vec3 local3 = vec3(local, 0.0);
        float yAngle = uCrestYRot * aYRotMul;
        float cy = cos(yAngle);
        float sy = sin(yAngle);
        local3 = vec3(
          local3.x * cy + local3.z * sy,
          local3.y,
          -local3.x * sy + local3.z * cy
        );

        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(local3, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uTex;
      uniform float uOpacity;
      uniform vec3 uTint;

      varying vec2 vUv;
      varying vec3 vTint;

      void main() {
        vec4 col = texture2D(uTex, vUv);
        if (col.a < 0.05) discard;
        col.rgb *= (uTint * vTint);
        col.a *= uOpacity;
        gl_FragColor = col;
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geom, mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  lines.renderOrder = 3;

  geom.setAttribute(
    "aUvTransform",
    new THREE.InstancedBufferAttribute(uvTransform, 4),
  );
  geom.setAttribute("aScale", new THREE.InstancedBufferAttribute(scales, 1));
  const rotAttr = new THREE.InstancedBufferAttribute(rots, 1);
  geom.setAttribute("aRot", rotAttr);
  geom.setAttribute("aYawAmp", new THREE.InstancedBufferAttribute(yawAmp, 1));
  geom.setAttribute(
    "aYawPhase",
    new THREE.InstancedBufferAttribute(yawPhase, 1),
  );
  geom.setAttribute(
    "aYawSpeed",
    new THREE.InstancedBufferAttribute(yawSpeed, 1),
  );
  geom.setAttribute("aYRotMul", new THREE.InstancedBufferAttribute(yRotMul, 1));
  const tintAttr = new THREE.InstancedBufferAttribute(tintRgb, 3);
  geom.setAttribute("aTint", tintAttr);

  for (let i = 0; i < count; i++) {
    getRouteXZ(theta[i], routeState.current, routePointA);
    const x = routePointA.x;
    const z = routePointA.z;
    const y = y0[i];
    getRouteXZ(theta[i] + 0.01, routeState.current, routePointB);
    let dirX = routePointB.x - routePointA.x;
    let dirZ = routePointB.z - routePointA.z;
    const dirLen = Math.hypot(dirX, dirZ);
    if (dirLen > 1e-5) {
      dirX /= dirLen;
      dirZ /= dirLen;
    } else {
      dirX = -Math.sin(theta[i]) * travelDirection;
      dirZ = Math.cos(theta[i]) * travelDirection;
    }

    ringX[i] = x;
    ringY[i] = y;
    ringZ[i] = z;
    routeFollowX[i] = x;
    routeFollowY[i] = y;
    routeFollowZ[i] = z;
    faceDirX[i] = dirX;
    faceDirZ[i] = dirZ;
    posX[i] = x;
    posY[i] = y;
    posZ[i] = z;

    dummy.position.set(x, y, z);
    dummy.rotation.set(
      0,
      Math.atan2(faceDirX[i], faceDirZ[i]),
      0,
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  randomizeConnections();

  mesh.instanceMatrix.needsUpdate = true;
  lineGeom.attributes.position.needsUpdate = true;

  function update(dt, t, cameraRef) {
    if (cameraRef) lastCamera = cameraRef;
    mat.uniforms.uTime.value = t;
    if (facingFlipState.active) {
      facingFlipState.elapsed = Math.min(
        facingFlipState.elapsed + dt,
        CFG.facingFlipDuration,
      );
      const u =
        CFG.facingFlipDuration > 1e-5
          ? facingFlipState.elapsed / CFG.facingFlipDuration
          : 1;
      const e = easeInOutCubic(clamp01(u));
      facingFlipState.current = lerp(facingFlipState.from, facingFlipState.to, e);
      if (u >= 1) {
        facingFlipState.current = facingFlipState.to;
        facingFlipState.active = false;
      }
    }
    mat.uniforms.uFacingFlip.value = facingFlipState.current;
    routeState.target = shapeState.index === 3 ? 1 : 0;
    const routeAlpha =
      1 - Math.exp(-CFG.routeMorphResponse * Math.max(0, dt));
    routeState.current += (routeState.target - routeState.current) * routeAlpha;
    if (Math.abs(routeState.target - routeState.current) < 1e-4) {
      routeState.current = routeState.target;
    }
    if (transformState.mode !== "scatter3d") {
      const shapeMode = SHAPE_MODES[shapeState.index] || SHAPE_MODES[0];
      for (let i = 0; i < count; i++) {
        theta[i] += speed[i] * dt * travelDirection;
        const tangentStep = 0.01 * travelDirection;
        getShapePoint(i, theta[i], t, shapeMode, routePointA);
        getShapePoint(i, theta[i] + tangentStep, t, shapeMode, routePointB);

        const targetX = routePointA.x;
        const targetY = routePointA.y;
        const targetZ = routePointA.z;
        const targetNextX = routePointB.x;
        const targetNextZ = routePointB.z;

        const toTargetX = targetX - routeFollowX[i];
        const toTargetY = targetY - routeFollowY[i];
        const toTargetZ = targetZ - routeFollowZ[i];
        const toTargetDist = Math.hypot(toTargetX, toTargetY, toTargetZ);
        const orbitSpeed = Math.max(0.2, CFG.radius * speed[i]);
        const maxStep =
          orbitSpeed * CFG.shapeTransitionSpeedFactor * Math.max(0, dt);
        if (toTargetDist <= Math.max(maxStep, 1e-5)) {
          routeFollowX[i] = targetX;
          routeFollowY[i] = targetY;
          routeFollowZ[i] = targetZ;
        } else {
          const inv = 1 / toTargetDist;
          routeFollowX[i] += toTargetX * inv * maxStep;
          routeFollowY[i] += toTargetY * inv * maxStep;
          routeFollowZ[i] += toTargetZ * inv * maxStep;
        }

        const x = routeFollowX[i];
        const y = routeFollowY[i];
        const z = routeFollowZ[i];

        let dirX;
        let dirZ;
        if (toTargetDist > maxStep * 0.35 + 1e-5) {
          dirX = toTargetX;
          dirZ = toTargetZ;
        } else {
          dirX = targetNextX - targetX;
          dirZ = targetNextZ - targetZ;
        }
        const dirLen = Math.hypot(dirX, dirZ);
        if (dirLen > 1e-5) {
          dirX /= dirLen;
          dirZ /= dirLen;
        } else {
          dirX = -Math.sin(theta[i]) * travelDirection;
          dirZ = Math.cos(theta[i]) * travelDirection;
        }

        ringX[i] = x;
        ringY[i] = y;
        ringZ[i] = z;
        faceDirX[i] = dirX;
        faceDirZ[i] = dirZ;
      }
    }

    if (transformState.mode === "scatter3d") {
      updateScatter3D(dt);
      visualScale = 1;
    } else if (transformState.mode === "return3d") {
      updateReturnFromScatter3D(dt);
      visualScale = 1;
    } else if (transformState.mode === "to2d") {
      updateTo2D(dt, lastCamera);
    } else if (transformState.mode === "fly2d") {
      updateFly2D(dt, lastCamera);
      visualScale = CFG.bird2DVisualScale;
    } else if (transformState.mode === "return2d") {
      updateReturn2D(dt, lastCamera);
      visualScale = CFG.bird2DVisualScale;
    } else if (transformState.mode === "to3d") {
      updateTo3D(dt);
    } else {
      visualScale = 1;
      for (let i = 0; i < count; i++) {
        posX[i] = ringX[i];
        posY[i] = ringY[i];
        posZ[i] = ringZ[i];
      }
    }

    mat.uniforms.uGlobalScale.value = visualScale;

    let camRightX = 1;
    let camRightZ = 0;
    if (lastCamera) {
      const e = lastCamera.matrixWorld.elements;
      camRightX = e[0];
      camRightZ = e[2];
      const camRightLen = Math.hypot(camRightX, camRightZ);
      if (camRightLen > 1e-5) {
        camRightX /= camRightLen;
        camRightZ /= camRightLen;
      } else {
        camRightX = 1;
        camRightZ = 0;
      }
    }
    let topViewBlend = 0;
    if (lastCamera) {
      const camLift = lastCamera.position.y - controls.target.y;
      topViewBlend = clamp01(
        (camLift - CFG.birdTopViewPitchBlendStart) /
          Math.max(
            1e-5,
            CFG.birdTopViewPitchBlendEnd - CFG.birdTopViewPitchBlendStart,
          ),
      );
    }
    const useMovementFacingSign =
      transformState.mode === "scatter3d" || transformState.mode === "return3d";
    const flipAlpha =
      1 - Math.exp(-CFG.birdSideFlipResponse * Math.max(0, dt));

    for (let i = 0; i < count; i++) {
      let dirX = faceDirX[i];
      let dirZ = faceDirZ[i];
      const dirLen = Math.hypot(dirX, dirZ);
      if (dirLen < 1e-5) {
        dirX = -Math.sin(theta[i]) * travelDirection;
        dirZ = Math.cos(theta[i]) * travelDirection;
      }
      const signBasisX = useMovementFacingSign ? dirX : -Math.sin(theta[i]);
      const signBasisZ = useMovementFacingSign ? dirZ : Math.cos(theta[i]);
      const side = signBasisX * camRightX + signBasisZ * camRightZ;
      let targetFlip = rots[i] >= 0 ? 1 : -1;
      if (Math.abs(side) >= CFG.birdSideFlipDeadzone) {
        // CW baseline should remain the "normal" orientation.
        targetFlip = side >= 0 ? -1 : 1;
      }
      rots[i] += (targetFlip - rots[i]) * flipAlpha;
      rots[i] = clamp(rots[i], -1, 1);
      const moveYaw = Math.atan2(dirX, dirZ);
      const renderYaw = constrainYawForCamera(
        moveYaw,
        posX[i],
        posZ[i],
        lastCamera,
      );
      let renderPitch = 0;
      if (topViewBlend > 1e-5 && lastCamera) {
        const toCamX = lastCamera.position.x - posX[i];
        const toCamY = lastCamera.position.y - posY[i];
        const toCamZ = lastCamera.position.z - posZ[i];
        const horiz = Math.hypot(toCamX, toCamZ);
        const rawPitch = Math.atan2(toCamY, Math.max(1e-5, horiz));
        const pitchTarget =
          Math.max(0, rawPitch) * CFG.birdTopViewPitchStrength * topViewBlend;
        renderPitch = -Math.min(CFG.birdTopViewPitchMax, pitchTarget);
      }

      dummy.position.set(posX[i], posY[i], posZ[i]);
      dummy.rotation.set(renderPitch, renderYaw, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    if (lineCount > 0) updateAllLines();

    rotAttr.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    lineGeom.attributes.position.needsUpdate = true;
  }

  function toggle2DMode() {
    if (!lastCamera) return;
    if (transformState.mode === "world3d" || transformState.mode === "to3d") {
      beginTo2D(lastCamera);
      return;
    }
    beginTo3D(lastCamera);
  }

  function toggleScatterFlight() {
    if (transformState.mode === "scatter3d") {
      beginReturnFromScatter();
      return;
    }
    if (transformState.mode === "return3d") {
      triggerScatterFlight();
      return;
    }
    triggerScatterFlight();
  }

  function triggerScatterFlight() {
    transformState.mode = "scatter3d";
    transformState.timer = 0;
    transformState.reverseFly = false;
    visualScale = 1;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);

      const scatterSpeed = lerp(
        CFG.scatterSpeedMin,
        CFG.scatterSpeedMax,
        Math.random(),
      );
      scatterVelX[i] = dx * scatterSpeed;
      scatterVelY[i] = 0;
      scatterVelZ[i] = dz * scatterSpeed;
      faceDirX[i] = scatterVelX[i];
      faceDirZ[i] = scatterVelZ[i];
    }
  }

  function beginReturnFromScatter() {
    transformState.mode = "return3d";
    transformState.timer = 0;
  }

  function beginTo2D(cameraRef) {
    transformState.mode = "to2d";
    transformState.timer = 0;
    for (let i = 0; i < count; i++) {
      worldStartX[i] = posX[i];
      worldStartY[i] = posY[i];
      worldStartZ[i] = posZ[i];

      projectWorldToScreen(posX[i], posY[i], posZ[i], cameraRef, tmpProject);
      screenStartX[i] = tmpProject.x;
      screenStartY[i] = tmpProject.y;
      screenNowX[i] = screenStartX[i];
      screenNowY[i] = screenStartY[i];

      screenTargetX[i] =
        (Math.random() * 2 - 1) * CFG.bird2DScreenMarginX * 0.95;
      screenTargetY[i] =
        (Math.random() * 2 - 1) * CFG.bird2DScreenMarginY * 0.95;
    }
  }

  function beginTo3D(cameraRef) {
    const reverseFly = transformState.mode === "fly2d";
    transformState.mode = "return2d";
    transformState.timer = 0;
    transformState.reverseFly = reverseFly;
    for (let i = 0; i < count; i++) {
      projectWorldToScreen(posX[i], posY[i], posZ[i], cameraRef, tmpProject);
      screenStartX[i] = tmpProject.x;
      screenStartY[i] = tmpProject.y;
      if (reverseFly) {
        // Reverse the outbound 2D flight path back to where fly2d began.
        screenTargetX[i] = flyOriginX[i];
        screenTargetY[i] = flyOriginY[i];
      } else {
        screenTargetX[i] =
          (Math.random() * 2 - 1) * CFG.bird2DScreenMarginX * 0.62;
        screenTargetY[i] =
          (Math.random() * 2 - 1) * CFG.bird2DScreenMarginY * 0.62;
      }
      screenNowX[i] = screenStartX[i];
      screenNowY[i] = screenStartY[i];
    }
  }

  function updateTo2D(dt, cameraRef) {
    if (!cameraRef) return;
    transformState.timer += dt;
    const u = clamp01(transformState.timer / CFG.bird2DTransitionDuration);
    const e = easeInOutCubic(u);
    visualScale = lerp(1, CFG.bird2DVisualScale, e);

    for (let i = 0; i < count; i++) {
      screenNowX[i] = lerp(screenStartX[i], screenTargetX[i], e);
      screenNowY[i] = lerp(screenStartY[i], screenTargetY[i], e);
      screenToWorld(
        screenNowX[i] * CFG.bird2DScaleFactor,
        screenNowY[i] * CFG.bird2DScaleFactor,
        cameraRef,
        tmpProject,
      );

      posX[i] = lerp(worldStartX[i], tmpProject.x, e);
      posY[i] = lerp(worldStartY[i], tmpProject.y, e);
      posZ[i] = lerp(worldStartZ[i], tmpProject.z, e);
    }

    if (u >= 1) {
      transformState.mode = "fly2d";
      transformState.timer = 0;
      transformState.reverseFly = false;
      for (let i = 0; i < count; i++) {
        const ax = screenNowX[i];
        const ay = screenNowY[i];
        flyOriginX[i] = ax;
        flyOriginY[i] = ay;
        let angle = Math.atan2(ay, ax);
        if (!Number.isFinite(angle)) angle = Math.random() * Math.PI * 2;
        angle += (Math.random() * 2 - 1) * 0.45;
        const speed2d = lerp(
          CFG.bird2DFlySpeedMin,
          CFG.bird2DFlySpeedMax,
          Math.random(),
        );
        screenVelX[i] = Math.cos(angle) * speed2d;
        screenVelY[i] = Math.sin(angle) * speed2d;
      }
    }
  }

  function updateFly2D(dt, cameraRef) {
    if (!cameraRef) return;
    for (let i = 0; i < count; i++) {
      screenNowX[i] += screenVelX[i] * dt;
      screenNowY[i] += screenVelY[i] * dt;
      screenToWorld(
        screenNowX[i] * CFG.bird2DScaleFactor,
        screenNowY[i] * CFG.bird2DScaleFactor,
        cameraRef,
        tmpWorld,
      );
      posX[i] = tmpWorld.x;
      posY[i] = tmpWorld.y;
      posZ[i] = tmpWorld.z;
    }
  }

  function updateReturn2D(dt, cameraRef) {
    if (!cameraRef) return;
    let finished = true;
    if (!transformState.reverseFly) {
      transformState.timer += dt;
    }
    const u = clamp01(transformState.timer / CFG.bird2DReturn2DDuration);
    const e = easeOutBack(u);
    for (let i = 0; i < count; i++) {
      if (transformState.reverseFly) {
        const dx = screenTargetX[i] - screenNowX[i];
        const dy = screenTargetY[i] - screenNowY[i];
        const dist = Math.hypot(dx, dy);
        const speed2d = Math.hypot(screenVelX[i], screenVelY[i]);
        const step = speed2d * dt;
        if (dist <= Math.max(step, 1e-5)) {
          screenNowX[i] = screenTargetX[i];
          screenNowY[i] = screenTargetY[i];
        } else {
          const inv = 1 / dist;
          screenNowX[i] += dx * inv * step;
          screenNowY[i] += dy * inv * step;
          finished = false;
        }
      } else {
        screenNowX[i] = lerp(screenStartX[i], screenTargetX[i], e);
        screenNowY[i] = lerp(screenStartY[i], screenTargetY[i], e);
      }
      screenToWorld(
        screenNowX[i] * CFG.bird2DScaleFactor,
        screenNowY[i] * CFG.bird2DScaleFactor,
        cameraRef,
        tmpWorld,
      );
      posX[i] = tmpWorld.x;
      posY[i] = tmpWorld.y;
      posZ[i] = tmpWorld.z;
    }
    if ((!transformState.reverseFly && u >= 1) || (transformState.reverseFly && finished)) {
      transformState.mode = "to3d";
      transformState.timer = 0;
      transformState.reverseFly = false;
      for (let i = 0; i < count; i++) {
        worldStartX[i] = posX[i];
        worldStartY[i] = posY[i];
        worldStartZ[i] = posZ[i];
      }
    }
  }

  function updateTo3D(dt) {
    transformState.timer += dt;
    const u = clamp01(transformState.timer / CFG.bird2DReturn3DDuration);
    const e = easeInOutCubic(u);
    visualScale = lerp(CFG.bird2DVisualScale, 1, e);
    for (let i = 0; i < count; i++) {
      posX[i] = lerp(worldStartX[i], ringX[i], e);
      posY[i] = lerp(worldStartY[i], ringY[i], e);
      posZ[i] = lerp(worldStartZ[i], ringZ[i], e);
    }
    if (u >= 1) {
      transformState.mode = "world3d";
      transformState.timer = 0;
      for (let i = 0; i < count; i++) {
        posX[i] = ringX[i];
        posY[i] = ringY[i];
        posZ[i] = ringZ[i];
      }
    }
  }

  function updateScatter3D(dt) {
    const accelScale = 1 + CFG.scatterAccel * dt;
    for (let i = 0; i < count; i++) {
      posX[i] += scatterVelX[i] * dt;
      posY[i] += scatterVelY[i] * dt;
      posZ[i] += scatterVelZ[i] * dt;

      scatterVelX[i] *= accelScale;
      scatterVelY[i] *= accelScale;
      scatterVelZ[i] *= accelScale;
      faceDirX[i] = scatterVelX[i];
      faceDirZ[i] = scatterVelZ[i];
    }
  }

  function constrainYawForCamera(moveYaw, x, z, cameraRef) {
    if (!cameraRef) return moveYaw;
    const toCamX = cameraRef.position.x - x;
    const toCamZ = cameraRef.position.z - z;
    if (toCamX * toCamX + toCamZ * toCamZ < 1e-8) return moveYaw;

    const camYaw = Math.atan2(toCamX, toCamZ);
    const delta = shortestAngleDelta(moveYaw, camYaw);
    const clampedDelta = clamp(
      delta,
      -CFG.birdFacingMaxOffCameraYaw,
      CFG.birdFacingMaxOffCameraYaw,
    );
    return camYaw + clampedDelta;
  }

  function shortestAngleDelta(a, b) {
    const twoPi = Math.PI * 2;
    let d = (a - b) % twoPi;
    if (d > Math.PI) d -= twoPi;
    if (d < -Math.PI) d += twoPi;
    return d;
  }

  function updateReturnFromScatter3D(dt) {
    let allArrived = true;
    const distNormDen = Math.max(CFG.radius * 4.0, 1e-5);

    for (let i = 0; i < count; i++) {
      const dx = ringX[i] - posX[i];
      const dy = ringY[i] - posY[i];
      const dz = ringZ[i] - posZ[i];
      const dist = Math.hypot(dx, dy, dz);

      if (dist > CFG.scatterReturnSnapDistance) {
        allArrived = false;
        const speed = lerp(
          CFG.scatterReturnSpeedMin,
          CFG.scatterReturnSpeedMax,
          clamp01(dist / distNormDen),
        );
        const step = Math.min(dist, speed * dt);
        const inv = 1 / Math.max(dist, 1e-5);

        posX[i] += dx * inv * step;
        posY[i] += dy * inv * step;
        posZ[i] += dz * inv * step;
        faceDirX[i] = dx;
        faceDirZ[i] = dz;
      } else {
        posX[i] = ringX[i];
        posY[i] = ringY[i];
        posZ[i] = ringZ[i];
        faceDirX[i] = -Math.sin(theta[i]) * travelDirection;
        faceDirZ[i] = Math.cos(theta[i]) * travelDirection;
      }
    }

    if (allArrived) {
      transformState.mode = "world3d";
      transformState.timer = 0;
      for (let i = 0; i < count; i++) {
        posX[i] = ringX[i];
        posY[i] = ringY[i];
        posZ[i] = ringZ[i];
      }
    }
  }

  function screenToWorld(sx, sy, cameraRef, out) {
    out.set(sx, sy, CFG.bird2DScreenDepthNdc).unproject(cameraRef);
    return out;
  }

  function projectWorldToScreen(x, y, z, cameraRef, out) {
    out.set(x, y, z).project(cameraRef);
    return out;
  }

  function getRouteXZ(angle, morph, out) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const circleX = c * CFG.radius;
    const circleZ = s * CFG.radius;
    const maxAbs = Math.max(Math.abs(c), Math.abs(s), 1e-5);
    const squareX = (c / maxAbs) * CFG.radius;
    const squareZ = (s / maxAbs) * CFG.radius;
    out.x = lerp(circleX, squareX, morph);
    out.z = lerp(circleZ, squareZ, morph);
    return out;
  }

  function getShapePoint(i, angle, time, mode, out) {
    const flutterY =
      y0[i] + Math.sin(time * CFG.flutterSpeed + flutterPhase[i]) * CFG.flutter;

    if (mode === "double-cylinder") {
      const inner = innerRingMask[i] === 1;
      const radius = inner ? CFG.radius * CFG.shapeInnerRadiusFactor : CFG.radius;
      const rate = inner ? CFG.shapeInnerAngularRate : 1.0;
      const a = angle * rate;
      out.x = Math.cos(a) * radius;
      out.z = Math.sin(a) * radius;
      out.y = inner ? flutterY * CFG.shapeInnerHeightFactor : flutterY;
      return out;
    }

    if (mode === "mobius") {
      const u = angle * CFG.shapeMobiusAngularRate;
      const v = mobiusLane[i] * CFG.shapeMobiusHalfWidth;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cHalf = Math.cos(u * 0.5);
      const sHalf = Math.sin(u * 0.5);
      const bandR = CFG.radius * CFG.shapeMobiusRadiusFactor;
      const radial = bandR + v * cHalf;
      out.x = radial * cu;
      out.z = radial * su;
      out.y = v * sHalf + flutterY * CFG.shapeMobiusFlutterMix;
      return out;
    }

    const morph = mode === "cube" ? routeState.current : 0;
    getRouteXZ(angle, morph, out);
    out.y = flutterY;
    return out;
  }

  function toggleCylinderCubeRoute() {
    shapeState.index = shapeState.index === 3 ? 0 : 3;
  }

  function cycleRouteShape() {
    shapeState.index = (shapeState.index + 1) % SHAPE_MODES.length;
  }

  function randomizeConnections() {
    if (lineCount <= 0) return;
    const sideA = pickRandomIndices(count, lineCount);
    const sideAFlag = new Uint8Array(count);
    for (let i = 0; i < sideA.length; i++) sideAFlag[sideA[i]] = 1;
    const availableSideB = [];
    for (let candidate = 0; candidate < count; candidate++) {
      if (!sideAFlag[candidate]) availableSideB.push(candidate);
    }

    for (let slot = 0; slot < lineCount; slot++) {
      const aBird = sideA[slot];
      lineBirdA[slot] = aBird;

      if (availableSideB.length <= 0) {
        // Safety fallback; should not happen with current lineCount math.
        lineBirdB[slot] = aBird;
        continue;
      }

      const targetAngle = theta[aBird] + Math.PI;
      const oppositeCandidateSlots = [];
      for (let i = 0; i < availableSideB.length; i++) {
        const candidate = availableSideB[i];
        const distance = angularDistance(theta[candidate], targetAngle);
        if (distance <= Math.PI * 0.5) oppositeCandidateSlots.push(i);
      }

      let pickSlot = 0;
      if (oppositeCandidateSlots.length > 0) {
        pickSlot =
          oppositeCandidateSlots[
            (Math.random() * oppositeCandidateSlots.length) | 0
          ];
      } else {
        pickSlot = (Math.random() * availableSideB.length) | 0;
      }

      const bBird = availableSideB[pickSlot];
      lineBirdB[slot] = bBird;
      const last = availableSideB.length - 1;
      availableSideB[pickSlot] = availableSideB[last];
      availableSideB.pop();
    }

    updateAllLines();
  }

  function updateAllLines() {
    for (let slot = 0; slot < lineCount; slot++) {
      const base = slot * 6;
      const aBird = lineBirdA[slot];
      const bBird = lineBirdB[slot];
      if (aBird < 0 || aBird >= count || bBird < 0 || bBird >= count) {
        linePositions[base + 0] = 0;
        linePositions[base + 1] = 0;
        linePositions[base + 2] = 0;
        linePositions[base + 3] = 0;
        linePositions[base + 4] = 0;
        linePositions[base + 5] = 0;
        continue;
      }

      setLineEndpoint(base, aBird, posX[aBird], posY[aBird], posZ[aBird]);
      setLineEndpoint(base + 3, bBird, posX[bBird], posY[bBird], posZ[bBird]);
    }
  }

  function setLineEndpoint(base, birdIndex, x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      x = ringX[birdIndex];
      y = ringY[birdIndex];
      z = ringZ[birdIndex];
    }
    linePositions[base + 0] = x;
    linePositions[base + 1] = y;
    linePositions[base + 2] = z;
  }

  function updateLabels(cameraRef, width, height) {
    return;
  }

  function setLinesVisible(visible) {
    lines.visible = visible;
  }

  function setTint(color) {
    mat.uniforms.uTint.value.copy(color);
  }

  function setFacingDirection(direction) {
    const target = direction >= 0 ? 1.0 : -1.0;
    if (
      Math.abs(target - facingFlipState.current) < 1e-4 &&
      !facingFlipState.active
    ) {
      return;
    }
    facingFlipState.from = facingFlipState.current;
    facingFlipState.to = target;
    facingFlipState.elapsed = 0;
    facingFlipState.active = true;
  }

  function setAudioReactiveRotation(rms, crest, dt = 1 / 60) {
    const rmsTarget =
      rms > CFG.rmsRotateTrigger
        ? CFG.rmsRotateMaxAngle *
          clamp01(
            (rms - CFG.rmsRotateTrigger) /
              Math.max(1e-5, CFG.rmsRotateMax - CFG.rmsRotateTrigger),
          )
        : 0;
    const crestTarget =
      crest > CFG.crestYRotateTrigger
        ? CFG.crestYRotateMaxAngle *
          clamp01(
            (crest - CFG.crestYRotateTrigger) /
              Math.max(1e-5, CFG.crestYRotateMax - CFG.crestYRotateTrigger),
          )
        : 0;

    const rotAlpha = 1 - Math.exp(-CFG.rmsRotateResponse * Math.max(0, dt));
    const crestAlpha =
      1 - Math.exp(-CFG.crestYRotateResponse * Math.max(0, dt));
    const middleAlpha =
      1 - Math.exp(-CFG.middlePeakYRotateResponse * Math.max(0, dt));
    const middleDecay =
      1 - Math.exp(-CFG.middlePeakYRotateDecay * Math.max(0, dt));

    audioRotAmount += (rmsTarget - audioRotAmount) * rotAlpha;
    crestYRotAmount += (crestTarget - crestYRotAmount) * crestAlpha;
    middlePeakYRotTarget += (0 - middlePeakYRotTarget) * middleDecay;
    middlePeakYRotAmount +=
      (middlePeakYRotTarget - middlePeakYRotAmount) * middleAlpha;

    mat.uniforms.uAudioRot.value = audioRotAmount;
    mat.uniforms.uCrestYRot.value = crestYRotAmount + middlePeakYRotAmount;
  }

  function triggerMiddlePeakYRotation() {
    middlePeakYRotDir *= -1;
    const nextTarget = middlePeakYRotTarget + middlePeakYRotDir * CFG.middlePeakYRotateStep;
    middlePeakYRotTarget = clamp(
      nextTarget,
      -CFG.middlePeakYRotateMax,
      CFG.middlePeakYRotateMax,
    );
  }

  function randomizePerBirdRainbowColors() {
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const h = Math.random();
      const s = lerp(0.7, 1.0, Math.random());
      const l = lerp(0.42, 0.74, Math.random());
      color.setHSL(h, s, l);
      tintRgb[i * 3 + 0] = color.r;
      tintRgb[i * 3 + 1] = color.g;
      tintRgb[i * 3 + 2] = color.b;
    }
    tintAttr.needsUpdate = true;
    mat.uniforms.uTint.value.set(1, 1, 1);
  }

  function randomizePerBirdSingleHueFamilyShades() {
    const color = new THREE.Color();
    // Rainbow anchor hues: red, orange, yellow, green, blue, indigo, violet
    const anchors = [0.0, 0.08, 0.15, 0.33, 0.58, 0.71, 0.83];
    const base = anchors[(Math.random() * anchors.length) | 0];
    const spread = 0.045;

    for (let i = 0; i < count; i++) {
      const h = wrap01(base + (Math.random() * 2 - 1) * spread);
      const s = lerp(0.65, 1.0, Math.random());
      const l = lerp(0.4, 0.75, Math.random());
      color.setHSL(h, s, l);
      tintRgb[i * 3 + 0] = color.r;
      tintRgb[i * 3 + 1] = color.g;
      tintRgb[i * 3 + 2] = color.b;
    }
    tintAttr.needsUpdate = true;
    mat.uniforms.uTint.value.set(1, 1, 1);
  }

  function setBirdTintHsl(index, h, s, l) {
    const color = new THREE.Color();
    color.setHSL(wrap01(h), s, l);
    tintRgb[index * 3 + 0] = color.r;
    tintRgb[index * 3 + 1] = color.g;
    tintRgb[index * 3 + 2] = color.b;
  }

  function infectBirdWithCurrentHue(index) {
    if (infectionMask[index]) return false;
    infectionMask[index] = 1;
    infectedIndices.push(index);
    infectionState.infectedCount += 1;

    const h = infectionState.hue + (Math.random() * 2 - 1) * 0.03;
    const s = lerp(0.72, 1.0, Math.random());
    const l = lerp(0.42, 0.74, Math.random());
    setBirdTintHsl(index, h, s, l);
    return true;
  }

  function resetInfectionSeed(newHue) {
    infectionState.hue = wrap01(newHue);
    infectionMask.fill(0);
    infectedIndices.length = 0;
    infectionState.infectedCount = 0;

    const seed = (Math.random() * count) | 0;
    infectBirdWithCurrentHue(seed);
  }

  function advanceInfectionSpread() {
    if (count <= 0) return;

    if (infectionState.infectedCount <= 0) {
      resetInfectionSeed(Math.random());
      tintAttr.needsUpdate = true;
      mat.uniforms.uTint.value.set(1, 1, 1);
      return;
    }

    if (infectionState.infectedCount >= count) {
      // Start a new wave using the opposite hue on trigger after full infection.
      resetInfectionSeed(infectionState.hue + 0.5);
      tintAttr.needsUpdate = true;
      mat.uniforms.uTint.value.set(1, 1, 1);
      return;
    }

    const infectPerTrigger = 15;
    for (let n = 0; n < infectPerTrigger; n++) {
      if (infectionState.infectedCount >= count) break;

      let bestIndex = -1;
      let bestDistance2 = Infinity;

      for (let candidate = 0; candidate < count; candidate++) {
        if (infectionMask[candidate]) continue;

        let nearestDist2 = Infinity;
        const cx = posX[candidate];
        const cy = posY[candidate];
        const cz = posZ[candidate];

        for (let j = 0; j < infectedIndices.length; j++) {
          const infected = infectedIndices[j];
          const dx = cx - posX[infected];
          const dy = cy - posY[infected];
          const dz = cz - posZ[infected];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < nearestDist2) nearestDist2 = d2;
        }

        if (nearestDist2 < bestDistance2) {
          bestDistance2 = nearestDist2;
          bestIndex = candidate;
        }
      }

      if (bestIndex < 0) break;
      infectBirdWithCurrentHue(bestIndex);
    }

    tintAttr.needsUpdate = true;
    mat.uniforms.uTint.value.set(1, 1, 1);
  }

  return {
    mesh,
    lines,
    update,
    toggle2DMode,
    toggleScatterFlight,
    triggerScatterFlight,
    toggleCylinderCubeRoute,
    cycleRouteShape,
    randomizeConnections,
    updateLabels,
    setLinesVisible,
    setFacingDirection,
    setTint,
    randomizePerBirdRainbowColors,
    randomizePerBirdSingleHueFamilyShades,
    advanceInfectionSpread,
    setAudioReactiveRotation,
    triggerMiddlePeakYRotation,
    getAudioReactiveRotation: () => ({
      audioRotAmount,
      crestYRotAmount,
      middlePeakYRotAmount,
    }),
    getInfectionProgress: () => ({
      infectedCount: infectionState.infectedCount,
      totalCount: count,
      hue: infectionState.hue,
    }),
    getRouteShapeState: () => ({
      index: shapeState.index,
      mode: SHAPE_MODES[shapeState.index] || SHAPE_MODES[0],
    }),
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function angularDistance(a, b) {
  const twoPi = Math.PI * 2;
  let d = (a - b) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return Math.abs(d);
}

function createGrassTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#4f9d3f";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const c = 95 + ((Math.random() * 70) | 0);
    ctx.fillStyle = `rgb(${(c * 0.4) | 0},${c},${(c * 0.35) | 0})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  ctx.lineWidth = 1;
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 2 + Math.random() * 5;
    const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * 0.9;
    ctx.strokeStyle =
      Math.random() < 0.5 ? "rgba(200,255,170,0.12)" : "rgba(25,75,20,0.18)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

function pickRandomIndices(total, pickedCount) {
  const values = new Uint32Array(total);
  for (let i = 0; i < total; i++) values[i] = i;

  for (let i = 0; i < pickedCount; i++) {
    const j = i + ((Math.random() * (total - i)) | 0);
    const t = values[i];
    values[i] = values[j];
    values[j] = t;
  }

  return Array.from(values.subarray(0, pickedCount));
}

function createLowPolyTrees() {
  const trees = new THREE.Group();
  const placed = [];

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x7a4b2a,
    flatShading: true,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    opacity: 1,
  });
  const leavesMatA = new THREE.MeshStandardMaterial({
    color: 0x2e8a3e,
    flatShading: true,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    opacity: 1,
  });
  const leavesMatB = new THREE.MeshStandardMaterial({
    color: 0x3ca653,
    flatShading: true,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    opacity: 1,
  });

  const centerClearRadius = CFG.radius * 0.9;

  for (let i = 0; i < CFG.treeCount; i++) {
    let px = 0;
    let pz = 0;
    let found = false;

    for (let attempt = 0; attempt < 60; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = lerp(CFG.treeMinRadius, CFG.treeMaxRadius, Math.random());
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      if (Math.hypot(x, z) < centerClearRadius) continue;

      let tooClose = false;
      for (let j = 0; j < placed.length; j++) {
        if (Math.hypot(placed[j].x - x, placed[j].z - z) < CFG.treeMinSpacing) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      px = x;
      pz = z;
      found = true;
      break;
    }

    if (!found) continue;
    placed.push({ x: px, z: pz });

    const tree = new THREE.Group();
    const trunkHeight = lerp(0.9, 1.8, Math.random());
    const trunkRadiusTop = lerp(0.06, 0.09, Math.random());
    const trunkRadiusBottom = trunkRadiusTop * 1.35;
    const trunkGeo = new THREE.CylinderGeometry(
      trunkRadiusTop,
      trunkRadiusBottom,
      trunkHeight,
      5,
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkHeight * 0.5;
    tree.add(trunk);

    const crownHeight = lerp(1.0, 2.1, Math.random());
    const crownRadius = lerp(0.45, 0.85, Math.random());
    const crownGeo = new THREE.ConeGeometry(crownRadius, crownHeight, 5, 1);
    const crown = new THREE.Mesh(
      crownGeo,
      Math.random() < 0.5 ? leavesMatA : leavesMatB,
    );
    crown.position.y = trunkHeight + crownHeight * 0.5 - 0.05;
    crown.rotation.y = Math.random() * Math.PI * 2;
    tree.add(crown);

    if (Math.random() < 0.35) {
      const crown2 = new THREE.Mesh(
        new THREE.ConeGeometry(crownRadius * 0.72, crownHeight * 0.72, 5, 1),
        Math.random() < 0.5 ? leavesMatA : leavesMatB,
      );
      crown2.position.y = trunkHeight + crownHeight * 0.92;
      crown2.rotation.y = Math.random() * Math.PI * 2;
      tree.add(crown2);
    }

    tree.position.set(px, GROUND_Y, pz);
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.userData.baseScale = lerp(0.9, 1.2, Math.random());
    tree.scale.setScalar(tree.userData.baseScale);
    trees.add(tree);
  }

  trees.children.sort((a, b) => {
    const aa = Math.atan2(a.position.z, a.position.x);
    const bb = Math.atan2(b.position.z, b.position.x);
    return aa - bb;
  });

  trees.userData.materials = [trunkMat, leavesMatA, leavesMatB];
  return trees;
}

function createIntroWords(phrase) {
  const words = phrase.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const group = new THREE.Group();
  group.position.set(0, 0.1, 0);

  const entries = words.map((word) => {
    const tex = makeWordTexture(word);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);

    const baseHeight = 1.35;
    const baseWidth = baseHeight * (tex.image.width / tex.image.height);
    sprite.scale.set(0.001, 0.001, 1);
    group.add(sprite);

    return {
      sprite,
      mat,
      tex,
      baseWidth,
      baseHeight,
    };
  });

  let totalWidth = 0;
  for (let i = 0; i < entries.length; i++) {
    totalWidth += entries[i].baseWidth;
    if (i > 0) totalWidth += 0.28;
  }

  let cursor = -totalWidth * 0.5;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    cursor += e.baseWidth * 0.5;
    e.sprite.position.set(cursor, 0, 0);
    cursor += e.baseWidth * 0.5 + 0.28;
  }

  const wordDelay = 0.3;
  const popDuration = 0.55;
  const fadeDuration = 0.3;
  let startAt = 0;

  function clearWords() {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      e.sprite.scale.set(0.001, 0.001, 1);
      e.sprite.position.y = 0;
      e.mat.opacity = 0;
    }
  }

  function update(time) {
    const elapsed = time - startAt;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const local = elapsed - i * wordDelay;

      if (local <= 0) {
        e.sprite.scale.set(0.001, 0.001, 1);
        e.mat.opacity = 0;
        continue;
      }

      const pPop = clamp01(local / popDuration);
      const pFade = clamp01(local / fadeDuration);
      const pop = easeOutBack(pPop);

      const sx = e.baseWidth * pop;
      const sy = e.baseHeight * pop;
      e.sprite.scale.set(sx, sy, 1);
      e.mat.opacity = pFade;
      e.sprite.position.y = Math.sin(elapsed * 1.6 + i * 0.45) * 0.03;
    }
  }

  function restart(now = 0) {
    startAt = now;
    clearWords();
  }

  clearWords();
  return { group, update, restart };
}

function makeWordTexture(word) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const fontSize = 160;
  const paddingX = 64;
  const paddingY = 40;
  const font = `700 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.font = font;
  const textWidth = Math.ceil(ctx.measureText(word).width);
  const w = textWidth + paddingX * 2;
  const h = fontSize + paddingY * 2;

  canvas.width = w;
  canvas.height = h;
  const c2 = canvas.getContext("2d");
  c2.font = font;
  c2.textAlign = "center";
  c2.textBaseline = "middle";
  c2.lineJoin = "round";
  c2.lineWidth = 14;
  c2.strokeStyle = "rgba(0, 0, 0, 0.55)";
  c2.fillStyle = "#ffffff";
  c2.strokeText(word, w * 0.5, h * 0.54);
  c2.fillText(word, w * 0.5, h * 0.54);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function easeInBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * t * t * t - c1 * t * t;
}

function easeInOutCubic(t) {
  if (t < 0.5) return 4 * t * t * t;
  return 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function setupAudio() {
  if (!audioState.flight) {
    const flight = new Audio("/flight.mp3");
    flight.loop = true;
    flight.preload = "auto";
    flight.volume = CFG.flightMinVolume;
    audioState.flightVolumeCurrent = CFG.flightMinVolume;
    audioState.flight = flight;
  }

  if (!audioState.shangri) {
    const shangri = new Audio("/shangri-la.mp3");
    shangri.preload = "auto";
    shangri.loop = false;
    shangri.volume = 1.0;
    audioState.shangri = shangri;
  }

  void tryStartFlight();
}

async function tryStartFlight() {
  if (!audioState.flight) return;
  try {
    await audioState.flight.play();
  } catch {
    armFlightUnlock();
  }
}

function armFlightUnlock() {
  if (audioState.unlockArmed) return;
  audioState.unlockArmed = true;

  const unlock = async () => {
    if (!audioState.flight) return;
    try {
      await audioState.flight.play();
      cleanup();
    } catch {
      // Keep listeners until user interaction succeeds.
    }
  };

  const cleanup = () => {
    audioState.unlockArmed = false;
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function updateFlightVolume() {
  if (!audioState.flight) return;

  const dist = camera.position.distanceTo(controls.target);
  const range = Math.max(0.001, controls.maxDistance - controls.minDistance);
  const nearFactor = clamp01((controls.maxDistance - dist) / range);
  const targetVolume = lerp(
    CFG.flightMinVolume,
    CFG.flightMaxVolume,
    nearFactor,
  );

  audioState.flightVolumeCurrent +=
    (targetVolume - audioState.flightVolumeCurrent) * CFG.flightVolumeLerp;
  audioState.flight.volume = audioState.flightVolumeCurrent;
}

async function playShangriLa(reset = true) {
  if (!audioState.shangri) return;
  await ensureAudioAnalysisGraph();
  if (reset) {
    audioState.shangri.currentTime = 0;
  }
  try {
    await audioState.shangri.play();
  } catch (err) {
    console.warn("Could not start shangri-la.mp3 playback:", err);
  }
}

function setupAudioAnalysisUI() {
  if (analysisState.ui) return;

  const root = document.createElement("aside");
  Object.assign(root.style, {
    position: "fixed",
    left: "10px",
    top: "10px",
    width: "340px",
    maxHeight: "92vh",
    overflowY: "auto",
    background: "rgba(0,0,0,0.52)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "10px",
    padding: "10px",
    color: "#e8f4ff",
    font: "12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    pointerEvents: "none",
    zIndex: "20",
    backdropFilter: "blur(2px)",
  });

  const title = document.createElement("div");
  title.textContent = "audio analysis | shangri-la.mp3";
  title.style.fontWeight = "700";
  title.style.marginBottom = "6px";
  root.appendChild(title);

  const status = document.createElement("div");
  status.textContent = "Status: waiting for G key";
  status.style.color = "#a7d6ff";
  status.style.marginBottom = "6px";
  root.appendChild(status);

  const waveCanvas = document.createElement("canvas");
  waveCanvas.width = 320;
  waveCanvas.height = 72;
  waveCanvas.style.width = "320px";
  waveCanvas.style.height = "72px";
  waveCanvas.style.display = "block";
  waveCanvas.style.border = "1px solid rgba(255,255,255,0.15)";
  waveCanvas.style.marginBottom = "6px";
  root.appendChild(waveCanvas);

  const specCanvas = document.createElement("canvas");
  specCanvas.width = 320;
  specCanvas.height = 110;
  specCanvas.style.width = "320px";
  specCanvas.style.height = "110px";
  specCanvas.style.display = "block";
  specCanvas.style.border = "1px solid rgba(255,255,255,0.15)";
  specCanvas.style.marginBottom = "8px";
  root.appendChild(specCanvas);

  const bandsTitle = document.createElement("div");
  bandsTitle.textContent = "band energy";
  bandsTitle.style.fontWeight = "700";
  bandsTitle.style.marginBottom = "4px";
  root.appendChild(bandsTitle);

  const bandRows = ANALYSIS_BANDS.map((band) => {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "grid",
      gridTemplateColumns: "58px 1fr 48px",
      alignItems: "center",
      gap: "6px",
      marginBottom: "3px",
    });

    const name = document.createElement("div");
    name.textContent = band.label;
    row.appendChild(name);

    const track = document.createElement("div");
    Object.assign(track.style, {
      height: "7px",
      borderRadius: "999px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(255,255,255,0.05)",
      overflow: "hidden",
    });
    const fill = document.createElement("div");
    Object.assign(fill.style, {
      width: "0%",
      height: "100%",
      background: "#79c5ff",
    });
    track.appendChild(fill);
    row.appendChild(track);

    const value = document.createElement("div");
    value.textContent = "0.00";
    value.style.textAlign = "right";
    row.appendChild(value);

    root.appendChild(row);
    return { fill, value };
  });

  const metrics = document.createElement("pre");
  Object.assign(metrics.style, {
    margin: "8px 0 0 0",
    whiteSpace: "pre-wrap",
    color: "#ffffff",
  });
  root.appendChild(metrics);

  document.body.appendChild(root);
  ensureCenterLoudnessDisplay();

  analysisState.ui = {
    root,
    status,
    waveCanvas,
    waveCtx: waveCanvas.getContext("2d"),
    specCanvas,
    specCtx: specCanvas.getContext("2d"),
    bandRows,
    metrics,
    lastTextUpdate: 0,
  };
}

function ensureCenterLoudnessDisplay() {
  if (analysisState.centerLoudnessDisplay) return analysisState.centerLoudnessDisplay;

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    alphaTest: 0.06,
    opacity: 0.82,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(0, 0, 0);
  // Keep this below birds (mesh.renderOrder = 2) so front birds naturally cover it.
  sprite.renderOrder = 1;
  // Half-sized compared to the previous center text pass.
  sprite.scale.set(1.7, 0.85, 1);
  scene.add(sprite);

  const display = {
    canvas,
    ctx,
    texture,
    material,
    sprite,
    value: "",
  };
  analysisState.centerLoudnessDisplay = display;
  drawCenterLoudnessText(display, "0.0");
  return display;
}

function drawCenterLoudnessText(display, value) {
  const text = `${value}`;
  display.value = text;

  const { canvas, ctx, texture } = display;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.font = "600 148px Helvetica Neue, Helvetica, Arial, sans-serif";
  ctx.lineWidth = 9;
  ctx.strokeStyle = "rgba(0,0,0,0.36)";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const x = w * 0.5;
  const y = h * 0.54;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  texture.needsUpdate = true;
}

function setCenterLoudnessText(value) {
  const display = ensureCenterLoudnessDisplay();
  if (!display) return;
  const text = `${value}`;
  if (display.value === text) return;
  drawCenterLoudnessText(display, text);
}

async function ensureAudioAnalysisGraph() {
  if (analysisState.initialized) {
    if (analysisState.context?.state === "suspended") {
      await analysisState.context.resume();
    }
    return;
  }
  if (!audioState.shangri) return;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  const context = analysisState.context || new AudioCtx();
  analysisState.context = context;
  if (context.state === "suspended") await context.resume();

  const source = context.createMediaElementSource(audioState.shangri);
  const analyser = context.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.75;
  analyser.minDecibels = -100;
  analyser.maxDecibels = -10;

  source.connect(analyser);
  analyser.connect(context.destination);

  analysisState.source = source;
  analysisState.analyser = analyser;
  analysisState.freqDb = new Float32Array(analyser.frequencyBinCount);
  analysisState.timeData = new Float32Array(analyser.fftSize);
  analysisState.linearMag = new Float32Array(analyser.frequencyBinCount);
  analysisState.prevLinearMag = new Float32Array(analyser.frequencyBinCount);
  analysisState.bands = ANALYSIS_BANDS.map((b) => ({ ...b, value: 0 }));
  analysisState.peaks = [];
  analysisState.fluxAvg = 0;
  analysisState.fluxVar = 0;
  analysisState.onsetTimes = [];
  analysisState.bpm = 0;
  analysisState.prevSubValue = 0;
  analysisState.was1336InRange = false;
  analysisState.prevDominantHz = NaN;
  analysisState.was47InRange = false;
  analysisState.prevMiddlePeakHz = NaN;
  analysisState.middlePeakBottomHits = 0;
  analysisState.initialized = true;
}

function updateAudioAnalysis(dt, t) {
  const ui = analysisState.ui;
  if (!ui) return;
  ensureCenterLoudnessDisplay();

  const song = audioState.shangri;
  if (!analysisState.initialized || !analysisState.analyser || !song) {
    if (birdSystem && typeof birdSystem.setAudioReactiveRotation === "function") {
      birdSystem.setAudioReactiveRotation(0, 0, dt);
    }
    setCenterLoudnessText("0.0");
    ui.status.textContent = "Status: waiting for G key";
    clearAnalysisCanvases();
    hideBandRows();
    return;
  }

  const analyser = analysisState.analyser;
  analyser.getFloatFrequencyData(analysisState.freqDb);
  analyser.getFloatTimeDomainData(analysisState.timeData);

  const sampleRate = analysisState.context.sampleRate;
  const binCount = analysisState.freqDb.length;
  const nyquist = sampleRate * 0.5;
  const binHz = nyquist / binCount;

  let rmsAcc = 0;
  let peak = 0;
  let zcr = 0;
  for (let i = 0; i < analysisState.timeData.length; i++) {
    const v = analysisState.timeData[i];
    rmsAcc += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
    if (
      i > 0 &&
      ((analysisState.timeData[i - 1] >= 0 && v < 0) ||
        (analysisState.timeData[i - 1] < 0 && v >= 0))
    ) {
      zcr++;
    }
  }
  const rms = Math.sqrt(rmsAcc / analysisState.timeData.length);
  const crest = peak / Math.max(1e-6, rms);
  const loudnessDb = 20 * Math.log10(Math.max(1e-7, rms));
  const zcrNorm = zcr / analysisState.timeData.length;
  setCenterLoudnessText(
    Number.isFinite(loudnessDb) ? loudnessDb.toFixed(1) : "0.0",
  );

  if (birdSystem && typeof birdSystem.setAudioReactiveRotation === "function") {
    birdSystem.setAudioReactiveRotation(rms, crest, dt);
  }

  let magSum = 0;
  let weightedFreq = 0;
  let weightedFreq2 = 0;
  let strongestMag = 0;
  let strongestBin = 0;
  let flux = 0;
  let geoLogSum = 0;
  const eps = 1e-10;
  const peaks = [];

  for (let i = 0; i < binCount; i++) {
    const db = analysisState.freqDb[i];
    const mag = db <= -100 ? 0 : Math.pow(10, db / 20);
    const freq = i * binHz;
    const prev = analysisState.prevLinearMag[i];

    analysisState.linearMag[i] = mag;
    if (mag > prev) flux += mag - prev;
    analysisState.prevLinearMag[i] = mag;

    magSum += mag;
    weightedFreq += freq * mag;
    weightedFreq2 += freq * freq * mag;
    geoLogSum += Math.log(mag + eps);

    if (mag > strongestMag) {
      strongestMag = mag;
      strongestBin = i;
    }
    if (i > 2 && i < binCount - 2) {
      if (
        mag > analysisState.linearMag[i - 1] &&
        mag > analysisState.linearMag[i + 1] &&
        freq >= 30 &&
        freq <= 16000
      ) {
        peaks.push({ freq, mag });
      }
    }
  }
  const dominantHz = strongestBin * binHz;

  const centroid = magSum > 0 ? weightedFreq / magSum : 0;
  const spread =
    magSum > 0
      ? Math.sqrt(Math.max(0, weightedFreq2 / magSum - centroid * centroid))
      : 0;
  const flatness =
    Math.exp(geoLogSum / binCount) / Math.max(eps, magSum / binCount);

  let cumulative = 0;
  const target = magSum * 0.85;
  let rolloff = 0;
  for (let i = 0; i < binCount; i++) {
    cumulative += analysisState.linearMag[i];
    if (cumulative >= target) {
      rolloff = i * binHz;
      break;
    }
  }

  const bandValues = {};
  for (const band of analysisState.bands) {
    const i0 = Math.max(0, Math.floor(band.low / binHz));
    const i1 = Math.min(binCount - 1, Math.ceil(band.high / binHz));
    let acc = 0;
    for (let i = i0; i <= i1; i++) {
      const p = analysisState.linearMag[i];
      acc += p * p;
    }
    const energy = Math.sqrt(acc / Math.max(1, i1 - i0 + 1));
    band.value += (energy - band.value) * 0.2;
    bandValues[band.key] = band.value;
  }

  const in1336Window =
    Math.abs(dominantHz - CFG.directionTriggerHz) <=
    CFG.directionTriggerToleranceHz;
  if (in1336Window && !analysisState.was1336InRange) {
    toggleTravelDirection();
  }
  analysisState.was1336InRange = in1336Window;

  const in47Window =
    Math.abs(dominantHz - CFG.perBirdColorTriggerHz) <=
    CFG.perBirdColorTriggerToleranceHz;
  const isDescendingAt47 =
    Number.isFinite(analysisState.prevDominantHz) &&
    dominantHz < analysisState.prevDominantHz;
  if (in47Window && isDescendingAt47 && !analysisState.was47InRange) {
    triggerBirdColorChange();
  }
  analysisState.was47InRange = in47Window;
  analysisState.prevDominantHz = dominantHz;

  const subValue = bandValues.sub || 0;
  if (
    analysisState.prevSubValue < CFG.subColorTriggerThreshold &&
    subValue >= CFG.subColorTriggerThreshold
  ) {
    triggerBirdColorChange();
  }
  analysisState.prevSubValue = subValue;

  const fluxNorm = flux / binCount;
  analysisState.fluxAvg += (fluxNorm - analysisState.fluxAvg) * 0.08;
  const fluxDelta = fluxNorm - analysisState.fluxAvg;
  analysisState.fluxVar +=
    (fluxDelta * fluxDelta - analysisState.fluxVar) * 0.08;
  const fluxStd = Math.sqrt(Math.max(1e-8, analysisState.fluxVar));
  const onsetThreshold = analysisState.fluxAvg + fluxStd * 1.8;
  const lastOnset =
    analysisState.onsetTimes.length > 0
      ? analysisState.onsetTimes[analysisState.onsetTimes.length - 1]
      : -999;
  const isOnset = fluxNorm > onsetThreshold && t - lastOnset > 0.12;
  if (isOnset) analysisState.onsetTimes.push(t);
  while (
    analysisState.onsetTimes.length > 0 &&
    t - analysisState.onsetTimes[0] > 18
  ) {
    analysisState.onsetTimes.shift();
  }
  if (analysisState.onsetTimes.length >= 4) {
    const intervals = [];
    for (let i = 1; i < analysisState.onsetTimes.length; i++) {
      intervals.push(
        analysisState.onsetTimes[i] - analysisState.onsetTimes[i - 1],
      );
    }
    intervals.sort((a, b) => a - b);
    const mid = intervals[(intervals.length / 2) | 0];
    if (mid > 1e-3) {
      const bpmRaw = clamp(60 / mid, 50, 220);
      analysisState.bpm += (bpmRaw - analysisState.bpm) * 0.12;
    }
  }

  peaks.sort((a, b) => b.mag - a.mag);
  analysisState.peaks = peaks.slice(0, 5);
  const middlePeakHz =
    analysisState.peaks.length >= 3 ? analysisState.peaks[2].freq : NaN;
  const middlePeakBottomTriggered =
    Number.isFinite(middlePeakHz) &&
    Number.isFinite(analysisState.prevMiddlePeakHz) &&
    analysisState.prevMiddlePeakHz > CFG.middlePeakBottomTriggerHz &&
    middlePeakHz <= CFG.middlePeakBottomTriggerHz;
  if (middlePeakBottomTriggered) {
    analysisState.middlePeakBottomHits += 1;
    if (
      birdSystem &&
      typeof birdSystem.triggerMiddlePeakYRotation === "function"
    ) {
      birdSystem.triggerMiddlePeakYRotation();
    }
  }
  analysisState.prevMiddlePeakHz = middlePeakHz;

  drawWaveform(ui.waveCtx, ui.waveCanvas, analysisState.timeData);
  drawSpectrum(ui.specCtx, ui.specCanvas, analysisState.freqDb, sampleRate);
  updateBandRows(ui.bandRows, analysisState.bands);

  const playing = !song.paused && !song.ended;
  const duration = Number.isFinite(song.duration) ? song.duration : 0;
  const position = Number.isFinite(song.currentTime) ? song.currentTime : 0;
  ui.status.textContent = `Status: ${playing ? "playing" : "idle"} | ${formatClock(position)} / ${formatClock(duration)}`;

  if (t - ui.lastTextUpdate > 0.05) {
    ui.lastTextUpdate = t;
    const layerIndex = clamp01(
      (bandValues.mid * 0.35 +
        bandValues.highmid * 0.35 +
        bandValues.air * 0.3) *
        4.5,
    );

    const peakSummary =
      analysisState.peaks.length > 0
        ? analysisState.peaks.map((p) => `${Math.round(p.freq)}Hz`).join(", ")
        : "n/a";
    const colorMode = getColorMode();
    const infectionProgress =
      colorMode === "infection" &&
      birdSystem &&
      typeof birdSystem.getInfectionProgress === "function"
        ? birdSystem.getInfectionProgress()
        : null;
    const reactiveRot =
      birdSystem && typeof birdSystem.getAudioReactiveRotation === "function"
        ? birdSystem.getAudioReactiveRotation()
        : null;
    const routeShapeState =
      birdSystem && typeof birdSystem.getRouteShapeState === "function"
        ? birdSystem.getRouteShapeState()
        : null;

    ui.metrics.textContent =
      `rms: ${rms.toFixed(4)}\n` +
      `peak: ${peak.toFixed(4)}\n` +
      `crest factor: ${crest.toFixed(2)}\n` +
      `rms rot trigger: ${CFG.rmsRotateTrigger.toFixed(2)} (${rms >= CFG.rmsRotateTrigger ? "active" : "off"})\n` +
      `crest y trigger: ${CFG.crestYRotateTrigger.toFixed(2)} (${crest >= CFG.crestYRotateTrigger ? "active" : "off"})\n` +
      `${
        reactiveRot
          ? `bird z-rot: ${((reactiveRot.audioRotAmount * 180) / Math.PI).toFixed(2)} deg\nbird y-rot: ${((reactiveRot.crestYRotAmount * 180) / Math.PI).toFixed(2)} deg\nmiddle trig y-add: ${((reactiveRot.middlePeakYRotAmount * 180) / Math.PI).toFixed(2)} deg\n`
          : ""
      }` +
      `loudness (dBFS): ${loudnessDb.toFixed(1)}\n` +
      `zcr: ${zcrNorm.toFixed(4)}\n` +
      `spectral centroid: ${Math.round(centroid)} Hz\n` +
      `spectral spread: ${Math.round(spread)} Hz\n` +
      `rolloff 85%: ${Math.round(rolloff)} Hz\n` +
      `spectral flatness: ${flatness.toFixed(4)}\n` +
      `spectral flux: ${fluxNorm.toFixed(6)}\n` +
      `onset threshold: ${onsetThreshold.toFixed(6)}\n` +
      `bpm estimate: ${analysisState.bpm > 0 ? analysisState.bpm.toFixed(1) : "n/a"}\n` +
      `dominant frequency: ${Math.round(dominantHz)} Hz\n` +
      `middle peak (top5 #3): ${Number.isFinite(middlePeakHz) ? Math.round(middlePeakHz) : "n/a"} Hz\n` +
      `middle 270Hz bottom trigger: ${middlePeakBottomTriggered ? "hit" : "off"} (${analysisState.middlePeakBottomHits})\n` +
      `${routeShapeState ? `route shape: ${routeShapeState.mode}\n` : ""}` +
      `1336 trigger window: ${in1336Window ? "hit" : "off"}\n` +
      `47Hz down-trigger window: ${in47Window ? (isDescendingAt47 ? "descending hit" : "in-range") : "off"}\n` +
      `color mode: ${colorMode}\n` +
      `${infectionProgress ? `infection progress: ${infectionProgress.infectedCount}/${infectionProgress.totalCount}\n` : ""}` +
      `sub energy: ${subValue.toFixed(4)}\n` +
      `layer index: ${layerIndex.toFixed(3)}\n` +
      `band ratio bass/mid: ${(bandValues.bass / Math.max(1e-6, bandValues.mid)).toFixed(3)}\n` +
      `top peaks: ${peakSummary}`;
  }
}

function drawWaveform(ctx, canvas, data) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "rgba(10,16,28,0.95)";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);
  ctx.lineTo(w, h * 0.5);
  ctx.stroke();

  ctx.strokeStyle = "#8fe7ff";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const idx = Math.floor((x / w) * data.length);
    const y = h * 0.5 - data[idx] * (h * 0.42);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawSpectrum(ctx, canvas, freqDb, sampleRate) {
  const w = canvas.width;
  const h = canvas.height;
  const binCount = freqDb.length;
  const nyquist = sampleRate * 0.5;
  ctx.fillStyle = "rgba(10,16,28,0.95)";
  ctx.fillRect(0, 0, w, h);

  const bars = 72;
  for (let i = 0; i < bars; i++) {
    const f0 = (Math.pow(nyquist, i / bars) * 20) / Math.pow(20, i / bars); // keeps scale stable
    const f1 =
      (Math.pow(nyquist, (i + 1) / bars) * 20) / Math.pow(20, (i + 1) / bars);
    const hz0 = clamp(f0, 20, nyquist);
    const hz1 = clamp(f1, hz0 + 1, nyquist);
    const i0 = Math.max(0, Math.floor((hz0 / nyquist) * binCount));
    const i1 = Math.min(binCount - 1, Math.ceil((hz1 / nyquist) * binCount));

    let db = -100;
    for (let j = i0; j <= i1; j++) db = Math.max(db, freqDb[j]);
    const norm = clamp01((db + 100) / 90);
    const barH = norm * (h - 4);

    const x = (i / bars) * w;
    const bw = w / bars - 1;
    const hue = 190 - norm * 35;
    ctx.fillStyle = `hsla(${hue}, 90%, 70%, 0.9)`;
    ctx.fillRect(x, h - barH - 1, bw, barH);
  }
}

function updateBandRows(rows, bands) {
  let maxVal = 1e-6;
  for (const band of bands) maxVal = Math.max(maxVal, band.value);
  const scale = 1 / maxVal;

  for (let i = 0; i < bands.length; i++) {
    const v = bands[i].value * scale;
    const pct = clamp01(Math.sqrt(v)) * 100;
    rows[i].fill.style.width = `${pct.toFixed(1)}%`;
    rows[i].value.textContent = bands[i].value.toFixed(3);
  }
}

function clearAnalysisCanvases() {
  const ui = analysisState.ui;
  if (!ui) return;
  ui.waveCtx.fillStyle = "rgba(10,16,28,0.95)";
  ui.waveCtx.fillRect(0, 0, ui.waveCanvas.width, ui.waveCanvas.height);
  ui.specCtx.fillStyle = "rgba(10,16,28,0.95)";
  ui.specCtx.fillRect(0, 0, ui.specCanvas.width, ui.specCanvas.height);
  if (ui.metrics)
    ui.metrics.textContent = "Press G to play and start analysis...";
}

function hideBandRows() {
  const ui = analysisState.ui;
  if (!ui) return;
  for (const row of ui.bandRows) {
    row.fill.style.width = "0%";
    row.value.textContent = "0.000";
  }
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function triggerBirdColorChange() {
  if (!birdSystem) return;
  const mode = getColorMode();
  if (mode === "rainbow") {
    if (birdSystem.randomizePerBirdRainbowColors) {
      birdSystem.randomizePerBirdRainbowColors();
    }
    return;
  }
  if (mode === "infection") {
    if (birdSystem.advanceInfectionSpread) {
      birdSystem.advanceInfectionSpread();
    }
    return;
  }
  if (birdSystem.randomizePerBirdSingleHueFamilyShades) {
    birdSystem.randomizePerBirdSingleHueFamilyShades();
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function wrap01(v) {
  let out = v % 1;
  if (out < 0) out += 1;
  return out;
}
