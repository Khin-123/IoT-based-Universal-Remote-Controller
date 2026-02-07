#define BLYNK_TEMPLATE_ID   "TMPL2sOm63FlB"
#define BLYNK_TEMPLATE_NAME "template2"
#define BLYNK_AUTH_TOKEN    "iOHgXVb-dlzdtqEDXdSLICWJnnAM4W9u"

#define BLYNK_PRINT         Serial

#include <Arduino.h>
#include <WiFi.h>
#include <BlynkSimpleEsp32.h>
#include <IRremoteESP8266.h>
#include <IRrecv.h>
#include <IRsend.h>
#include <IRutils.h>
#include <Preferences.h>

// ────────────────────────────────────────────────
// WiFi credentials
// ────────────────────────────────────────────────
char ssid[] = "Xiaomi 15T Pro";
char pass[] = "d0ntc0nnect";

// ────────────────────────────────────────────────
// Blynk
// ────────────────────────────────────────────────
WidgetTerminal terminal(V4);

// ────────────────────────────────────────────────
// Pins
// ────────────────────────────────────────────────
#define LED_PIN       26
#define BUTTON_PIN    27
#define IR_RECV_PIN   14
#define IR_SEND_PIN   4

// ────────────────────────────────────────────────
// IR objects
// ────────────────────────────────────────────────
IRrecv irrecv(IR_RECV_PIN);
IRsend irsend(IR_SEND_PIN);
decode_results results;

// ────────────────────────────────────────────────
// Persistent storage
// ────────────────────────────────────────────────
Preferences prefs;

// ────────────────────────────────────────────────
// Operating modes
// ────────────────────────────────────────────────
enum Mode { LEARN_MODE, SEND_MODE };
Mode currentMode = LEARN_MODE;

// ────────────────────────────────────────────────
// Device selection
// ────────────────────────────────────────────────
enum DeviceType { NONE, AC, FAN, TV };
DeviceType currentDevice = NONE;

// ────────────────────────────────────────────────
// Learn actions for power buttons
// ────────────────────────────────────────────────
enum LearnAction { LEARN_NONE, LEARN_AC_ON, LEARN_AC_OFF, LEARN_FAN_POWER, LEARN_TV_POWER };
LearnAction currentLearn = LEARN_NONE;

// ────────────────────────────────────────────────
// IR code storage structure
// ────────────────────────────────────────────────
struct IRData {
    decode_type_t proto = UNKNOWN;
    uint64_t      val   = 0;
    uint16_t      bits  = 0;

    IRData() = default;
    IRData(decode_type_t p, uint64_t v, uint16_t b)
        : proto(p), val(v), bits(b) {}
};

// ────────────────────────────────────────────────
// AC related
// ────────────────────────────────────────────────
#define TEMP_MIN   17
#define TEMP_MAX   25
#define TEMP_COUNT (TEMP_MAX - TEMP_MIN + 1)

IRData acOn;
IRData acOff;
IRData acTemp[TEMP_COUNT];
int    learnTemp = -1;

// ────────────────────────────────────────────────
// Fan
// ────────────────────────────────────────────────
IRData fanPower;

// ────────────────────────────────────────────────
// TV (channels 1–9)
// ────────────────────────────────────────────────
#define TV_CHANNEL_COUNT 9
IRData tvPower;
IRData tvChannel[TV_CHANNEL_COUNT];   // index 0 = ch1, 1 = ch2, ..., 8 = ch9
int    learnChannel = -1;

// ────────────────────────────────────────────────
// Button debouncing
// ────────────────────────────────────────────────
bool          lastBtn  = HIGH;
unsigned long lastTime = 0;

