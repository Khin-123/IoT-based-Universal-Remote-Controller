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
char ssid[] = "Xiaomi 15T Pro";
char pass[] = "d0ntc0nnect";

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
constexpr uint16_t IR_RECV_BUFFER_SIZE = 1024;
constexpr uint8_t IR_RECV_TIMEOUT_MS = 50;
constexpr uint16_t IR_RAW_FALLBACK_HZ = 38;
constexpr uint16_t IR_RAW_STORE_MAX = 300;

// ────────────────────────────────────────────────
// IR objects
// ────────────────────────────────────────────────
IRrecv irrecv(IR_RECV_PIN, IR_RECV_BUFFER_SIZE, IR_RECV_TIMEOUT_MS, true);
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
    uint8_t state[kStateSizeMax] = {0};
    uint16_t stateLen = 0;
    uint16_t raw[IR_RAW_STORE_MAX] = {0};
    uint16_t rawLen = 0;

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
int acLastTempSet[3] = {TEMP_MAX, TEMP_MAX, TEMP_MAX};
bool acLastTempValid[3] = {false, false, false};

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
String slotBaseFromProtoKey(const String &protoKey)
{
    if (protoKey.endsWith("_p") && protoKey.length() > 2)
        return protoKey.substring(0, protoKey.length() - 2);
    return protoKey;
}

IRData loadIRDataFromPrefs(const String &protoKey, const String &valKey, const String &bitsKey)
{
    IRData d(
        (decode_type_t)prefs.getUChar(protoKey.c_str(), 0),
        prefs.getULong64(valKey.c_str(), 0),
        prefs.getUInt(bitsKey.c_str(), 0));

    String base = slotBaseFromProtoKey(protoKey);
    String stateLenKey = base + "_sl";
    String stateKey = base + "_s";
    d.stateLen = prefs.getUShort(stateLenKey.c_str(), 0);
    if (d.stateLen > kStateSizeMax)
        d.stateLen = kStateSizeMax;
    if (d.stateLen > 0)
    {
        size_t expectedStateBytes = d.stateLen;
        size_t foundStateBytes = prefs.getBytesLength(stateKey.c_str());
        if (foundStateBytes >= expectedStateBytes)
            prefs.getBytes(stateKey.c_str(), d.state, expectedStateBytes);
        else
            d.stateLen = 0;
    }

    String rawLenKey = base + "_rl";
    String rawKey = base + "_r";
    d.rawLen = prefs.getUShort(rawLenKey.c_str(), 0);
    if (d.rawLen > IR_RAW_STORE_MAX)
        d.rawLen = IR_RAW_STORE_MAX;
    if (d.rawLen > 0)
    {
        size_t expectedRawBytes = (size_t)d.rawLen * sizeof(uint16_t);
        size_t foundRawBytes = prefs.getBytesLength(rawKey.c_str());
        if (foundRawBytes >= expectedRawBytes)
            prefs.getBytes(rawKey.c_str(), d.raw, expectedRawBytes);
        else
            d.rawLen = 0;
    }

    return d;
}

void saveIRDataToPrefs(const String &protoKey, const String &valKey, const String &bitsKey, const IRData &d)
{
    prefs.putUChar(protoKey.c_str(), (uint8_t)d.proto);
    prefs.putULong64(valKey.c_str(), d.val);
    prefs.putUInt(bitsKey.c_str(), d.bits);

    String base = slotBaseFromProtoKey(protoKey);
    String stateLenKey = base + "_sl";
    String stateKey = base + "_s";
    prefs.putUShort(stateLenKey.c_str(), d.stateLen);
    if (d.stateLen > 0)
        prefs.putBytes(stateKey.c_str(), d.state, d.stateLen);
    else
        prefs.remove(stateKey.c_str());

    String rawLenKey = base + "_rl";
    String rawKey = base + "_r";
    prefs.putUShort(rawLenKey.c_str(), d.rawLen);
    if (d.rawLen > 0)
        prefs.putBytes(rawKey.c_str(), d.raw, (size_t)d.rawLen * sizeof(uint16_t));
    else
        prefs.remove(rawKey.c_str());
}

