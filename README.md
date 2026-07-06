# IoT-Based Universal Remote Controller

A working smart remote controller built with:
- ESP32 firmware for IR learning and IR sending
- Express backend with Firebase Admin and Firestore
- React + Vite frontend with Firebase Authentication

This repository is in an active state with the current implementation covering:
- User sign-up, login, email verification, and Google sign-in
- Per-user remote registration using ESP32 unique IDs
- Learn / send IR command flows through a WebSocket-connected ESP32
- Firestore storage for remotes, devices, and IR commands
- Device editing, renaming, deletion, and command management

## Current Architecture

### ESP32
- `src/main.cpp`
- Connects to Wi-Fi
- Exposes local HTTP endpoints:
  - `GET /health`
  - `GET /learn`
  - `POST /send`
- Connects to backend via WebSocket at `/ws`
- Sends a `hello` handshake with `espId`
- Receives learn/send requests from backend through WebSocket

### Backend
- `backend/src/server.js`
- `backend/src/firebaseAdmin.js`
- `backend/src/authMiddleware.js`
- Uses Firebase Admin SDK for auth verification and Firestore access
- Supports:
  - remote registration and listing
  - device and command persistence
  - IR learn/send orchestration with connected ESP32

### Frontend
- `frontend/src/App.jsx`
- `frontend/src/firebase.js`
- `frontend/src/api.js`
- UI components in `frontend/src/components/`
- Supports authentication, remote selection, device control, and terminal logs

## Firestore Data Model

Current data structure is:

- `users/{uid}/remotes/{remoteId}/devices/{deviceName}`

Each device document contains:
- `deviceName`
- `type`
- `commands` object keyed by command name
- `updatedAt`

Example device document:

```json
{
  "deviceName": "TV1",
  "type": "TV",
  "commands": {
    "power": {
      "protocol": "NEC",
      "value": 12345,
      "bits": 32,
      "raw": []
    }
  },
  "updatedAt": "<timestamp>"
}
```

## Backend API Endpoints

All protected endpoints require `Authorization: Bearer <Firebase ID Token>`.

### Public
- `GET /health`
  - Returns backend health status.

### Remote management
- `GET /api/remotes`
  - List registered remotes for current user.
- `POST /api/remotes`
  - Add a new remote with body `{ espId, name }`.
- `DELETE /api/remotes`
  - Remove a remote with body `{ remoteId }`.

### Device and command management
- `GET /api/devices?remoteId=<remoteId>`
  - List devices for a selected remote.
- `POST /api/learn`
  - Learn a new IR command and save it.
  - Body: `{ remoteId, deviceName, commandName, deviceType, timeoutMs? }`
- `POST /api/send`
  - Send a saved IR command via the ESP32.
  - Body: `{ remoteId, deviceName, commandName }`
- `PATCH /api/device/rename`
  - Rename a device.
  - Body: `{ remoteId, oldDeviceName, newDeviceName }`
- `DELETE /api/device`
  - Delete a device.
  - Body: `{ remoteId, deviceName }`
- `DELETE /api/command`
  - Delete a specific command.
  - Body: `{ remoteId, deviceName, commandName }`

### ESP32 WebSocket
- Backend WebSocket endpoint: `ws://<host>:<port>/ws`
- ESP32 must connect and register its `espId`
- Backend routes learn/send payloads through this socket

## Frontend Features

Implemented features:
- Email/password sign-up and login
- Google sign-in
- Email verification gating
- Remote registration by ESP ID
- Remote selection and refresh
- Device creation, edit, rename, delete
- Command learn/send via dynamic control UI
- AC, TV, FAN, and PROJECTOR modes supported in the control panel
- Activity log / terminal history

## Setup Instructions

### 1) Firebase Setup

1. Create a Firebase project.
2. Enable Authentication providers:
   - Email/Password
   - Google
3. Create a Firestore database.
4. Generate a service account JSON key from Firebase Console > Project Settings > Service Accounts.
5. Create a Firebase web app and copy the config values.

### 2) Backend Setup

```bash
cd backend
npm install
```

Create `backend/.env` with:

```env
PORT=3000
FRONTEND_ORIGIN=http://localhost:5173
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
# or
# FIREBASE_SERVICE_ACCOUNT_JSON={...}
```

If you prefer a single secret, set `FIREBASE_SERVICE_ACCOUNT_JSON` instead of `FIREBASE_SERVICE_ACCOUNT_PATH`.

Run backend:

```bash
npm run dev
```

### 3) Frontend Setup

```bash
cd frontend
npm install
```

Create `frontend/.env` with:

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Run frontend:

```bash
npm run dev
```

Open the app at `http://localhost:5173`.

### 4) ESP32 Setup

Edit `src/main.cpp` and update:

```cpp
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASS = "YOUR_WIFI_PASSWORD";
```

If using the local backend, update the backend WebSocket block:

```cpp
const char *BACKEND_HOST = "<your-local-backend-host>";
const uint16_t BACKEND_PORT = 3000;
const char *BACKEND_PATH = "/ws";
const bool BACKEND_SSL = false;
```

Then build and upload using PlatformIO:

```bash
pio run
pio run -t upload
pio device monitor
```

Read the ESP32 serial output to confirm Wi-Fi and WebSocket connection.

### 5) Remote Registration

1. Start backend and frontend.
2. Power on ESP32 and confirm it connects to Wi-Fi.
3. In the frontend, add a remote using the ESP ID printed on the ESP serial monitor.
4. Select the remote and begin learning/sending IR commands.

## Firestore Security Rules

Use per-user isolation:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Notes

- Backend auth middleware requires verified email addresses.
- ESP32 currently uses WebSocket pairing to receive learn/send commands.
- Device names may not contain `.` or `/`.
- The current frontend uses `VITE_API_BASE_URL` to reach the backend.
```

## 6) End-to-End Test

1. Login in frontend.
2. Set `deviceName=TV1`, `commandName=power`.
3. Click **Learn IR** and press remote key.
4. Click **Refresh Devices** and verify command appears.
5. Click **Send IR** and verify target device receives the command.

## Notes

- ESP32 does not store your user command library long-term.
- Firestore is the source of truth.
- Commands are isolated per authenticated user UID.
