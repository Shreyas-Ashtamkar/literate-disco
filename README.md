# 💕 Find You - Valentine Compass

A real-time peer-to-peer location-sharing compass application that helps two people find each other. Both devices will point directly at each other when held flat, creating a beautiful "compass to love" experience.

**Perfect for:** Couples who want to know where each other is and which direction to head towards each other.

---

## ✨ Features

- **🧭 Real-Time Bearing Calculation**: Shows the compass direction to your partner
- **📍 Live Location Sharing**: GPS coordinates sync automatically between devices via peer-to-peer connection
- **🔒 Privacy-First**: No server storage—data flows directly between devices
- **📡 Peer-to-Peer Detection**: Auto-connect via shared link with unique peer IDs
- **⚡ Real-Time Updates**: Coordinates sync every 1 second when moving
- **📊 Distance Calculation**: See how far apart you are (meters/kilometers)
- **🧭 Turn Indicator**: Shows how much to turn left/right to face your partner
- **❤️ Connection Status**: Visual indicators for HTTPS, GPS, Compass, and P2P connection

---

## 🎯 How It Works: The Magic Behind "Find You"

### 1. **Device Setup & Peer ID Generation**

When you first open the app:
- A **unique Peer ID** is generated for your device (stored in localStorage)
- The ID format: `find-you-{sessionId}-{randomId}` (e.g., `find-you-w7j9wk-t7isey`)
- You initialize a **PeerJS connection** to the global signaling server
- Your device is now "listening" for incoming connections from partners

**Log**: `[12:24:29 PM] Peer initialized: find-you-ijri48-eupl...`

### 2. **Sharing Your Peer ID**

When you click the **Share button** (top-right):
- Your Peer ID is embedded in a URL query parameter: `?peer=find-you-ijri48-eupl...`
- The URL is shared via:
  - Native Web Share API (mobile) → share sheet
  - Fallback to clipboard copy (if Web Share unavailable)
- Your partner receives this link and opens it

### 3. **Connecting to Your Partner**

When your partner opens the shared link:
1. The URL parameter `?peer=find-you-ijri48-eupl...` is extracted
2. Their device initializes PeerJS and attempts to connect to your Peer ID
3. **Automatic Retry with Exponential Backoff**:
   - Tries up to 10 times with increasing delays
   - Delay formula: `1s × 1.5^(attempt-1)` (max 10 seconds)
   - Shows retry attempts in the log: `Retrying connection in 3s (attempt 2/10)...`

**Log example**:
```
[12:24:29 PM] Attempting to connect to peer from link: find-you-ijri48-eupl...
[12:24:30 PM] Peer connection error: Could not connect to peer
[12:24:31 PM] Retrying connection in 1s (attempt 1/10)...
[12:24:33 PM] Retrying connection in 2s (attempt 2/10)...
[12:24:36 PM] Connected to peer: find-you-ijri48-eupl...
```

### 4. **Real-Time Location Syncing**

Once connected, the real magic happens:

#### **Your Location (GPS)**
```
[GPS] Fetched location: 40.71280, -74.00601
[GPS] Updated my location: 40.71281, -74.00602
```
- Your device's GPS updates are captured every 500ms (when moving)
- Coordinates are constantly being used in calculations

#### **Sending to Partner (P2P)**
```
[P2P] Sent my location: 40.71281, -74.00602
[P2P] Sent my location: 40.71282, -74.00603
```
- Every 1 second (SYNC_INTERVAL), your GPS coordinates are sent via P2P connection
- Heartbeat signals sent every 5 seconds to keep connection alive
- Message format:
  ```json
  {
    "type": "coordinates",
    "latitude": 40.71281,
    "longitude": -74.00602,
    "timestamp": 1708000000000
  }
  ```

#### **Receiving Partner's Location (P2P)**
```
[P2P] Received coordinates: 40.71500, -74.00400
```
- When your partner's coordinates arrive, your `target` object updates
- These coordinates are **prioritized** over manually entered ones
- Modal inputs auto-populate when opened, showing current synced data

### 5. **Bearing Calculation & Compass Direction**

This is where the "pointing to each other" magic happens:

```javascript
// Your device calculates:
bearing = geolib.getGreatCircleBearing(
  myLocation,      // Your GPS coordinates
  partnerLocation  // Partner's synced coordinates
)
```

