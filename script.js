// geolib is loaded via UMD and exposed as global `geolib`
// We use:
//   - geolib.getGreatCircleBearing({latitude,longitude}, {latitude,longitude})
//   - geolib.getDistance({latitude,longitude}, {latitude,longitude})

const LS_TARGET = "compass_target_v3";

// DOM
const tLat = document.getElementById("tLat");
const tLon = document.getElementById("tLon");

const findBtn = document.getElementById("findBtn");
const shareTopBtn = document.getElementById("shareTopBtn");
const editPartnerBtn = document.getElementById("editPartnerBtn");
const refreshMyLocBtn = document.getElementById("refreshMyLocBtn");
const partnerModal = document.getElementById("partnerModal");
const closePartnerModal = document.getElementById("closePartnerModal");
const savePartnerBtn = document.getElementById("savePartnerBtn");

const arrow = document.getElementById("arrow");
const headingVal = document.getElementById("headingVal");
const bearingVal = document.getElementById("bearingVal");
const deltaVal = document.getElementById("deltaVal");
const distVal = document.getElementById("distVal");
const statusEl = document.getElementById("status");
const myCoordsVal = document.getElementById("myCoordsVal");
const partnerCoordsVal = document.getElementById("partnerCoordsVal");
const toastEl = document.getElementById("toast");

const secureChip = document.getElementById("secureChip");
const permChip = document.getElementById("permChip");
const locChip = document.getElementById("locChip");

// State
let target = loadTarget();     // {latitude, longitude} or null
let watchId = null;
let lastPos = null;            // {latitude, longitude}
let lastHeading = null;        // 0..360
let orientationHandler = null;
let toastTimer = null;
let isFinding = false;

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

function fmtCoords(pos) {
  if (!pos) return "—";
  const lat = Number(pos.latitude);
  const lon = Number(pos.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function logStatus(msg) {
  const ts = new Date().toLocaleTimeString();
  statusEl.textContent = `[${ts}] ${msg}\n` + statusEl.textContent;
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("show");
  }, 1600);
}

function setChip(el, state) {
  el.classList.remove("ok", "bad");
  if (state === "ok") el.classList.add("ok");
  if (state === "bad") el.classList.add("bad");

  const key = state || "idle";
  const icon = el.dataset[key] || el.dataset.idle || "";
  if (icon) el.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
}

function currentTargetFromInputs() {
  const lat = Number(tLat.value.trim());
  const lon = Number(tLon.value.trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: lat, longitude: lon };
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

function saveTarget(lat, lon, alsoFillInputs = true) {
  target = { latitude: lat, longitude: lon };
  localStorage.setItem(LS_TARGET, JSON.stringify(target));
  if (alsoFillInputs) {
    tLat.value = String(lat);
    tLon.value = String(lon);
  }
  logStatus(`Saved target: ${lat}, ${lon}`);
  updateDisplay();
}

function setTargetUIFromStored() {
  if (!target) return;
  tLat.value = String(target.latitude);
  tLon.value = String(target.longitude);
  logStatus(`Loaded target: ${target.latitude}, ${target.longitude}`);
}

// --- query params: read then clear ---
function applyQueryParamsThenClear() {
  const url = new URL(window.location.href);

  // Accept lat/lon OR latitude/longitude
  const latRaw = url.searchParams.get("lat") ?? url.searchParams.get("latitude");
  const lonRaw = url.searchParams.get("lon") ?? url.searchParams.get("lng") ?? url.searchParams.get("longitude");

  if (latRaw == null || lonRaw == null) return;

  const lat = Number(latRaw);
  const lon = Number(lonRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    logStatus("Query params present but invalid. Ignored.");
    // still clear them to avoid persistent junk
    url.search = "";
    window.history.replaceState({}, "", url.toString());
    return;
  }

  // Save + fill inputs
  saveTarget(lat, lon, true);
  logStatus("Target loaded from URL params.");

  // Clear query params without reloading
  url.search = "";
  window.history.replaceState({}, "", url.toString());
  logStatus("Cleared URL query params.");
}

// --- share link ---
function buildShareUrl() {
  if (!lastPos) return null;

  const url = new URL(window.location.href);
  url.searchParams.set("lat", String(lastPos.latitude));
  url.searchParams.set("lon", String(lastPos.longitude));
  return url.toString();
}

async function shareLink() {
  if (!lastPos) {
    logStatus("Fetching location...");
    await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          lastPos = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          setChip(locChip, "ok");
          updateDisplay();
          resolve();
        },
        (err) => {
          setChip(locChip, "bad");
          logStatus(`Location fetch failed: ${err.message}`);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  const url = buildShareUrl();
  if (!url) {
    logStatus("Location not available. Cannot share.");
    return;
  }

  // Native share (mobile) if available
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Compass → Target",
        text: "Open this to set the target automatically:",
        url,
      });
      logStatus("Shared via native share sheet.");
      return;
    } catch (e) {
      logStatus(`Share canceled/failed: ${e.message || String(e)}`);
    }
  }

  // Fallback: copy
  await copyToClipboard(url);
  logStatus("Share not available; copied link instead.");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // iOS sometimes hates navigator.clipboard unless user-gesture + https, so fallback:
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