bool decodeResultToIRData(const decode_results &src, IRData &out)
{
    out = IRData();
    out.proto = src.decode_type;

    if (hasACState(src.decode_type))
    {
        uint16_t stateBytes = (src.bits + 7) / 8;
        if (stateBytes == 0)
            return false;
        if (stateBytes > kStateSizeMax)
            stateBytes = kStateSizeMax;
        memcpy(out.state, src.state, stateBytes);
        out.stateLen = stateBytes;
        out.bits = src.bits;
        return true;
    }

    if (src.decode_type == UNKNOWN)
    {
        if (src.rawlen <= 1)
            return false;

        uint16_t correctedRawLen = getCorrectedRawLength(&src);
        if (correctedRawLen == 0)
            return false;

        uint16_t *rawArray = resultToRawArray(&src);
        if (rawArray == nullptr)
            return false;

        out.rawLen = correctedRawLen;
        if (out.rawLen > IR_RAW_STORE_MAX)
            out.rawLen = IR_RAW_STORE_MAX;

        memcpy(out.raw, rawArray, (size_t)out.rawLen * sizeof(uint16_t));
        delete[] rawArray;

        return out.rawLen > 0;
    }

    if (src.bits == 0 || src.value == UINT64_MAX)
        return false;

    out.val = src.value;
    out.bits = src.bits;
    return true;
}

bool hasIRPayload(const IRData &d)
{
    if (d.proto == UNKNOWN)
        return d.rawLen > 0;
    if (hasACState(d.proto))
        return d.stateLen > 0;
    return d.bits > 0 && d.val != UINT64_MAX;
}