**Example:**
- You are at: (40.7128°N, 74.0060°W) - Central Park, NYC
- Partner is at: (40.7505°N, 73.9972°W) - Upper West Side, NYC
- Bearing calculated: **343°** (Nearly North-Northwest)
- Your arrow points to 343° on the compass

**Partner's calculation:**
- Partner is at: (40.7505°N, 73.9972°W)
- You are at: (40.7128°N, 74.0060°W)
- Their bearing calculated: **163°** (Nearly South-Southeast)
- Their arrow points to 163° (opposite direction!)

```
[CALC] Bearing: 343.2° (My [GPS] → Partner [P2P])
```

### 6. **Device Orientation & Arrow Rotation**

The compass arrow rotates based on device orientation:

```javascript
// Device's heading from accelerometer/magnetometer
heading = event.webkitCompassHeading || (360 - event.alpha)

// Arrow rotation = bearing - heading
arrowRotation = bearing - heading
```

**When device is held flat:**
- Accelerometer gives accurate heading
- Magnetometer (compass) detects magnetic north
- Device rotation directly maps to arrow rotation
- **Result: Both devices point directly at each other! 💕**

### 7. **Turn Indicator (Delta)**

Shows how much to turn left/right to face partner:

```
deltaValue = bearing - heading
```

- **Negative** = Turn left
- **Positive** = Turn right
- Range: **-180° to +180°**

```
[CALC] Turn: -45.3° (Turn 45° left to face partner)
```

### 8. **Distance Calculation**

Great-circle distance between your two locations:

```javascript
distance = geolib.getDistance(
  myLocation,      // Your GPS
  partnerLocation  // Partner's P2P synced location
)
```

Displayed as:
- **Meters** (< 1 km): `245 m`
- **Kilometers** (>= 1 km): `2.34 km`

---

## 🏗️ Technical Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    DEVICE A (You)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐         ┌─────────────┐                 │
│  │ GPS Module   │────────▶│ lastPos     │                 │
│  │ (500ms)      │         │ Object      │                 │
│  └──────────────┘         └─────────────┘                 │
│                                 │                          │
│                                 ▼                          │
│                          ┌──────────────┐                 │
│                          │   P2P Send   │──────┐           │
│                          │  (1s sync)   │      │           │
│                          └──────────────┘      │           │
│                                                │           │
│  ┌──────────────┐         ┌─────────────┐     │           │
│  │ Compass      │────────▶│ lastHeading │     │           │
│  │ (Real-time)  │         │ (0-360°)    │     │           │
│  └──────────────┘         └─────────────┘     │           │
│                                 │              │           │
│  P2P Data Input                 │              │           │
│       │                         │              │           │
│       │         ┌───────────────┼──────────────┘           │
│       │         │               │                          │
│       ▼         ▼               ▼                          │
│  ┌────────────────────────────────────┐                   │
│  │  updateDisplay()                   │                   │
│  │  ├─ Bearing = Geolibfn(lastPos,     │                  │
│  │  │            target)               │                  │
│  │  ├─ Distance = Geolibfn(lastPos,    │                  │
│  │  │             target)              │                  │
│  │  ├─ Delta = Bearing - Heading       │                  │
│  │  └─ Arrow Rotation = Delta          │                  │
│  └────────────────────────────────────┘                   │
│                 │                                          │
│                 ▼                                          │
│  ┌────────────────────────────────────┐                   │
│  │  UI Update (Real-Time)             │                   │
│  │  ├─ Compass Arrow Direction        │                   │
│  │  ├─ Bearing Value (degrees)        │                   │
│  │  ├─ Distance Value (m/km)          │                   │
│  │  ├─ My Coordinates                 │                   │
│  │  └─ Partner Coordinates (synced)   │                   │
│  └────────────────────────────────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ P2P Connection
                          │ (WebRTC Data)
                          │
┌─────────────────────────────────────────────────────────────┐
│                    DEVICE B (Partner)                       │
├─────────────────────────────────────────────────────────────┤
│  [Same flow as Device A]                                   │
└─────────────────────────────────────────────────────────────┘
```

### State Management

**Global State Variables:**

```javascript
// Location Data
let lastPos = null;           // {latitude, longitude} - My GPS location
let lastHeading = null;       // 0-360 - Device compass heading
let target = null;            // {latitude, longitude} - Partner's location (synced)