async function copyMyCoords() {
  if (!lastPos) {
    logStatus("Location not available yet. Start to get coordinates.");
    return;
  }

  const coordsText = fmtCoords(lastPos);
  if (coordsText === "—") {
    logStatus("Coordinates invalid. Try again.");
    return;
  }

  await copyToClipboard(coordsText);
  showToast("Copied coordinates");
  logStatus("Copied my coordinates to clipboard.");
}

// --- display ---
function updateDisplay() {
  headingVal.textContent = fmtDeg(lastHeading);
  myCoordsVal.textContent = fmtCoords(lastPos);

  const maybeTarget = currentTargetFromInputs() || target;
  partnerCoordsVal.textContent = fmtCoords(maybeTarget);
  if (!maybeTarget || !lastPos) {
    bearingVal.textContent = "—";
    deltaVal.textContent = "—";
    distVal.textContent = "—";
    arrow.style.transform = `translate(-50%, -92%) rotate(0deg)`;
    return;
  }

  let b, d;
  try {
    b = geolib.getGreatCircleBearing(lastPos, maybeTarget);
    d = geolib.getDistance(lastPos, maybeTarget);
  } catch (e) {
    logStatus(`Error calculating bearing/distance: ${e.message}`);
    bearingVal.textContent = "—";
    distVal.textContent = "—";
    deltaVal.textContent = "—";
    return;
  }

  bearingVal.textContent = fmtDeg(b);
  distVal.textContent = fmtDist(d);

  if (lastHeading == null) {
    deltaVal.textContent = "—";
    return;
  }

  const delta = signedDelta(lastHeading, b);
  deltaVal.textContent = `${delta.toFixed(1)}°`;
  const angle = Math.round(delta * 100) / 100;
  arrow.style.transform = 'translate(-50%, -92%) rotate(' + angle + 'deg)';
}

// --- geolocation ---
function startGeolocation() {
  if (!("geolocation" in navigator)) {
    setChip(locChip, "bad");
    logStatus("Geolocation not supported.");
    return;
  }
  if (watchId != null) return;

  setChip(locChip, "pending");

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPos = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setChip(locChip, "ok");
      updateDisplay();
    },
    (err) => {
      setChip(locChip, "bad");
      logStatus(`Geolocation error: ${err.message}`);
    },
    { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 }
  );

  logStatus("Geolocation watch started.");
}

function getCurrentPositionOnce() {
  if (!("geolocation" in navigator)) {
    setChip(locChip, "bad");
    logStatus("Geolocation not supported.");
    return;
  }

  setChip(locChip, "pending");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastPos = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setChip(locChip, "ok");
      updateDisplay();
      logStatus("Location updated.");
    },
    (err) => {
      setChip(locChip, "bad");
      logStatus(`Location fetch failed: ${err.message}`);
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

function stopGeolocation() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setChip(locChip, null);
    logStatus("Geolocation watch stopped.");
  }
}

// --- orientation / compass ---
async function requestOrientationPermissionIfNeeded() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;

  if (typeof DOE.requestPermission === "function") {
    const res = await DOE.requestPermission();
    if (res !== "granted") throw new Error("Device orientation permission denied.");
  }
}

