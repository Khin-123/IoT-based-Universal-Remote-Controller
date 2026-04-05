# IoT Universal Remote with Firebase (React + Express + ESP32)

This implementation now uses Firebase for user-scoped IR storage.

- Frontend: Firebase Auth (email/password + Google)
- Backend: Firebase Admin token verification + Firestore storage
- ESP32: stateless IR capture/send API (`/learn`, `/send`)

## Final Data Model (Firestore)

Document path:

```text
users/{uid}
```

Document structure:

```json
{
  "devices": {
    "TV1": {
      "type": "TV",
      "commands": {
        "power": {
          "protocol": "NEC",
          "value": 12345,
          "bits": 32,
          "raw": []
        }
      }
    },
    "AC1": {
      "type": "AC",
      "commands": {
        "temp_24": {
          "protocol": "RAW",
          "value": 0,
          "bits": 0,
          "raw": [9000, 4500, 560]
        }
      }
    }
  }
}
```

## Folder Structure

```text
.
+- src/
¦  +- main.cpp
+- platformio.ini
+- backend/
¦  +- .env
¦  +- .env.example
¦  +- package.json
¦  +- src/
¦     +- firebaseAdmin.js
¦     +- authMiddleware.js
¦     +- server.js
+- frontend/
   +- .env.example
   +- package.json
   +- src/
      +- firebase.js
      +- App.jsx
      +- App.css
      +- main.jsx
```

## ESP32 API

### `GET /health`
Health + IP.

### `GET /learn`
- Waits for an IR signal.
- Query option: `timeoutMs` (default 15000).
- Returns:

```json
{
  "success": true,
  "protocol": "NEC",
  "value": 12345,
  "bits": 32,
  "raw": []
}
```

For AC/unknown signal types it returns raw timings in `raw`.

### `POST /send`
Body:

```json
{
  "protocol": "NEC",
  "value": 12345,
  "bits": 32,
  "raw": []
}
```

If `raw` has values, raw transmission is used.

## Backend API

All protected routes require:

```http
Authorization: Bearer <Firebase ID Token>
```

### `POST /api/learn`
Input:

```json
{
  "deviceName": "TV1",
  "commandName": "power"
}
```

Flow:
1. Calls `ESP32 /learn`
2. Saves result under `users/{uid}.devices.{deviceName}.commands.{commandName}`

### `POST /api/send`
Input:

```json
{
  "deviceName": "TV1",
  "commandName": "power"
}
```

Flow:
1. Reads command IR from Firestore for logged-in user
2. Calls `ESP32 /send` with that IR payload

### `GET /api/devices`
Returns all user devices + commands.

## Frontend Features

- Register with email/password
- Login with email/password
- Google sign-in
- Dashboard:
  - Device name input
  - Command name input
  - Learn IR button
  - Send IR button
  - Device/command list for current user

## Detailed Setup Instructions

## 1) Firebase Setup

1. Create a Firebase project.
2. Enable Authentication providers:
   - Email/Password
   - Google
3. Create Firestore database.
4. Generate service account key:
   - Firebase Console -> Project Settings -> Service Accounts -> Generate private key
5. Create web app in Firebase and copy config values.

## 2) Backend Setup

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
PORT=3000
ESP32_BASE_URL=http://<ESP32_IP>
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
```

Alternative instead of path:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Place `serviceAccountKey.json` inside `backend/` if using path mode.

Run backend:

```bash
npm run dev
```

## 3) Frontend Setup

```bash
cd frontend
npm install
```

Create `frontend/.env`:

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

Open `http://localhost:5173`.

## 4) ESP32 Setup

1. Open `src/main.cpp`
2. Set Wi-Fi values:

```cpp
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASS = "YOUR_WIFI_PASSWORD";
```

3. Build/upload:

```bash
pio run
pio run -t upload
pio device monitor
```

4. Read ESP32 IP from serial output.
5. Put that IP in backend `.env` as `ESP32_BASE_URL`.

## 5) Firestore Security Rules

Use per-user isolation:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
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