// Peer Connection
let peer = null;              // PeerJS instance
let peerConnection = null;    // Active P2P connection
let myPeerId = string;        // My unique peer identifier
let remotePeerId = string;    // Partner's peer identifier

// Sync Timing
let lastSyncTime = 0;         // Timestamp of last coordinate send
let connectionRetryCount = 0; // Current retry attempt number
```

### Key Functions & Their Flow

#### **Initialization** (`init()`)
1. Check HTTPS security
2. Verify geolib library loaded
3. Initialize PeerJS peer
4. Request location and orientation permissions
5. Check for URL `?peer=` parameter and connect if present
6. Load stored target coordinates (<a href="#localStorage-persistence">if any</a>)

#### **Geolocation Watch** (`startGeolocation()`)
- Continuously monitors GPS (500ms max age, high accuracy)
- On each update:
  1. Updates `lastPos`
  2. Calls `sendCoordinatesToPeer()` (throttled to 1s)
  3. Calls `updateDisplay()` (triggers all calculations)
- Starts heartbeat interval to keep P2P connection alive

#### **Orientation Watch** (`startOrientation()`)
- Listens to `deviceorientationabsolute` or `deviceorientation` event
- Updates `lastHeading` continuously
- Calls `updateDisplay()` on each change
- Rotates compass arrow based on heading

#### **Bearing Calculation** (`updateDisplay()`)
```javascript
maybeTarget = target || currentTargetFromInputs()
bearing = geolib.getGreatCircleBearing(lastPos, maybeTarget)
distance = geolib.getDistance(lastPos, maybeTarget)
delta = signedDelta(lastHeading, bearing)
arrowRotation = delta
```

#### **P2P Message Handling** (`handlePeerMessage()`)
- Receives partner's coordinates: `{type: "coordinates", latitude, longitude}`
- Updates `target` object (prioritized over manual input)
- Calls `updateDisplay()` to recalculate bearing with updated partner location

---

## 🚀 Getting Started

### Prerequisites

- **HTTPS Connection** (or localhost)
  - Required for geolocation and device orientation APIs
  - Check the 🔒 lock chip in header
  
- **Modern Browser**
  - Chrome/Firefox on Android
  - Safari on iOS 13+
  
- **Device Sensors**
  - GPS/Geolocation capability
  - Compass/Accelerometer (for device orientation)
  
- **Peer-to-Peer Network**
  - Both devices connected to internet (doesn't need same WiFi)
  - PeerJS signaling server connectivity

### Installation & Usage

1. **Deploy the application** (must be HTTPS in production)
   ```bash
   # Copy index.html, script.js, style.css to your HTTPS host
   ```

2. **Open on Device A** (first device)
   - Navigate to `https://your-domain.com/`
   - Click the **Share** button (⬆️ icon in header)
   - Copy the generated link

