#define BLYNK_TEMPLATE_ID "TMPL2sOm63FlB"
#define BLYNK_TEMPLATE_NAME "template2"
#define BLYNK_AUTH_TOKEN "iOHgXVb-dlzdtqEDXdSLICWJnnAM4W9u"

#define BLYNK_PRINT Serial

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
char ssid[] = "HONOR 200";
char pass[] = "swampyae2005";

// ────────────────────────────────────────────────
// Blynk
// ────────────────────────────────────────────────
WidgetTerminal terminal(V4);


// ────────────────────────────────────────────────
// Pins
// ────────────────────────────────────────────────
#define LED_PIN 26
#define BUTTON_PIN 27
#define IR_RECV_PIN 14
#define IR_SEND_PIN 4

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
enum Mode
{
    LEARN_MODE,
    SEND_MODE
};
Mode currentMode = LEARN_MODE;

// ────────────────────────────────────────────────
// Device selection
// ────────────────────────────────────────────────
enum DeviceId
{
    NONE,
    AC1,
    AC2,
    AC3,
    FAN1,
    FAN2,
    TV1,
    TV2,
    PROJECTOR1,
    PROJECTOR2
};
DeviceId currentDevice = NONE;

// ────────────────────────────────────────────────
// Learn actions for power buttons
// ────────────────────────────────────────────────
enum LearnAction
{
    LEARN_NONE,
    LEARN_AC_ON,
    LEARN_AC_OFF,
    LEARN_FAN_POWER,
    LEARN_FAN_SWING,
    LEARN_TV_POWER,
    LEARN_PROJECTOR_POWER
};
LearnAction currentLearn = LEARN_NONE;
int learnFanSpeed = -1;

// ────────────────────────────────────────────────
// IR code storage structure
// ────────────────────────────────────────────────
struct IRData
{
    decode_type_t proto = UNKNOWN;
    uint64_t val = 0;
    uint16_t bits = 0;

    IRData() = default;
    IRData(decode_type_t p, uint64_t v, uint16_t b)
        : proto(p), val(v), bits(b) {}
};

// ────────────────────────────────────────────────
// AC related (AC1..AC3)
// ────────────────────────────────────────────────
#define TEMP_MIN 17
#define TEMP_MAX 25
#define TEMP_COUNT (TEMP_MAX - TEMP_MIN + 1)

IRData acOn[3];
IRData acOff[3];
IRData acTemp[3][TEMP_COUNT];
int learnTemp = -1;

// ────────────────────────────────────────────────
// Fan (FAN1..FAN2)
// ────────────────────────────────────────────────
IRData fanPower[2];
IRData fanSwing[2];
IRData fanSpeed[2][3];

// ────────────────────────────────────────────────
// TV (channels 1–9, TV1..TV2)
// ────────────────────────────────────────────────
#define TV_CHANNEL_COUNT 9
IRData tvPower[2];
IRData tvChannel[2][TV_CHANNEL_COUNT]; // index 0 = ch1, 1 = ch2, ..., 8 = ch9
int learnChannel = -1;

// ────────────────────────────────────────────────
// Projector (PROJECTOR1..PROJECTOR2)
// ────────────────────────────────────────────────
IRData projectorPower[2];

// ────────────────────────────────────────────────
// Button debouncing
// ────────────────────────────────────────────────
bool lastBtn = HIGH;
unsigned long lastTime = 0;

// ────────────────────────────────────────────────
// Device helpers
// ────────────────────────────────────────────────
enum DeviceGroup
{
    GROUP_NONE,
    GROUP_AC,
    GROUP_FAN,
    GROUP_TV,
    GROUP_PROJECTOR
};

DeviceGroup currentGroup()
{
    switch (currentDevice)
    {
    case AC1:
    case AC2:
    case AC3:
        return GROUP_AC;
    case FAN1:
    case FAN2:
        return GROUP_FAN;
    case TV1:
    case TV2:
        return GROUP_TV;
    case PROJECTOR1:
    case PROJECTOR2:
        return GROUP_PROJECTOR;
    default:
        return GROUP_NONE;
    }
}