void sendIR(const IRData &d)
{
    bool sent = false;
    String protoStr = typeToString(d.proto);

    if (hasACState(d.proto) && d.stateLen > 0)
        sent = irsend.send(d.proto, d.state, d.stateLen);

    if (!sent && d.proto == UNKNOWN && d.rawLen == 0)
    {
        terminal.println("⚠️ Empty / invalid IR data");
        terminal.flush();
        return;
    }

    bool usesLegacySwitch = d.proto == NEC || d.proto == SONY || d.proto == SAMSUNG ||
                            d.proto == LG || d.proto == COOLIX || d.proto == GREE ||
                            d.proto == KELON || d.proto == TECO;
    if (!sent && !usesLegacySwitch && d.proto != UNKNOWN && d.bits > 0 && d.val != UINT64_MAX)
        sent = irsend.send(d.proto, d.val, d.bits);

    if (!sent && d.proto == UNKNOWN && d.rawLen > 0)
    {
        irsend.sendRaw(d.raw, d.rawLen, IR_RAW_FALLBACK_HZ);
        sent = true;
    }

    if (!sent && !usesLegacySwitch)
    {
        terminal.println("Empty / unsupported IR data");
        terminal.flush();
        return;
    }

    if (!sent && usesLegacySwitch)
        switch (d.proto)
    {
    case NEC:
        irsend.sendNEC(d.val, d.bits);
        sent = true;
        break;
    case SONY:
        irsend.sendSony(d.val, d.bits);
        sent = true;
        break;
    case SAMSUNG:
        irsend.sendSAMSUNG(d.val, d.bits);
        sent = true;
        break;
    case LG:
        irsend.sendLG(d.val, d.bits);
        sent = true;
        break;
    case COOLIX:
        irsend.sendCOOLIX(d.val);
        sent = true;
        break;
    case GREE:
        irsend.sendGree(d.val, d.bits);
        sent = true;
        break;
    case KELON:
        irsend.sendKelon(d.val);
        sent = true;
        break;
    case TECO:
        irsend.sendTeco(d.val, d.bits, 2);
        sent = true;
        break;
    default:
        terminal.println("❌ Unsupported protocol: " + String(typeToString(d.proto)));
        terminal.flush();
        return;
    }

    terminal.println("📡 IR SENT");
    terminal.print("Protocol: ");
    terminal.println(protoStr);
    if (d.proto == UNKNOWN && d.rawLen > 0)
    {
        terminal.print("Raw timings: ");
        terminal.println(d.rawLen);
    }
    else if (hasACState(d.proto) && d.stateLen > 0)
    {
        terminal.print("State bytes: ");
        terminal.println(d.stateLen);
    }
    else
    {
        terminal.print("Code: 0x");
        terminal.println(d.val, HEX);
        terminal.print("Bits: ");
        terminal.println(d.bits);
    }
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
        {
            sendIR(acTemp[idx][t - TEMP_MIN]);
            acLastTempSet[idx] = t;
            acLastTempValid[idx] = true;
        }
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
        {
            bool sentTempState = false;
            if (acLastTempValid[idx])
            {
                int tempIdx = acLastTempSet[idx] - TEMP_MIN;
                if (tempIdx >= 0 && tempIdx < TEMP_COUNT && hasIRPayload(acTemp[idx][tempIdx]))
                {
                    terminal.printf("🌡 Restoring last temp: %d°C\n", acLastTempSet[idx]);
                    sendIR(acTemp[idx][tempIdx]);
                    sentTempState = true;
                }
            }

            if (!sentTempState)
                sendIR(acOn[idx]);
        }
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
        acOn[ac] = loadIRDataFromPrefs(prefix + "on_p", prefix + "on_v", prefix + "on_b");
        acOff[ac] = loadIRDataFromPrefs(prefix + "off_p", prefix + "off_v", prefix + "off_b");

        for (int i = 0; i < TEMP_COUNT; i++)
        {
            String p = prefix + "t" + String(i) + "_p";
            String v = prefix + "t" + String(i) + "_v";
            String b = prefix + "t" + String(i) + "_b";
            acTemp[ac][i] = loadIRDataFromPrefs(p, v, b);
        }
    }

    // FAN1..FAN2
    for (int fan = 0; fan < 2; fan++)
    {
        String prefix = "fan" + String(fan + 1) + "_";
        fanPower[fan] = loadIRDataFromPrefs(prefix + "p", prefix + "v", prefix + "b");
        fanSwing[fan] = loadIRDataFromPrefs(prefix + "swing_p", prefix + "swing_v", prefix + "swing_b");

        for (int i = 0; i < 3; i++)
        {
            String p = prefix + "sp" + String(i) + "_p";
            String v = prefix + "sp" + String(i) + "_v";
            String b = prefix + "sp" + String(i) + "_b";
            fanSpeed[fan][i] = loadIRDataFromPrefs(p, v, b);
        }
    }

    // TV1..TV2
    for (int tv = 0; tv < 2; tv++)
    {
        String prefix = "tv" + String(tv + 1) + "_";
        tvPower[tv] = loadIRDataFromPrefs(prefix + "p", prefix + "v", prefix + "b");

        for (int ch = 0; ch < TV_CHANNEL_COUNT; ch++)
        {
            String p = prefix + "ch" + String(ch) + "_p";
            String v = prefix + "ch" + String(ch) + "_v";
            String b = prefix + "ch" + String(ch) + "_b";
            tvChannel[tv][ch] = loadIRDataFromPrefs(p, v, b);
        }
    }

    // PROJECTOR1..PROJECTOR2
    for (int pr = 0; pr < 2; pr++)
    {
        String prefix = "proj" + String(pr + 1) + "_";
        projectorPower[pr] = loadIRDataFromPrefs(prefix + "p", prefix + "v", prefix + "b");
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
        // Ignore repeats / overflow captures
        if (results.repeat || results.overflow)
        {
            Serial.println("⚠️ IR invalid/repeat ignored");
            terminal.println("⚠️ IR invalid/repeat ignored");
            terminal.flush();
            irrecv.resume();
            return;
        }

        IRData captured;
        if (!decodeResultToIRData(results, captured))
        {
            Serial.println("IR decode unsupported/invalid");
            terminal.println("IR decode unsupported/invalid");
            terminal.flush();
            irrecv.resume();
            return;
        }

        prefs.begin("ir", false);

        String prefix = devicePrefix();
        String protoStr = typeToString(captured.proto);

        if (learnTemp != -1)
        {
            int idx = learnTemp - TEMP_MIN;
            int dev = currentIndex();
            if (dev >= 0 && currentGroup() == GROUP_AC)
            {
                acTemp[dev][idx] = captured;
                String p = prefix + "t" + String(idx) + "_p";
                String v = prefix + "t" + String(idx) + "_v";
                String b = prefix + "t" + String(idx) + "_b";
                saveIRDataToPrefs(p, v, b, acTemp[dev][idx]);
            }
            terminal.printf("✅ Saved %s for %d°C\n", protoStr.c_str(), learnTemp);
            learnTemp = -1;
        }
        else if (learnChannel != -1)
        {
            int dev = currentIndex();
            if (dev >= 0 && currentGroup() == GROUP_TV)
            {
                tvChannel[dev][learnChannel] = captured;
                String p = prefix + "ch" + String(learnChannel) + "_p";
                String v = prefix + "ch" + String(learnChannel) + "_v";
                String b = prefix + "ch" + String(learnChannel) + "_b";
                saveIRDataToPrefs(p, v, b, tvChannel[dev][learnChannel]);
            }
            terminal.printf("✅ Saved %s for channel %d\n", protoStr.c_str(), learnChannel + 1);
            learnChannel = -1;
        }
        else if (learnFanSpeed != -1)
        {
            int idx = learnFanSpeed;
            int dev = currentIndex();
            if (dev >= 0 && currentGroup() == GROUP_FAN)
            {
                fanSpeed[dev][idx] = captured;
                String p = prefix + "sp" + String(idx) + "_p";
                String v = prefix + "sp" + String(idx) + "_v";
                String b = prefix + "sp" + String(idx) + "_b";
                saveIRDataToPrefs(p, v, b, fanSpeed[dev][idx]);
            }
            terminal.printf("✅ Saved %s for FAN SPEED %d\n", protoStr.c_str(), idx + 1);
            learnFanSpeed = -1;
        }
        else if (currentLearn != LEARN_NONE)
        {
            switch (currentLearn)
            {
            case LEARN_AC_ON:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_AC)
                {
                    acOn[dev] = captured;
                    saveIRDataToPrefs(prefix + "on_p", prefix + "on_v", prefix + "on_b", acOn[dev]);
                    terminal.printf("✅ Saved %s for AC ON\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_AC_OFF:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_AC)
                {
                    acOff[dev] = captured;
                    saveIRDataToPrefs(prefix + "off_p", prefix + "off_v", prefix + "off_b", acOff[dev]);
                    terminal.printf("✅ Saved %s for AC OFF\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_FAN_POWER:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_FAN)
                {
                    fanPower[dev] = captured;
                    saveIRDataToPrefs(prefix + "p", prefix + "v", prefix + "b", fanPower[dev]);
                    terminal.printf("✅ Saved %s for FAN POWER\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_FAN_SWING:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_FAN)
                {
                    fanSwing[dev] = captured;
                    saveIRDataToPrefs(prefix + "swing_p", prefix + "swing_v", prefix + "swing_b", fanSwing[dev]);
                    terminal.printf("✅ Saved %s for FAN SWING\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_TV_POWER:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_TV)
                {
                    tvPower[dev] = captured;
                    saveIRDataToPrefs(prefix + "p", prefix + "v", prefix + "b", tvPower[dev]);
                    terminal.printf("✅ Saved %s for TV POWER\n", protoStr.c_str());
                }
                break;
            }
            case LEARN_PROJECTOR_POWER:
            {
                int dev = currentIndex();
                if (dev >= 0 && currentGroup() == GROUP_PROJECTOR)
                {
                    projectorPower[dev] = captured;
                    saveIRDataToPrefs(prefix + "p", prefix + "v", prefix + "b", projectorPower[dev]);
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