3. **Open Link on Device B** (partner's device)
   - Paste the link in browser
   - Wait for connection (should connect within seconds)
   - Watch the sensors chip turn green ✓

4. **Make Sure Both Have Location Enabled**
   - App will request location access
   - Both devices should show 📍 location chip as green

5. **Hold Flat & Face Each Other**
   - Keep devices flat/level (parallel to ground)
   - Adjust compass orientation to face partner
   - Arrows will point directly at each other! 💕

---

## 📊 Real-Time Logging

The app maintains a comprehensive live log showing all operations. Open it by clicking the 📋 Log button:

### GPS Events
```
[GPS] Fetched location: 40.71280, -74.00601
[GPS] Updated my location: 40.71281, -74.00602
```

### P2P Events
```
[P2P] Sent my location: 40.71281, -74.00602
[P2P] Received coordinates: 40.71500, -74.00400
```

### Calculation Events
```
[CALC] Bearing: 343.2° (My [GPS] → Partner [P2P])
```

### Connection Events
```
Peer initialized: find-you-ijri48-eupl...
Attempting to connect to peer from link: find-you-ijri48-eupl...
Retrying connection in 1s (attempt 1/10)...
Connected to peer: find-you-ijri48-eupl...
```

---

## 🔌 Peer-to-Peer Connection Details

### PeerJS Configuration

The app uses **PeerJS** for WebRTC data channels:

```javascript
peer = new Peer(myPeerId, {})
// Uses PeerJS public signaling server
// Automatically handles WebRTC peer discovery
```

### Connection Flow Sequence

```
Device A: Ready (listening)
    │
    └──▶ User shares peer ID in URL
         │
         └──▶ Device B: Receives link
              │
              └──▶ Extract peer ID from ?peer= param
                  │
                  └──▶ Call peer.connect(peerIdA)
                      │
                      ├─▶ Attempt 1: Failed
                      ├─▶ Attempt 2: Failed  
                      ├─▶ Attempt 3: Success! ✓
                      │
                      └──▶ Connection Open Event
                          │
                          ├─▶ Device A receives connection
                          │
                          └─▶ Two-way data channel established
```

### Message Protocol

**Coordinates Message** (every 1 second):
```json
{
  "type": "coordinates",
  "latitude": 40.71281,
  "longitude": -74.00602,
  "timestamp": 1708000000123
}
```

**Heartbeat Message** (every 5 seconds):
```json
{
  "type": "heartbeat",
  "timestamp": 1708000000123
}
```

### Connection Reliability

| Feature | Implementation |
|---------|-----------------|
| **Auto-Retry** | Exponential backoff (1s to 10s max) |
| **Max Retries** | 10 attempts over ~20 seconds |
| **Keep-Alive** | Heartbeat every 5 seconds |
| **Error Handling** | Graceful degradation with user feedback |
| **Reconnection** | Automatic peer reconnect to signaling server |

---

## 📍 Bearing & Distance Calculations

### Using GeoLib

The app uses **GeoLib** library for geographic calculations:

```javascript
// Great-circle bearing (geodetic bearing)
bearing = geolib.getGreatCircleBearing(
  {latitude: 40.7128, longitude: -74.0060},  // My location
  {latitude: 40.7505, longitude: -73.9972}   // Partner location
)
// Result: ~343° (pointing north-northwest)

// Great-circle distance (shortest path on Earth)
distance = geolib.getDistance(
  {latitude: 40.7128, longitude: -74.0060},
  {latitude: 40.7505, longitude: -73.9972}
)
// Result: 5900 meters (5.9 km)
```

### Why These Calculations?

- **Great-Circle Bearing**: Accounts for Earth's curvature, provides true compass direction
- **Great-Circle Distance**: Shortest path between two points on sphere (not straight line on map)
- **Perfect for mobile**: Works anywhere on Earth (both devices always point at each other)

### Practical Example

**Scenario: Couple in NYC**

Location A (Device 1): Central Park
- Latitude: 40.7829° N
- Longitude: 73.9654° W

Location B (Device 2): Times Square  
- Latitude: 40.7580° N
- Longitude: 73.9855° W

**Device 1 calculations:**
```
Bearing = 256° (pointing west-southwest)
Distance = 2.1 km
```

**Device 2 calculations:**
```
Bearing = 76° (pointing east-northeast, opposite!)
Distance = 2.1 km
```

When both devices are held flat and level:
- Device 1's arrow points at 256° (Device 2's location)
- Device 2's arrow points at 76° (Device 1's location)
- **Both students point toward each other!** 💕

---

## 💾 LocalStorage Persistence

The app saves data locally for offline access:

| Key | Purpose | Value |
|-----|---------|-------|
| `compass_target_v3` | Partner's coordinates | `{latitude, longitude}` |
| `compass_peer_id` | Your peer ID | `find-you-xxxx-yyyy` |
| `compass_session_id` | Session identifier | Random 6-char string |

**Behavior:**
- Manual entry in modal saves to localStorage
- Synced peer coordinates are NOT saved (only in memory)
- Reloading page restores manual coordinates
- New session created if localStorage empty

---

## 🔒 Security & Privacy

✅ **Privacy-First Design:**
- All data flows peer-to-peer (no server database)
- Only coordinates exchanged (no metadata, analytics, or tracking)
- HTTPS required (encrypts all traffic)
- PeerJS signaling server only facilitates initial connection
- After connection established, signaling server not used

✅ **Security Features:**
- Unique random peer IDs (not guessable)
- HTTPS-only in production
- No sensitive data logged
- Device orientation data never transmitted