int currentIndex()
{
    switch (currentDevice)
    {
    case AC1:
        return 0;
    case AC2:
        return 1;
    case AC3:
        return 2;
    case FAN1:
        return 0;
    case FAN2:
        return 1;
    case TV1:
        return 0;
    case TV2:
        return 1;
    case PROJECTOR1:
        return 0;
    case PROJECTOR2:
        return 1;
    default:
        return -1;
    }
}

String devicePrefix()
{
    switch (currentDevice)
    {
    case AC1:
        return "ac1_";
    case AC2:
        return "ac2_";
    case AC3:
        return "ac3_";
    case FAN1:
        return "fan1_";
    case FAN2:
        return "fan2_";
    case TV1:
        return "tv1_";
    case TV2:
        return "tv2_";
    case PROJECTOR1:
        return "proj1_";
    case PROJECTOR2:
        return "proj2_";
    default:
        return "";
    }
}

// ────────────────────────────────────────────────
// Send IR command
// ────────────────────────────────────────────────
void sendIR(const IRData &d)
{
    if (d.proto == UNKNOWN || d.val == 0)
    {
        terminal.println("⚠️ Empty / invalid IR data");
        terminal.flush();
        return;
    }

    switch (d.proto)
    {
    case NEC:
        irsend.sendNEC(d.val, d.bits);
        break;
    case SONY:
        irsend.sendSony(d.val, d.bits);
        break;
    case SAMSUNG:
        irsend.sendSAMSUNG(d.val, d.bits);
        break;
    case LG:
        irsend.sendLG(d.val, d.bits);
        break;
    case COOLIX:
        irsend.sendCOOLIX(d.val);
        break;
    case GREE:
        irsend.sendGree(d.val, d.bits);
        break;
    case KELON:
        irsend.sendKelon(d.val);
        break;
    case TECO:
        irsend.sendTeco(d.val, d.bits, 2);
        break;
    default:
        terminal.println("❌ Unsupported protocol: " + String(typeToString(d.proto)));
        terminal.flush();
        return;
    }

    terminal.println("📡 IR SENT");
    terminal.print("Protocol: ");
    terminal.println(typeToString(d.proto));
    terminal.print("Code: 0x");
    terminal.println(d.val, HEX);
    terminal.print("Bits: ");
    terminal.println(d.bits);
    terminal.flush();
}

// ────────────────────────────────────────────────
// UI visibility helpers
// ────────────────────────────────────────────────
void hideAll()
{
    int pins[] = {V0, V1, V2, V3, V5, V6, V7, V8, V9};
    for (int pin : pins)
    {
        Blynk.setProperty(pin, "isHidden", true);
    }
}

void showAC()
{
    Blynk.setProperty(V0, "isHidden", false);
    Blynk.setProperty(V1, "isHidden", false);
    Blynk.setProperty(V7, "isHidden", false);
}

void showFan()
{
    Blynk.setProperty(V2, "isHidden", false);
    Blynk.setProperty(V6, "isHidden", false);
    Blynk.setProperty(V5, "isHidden", false);
}

void showTV()
{
    Blynk.setProperty(V8, "isHidden", false);
    Blynk.setProperty(V9, "isHidden", false);
}

void showPROJECTOR()
{
    Blynk.setProperty(V3, "isHidden", false);
}

bool requireDevice()
{
    if (currentDevice == NONE)
    {
        terminal.println("⚠️ Choose the device first.");
        terminal.flush();
        return false;
    }
    return true;
}