// ────────────────────────────────────────────────
// Send IR command
// ────────────────────────────────────────────────
void sendIR(const IRData &d) {
    if (d.proto == UNKNOWN || d.val == 0) {
        terminal.println("⚠️ Empty / invalid IR data");
        terminal.flush();
        return;
    }

    switch (d.proto) {
        case NEC:     irsend.sendNEC(d.val, d.bits); break;
        case SONY:    irsend.sendSony(d.val, d.bits); break;
        case SAMSUNG: irsend.sendSAMSUNG(d.val, d.bits); break;
        case LG:      irsend.sendLG(d.val, d.bits); break;
        case COOLIX:  irsend.sendCOOLIX(d.val); break;
        case GREE:    irsend.sendGree(d.val, d.bits); break;
        case KELON:   irsend.sendKelon(d.val); break;
        case TECO:    irsend.sendTeco(d.val, d.bits, 2); break;
        case HAIER_AC: irsend.sendHaierAC(d.val, d.bits); break;
        default:
            terminal.println("❌ Unsupported protocol: " + String(typeToString(d.proto)));
            terminal.flush();
            return;
    }

    terminal.println("📡 IR SENT");
    terminal.print("Protocol: "); terminal.println(typeToString(d.proto));
    terminal.print("Code: 0x");   terminal.println(d.val, HEX);
    terminal.print("Bits: ");     terminal.println(d.bits);
    terminal.flush();
}

// ────────────────────────────────────────────────
// UI visibility helpers
// ────────────────────────────────────────────────
void hideAll() {
    int pins[] = {V0, V1, V2, V7, V8, V9};
    for (int pin : pins) {
        Blynk.setProperty(pin, "isHidden", true);
    }
}

void showAC() {
    Blynk.setProperty(V0, "isHidden", false);
    Blynk.setProperty(V1, "isHidden", false);
    Blynk.setProperty(V7, "isHidden", false);
}

void showFan() {
    Blynk.setProperty(V2, "isHidden", false);
}

void showTV() {
    Blynk.setProperty(V8, "isHidden", false);
    Blynk.setProperty(V9, "isHidden", false);
}

bool requireDevice() {
    if (currentDevice == NONE) {
        terminal.println("⚠️ Choose the device first.");
        terminal.flush();
        return false;
    }
    return true;
}

// ────────────────────────────────────────────────
// Blynk: Device selector → forces LEARN mode
// ────────────────────────────────────────────────
BLYNK_WRITE(V10) {
    hideAll();
    int s = param.asInt();
    currentMode = LEARN_MODE;
    digitalWrite(LED_PIN, LOW);

    if (s == 0) { currentDevice = AC;  showAC();  terminal.println("🌀 AC selected");  }
    if (s == 1) { currentDevice = FAN; showFan(); terminal.println("🌀 FAN selected"); }
    if (s == 2) { currentDevice = TV;  showTV();  terminal.println("📺 TV selected");  }

    Blynk.setProperty(V10, "isHidden", true);
    terminal.println("🔁 Mode: LEARN");
    terminal.flush();
}

// ────────────────────────────────────────────────
// Blynk: Back button
// ────────────────────────────────────────────────
BLYNK_WRITE(V11) {
    hideAll();
    currentDevice = NONE;
    Blynk.setProperty(V10, "isHidden", false);
    terminal.println("🔙 Back to device selection");
    terminal.flush();
}