⚠️ **Limitations:**
- Peer ID in URL can be shared with anyone (by design)
- P2P connection requires same network/internet connectivity
- Webrtc depends on PeerJS infrastructure availability

---

## 🧪 Testing & Verification

### Single Device Testing

1. Open browser DevTools console
2. Enter coordinates manually in "Partner Coordinates" modal
3. Mock GPS coordinates by watching the log
4. Verify bearing calculations with online bearing calculator
   - Input: Your lat/lon + Partner lat/lon
   - Compare with app's bearing output

### Dual Device Testing

**Recommended Setup:**
- Two smartphones (Android/iOS)
- Both on same WiFi network (optional, internet works)
- Both with GPS enabled
- One device indoors, one outdoors (or move around)

**Verification Steps:**
1. Open first device → Share link
2. Open second device → Paste link
3. Wait for "Connected to peer" message
4. Both devices should show:
   - ✅ 🔒 Lock (HTTPS)
   - ✅ 🧭 Compass (sensor working)  
   - ✅ 📍 Location (GPS locked)
   - ✅ ➡️ Connection (P2P connected)
5. Watch logs for coordinate syncing
6. Hold devices flat and face each other
7. See arrows point directly at each other!

### Debugging

**If arrows don't point at each other:**
1. Check device orientation: Is phone level/flat?
2. Verify GPS accuracy: Are coordinates recent? (check timestamp)
3. Check compass calibration: Rotate device in figure-8 pattern
4. Verify P2P connection: Both show green connection chip?

**If connection fails:**
1. Check internet connectivity on both devices
2. Verify HTTPS is enabled (lock chip should be green)
3. Try refreshing page
4. Check browser console for WebRTC errors
5. Ensure PeerJS signaling server is reachable

---

## 📱 Browser Support

| Browser | Android | iOS | Notes |
|---------|---------|-----|-------|
| Chrome | ✅ | ✅ | Best support |
| Firefox | ✅ | ✅ | Good support |
| Safari | ✅ | ✅ | iOS 13+ required |
| Edge | ✅ | ✅ | Works fine |
| UC Browser | ⚠️ | ❌ | Limited support |

**Requirements by feature:**
- **Geolocation**: All modern browsers
- **Device Orientation**: Android required (iOS limited)
- **WebRTC (P2P)**: Chrome 45+, Firefox 22+, Safari 14.1+
- **Web Crypto**: All modern browsers

---

## 🐛 Troubleshooting

### "Peer error: Could not connect to peer"

**Cause**: Partner's peer hasn't initialized yet or signaling server unreachable

**Solution**:
- Wait 2-3 seconds for connection retry
- App automatically retries up to 10 times with increasing delays
- Check internet connectivity on both devices

### "Geolocation not supported"

**Cause**: Browser or device lacks GPS capability