// ────────────────────────────────────────────────
// Blynk: Device selector → forces LEARN mode
// ────────────────────────────────────────────────
BLYNK_WRITE(V12)
{
    hideAll();
    currentMode = LEARN_MODE;
    digitalWrite(LED_PIN, LOW);

    // Support both numeric values and Menu selector strings
    int sel = -1;
    int rawInt = param.asInt();
    String sval = String(param.asStr());
    sval.trim();

    Serial.printf("[MENU] raw int=%d raw str='%s'\n", rawInt, sval.c_str());
    terminal.printf("[MENU] raw int=%d raw str='%s'\n", rawInt, sval.c_str());
    terminal.flush();

    bool hasAlpha = false;
    for (unsigned int i = 0; i < sval.length(); i++)
    {
        char c = sval.charAt(i);
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))
        {
            hasAlpha = true;
            break;
        }
    }

    if (hasAlpha)
    {
        String up = sval;
        up.toUpperCase();

        int num = -1;
        for (unsigned int i = 0; i < up.length(); i++)
        {
            char c = up.charAt(i);
            if (c >= '0' && c <= '9')
            {
                if (num < 0)
                    num = 0;
                num = num * 10 + (c - '0');
            }
        }

        if (up.indexOf("AC") >= 0 && num >= 1 && num <= 3)
            sel = num - 1;
        else if (up.indexOf("FAN") >= 0 && num >= 1 && num <= 2)
            sel = 3 + (num - 1);
        else if (up.indexOf("TV") >= 0 && num >= 1 && num <= 2)
            sel = 5 + (num - 1);
        else if (up.indexOf("PROJECTOR") >= 0 && num >= 1 && num <= 2)
            sel = 7 + (num - 1);
    }

    if (sel < 0)
    {
        // Numeric menu values: prefer string value first, then raw int.
        int svalInt = sval.toInt();
        if (sval.length() > 0 && (svalInt >= 0 && svalInt <= 8))
            sel = svalInt;
        else if (sval.length() > 0 && (svalInt >= 1 && svalInt <= 9))
            sel = svalInt - 1;
        else if (rawInt >= 0 && rawInt <= 8)
            sel = rawInt;
        else if (rawInt >= 1 && rawInt <= 9)
            sel = rawInt - 1;
    }

    // if (sel == 0)
    // {
    //     currentDevice = AC1;
    //     showAC();
    //     terminal.println("🌀 AC 1 selected");
    // }
    // else if (sel == 1)
    // {
    //     currentDevice = AC2;
    //     showAC();
    //     terminal.println("🌀 AC 2 selected");
    // }
    // else if (sel == 2)
    // {
    //     currentDevice = AC3;
    //     showAC();
    //     terminal.println("🌀 AC 3 selected");
    // }
    // else if (sel == 3)
    // {
    //     currentDevice = FAN1;
    //     showFan();
    //     terminal.println("🌀 FAN 1 selected");
    // }
    // else if (sel == 4)
    // {
    //     currentDevice = FAN2;
    //     showFan();
    //     terminal.println("🌀 FAN 2 selected");
    // }
    // else if (sel == 5)
    // {
    //     currentDevice = TV1;
    //     showTV();
    //     terminal.println("📺 TV 1 selected");
    // }
    // else if (sel == 6)
    // {
    //     currentDevice = TV2;
    //     showTV();
    //     terminal.println("📺 TV 2 selected");
    // }
    // else if (sel == 7)
    // {
    //     currentDevice = PROJECTOR1;
    //     showPROJECTOR();
    //     terminal.println("📽 Projector 1 selected");
    // }
    // else if (sel == 8)
    // {
    //     currentDevice = PROJECTOR2;
    //     showPROJECTOR();
    //     terminal.println("📽 Projector 2 selected");
    // }
    // else
    // {
    //     terminal.println("⚠️ Unknown selection");
    //     terminal.flush();
    //     return;
    // }
    // terminal.printf("Parsed selection: %d\n", sel);

    switch (sel)
    {
    case 0:
        currentDevice = AC1;
        showAC();
        terminal.println("🌀 AC 1 selected");
        break;
    case 1:
        currentDevice = AC2;
        showAC();
        terminal.println("🌀 AC 2 selected");
        break;
    case 2:
        currentDevice = AC3;
        showAC();
        terminal.println("🌀 AC 3 selected");
        break;
    case 3:
        currentDevice = FAN1;
        showFan();
        terminal.println("🌀 FAN 1 selected");
        break;
    case 4:
        currentDevice = FAN2;
        showFan();
        terminal.println("🌀 FAN 2 selected");
        break;
    case 5:
        currentDevice = TV1;
        showTV();
        terminal.println("📺 TV 1 selected");
        break;
    case 6:
        currentDevice = TV2;
        showTV();
        terminal.println("📺 TV 2 selected");
        break;
    case 7:
        currentDevice = PROJECTOR1;
        showPROJECTOR();
        terminal.println("📽 Projector 1 selected");
        break;
    case 8:
        currentDevice = PROJECTOR2;
        showPROJECTOR();
        terminal.println("📽 Projector 2 selected");
        break;
    default:
        terminal.println("⚠️ Unknown selection");
        terminal.flush();
        return;
    }

    Blynk.setProperty(V10, "isHidden", true);
    terminal.println("🔁 Mode: LEARN");
    terminal.flush();
}

