// geolib is loaded via UMD and exposed as global `geolib`
// We use:
//   - geolib.getGreatCircleBearing({latitude,longitude}, {latitude,longitude})
//   - geolib.getDistance({latitude,longitude}, {latitude,longitude})

const LS_TARGET = "compass_target_v3";
const LS_PEER_ID = "compass_peer_id";
const LS_SESSION_ID = "compass_session_id";

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
let heartbeatInterval = null;
let lastPos = null;            // {latitude, longitude}
let lastHeading = null;        // 0..360
let orientationHandler = null;
let toastTimer = null;
let isFinding = false;

// Peer-to-peer state
let peer = null;
let peerConnection = null;
let myPeerId = null;
let remotePeerId = null;
let lastSyncTime = 0;
const SYNC_INTERVAL = 1000;    // Send coordinates every 1 second

// Connection retry state
let connectionRetryCount = 0;
const MAX_RETRIES = 10;
let connectionRetryTimer = null;

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

  // Check for peer ID in query params
  const peerIdParam = url.searchParams.get("peer");

  if (peerIdParam) {
    // Initialize our peer and connect to the shared peer
    if (!peer) {
      initializePeer();
    }
    // Give peer server time to initialize (2 seconds)
    setTimeout(() => {
      connectToPeer(peerIdParam);
      logStatus(`Attempting to connect to peer from link: ${peerIdParam.substring(0, 20)}...`);
    }, 2000);
  }

  // Clear query params without reloading
  url.search = "";
  window.history.replaceState({}, "", url.toString());
}

// --- share link ---
function buildShareUrl() {
  if (!myPeerId) {
    initializePeer();
  }

  const url = new URL(window.location.href);
  url.searchParams.set("peer", myPeerId);
  // Remove any old coordinate params
  url.searchParams.delete("lat");
  url.searchParams.delete("lon");
  url.searchParams.delete("latitude");
  url.searchParams.delete("longitude");
  url.searchParams.delete("lng");
  return url.toString();
}

async function shareLink() {
  if (!myPeerId) {
    initializePeer();
  }

  const url = buildShareUrl();
  if (!url) {
    logStatus("Peer ID not available. Cannot share.");
    return;
  }

  // Native share (mobile) if available
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Find You - Compass",
        text: "Open this link to connect and share real-time location:",
        url,
      });
      logStatus("Shared peer link via native share sheet.");
      return;
    } catch (e) {
      logStatus(`Share canceled/failed: ${e.message || String(e)}`);
    }
  }

  // Fallback: copy
  await copyToClipboard(url);
  showToast("Link copied to clipboard");
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

// --- peer functions ---
function generateSessionId() {
  return Math.random().toString(36).substring(2, 8);
}

function generatePeerId(sessionId) {
  // Use the sessionId as our peer ID - both peers in same session use different partIDs
  return `find-you-${sessionId}-${Math.random().toString(36).substring(2, 8)}`;
}

function initializePeer() {
  if (peer) return;

  // Generate or load peer ID
  let sessionId = localStorage.getItem(LS_SESSION_ID);
  if (!sessionId) {
    sessionId = generateSessionId();
    localStorage.setItem(LS_SESSION_ID, sessionId);
  }

  myPeerId = generatePeerId(sessionId);
  localStorage.setItem(LS_PEER_ID, myPeerId);

  peer = new Peer(myPeerId, {});

  peer.on("open", (id) => {
    logStatus(`Peer initialized: ${id.substring(0, 20)}...`);
  });

  peer.on("connection", handleIncomingConnection);

  peer.on("error", (err) => {
    logStatus(`Peer error: ${err.message || String(err)}`);
  });

  peer.on("disconnected", () => {
    logStatus("Peer disconnected from signaling server.");
    // Attempt to reconnect
    if (peer) {
      peer.reconnect();
    }
  });
}

function handleIncomingConnection(conn) {
  if (peerConnection && peerConnection.open) {
    conn.close();
    return;
  }

  peerConnection = conn;
  remotePeerId = conn.peer;

  conn.on("open", () => {
    logStatus(`Connected to peer: ${remotePeerId.substring(0, 20)}...`);
    // Once connected, fill the partner's displayed ID
    updateDisplay();
  });

  conn.on("data", (data) => {
    handlePeerMessage(data);
  });

  conn.on("close", () => {
    peerConnection = null;
    setChip(permChip, "idle");
    logStatus("Peer connection closed.");
    updateDisplay();
  });

  conn.on("error", (err) => {
    logStatus(`Peer connection error: ${err.message || String(err)}`);
  });
}

function connectToPeer(peerId) {
  if (!peer) {
    initializePeer();
  }

  if (peerConnection && peerConnection.open) {
    logStatus("Already connected to a peer.");
    return;
  }

  remotePeerId = peerId;
  connectionRetryCount = 0;
  attemptConnection();
}

