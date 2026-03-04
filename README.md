# IoT-based Universal Remote Controller (ESP32 + Blynk + IR)

This project turns an ESP32 into a learnable, internet-connected IR remote that can control:

- AC units (3 profiles: `AC1..AC3`)
- Fans (2 profiles: `FAN1..FAN2`)
- TVs (2 profiles: `TV1..TV2`)
- Projectors (2 profiles: `PROJECTOR1..PROJECTOR2`)

It supports two operating modes:

- `LEARN_MODE`: capture IR from original remotes and store permanently in ESP32 NVS
- `SEND_MODE`: transmit stored commands from Blynk controls

The firmware currently boots in `SEND_MODE`.

## 1) Key Features

- Learn and store IR commands per device profile
- Supports normal decoded protocols and fallback for unknown/raw captures
- AC-friendly handling:
- stores full state payloads for AC protocols when available
- stores raw timings for unknown AC remotes when decoding fails
- Mode control from both:
- physical button (`GPIO27`)
- Blynk switch (`V13`)
- Physical LED and Blynk LED stay synchronized:
- physical LED on `GPIO26`
- Blynk status LED on `V14`
- Startup mode is `SEND_MODE`
- Device selection (`V12`) no longer forces learn mode; current mode is preserved

## 2) Hardware Requirements

- ESP32 development board
- IR receiver module (for learning)
- IR LED + proper driver stage/transistor (for transmitting)
- Push button (mode toggle)
- Indicator LED (mode state)
- Stable 5V/USB power

## 3) Pin Mapping (ESP32)

From `src/main.cpp`:

- `IR_RECV_PIN` = `GPIO14`
- `IR_SEND_PIN` = `GPIO4`
- `BUTTON_PIN` = `GPIO27`
- `LED_PIN` = `GPIO26`

Mode LED behavior:

- `SEND_MODE` -> LED ON
- `LEARN_MODE` -> LED OFF

## 4) Software Stack

Configured in `platformio.ini`:

- Platform: `espressif32`
- Board: `esp32dev`
- Framework: `arduino`
- Libraries:
- `crankyoldgit/IRremoteESP8266`
- `blynkkk/Blynk@^1.3.2`

## 5) Blynk Virtual Pin Map

### Core UI / Mode

- `V4`: Terminal output (`WidgetTerminal`)
- `V12`: Device selector menu
- `V11`: Back to selector
- `V13`: Mode switch (`0=LEARN`, `1=SEND`)
- `V14`: Mode indicator LED (`0=LEARN`, `1=SEND`)

### Device Actions

- `V0`: AC ON
- `V1`: AC OFF
- `V7`: AC temperature (`17..25`)
- `V2`: Fan power
- `V6`: Fan swing
- `V5`: Fan speed (`1..3`)
- `V8`: TV power
- `V9`: TV channel (`1..9`)
- `V3`: Projector power

### Visibility helper widget

- `V10`: Used as the device selection view/container visibility control

## 6) Device Selector Values (`V12`)

The firmware accepts either numeric selection or label-like text.

Numeric mapping:

- `0`: AC1
- `1`: AC2
- `2`: AC3
- `3`: FAN1
- `4`: FAN2
- `5`: TV1
- `6`: TV2
- `7`: PROJECTOR1
- `8`: PROJECTOR2

Text parsing supports names containing `AC`, `FAN`, `TV`, `PROJECTOR` plus index number.

## 7) Mode Behavior and Sync

### Sources of mode change

- Physical button on `GPIO27` (`toggleMode()`)
- Blynk switch `V13`

### Sync rules

`syncModeIndicators()` updates all mode indicators together:

- physical LED (`GPIO26`)
- `V13` switch state
- `V14` LED state

`BLYNK_CONNECTED()` calls `syncModeIndicators()` so app UI re-syncs after reconnect.

### Important guard

Mode change is blocked if no device is selected (`currentDevice == NONE`).

## 8) Learn Workflow

1. Select a device in `V12`.
2. Set mode to `LEARN` from physical button or `V13`.
3. Press the target Blynk control you want to learn:
- AC ON/OFF (`V0`, `V1`)
- AC temp (`V7`) choose value first, then send matching remote command
- Fan power/swing/speed (`V2`, `V6`, `V5`)
- TV power/channel (`V8`, `V9`)
- Projector power (`V3`)
4. Point original remote at receiver and press key.
5. Firmware stores IR data in NVS (`Preferences`, namespace `ir`).

### Capture handling

- Repeats and overflow captures are ignored
- Decoded AC state payloads are stored as state bytes
- Unknown decodes are stored as raw timings (fallback)

## 9) Send Workflow

1. Select device (`V12`).
2. Set mode to `SEND` (`V13=1` or physical button).
3. Use action controls to transmit stored IR.

### AC ON behavior

When sending AC ON:

- If a last temperature was sent in this runtime and that temp command exists, firmware sends that temp state first
- Otherwise it sends learned AC ON command

This improves stateful AC behavior for remotes that encode full state in each frame.

## 10) IR Storage Model (NVS)

Each command slot can store:

- protocol type + value + bits (classic)
- optional AC state bytes (`stateLen/state`)
- optional raw timing array (`rawLen/raw`)

This gives compatibility for:

- standard protocols (e.g. NEC)
- complex AC protocols
- unknown remotes via raw fallback replay

## 11) Build and Upload

From project root:

```bash
pio run
pio run -t upload
pio device monitor
```

If `pio` is not in PATH, install PlatformIO CLI or use VS Code PlatformIO extension.

## 12) First-Time Setup Checklist

1. Update credentials in `src/main.cpp`:
- `BLYNK_TEMPLATE_ID`
- `BLYNK_TEMPLATE_NAME`
- `BLYNK_AUTH_TOKEN`
- Wi-Fi `ssid` / `pass`
2. Create matching Blynk datastreams/widgets for all pins listed above.
3. Flash firmware.
4. Open serial monitor and Blynk terminal (`V4`).
5. Select a device and start learning required keys.

## 13) Troubleshooting

### "Choose the device first"

Select one of AC/FAN/TV/PROJECTOR profiles in `V12` before mode toggle or actions.

### Learned signal sends nothing

- Verify learning was done for that exact control slot
- Check IR LED drive circuit and orientation
- Check device profile index (e.g. AC1 vs AC2)

### AC turns on but wrong temp/state

- Re-learn temperature/state commands for that AC profile
- Use temperature slider in send mode so runtime remembers latest temp state

### Unknown protocol in logs

This is expected for some remotes. Raw fallback capture/replay is implemented.

## 14) Security Notes

Do not commit real Wi-Fi credentials or Blynk auth tokens to public repositories.
Use environment-specific secrets management for production.

---

If you want, I can also generate a matching Blynk widget setup table (widget type, min/max, push mode) so your dashboard can be recreated exactly.
