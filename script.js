// --- Storage keys ---
const LS_TARGET = "compass_target_v1";

// --- DOM ---
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

// --- State ---
let target = loadTarget();               // {lat, lon} or null
let watchId = null;                      // geolocation watch
let lastPos = null;                      // {lat, lon}
let lastHeading = null;                  // degrees 0..360
let orientationHandler = null;

// --- Utils (math) ---
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

// Normalize to [0, 360)
function norm360(deg) {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

// Smallest signed angle from a to b in degrees (-180..180]
function signedDelta(fromDeg, toDegVal) {
  const d = norm360(toDegVal) - norm360(fromDeg);
  const wrapped = ((d + 540) % 360) - 180;
  return wrapped;
}

// Initial bearing from (lat1,lon1) to (lat2,lon2) in degrees 0..360
function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return norm360(toDeg(Math.atan2(y, x)));
}

// Haversine distance in meters
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

// --- UI helpers ---
function logStatus(msg) {
  const ts = new Date().toLocaleTimeString();
  statusEl.textContent = `[${ts}] ${msg}\n` + statusEl.textContent;
}

function setTargetUI() {
  if (target) {
    tLat.value = String(target.lat);
    tLon.value = String(target.lon);
    logStatus(`Loaded target: ${target.lat}, ${target.lon}`);
  } else {
    logStatus("No saved target.");
  }
}

function fmtDeg(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return `${x.toFixed(1)}°`;
}

function fmtM(m) {
  if (m == null || Number.isNaN(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function updateDisplay() {
  headingVal.textContent = fmtDeg(lastHeading);

  if (!target || !lastPos) {
    bearingVal.textContent = "—";
    deltaVal.textContent = "—";
    distVal.textContent = "—";
    arrow.style.transform = `translate(-50%, -92%) rotate(0deg)`;
    return;
  }

  const b = bearing(lastPos.lat, lastPos.lon, target.lat, target.lon);
  const d = distanceMeters(lastPos.lat, lastPos.lon, target.lat, target.lon);

  bearingVal.textContent = fmtDeg(b);
  distVal.textContent = fmtM(d);

  if (lastHeading == null) {
    deltaVal.textContent = "—";
    return;
  }

  // We want arrow to point toward target relative to current heading:
  // If heading=0 and bearing=90 => turn +90 (arrow points right/east)
  const delta = signedDelta(lastHeading, b);
  deltaVal.textContent = `${delta.toFixed(1)}°`;

  arrow.style.transform = `translate(-50%, -92%) rotate(${delta}deg)`;
}

// --- Local storage ---
function loadTarget() {
  try {
    const raw = localStorage.getItem(LS_TARGET);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!Number.isFinite(obj.lat) || !Number.isFinite(obj.lon)) return null;
    return { lat: obj.lat, lon: obj.lon };
  } catch {
    return null;
  }
}

function saveTarget(lat, lon) {
  target = { lat, lon };
  localStorage.setItem(LS_TARGET, JSON.stringify(target));
  logStatus(`Saved target: ${lat}, ${lon}`);
  updateDisplay();
}

// --- Geolocation ---
function startGeolocation() {
  if (!("geolocation" in navigator)) {
    logStatus("Geolocation not supported.");
    return;
  }

  if (watchId != null) return;

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      updateDisplay();
    },
    (err) => {
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
    logStatus("Geolocation watch stopped.");
  }
}

// --- Compass / Orientation ---
async function requestOrientationPermissionIfNeeded() {
  // iOS Safari requires explicit permission gate
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;

  if (typeof DOE.requestPermission === "function") {
    const res = await DOE.requestPermission();
    if (res !== "granted") {
      throw new Error("Device orientation permission denied.");
    }
  }
}

function startOrientation() {
  if (!("DeviceOrientationEvent" in window)) {
    logStatus("DeviceOrientation not supported.");
    return;
  }
  if (orientationHandler) return;

  orientationHandler = (event) => {
    // iOS provides webkitCompassHeading (0..360, already “north = 0”)
    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
      lastHeading = norm360(event.webkitCompassHeading);
    } else if (event.alpha !== null && event.alpha !== undefined) {
      // On many Android browsers, alpha is rotation around Z axis.
      // Convert to compass-like heading: 0 = north.
      lastHeading = norm360(360 - event.alpha);
    } else {
      lastHeading = null;
    }

    updateDisplay();
  };

  // "deviceorientationabsolute" when available, else fallback
  const evt = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(evt, orientationHandler, true);
  logStatus(`Orientation listener started (${evt}).`);
}

function stopOrientation() {
  if (!orientationHandler) return;
  const evt = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
  window.removeEventListener(evt, orientationHandler, true);
  orientationHandler = null;
  lastHeading = null;
  logStatus("Orientation listener stopped.");
  updateDisplay();
}

// --- Buttons ---
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

useMyLocBtn.addEventListener("click", async () => {
  if (!("geolocation" in navigator)) {
    logStatus("Geolocation not supported.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      tLat.value = String(lat);
      tLon.value = String(lon);
      saveTarget(lat, lon);
    },
    (err) => logStatus(`Geolocation error: ${err.message}`),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

startBtn.addEventListener("click", async () => {
  try {
    await requestOrientationPermissionIfNeeded();
    startOrientation();
    startGeolocation();
    logStatus("Sensors started.");
  } catch (e) {
    logStatus(`Start failed: ${e.message || String(e)}`);
  }
});

stopBtn.addEventListener("click", () => {
  stopOrientation();
  stopGeolocation();
  logStatus("Stopped.");
});

// --- Init ---
setTargetUI();
updateDisplay();