function attemptConnection() {
  if (!peer || !remotePeerId) return;

  peerConnection = peer.connect(remotePeerId);

  peerConnection.on("open", () => {
    connectionRetryCount = 0;
    if (connectionRetryTimer) {
      clearTimeout(connectionRetryTimer);
      connectionRetryTimer = null;
    }
    setChip(permChip, "ok");
    logStatus(`Connected to peer: ${remotePeerId.substring(0, 20)}...`);
    updateDisplay();
  });

  peerConnection.on("data", (data) => {
    handlePeerMessage(data);
  });

  peerConnection.on("close", () => {
    peerConnection = null;
    setChip(permChip, "idle");
    logStatus("Peer connection closed.");
    updateDisplay();
  });

  peerConnection.on("error", (err) => {
    setChip(permChip, "bad");
    const errMsg = err.message || String(err);
    logStatus(`Peer connection error: ${errMsg}`);

    // Retry with exponential backoff
    if (connectionRetryCount < MAX_RETRIES) {
      connectionRetryCount++;
      const delay = Math.min(1000 * Math.pow(1.5, connectionRetryCount - 1), 10000);
      logStatus(`Retrying connection in ${Math.round(delay / 1000)}s (attempt ${connectionRetryCount}/${MAX_RETRIES})...`);
      connectionRetryTimer = setTimeout(() => {
        if (remotePeerId && !peerConnection) {
          attemptConnection();
        }
      }, delay);
    } else {
      logStatus("Max connection retries reached. Please refresh and try again.");
    }
  });
}

function handlePeerMessage(data) {
  try {
    if (data.type === "coordinates" && data.latitude != null && data.longitude != null) {
      // Update target with partner's coordinates
      target = { latitude: data.latitude, longitude: data.longitude };
      logStatus(`Received coordinates from peer: ${fmtCoords(target)}`);
      updateDisplay();
    } else if (data.type === "heartbeat") {
      // Heartbeat received, connection is alive
      // No action needed, just acknowledge receipt
    }
  } catch (error) {
    logStatus(`Error handling peer message: ${error.message}`);
  }
}

function sendCoordinatesToPeer() {
  if (!peerConnection || !peerConnection.open || !lastPos) {
    return;
  }

  const now = Date.now();
  if (now - lastSyncTime < SYNC_INTERVAL) {
    return;
  }

  try {
    peerConnection.send({
      type: "coordinates",
      latitude: lastPos.latitude,
      longitude: lastPos.longitude,
      timestamp: now
    });
    lastSyncTime = now;
  } catch (error) {
    logStatus(`Error sending coordinates: ${error.message}`);
  }
}

function sendHeartbeat() {
  if (!peerConnection || !peerConnection.open) {
    return;
  }

  try {
    peerConnection.send({
      type: "heartbeat",
      timestamp: Date.now()
    });
  } catch (error) {
    // Silently fail for heartbeats
  }
}

// --- display ---
function updateDisplay() {
  headingVal.textContent = fmtDeg(lastHeading);
  myCoordsVal.textContent = fmtCoords(lastPos);

  const maybeTarget = currentTargetFromInputs() || target;
  
  // If we have a synced target from peer, show that even if inputs are empty
  if (target && (!tLat.value && !tLon.value)) {
    partnerCoordsVal.textContent = fmtCoords(target);
  } else {
    partnerCoordsVal.textContent = fmtCoords(maybeTarget);
  }
  
  if (!maybeTarget || !lastPos) {
    bearingVal.textContent = "—";
    deltaVal.textContent = "—";
    distVal.textContent = "—";
    arrow.style.transform = `translate(-50%, -92%) rotate(0deg)`;
    return;
  }

  // Check if geolib is available
  if (typeof geolib === 'undefined' || !geolib.getGreatCircleBearing || !geolib.getDistance) {
    bearingVal.textContent = "—";
    distVal.textContent = "—";
    deltaVal.textContent = "—";
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
      // Send coordinates to peer
      sendCoordinatesToPeer();
      updateDisplay();
    },
    (err) => {
      setChip(locChip, "bad");
      logStatus(`Geolocation error: ${err.message}`);
    },
    { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 }
  );

  // Send heartbeat every 5 seconds to keep connection alive
  heartbeatInterval = setInterval(sendHeartbeat, 5000);

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
      // Send coordinates to peer
      sendCoordinatesToPeer();
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
  if (heartbeatInterval != null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
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

  // Check if geolib loaded
  if (typeof geolib === 'undefined') {
    logStatus("ERROR: geolib library failed to load. Please refresh the page.");
    console.error("geolib is not defined. Check if the script is loading correctly.");
  } else {
    logStatus("geolib library loaded successfully.");
  }

  // Initialize peer
  initializePeer();

  // Update display when user edits inputs
  [tLat, tLon].forEach((el) => el.addEventListener("input", updateDisplay));

  // 1) Fetch location once on page load
  getCurrentPositionOnce();

  // 2) If URL has ?peer=.., apply + connect
  applyQueryParamsThenClear();

  // 3) If no query params were used, load stored target into inputs
  if (!tLat.value && !tLon.value) {
    setTargetUIFromStored();
  }

  updateDisplay();
  setFindingUi(false);
})();