**Solution**:
- Use a real smartphone (simulator browsers can't access GPS)
- Ensure location permission granted
- Check browser location settings

### "DeviceOrientation not supported"

**Cause**: Device lacks compass/accelerometer sensors

**Solution**:
- Use modern smartphone (all have these sensors)
- Ensure device orientation permission granted
- Calibrate compass (rotate device in figure-8 pattern)

### "Partner coordinates not updating"

**Cause**: P2P connection established but coordinates not received yet

**Solution**:
- Check connection status (should be green)
- Open log; look for `[P2P] Received coordinates` messages
- Ensure partner's "Find" button is active (blue button)
- Make sure partner's GPS is enabled

### "Arrow doesn't point at partner"

**Cause**: Device orientation data incorrect

**Solution**:
- Hold device flat/level (parallel to ground)
- Calibrate compass: Rotate device in large figure-8 pattern
- Use magnetic compass app to verify heading
- Move away from metal/magnetic objects

### "Distance shows very high/low (incorrect)"

**Cause**: GPS accuracy issue or stale coordinates

**Solution**:
- Move to location with clear sky view
- Wait 30 seconds for GPS to get accurate fix
- Check timestamp in log (should be recent)
- Verify both devices have fresh coordinates

---

## 🌟 How the Mathematics Works

### Great-Circle Bearing Formula

The app calculates bearing using the haversine formula:

```
y = sin(Δλ) × cos(φ2)
x = cos(φ1) × sin(φ2) − sin(φ1) × cos(φ2) × cos(Δλ)
bearing = atan2(y, x)
```

Where:
- φ1, λ1 = Your latitude, longitude
- φ2, λ2 = Partner's latitude, longitude  
- Δλ = Difference in longitude

**Result**: True compass bearing (0° = North, 90° = East, 180° = South, 270° = West)

### Device Arrow Rotation

```javascript
arrowAngle = bearing - deviceHeading
```

**Why this works:**
- Device heading = direction phone is pointing
- Bearing = direction partner is located
- Difference = how much to rotate arrow

**Example:**
- Partner is at bearing 45° (NE)
- Device heading is 0° (pointing N)
- Arrow rotates: 45° - 0° = 45° (points NE)

---

## 🎨 UI Components & Status Indicators

### Header Chips (Status Indicators)

| Chip | State | Meaning | Icon |
|------|-------|---------|------|
| 🔒 Secure | 🟢 OK | HTTPS enabled (required) | fa-lock |
| | 🔴 Bad | Not HTTPS (insecure) | fa-lock-open |
| 🧭 Compass | 🟢 OK | Device orientation working | fa-compass |
| | 🟡 Pending | Requesting permission | fa-spinner |
| | 🔴 Bad | Compass unavailable | fa-circle-xmark |
| 📍 Location | 🟢 OK | GPS enabled & working | fa-location-dot |
| | 🟡 Pending | Fetching location | fa-spinner |
| | 🔴 Bad | GPS unavailable/denied | fa-triangle-exclamation |

### Modal Inputs

**Partner Coordinates Modal:**
- Latitude input (φ): -90° to +90°
- Longitude input (λ): -180° to +180°
- Auto-populates with synced P2P coordinates
- Can manually override (useful for offline testing)

### Compass Display

**Visual Elements:**
- Rotating compass ring
- Arrow pointing to partner
- Cardinal directions (N, S, E, W)
- Stateful rotation based on device heading + bearing

---

## 🚀 Performance Optimizations

| Aspect | Implementation |
|--------|-----------------|
| **Location Updates** | 500ms max age, throttled to 1s for P2P send |
| **Orientation Updates** | Real-time listener (no throttle) |
| **Display Updates** | Batched in `updateDisplay()` function |
| **Heartbeat Interval** | 5 seconds (balance: latency vs. traffic) |
| **Connection Retries** | Exponential backoff (prevent flooding) |
| **Memory Usage** | Only essential data stored (coordinates + state) |

---

## 📜 Technology Stack

- **Frontend**: Vanilla JavaScript (no frameworks)
- **P2P**: PeerJS (WebRTC abstraction)
- **Geolocation**: Browser Geolocation API
- **Orientation**: Device Orientation API (W3C)
- **Calculations**: GeoLib (geographic algorithms)
- **UI**: Bootstrap 5 + Custom CSS
- **Icons**: Font Awesome 6

**Why vanilla JS?**
- Lightweight (no framework overhead)
- Runs on any device (including older phones)
- Fast and responsive for real-time data

---

## 💡 Future Enhancement Ideas

- 📸 Add real-time photo sharing over P2P
- 🗺️ Embedded map showing both locations  
- 📞 Voice/video call integration over WebRTC
- 🔔 Notifications when partner is nearby
- 🎨 Custom color themes & pin markers
- 📊 Location history & traveled distance stats
- 🔐 Encryption for shared coordinates
- 🌙 Dark mode toggle

---

## ❤️ Valentine's Day Special

This app was created as a Valentine's Day project to help couples find each other. The **"Find You" compass** metaphor is about:

- 🧭 **Direction**: Knowing which way to head toward your love
- 📍 **Location**: Being aware of where your partner is
- 💕 **Connection**: Real-time P2P bond between devices
- 🎁 **Gift**: A tech way to express direction of love

Hold it flat, face each other, and let the compass guide you to each other! 💕

---

## 📝 License

This project is provided as-is for personal and educational use.

---

## 🤝 Support

For issues or questions:
1. Check the **Troubleshooting** section above
2. Open browser DevTools → Console for error messages
3. Open the **Log panel** in the app for real-time diagnostics
4. Verify all prerequisites are met

---

**Made with ❤️ for Valentine's Day 2026**
