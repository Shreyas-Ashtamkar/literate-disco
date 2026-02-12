// Uses geolib (UMD) exposed as global `geolib`
// Docs: geolib.getGreatCircleBearing, geolib.getDistance

const LS_TARGET = "compass_target_v2";

// DOM
const tLat = document.getElementById("tLat");
const tLon = document.getElementById("tLon");
const saveBtn = document.getElementById("saveBtn");
const useMyLocBtn = document.getElementById("useMyLocBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

const arrow = document.getElementById("arrow");
const headingVal = document.getElementById("headingVal");
const bearingVal = document.getElementById("bearingVal");
const deltaVal = document.getElementById("deltaVal");
const distVal = document.getElementById("distVal");
const statusEl = document.getElementById("status");

const secureChip = document.getElementById("secureChip");
const permChip = document.getElementById("permChip");
const locChip = document.getElementById("locChip");

// State
let target = loadTarget();     // {latitude, longitude} or null (geolib expects these keys)
let watchId = null;
let lastPos = null;            // {latitude, longitude}
let lastHeading = null;        // 0..360
let orientationHandler = null;

// --- helpers ---
const norm360 = (deg) => {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
};

// (-180..180]
function signedDelta(fromDeg, toDeg) {
  const d = norm360(toDeg) - norm360(fromDeg);
  return ((d + 540) % 360) - 180;
}

function fmtDeg(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return `${x.toFixed(1)}°`;
}

function fmtDist(meters) {
  if (meters == null || Number.isNaN(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function logStatus(msg) {
  const ts = new Date().toLocaleTimeString();
  statusEl.textContent = `[${ts}] ${msg}\n` + statusEl.textContent;
}

function setChip(el, state, text) {
  el.classList.remove("ok", "bad");
  if (state === "ok") el.classList.add("ok");
  if (state === "bad") el.classList.add("bad");
  if (text) el.textContent = text;
}

// --- local storage ---
function loadTarget() {
  try {
    const raw = localStorage.getItem(LS_TARGET);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!Number.isFinite(obj.latitude) || !Number.isFinite(obj.longitude)) return null;
    return obj;
  } catch {
    return null;
  }
}

function saveTarget(lat, lon) {
  target = { latitude: lat, longitude: lon };
  localStorage.setItem(LS_TARGET, JSON.stringify(target));
  logStatus(`Saved target: ${lat}, ${lon}`);
  updateDisplay();
}

function setTargetUI() {
  if (!target) return;
  tLat.value = String(target.latitude);
  tLon.value = String(target.longitude);
  logStatus(`Loaded target: ${target.latitude}, ${target.longitude}`);
}

// --- display ---
function updateDisplay() {
  headingVal.textContent = fmtDeg(lastHeading);

  if (!target || !lastPos) {
    bearingVal.textContent = "—";
    deltaVal.textContent = "—";
    distVal.textContent = "—";
    arrow.style.transform = `translate(-50%, -92%) rotate(0deg)`;
    return;
  }

  // geolib outputs bearing in degrees (0..360)
  const b = geolib.getGreatCircleBearing(lastPos, target);
  const d = geolib.getDistance(lastPos, target);

  bearingVal.textContent = fmtDeg(b);
  distVal.textContent = fmtDist(d);

  if (lastHeading == null) {
    deltaVal.textContent = "—";
    return;
  }

  const delta = signedDelta(lastHeading, b);
  deltaVal.textContent = `${delta.toFixed(1)}°`;

  // rotate arrow by relative turn angle
  arrow.style.transform = `translate(-50%, -92%) rotate(${delta}deg)`;
}

// --- geolocation ---
function startGeolocation() {
  if (!("geolocation" in navigator)) {
    setChip(locChip, "bad", "Location ✗");
    logStatus("Geolocation not supported.");
    return;
  }
  if (watchId != null) return;

  setChip(locChip, null, "Location …");

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPos = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setChip(locChip, "ok", "Location ✓");
      updateDisplay();
    },
    (err) => {
      setChip(locChip, "bad", "Location ✗");
      logStatus(`Geolocation error: ${err.message}`);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 500,
      timeout: 15000,
    }
  );

  logStatus("Geolocation watch started.");
}

function stopGeolocation() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setChip(locChip, null, "Location");
    logStatus("Geolocation watch stopped.");
  }
}

// --- orientation / compass ---
async function requestOrientationPermissionIfNeeded() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;

  // iOS permission gate
  if (typeof DOE.requestPermission === "function") {
    const res = await DOE.requestPermission();
    if (res !== "granted") throw new Error("Device orientation permission denied.");
  }
}

function startOrientation() {
  if (!("DeviceOrientationEvent" in window)) {
    setChip(permChip, "bad", "Sensors ✗");
    logStatus("DeviceOrientation not supported.");
    return;
  }
  if (orientationHandler) return;

  const evt = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
  setChip(permChip, null, "Sensors …");

  orientationHandler = (event) => {
    // iOS: webkitCompassHeading is true compass heading
    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
      lastHeading = norm360(event.webkitCompassHeading);
      setChip(permChip, "ok", "Sensors ✓");
      updateDisplay();
      return;
    }

    // Android-ish: alpha (0..360). Often needs conversion.
    if (event.alpha !== null && event.alpha !== undefined) {
      lastHeading = norm360(360 - event.alpha);
      setChip(permChip, "ok", "Sensors ✓");
      updateDisplay();
      return;
    }

    lastHeading = null;
    setChip(permChip, "bad", "Sensors ✗");
    updateDisplay();
  };

  window.addEventListener(evt, orientationHandler, true);
  logStatus(`Orientation listener started (${evt}).`);
}

function stopOrientation() {
  if (!orientationHandler) return;
  const evt = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
  window.removeEventListener(evt, orientationHandler, true);
  orientationHandler = null;
  lastHeading = null;
  setChip(permChip, null, "Sensors");
  logStatus("Orientation listener stopped.");
  updateDisplay();
}

// --- buttons ---
saveBtn.addEventListener("click", () => {
  const lat = Number(tLat.value.trim());
  const lon = Number(tLon.value.trim());

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    logStatus("Invalid target lat/lon.");
    return;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    logStatus("Target lat/lon out of range.");
    return;
  }
  saveTarget(lat, lon);
});

useMyLocBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    logStatus("Geolocation not supported.");
    return;
  }
  setChip(locChip, null, "Location …");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      tLat.value = String(lat);
      tLon.value = String(lon);
      saveTarget(lat, lon);
      setChip(locChip, "ok", "Location ✓");
    },
    (err) => {
      setChip(locChip, "bad", "Location ✗");
      logStatus(`Geolocation error: ${err.message}`);
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

startBtn.addEventListener("click", async () => {
  try {
    await requestOrientationPermissionIfNeeded();
    startOrientation();
    startGeolocation();
    logStatus("Started.");
  } catch (e) {
    setChip(permChip, "bad", "Sensors ✗");
    logStatus(`Start failed: ${e.message || String(e)}`);
  }
});

stopBtn.addEventListener("click", () => {
  stopOrientation();
  stopGeolocation();
  logStatus("Stopped.");
});

// --- init ---
(function init() {
  const isSecure = window.isSecureContext || location.hostname === "localhost";
  setChip(secureChip, isSecure ? "ok" : "bad", isSecure ? "HTTPS ✓" : "HTTPS ✗");

  setTargetUI();
  updateDisplay();
})();