// ────────────────────────────────────────────────
// Blynk: AC temperature slider
// ────────────────────────────────────────────────
BLYNK_WRITE(V7) {
    if (!requireDevice() || currentDevice != AC) return;

    int t = param.asInt();
    if (t < TEMP_MIN || t > TEMP_MAX) return;

    if (currentMode == LEARN_MODE) {
        learnTemp = t;
        terminal.printf("📥 Ready to learn %d°C – point remote and press temp button\n", t);
    } else {
        terminal.printf("🌡 Sending %d°C command\n", t);
        sendIR(acTemp[t - TEMP_MIN]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// AC ON / OFF
// ────────────────────────────────────────────────
BLYNK_WRITE(V0) {   // AC ON
    if (!requireDevice() || currentDevice != AC || !param.asInt()) return;

    if (currentMode == LEARN_MODE) {
        currentLearn = LEARN_AC_ON;
        terminal.println("📥 Ready to learn AC ON – point remote and press ON");
    } else {
        terminal.println("🔌 Turning AC ON...");
        sendIR(acOn);
    }
    terminal.flush();
}

BLYNK_WRITE(V1) {   // AC OFF
    if (!requireDevice() || currentDevice != AC || !param.asInt()) return;

    if (currentMode == LEARN_MODE) {
        currentLearn = LEARN_AC_OFF;
        terminal.println("📥 Ready to learn AC OFF – point remote and press OFF");
    } else {
        terminal.println("🔌 Turning AC OFF...");
        sendIR(acOff);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// FAN POWER
// ────────────────────────────────────────────────
BLYNK_WRITE(V2) {   // FAN POWER
    if (!requireDevice() || currentDevice != FAN || !param.asInt()) return;

    if (currentMode == LEARN_MODE) {
        currentLearn = LEARN_FAN_POWER;
        terminal.println("📥 Ready to learn FAN POWER – point remote and press power");
    } else {
        terminal.println("🌀 FAN power toggle...");
        sendIR(fanPower);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// TV POWER
// ────────────────────────────────────────────────
BLYNK_WRITE(V8) {   // TV POWER
    if (!requireDevice() || currentDevice != TV || !param.asInt()) return;

    if (currentMode == LEARN_MODE) {
        currentLearn = LEARN_TV_POWER;
        terminal.println("📥 Ready to learn TV POWER – point remote and press power");
    } else {
        terminal.println("📺 TV power toggle...");
        sendIR(tvPower);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// Blynk: TV channel slider (assuming V9 = channel 1–9)
// ────────────────────────────────────────────────
BLYNK_WRITE(V9) {
    if (!requireDevice() || currentDevice != TV) return;

    int ch = param.asInt();           // assume 1 .. 9
    if (ch < 1 || ch > TV_CHANNEL_COUNT) return;

    if (currentMode == LEARN_MODE) {
        learnChannel = ch - 1;        // store in array 0..8
        terminal.printf("📥 Ready to learn channel %d – point remote and press channel %d\n", ch, ch);
    } else {
        terminal.printf("📺 Changing to channel %d\n", ch);
        sendIR(tvChannel[ch - 1]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// SETUP
// ────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(300);
    Serial.println("\n\n[BOOT] Starting...");

    pinMode(LED_PIN, OUTPUT);
    pinMode(BUTTON_PIN, INPUT_PULLUP);
    digitalWrite(LED_PIN, LOW);
    Serial.println("[BOOT] LED set to OFF (learn mode)");

    Serial.print("[BOOT] Connecting to WiFi: ");
    Serial.println(ssid);

    Blynk.begin(BLYNK_AUTH_TOKEN, ssid, pass);

    Serial.println("[BOOT] Blynk connected");

    irrecv.enableIRIn();
    irsend.begin();

    hideAll();

    // Load saved codes
    prefs.begin("ir", true);

    acOn = IRData(
        (decode_type_t)prefs.getUChar("ac_on_p", 0),
        prefs.getULong64("ac_on_v", 0),
        prefs.getUInt("ac_on_b", 0)
    );

    acOff = IRData(
        (decode_type_t)prefs.getUChar("ac_off_p", 0),
        prefs.getULong64("ac_off_v", 0),
        prefs.getUInt("ac_off_b", 0)
    );

    for (int i = 0; i < TEMP_COUNT; i++) {
        String p = "t" + String(i) + "_p";
        String v = "t" + String(i) + "_v";
        String b = "t" + String(i) + "_b";
        acTemp[i] = IRData(
            (decode_type_t)prefs.getUChar(p.c_str(), 0),
            prefs.getULong64(v.c_str(), 0),
            prefs.getUInt(b.c_str(), 0)
        );
    }

    fanPower = IRData(
        (decode_type_t)prefs.getUChar("fan_p", 0),
        prefs.getULong64("fan_v", 0),
        prefs.getUInt("fan_b", 0)
    );

    tvPower = IRData(
        (decode_type_t)prefs.getUChar("tv_p", 0),
        prefs.getULong64("tv_v", 0),
        prefs.getUInt("tv_b", 0)
    );

    prefs.end();

    terminal.clear();
    terminal.println("✅ SYSTEM READY");
    terminal.println("Current mode: LEARN (press physical button to toggle after selecting device)");
    terminal.flush();

    Serial.println("[BOOT] Setup complete");
}

// ────────────────────────────────────────────────
// Toggle learn/send mode with hardware button
// ────────────────────────────────────────────────
void toggleMode() {
    if (currentDevice == NONE) {
        terminal.println("⚠️ Choose the device first.");
        Serial.println("[BTN] No device selected → ignored");
        terminal.flush();
        return;
    }

    currentMode = (currentMode == LEARN_MODE) ? SEND_MODE : LEARN_MODE;
    digitalWrite(LED_PIN, currentMode == SEND_MODE ? HIGH : LOW);

    const char* modeStr = (currentMode == LEARN_MODE) ? "LEARN" : "SEND";
    terminal.printf("🔁 Mode: %s (LED %s)\n", modeStr, currentMode == SEND_MODE ? "ON" : "OFF");
    Serial.printf("[BTN] Mode → %s | LED → %d\n", modeStr, digitalRead(LED_PIN));
    terminal.flush();
}

// ────────────────────────────────────────────────
// MAIN LOOP
// ────────────────────────────────────────────────
void loop() {
    Blynk.run();

    // Debug: show loop is running
    static unsigned long lastHeartbeat = 0;
    if (millis() - lastHeartbeat > 5000) {
        lastHeartbeat = millis();
        Serial.printf("[ALIVE] millis=%lu | mode=%s | device=%d | btn=%d\n",
                      millis(),
                      currentMode == LEARN_MODE ? "LEARN" : "SEND",
                      currentDevice,
                      digitalRead(BUTTON_PIN));
    }

    // Physical button
    bool s = digitalRead(BUTTON_PIN);
    if (s == LOW && lastBtn == HIGH && (millis() - lastTime > 300)) {
        Serial.println("[BTN] Press detected!");
        toggleMode();
        lastTime = millis();
    }
    lastBtn = s;

    // Learn mode – capture IR signal
    if (currentMode == LEARN_MODE && irrecv.decode(&results)) {
        // Ignore invalid / repeats
        if (results.decode_type == UNKNOWN || results.repeat || results.bits == 0 || results.value == 0xFFFFFFFFFFFFFFFF) {
            Serial.println("⚠️ IR invalid/repeat ignored");
            terminal.println("⚠️ IR invalid/repeat ignored");
            terminal.flush();
            irrecv.resume();
            return;
        }

        prefs.begin("ir", false);

        if (learnTemp != -1) {
            int idx = learnTemp - TEMP_MIN;
            acTemp[idx] = IRData(results.decode_type, results.value, results.bits);
            String p = "t" + String(idx) + "_p";
            String v = "t" + String(idx) + "_v";
            String b = "t" + String(idx) + "_b";
            prefs.putUChar(p.c_str(), results.decode_type);
            prefs.putULong64(v.c_str(), results.value);
            prefs.putUInt(b.c_str(), results.bits);
            terminal.printf("✅ Saved %s for %d°C\n", typeToString(results.decode_type).c_str(), learnTemp);
            learnTemp = -1;
        }
        else if (learnChannel != -1) {
            tvChannel[learnChannel] = IRData(results.decode_type, results.value, results.bits);
            terminal.printf("✅ Saved %s for channel %d\n", typeToString(results.decode_type).c_str(), learnChannel + 1);
            learnChannel = -1;
        }
        else if (currentLearn != LEARN_NONE) {
            String protoStr = typeToString(results.decode_type);
            switch (currentLearn) {
                case LEARN_AC_ON:
                    acOn = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar("ac_on_p", results.decode_type);
                    prefs.putULong64("ac_on_v", results.value);
                    prefs.putUInt("ac_on_b", results.bits);
                    terminal.printf("✅ Saved %s for AC ON\n", protoStr.c_str());
                    break;
                case LEARN_AC_OFF:
                    acOff = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar("ac_off_p", results.decode_type);
                    prefs.putULong64("ac_off_v", results.value);
                    prefs.putUInt("ac_off_b", results.bits);
                    terminal.printf("✅ Saved %s for AC OFF\n", protoStr.c_str());
                    break;
                case LEARN_FAN_POWER:
                    fanPower = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar("fan_p", results.decode_type);
                    prefs.putULong64("fan_v", results.value);
                    prefs.putUInt("fan_b", results.bits);
                    terminal.printf("✅ Saved %s for FAN POWER\n", protoStr.c_str());
                    break;
                case LEARN_TV_POWER:
                    tvPower = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar("tv_p", results.decode_type);
                    prefs.putULong64("tv_v", results.value);
                    prefs.putUInt("tv_b", results.bits);
                    terminal.printf("✅ Saved %s for TV POWER\n", protoStr.c_str());
                    break;
                default:
                    break;
            }
            currentLearn = LEARN_NONE;
        } else {
            terminal.println("⚠️ Select what to learn first (press button/slider)");
        }

        prefs.end();
        terminal.flush();
        irrecv.resume();
    }
}