// ────────────────────────────────────────────────
// Blynk: Back button
// ────────────────────────────────────────────────
BLYNK_WRITE(V11)
{
    hideAll();
    currentDevice = NONE;
    Blynk.setProperty(V10, "isHidden", false);
    terminal.println("🔙 Back to device selection");
    terminal.flush();
}

// ────────────────────────────────────────────────
// Blynk: AC temperature slider
// ────────────────────────────────────────────────
BLYNK_WRITE(V7)
{
    if (!requireDevice() || currentGroup() != GROUP_AC)
        return;

    int t = param.asInt();
    if (t < TEMP_MIN || t > TEMP_MAX)
        return;

    if (currentMode == LEARN_MODE)
    {
        learnTemp = t;
        terminal.printf("📥 Ready to learn %d°C – point remote and press temp button\n", t);
    }
    else
    {
        terminal.printf("🌡 Sending %d°C command\n", t);
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(acTemp[idx][t - TEMP_MIN]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// AC ON / OFF
// ────────────────────────────────────────────────
BLYNK_WRITE(V0)
{ // AC ON
    if (!requireDevice() || currentGroup() != GROUP_AC || !param.asInt())
        return;

    if (currentMode == LEARN_MODE)
    {
        currentLearn = LEARN_AC_ON;
        terminal.println("📥 Ready to learn AC ON – point remote and press ON");
    }
    else
    {
        terminal.println("🔌 Turning AC ON...");
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(acOn[idx]);
    }
    terminal.flush();
}

BLYNK_WRITE(V1)
{ // AC OFF
    if (!requireDevice() || currentGroup() != GROUP_AC || !param.asInt())
        return;

    if (currentMode == LEARN_MODE)
    {
        currentLearn = LEARN_AC_OFF;
        terminal.println("📥 Ready to learn AC OFF – point remote and press OFF");
    }
    else
    {
        terminal.println("🔌 Turning AC OFF...");
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(acOff[idx]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// FAN POWER
// ────────────────────────────────────────────────
BLYNK_WRITE(V2)
{ // FAN POWER
    if (!requireDevice() || currentGroup() != GROUP_FAN || !param.asInt())
        return;

    if (currentMode == LEARN_MODE)
    {
        currentLearn = LEARN_FAN_POWER;
        terminal.println("📥 Ready to learn FAN POWER – point remote and press power");
    }
    else
    {
        terminal.println("🌀 FAN power toggle...");
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(fanPower[idx]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// FAN SWING
// ────────────────────────────────────────────────
BLYNK_WRITE(V6)
{ // FAN SWING
    if (!requireDevice() || currentGroup() != GROUP_FAN || !param.asInt())
        return;

    if (currentMode == LEARN_MODE)
    {
        currentLearn = LEARN_FAN_SWING;
        terminal.println("📥 Ready to learn FAN SWING – point remote and press swing");
    }
    else
    {
        terminal.println("🔁 FAN swing toggle...");
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(fanSwing[idx]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// FAN SPEED (V5: 1..3)
// ────────────────────────────────────────────────
BLYNK_WRITE(V5)
{
    if (!requireDevice() || currentGroup() != GROUP_FAN)
        return;

    int s = param.asInt(); // expected 1..3
    if (s < 1 || s > 3)
        return;

    if (currentMode == LEARN_MODE)
    {
        learnFanSpeed = s - 1;
        terminal.printf("📥 Ready to learn FAN SPEED %d – point remote and press speed %d\n", s, s);
    }
    else
    {
        terminal.printf("🌀 Sending FAN SPEED %d\n", s);
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(fanSpeed[idx][s - 1]);
    }
    terminal.flush();
}

BLYNK_WRITE(V3)
{ // PROJECTOR POWER
    if (!requireDevice() || currentGroup() != GROUP_PROJECTOR || !param.asInt())
        return;

    if (currentMode == LEARN_MODE)
    {
        currentLearn = LEARN_PROJECTOR_POWER;
        terminal.println("📥 Ready to learn PROJECTOR POWER – point remote and press power");
    }
    else
    {
        terminal.println("📽 Projector power toggle...");
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(projectorPower[idx]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// TV POWER
// ────────────────────────────────────────────────
BLYNK_WRITE(V8)
{ // TV POWER
    if (!requireDevice() || currentGroup() != GROUP_TV || !param.asInt())
        return;

    if (currentMode == LEARN_MODE)
    {
        currentLearn = LEARN_TV_POWER;
        terminal.println("📥 Ready to learn TV POWER – point remote and press power");
    }
    else
    {
        terminal.println("📺 TV power toggle...");
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(tvPower[idx]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// Blynk: TV channel slider (assuming V9 = channel 1–9)
// ────────────────────────────────────────────────
BLYNK_WRITE(V9)
{
    if (!requireDevice() || currentGroup() != GROUP_TV)
        return;

    int ch = param.asInt(); // assume 1 .. 9
    if (ch < 1 || ch > TV_CHANNEL_COUNT)
        return;

    if (currentMode == LEARN_MODE)
    {
        learnChannel = ch - 1; // store in array 0..8
        terminal.printf("📥 Ready to learn channel %d – point remote and press channel %d\n", ch, ch);
    }
    else
    {
        terminal.printf("📺 Changing to channel %d\n", ch);
        int idx = currentIndex();
        if (idx >= 0)
            sendIR(tvChannel[idx][ch - 1]);
    }
    terminal.flush();
}

// ────────────────────────────────────────────────
// SETUP
// ────────────────────────────────────────────────
void setup()
{
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

    // AC1..AC3
    for (int ac = 0; ac < 3; ac++)
    {
        String prefix = "ac" + String(ac + 1) + "_";
        acOn[ac] = IRData(
            (decode_type_t)prefs.getUChar((prefix + "on_p").c_str(), 0),
            prefs.getULong64((prefix + "on_v").c_str(), 0),
            prefs.getUInt((prefix + "on_b").c_str(), 0));

        acOff[ac] = IRData(
            (decode_type_t)prefs.getUChar((prefix + "off_p").c_str(), 0),
            prefs.getULong64((prefix + "off_v").c_str(), 0),
            prefs.getUInt((prefix + "off_b").c_str(), 0));

        for (int i = 0; i < TEMP_COUNT; i++)
        {
            String p = prefix + "t" + String(i) + "_p";
            String v = prefix + "t" + String(i) + "_v";
            String b = prefix + "t" + String(i) + "_b";
            acTemp[ac][i] = IRData(
                (decode_type_t)prefs.getUChar(p.c_str(), 0),
                prefs.getULong64(v.c_str(), 0),
                prefs.getUInt(b.c_str(), 0));
        }
    }

    // FAN1..FAN2
    for (int fan = 0; fan < 2; fan++)
    {
        String prefix = "fan" + String(fan + 1) + "_";
        fanPower[fan] = IRData(
            (decode_type_t)prefs.getUChar((prefix + "p").c_str(), 0),
            prefs.getULong64((prefix + "v").c_str(), 0),
            prefs.getUInt((prefix + "b").c_str(), 0));

        fanSwing[fan] = IRData(
            (decode_type_t)prefs.getUChar((prefix + "swing_p").c_str(), 0),
            prefs.getULong64((prefix + "swing_v").c_str(), 0),
            prefs.getUInt((prefix + "swing_b").c_str(), 0));

        for (int i = 0; i < 3; i++)
        {
            String p = prefix + "sp" + String(i) + "_p";
            String v = prefix + "sp" + String(i) + "_v";
            String b = prefix + "sp" + String(i) + "_b";
            fanSpeed[fan][i] = IRData(
                (decode_type_t)prefs.getUChar(p.c_str(), 0),
                prefs.getULong64(v.c_str(), 0),
                prefs.getUInt(b.c_str(), 0));
        }
    }

    // TV1..TV2
    for (int tv = 0; tv < 2; tv++)
    {
        String prefix = "tv" + String(tv + 1) + "_";
        tvPower[tv] = IRData(
            (decode_type_t)prefs.getUChar((prefix + "p").c_str(), 0),
            prefs.getULong64((prefix + "v").c_str(), 0),
            prefs.getUInt((prefix + "b").c_str(), 0));

        for (int ch = 0; ch < TV_CHANNEL_COUNT; ch++)
        {
            String p = prefix + "ch" + String(ch) + "_p";
            String v = prefix + "ch" + String(ch) + "_v";
            String b = prefix + "ch" + String(ch) + "_b";
            tvChannel[tv][ch] = IRData(
                (decode_type_t)prefs.getUChar(p.c_str(), 0),
                prefs.getULong64(v.c_str(), 0),
                prefs.getUInt(b.c_str(), 0));
        }
    }

    // PROJECTOR1..PROJECTOR2
    for (int pr = 0; pr < 2; pr++)
    {
        String prefix = "proj" + String(pr + 1) + "_";
        projectorPower[pr] = IRData(
            (decode_type_t)prefs.getUChar((prefix + "p").c_str(), 0),
            prefs.getULong64((prefix + "v").c_str(), 0),
            prefs.getUInt((prefix + "b").c_str(), 0));
    }

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
void toggleMode()
{
    if (currentDevice == NONE)
    {
        terminal.println("⚠️ Choose the device first.");
        Serial.println("[BTN] No device selected → ignored");
        terminal.flush();
        return;
    }

    currentMode = (currentMode == LEARN_MODE) ? SEND_MODE : LEARN_MODE;
    digitalWrite(LED_PIN, currentMode == SEND_MODE ? HIGH : LOW);

    const char *modeStr = (currentMode == LEARN_MODE) ? "LEARN" : "SEND";
    terminal.printf("🔁 Mode: %s (LED %s)\n", modeStr, currentMode == SEND_MODE ? "ON" : "OFF");
    Serial.printf("[BTN] Mode → %s | LED → %d\n", modeStr, digitalRead(LED_PIN));
    terminal.flush();
}

// ────────────────────────────────────────────────
// MAIN LOOP
// ────────────────────────────────────────────────
void loop()
{
    Blynk.run();

    // Debug: show loop is running
    static unsigned long lastHeartbeat = 0;
    if (millis() - lastHeartbeat > 5000)
    {
        lastHeartbeat = millis();
        Serial.printf("[ALIVE] millis=%lu | mode=%s | device=%d | btn=%d\n",
                      millis(),
                      currentMode == LEARN_MODE ? "LEARN" : "SEND",
                      currentDevice,
                      digitalRead(BUTTON_PIN));
    }

    // Physical button
    bool s = digitalRead(BUTTON_PIN);
    if (s == LOW && lastBtn == HIGH && (millis() - lastTime > 300))
    {
        Serial.println("[BTN] Press detected!");
        toggleMode();
        lastTime = millis();
    }
    lastBtn = s;

    // Learn mode – capture IR signal
    if (currentMode == LEARN_MODE && irrecv.decode(&results))
    {
        // Ignore invalid / repeats
        if (results.decode_type == UNKNOWN || results.repeat || results.bits == 0 || results.value == 0xFFFFFFFFFFFFFFFF)
        {
            Serial.println("⚠️ IR invalid/repeat ignored");
            terminal.println("⚠️ IR invalid/repeat ignored");
            terminal.flush();
            irrecv.resume();
            return;
        }

        prefs.begin("ir", false);

        String prefix = devicePrefix();

        if (learnTemp != -1)
        {
            int idx = learnTemp - TEMP_MIN;
            int dev = currentIndex();
            if (dev >= 0 && currentGroup() == GROUP_AC)
            {
                acTemp[dev][idx] = IRData(results.decode_type, results.value, results.bits);
                String p = prefix + "t" + String(idx) + "_p";
                String v = prefix + "t" + String(idx) + "_v";
                String b = prefix + "t" + String(idx) + "_b";
                prefs.putUChar(p.c_str(), results.decode_type);
                prefs.putULong64(v.c_str(), results.value);
                prefs.putUInt(b.c_str(), results.bits);
            }
            terminal.printf("✅ Saved %s for %d°C\n", typeToString(results.decode_type).c_str(), learnTemp);
            learnTemp = -1;
        }
        else if (learnChannel != -1)
        {
            int dev = currentIndex();
            if (dev >= 0 && currentGroup() == GROUP_TV)
            {
                tvChannel[dev][learnChannel] = IRData(results.decode_type, results.value, results.bits);
                String p = prefix + "ch" + String(learnChannel) + "_p";
                String v = prefix + "ch" + String(learnChannel) + "_v";
                String b = prefix + "ch" + String(learnChannel) + "_b";
                prefs.putUChar(p.c_str(), results.decode_type);
                prefs.putULong64(v.c_str(), results.value);
                prefs.putUInt(b.c_str(), results.bits);
            }
            terminal.printf("✅ Saved %s for channel %d\n", typeToString(results.decode_type).c_str(), learnChannel + 1);
            learnChannel = -1;
        }
        else if (learnFanSpeed != -1)
        {
            int idx = learnFanSpeed;
            int dev = currentIndex();
            if (dev >= 0 && currentGroup() == GROUP_FAN)
            {
                fanSpeed[dev][idx] = IRData(results.decode_type, results.value, results.bits);
                String p = prefix + "sp" + String(idx) + "_p";
                String v = prefix + "sp" + String(idx) + "_v";
                String b = prefix + "sp" + String(idx) + "_b";
                prefs.putUChar(p.c_str(), results.decode_type);
                prefs.putULong64(v.c_str(), results.value);
                prefs.putUInt(b.c_str(), results.bits);
            }
            terminal.printf("✅ Saved %s for FAN SPEED %d\n", typeToString(results.decode_type).c_str(), idx + 1);
            learnFanSpeed = -1;
        }
        else if (currentLearn != LEARN_NONE)
        {
            String protoStr = typeToString(results.decode_type);
            switch (currentLearn)
            {
            case LEARN_AC_ON:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_AC)
                {
                    acOn[dev] = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar((prefix + "on_p").c_str(), results.decode_type);
                    prefs.putULong64((prefix + "on_v").c_str(), results.value);
                    prefs.putUInt((prefix + "on_b").c_str(), results.bits);
                    terminal.printf("✅ Saved %s for AC ON\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_AC_OFF:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_AC)
                {
                    acOff[dev] = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar((prefix + "off_p").c_str(), results.decode_type);
                    prefs.putULong64((prefix + "off_v").c_str(), results.value);
                    prefs.putUInt((prefix + "off_b").c_str(), results.bits);
                    terminal.printf("✅ Saved %s for AC OFF\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_FAN_POWER:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_FAN)
                {
                    fanPower[dev] = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar((prefix + "p").c_str(), results.decode_type);
                    prefs.putULong64((prefix + "v").c_str(), results.value);
                    prefs.putUInt((prefix + "b").c_str(), results.bits);
                    terminal.printf("✅ Saved %s for FAN POWER\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_FAN_SWING:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_FAN)
                {
                    fanSwing[dev] = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar((prefix + "swing_p").c_str(), results.decode_type);
                    prefs.putULong64((prefix + "swing_v").c_str(), results.value);
                    prefs.putUInt((prefix + "swing_b").c_str(), results.bits);
                    terminal.printf("✅ Saved %s for FAN SWING\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_TV_POWER:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_TV)
                {
                    tvPower[dev] = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar((prefix + "p").c_str(), results.decode_type);
                    prefs.putULong64((prefix + "v").c_str(), results.value);
                    prefs.putUInt((prefix + "b").c_str(), results.bits);
                    terminal.printf("✅ Saved %s for TV POWER\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_PROJECTOR_POWER:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_PROJECTOR)
                {
                    projectorPower[dev] = IRData(results.decode_type, results.value, results.bits);
                    prefs.putUChar((prefix + "p").c_str(), results.decode_type);
                    prefs.putULong64((prefix + "v").c_str(), results.value);
                    prefs.putUInt((prefix + "b").c_str(), results.bits);
                    terminal.printf("✅ Saved %s for PROJECTOR POWER\n", protoStr.c_str());
                }
                break;
            }
            default:
                break;
            }
            currentLearn = LEARN_NONE;
        }
        else
        {
            terminal.println("⚠️ Select what to learn first (press button/slider)");
        }

        prefs.end();
        terminal.flush();
        irrecv.resume();
    }
}