function startOrientation() {
  if (!("DeviceOrientationEvent" in window)) {
    setChip(permChip, "bad");
    logStatus("DeviceOrientation not supported.");
    return;
  }
  if (orientationHandler) return;

  const evt = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
  setChip(permChip, "pending");

  orientationHandler = (event) => {
    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
      lastHeading = norm360(event.webkitCompassHeading);
      setChip(permChip, "ok");
      updateDisplay();
      return;
    }
    if (event.alpha !== null && event.alpha !== undefined) {
      lastHeading = norm360(360 - event.alpha);
      setChip(permChip, "ok");
      updateDisplay();
      return;
    }
    lastHeading = null;
    setChip(permChip, "bad");
    updateDisplay();
  };

  window.addEventListener(evt, orientationHandler);
  logStatus(`Orientation listener started (${evt}).`);
}

function stopOrientation() {
  if (!orientationHandler) return;
  const evt = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";
  window.removeEventListener(evt, orientationHandler);
  orientationHandler = null;
  lastHeading = null;
  setChip(permChip, null);
  logStatus("Orientation listener stopped.");
  updateDisplay();
}

function setFindingUi(active) {
  if (!findBtn) return;
  isFinding = active;
  findBtn.classList.toggle("ghost", active);
  findBtn.classList.toggle("primary", !active);
  findBtn.innerHTML = active
    ? "<i class=\"fa-solid fa-stop btn-ico\" aria-hidden=\"true\"></i><span class=\"btn-text\">Stop</span>"
    : "<i class=\"fa-solid fa-location-arrow btn-ico\" aria-hidden=\"true\"></i><span class=\"btn-text\">Find</span>";
}

// --- buttons ---
findBtn.addEventListener("click", async () => {
  if (isFinding) {
    stopOrientation();
    stopGeolocation();
    setFindingUi(false);
    logStatus("Stopped.");
    return;
  }

  try {
    await requestOrientationPermissionIfNeeded();
    startOrientation();
    startGeolocation();
    setFindingUi(true);
    logStatus("Started.");
  } catch (e) {
    setChip(permChip, "bad");
    logStatus(`Start failed: ${e.message || String(e)}`);
  }
});

// --- modal controls ---
function openPartnerModal() {
  if (partnerModal) partnerModal.classList.add("show");
}

function closePartnerModalFn() {
  if (partnerModal) partnerModal.classList.remove("show");
}

editPartnerBtn.addEventListener("click", openPartnerModal);
closePartnerModal.addEventListener("click", closePartnerModalFn);
partnerModal.addEventListener("click", (e) => {
  if (e.target === partnerModal) closePartnerModalFn();
});

savePartnerBtn.addEventListener("click", () => {
  const t = currentTargetFromInputs();
  if (!t) {
    logStatus("Invalid target lat/lon.");
    return;
  }
  saveTarget(t.latitude, t.longitude, true);
  closePartnerModalFn();
});

// --- log visibility ---
permChip.addEventListener("click", () => {
  const logDrop = document.querySelector(".log-drop");
  if (logDrop) logDrop.toggleAttribute("open");
});

locChip.addEventListener("click", () => {
  const logDrop = document.querySelector(".log-drop");
  if (logDrop) logDrop.toggleAttribute("open");
});

shareTopBtn.addEventListener("click", shareLink);

refreshMyLocBtn.addEventListener("click", getCurrentPositionOnce);

myCoordsVal.addEventListener("click", copyMyCoords);
myCoordsVal.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    copyMyCoords();
  }
});

// --- init ---
(function init() {
  const isSecure = window.isSecureContext || location.hostname === "localhost";
  setChip(secureChip, isSecure ? "ok" : "bad");

  // Update display when user edits inputs
  [tLat, tLon].forEach((el) => el.addEventListener("input", updateDisplay));

  // 1) Fetch location once on page load
  getCurrentPositionOnce();

  // 2) If URL has ?lat=..&lon=.., apply + save + clear params
  applyQueryParamsThenClear();

  // 3) If no query params were used, load stored target into inputs
  if (!tLat.value && !tLon.value) {
    setTargetUIFromStored();
  }

  updateDisplay();
  setFindingUi(false);
})();
