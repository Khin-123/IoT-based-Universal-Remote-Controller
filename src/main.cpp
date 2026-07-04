#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <IRremoteESP8266.h>
#include <IRrecv.h>
#include <IRsend.h>
#include <IRutils.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>

const char *WIFI_SSID = "HONOR 200";
const char *WIFI_PASS = "swampyae2005";

#define IR_RECV_PIN 14
#define IR_SEND_PIN 4

constexpr uint16_t IR_RECV_BUFFER_SIZE = 1024;
constexpr uint8_t IR_RECV_TIMEOUT_MS = 50;
constexpr uint16_t IR_SEND_FREQUENCY_KHZ = 38;
constexpr uint32_t LEARN_TIMEOUT_MS_DEFAULT = 15000;
constexpr uint32_t LEARN_TIMEOUT_MS_MAX = 45000;
constexpr uint16_t RAW_MAX_SAMPLES = 600;

WebServer server(80);
IRrecv irrecv(IR_RECV_PIN, IR_RECV_BUFFER_SIZE, IR_RECV_TIMEOUT_MS, true);
IRsend irsend(IR_SEND_PIN);
decode_results results;
WebSocketsClient ws;

// Deployed backend settings.
const char *BACKEND_HOST = "smart-ir-remote-hub.onrender.com";
const uint16_t BACKEND_PORT = 443;
const char *BACKEND_PATH = "/ws";
const bool BACKEND_SSL = true;

// Local backend settings, for later:
// const char *BACKEND_HOST = "192.168.99.122";
// const uint16_t BACKEND_PORT = 3000;
// const char *BACKEND_PATH = "/ws";
// const bool BACKEND_SSL = false;

String ESP_ID = "";
unsigned long lastWsReconnectAttemptMs = 0;
bool wsInitialized = false;

void logHeap(const char *tag) {
  Serial.printf(
      "[HEAP] %s free=%u min=%u maxAlloc=%u\n",
      tag,
      ESP.getFreeHeap(),
      ESP.getMinFreeHeap(),
      ESP.getMaxAllocHeap());
}

String escapeJson(String s) {
  s.replace("\\", "\\\\");
  s.replace("\"", "\\\"");
  s.replace("\n", "\\n");
  s.replace("\r", "");
  return s;
}

void sendError(int code, const String &message) {
  String body = "{";
  body += "\"success\":false,";
  body += "\"message\":\"" + escapeJson(message) + "\"";
  body += "}";
  server.send(code, "application/json", body);
}

String getEspId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[17];
  snprintf(buf, sizeof(buf), "%04X%08X", (uint16_t)(mac >> 32), (uint32_t)mac);
  return String(buf);
}

decode_type_t protocolFromString(const String &protocol) {
  String p = protocol;
  p.toUpperCase();

  if (p == "NEC") return NEC;
  if (p == "SONY") return SONY;
  if (p == "SAMSUNG") return SAMSUNG;
  if (p == "LG") return LG;
  if (p == "COOLIX") return COOLIX;
  if (p == "GREE") return GREE;
  if (p == "KELON") return KELON;
  if (p == "TECO") return TECO;
  if (p == "PANASONIC") return PANASONIC;
  if (p == "JVC") return JVC;
  if (p == "RC5") return RC5;
  if (p == "RC6") return RC6;
  return UNKNOWN;
}

bool sendByProtocol(decode_type_t proto, uint64_t value, uint16_t bits) {
  if (proto == UNKNOWN || bits == 0 || value == UINT64_MAX) {
    return false;
  }

  bool sent = irsend.send(proto, value, bits);
  if (sent) {
    return true;
  }

  switch (proto) {
    case NEC:
      irsend.sendNEC(value, bits);
      return true;
    case SONY:
      irsend.sendSony(value, bits);
      return true;
    case SAMSUNG:
      irsend.sendSAMSUNG(value, bits);
      return true;
    case LG:
      irsend.sendLG(value, bits);
      return true;
    case COOLIX:
      irsend.sendCOOLIX(value);
      return true;
    case GREE:
      irsend.sendGree(value, bits);
      return true;
    case KELON:
      irsend.sendKelon(value);
      return true;
    case TECO:
      irsend.sendTeco(value, bits, 2);
      return true;
    default:
      return false;
  }
}

bool buildLearnResponse(decode_results &decoded, String &responseBody) {
  DynamicJsonDocument doc(32768);
  doc["success"] = true;

  if (decoded.decode_type == UNKNOWN || hasACState(decoded.decode_type)) {
    uint16_t correctedRawLen = getCorrectedRawLength(&decoded);
    if (correctedRawLen == 0) {
      return false;
    }

    uint16_t *rawArray = resultToRawArray(&decoded);
    if (rawArray == nullptr) {
      return false;
    }

    uint16_t safeRawLen = correctedRawLen > RAW_MAX_SAMPLES ? RAW_MAX_SAMPLES : correctedRawLen;

    doc["protocol"] = "RAW";
    doc["value"] = 0;
    doc["bits"] = 0;

    JsonArray raw = doc.createNestedArray("raw");
    for (uint16_t i = 0; i < safeRawLen; i++) {
      raw.add(rawArray[i]);
    }

    delete[] rawArray;
  } else {
    if (decoded.bits == 0 || decoded.value == UINT64_MAX) {
      return false;
    }

    doc["protocol"] = String(typeToString(decoded.decode_type));
    doc["value"] = decoded.value;
    doc["bits"] = decoded.bits;
    doc.createNestedArray("raw");
  }

  serializeJson(doc, responseBody);
  return true;
}

bool sendIrFromJson(JsonVariant ir) {
  String protocol = ir["protocol"] | "";
  uint64_t value = ir["value"] | 0;
  uint16_t bits = ir["bits"] | 0;
  JsonArray raw = ir["raw"].as<JsonArray>();
  size_t rawLen = raw.size();

  if (rawLen > 0) {
    if (rawLen > RAW_MAX_SAMPLES) return false;
    uint16_t *rawBuffer = (uint16_t *)malloc(rawLen * sizeof(uint16_t));
    if (!rawBuffer) return false;
    size_t i = 0;
    for (JsonVariant v : raw) {
      rawBuffer[i++] = (uint16_t)(v.as<uint32_t>());
    }
    irsend.sendRaw(rawBuffer, rawLen, IR_SEND_FREQUENCY_KHZ);
    free(rawBuffer);
    return true;
  }

  decode_type_t proto = protocolFromString(protocol);
  return sendByProtocol(proto, value, bits);
}

String runLearnOnce(uint32_t timeoutMs, bool &ok) {
  ok = false;
  unsigned long startedAt = millis();

  while (millis() - startedAt < timeoutMs) {
    ws.loop(); // keep ws alive during long learn
    if (irrecv.decode(&results)) {
      if (results.repeat || results.overflow) {
        irrecv.resume();
        delay(10);
        continue;
      }

      String body;
      bool built = buildLearnResponse(results, body);
      irrecv.resume();

      if (!built) {
        ok = false;
        return "{\"success\":false,\"message\":\"IR captured but could not convert.\"}";
      }

      ok = true;
      return body;
    }

    delay(10);
  }

  ok = false;
  return "{\"success\":false,\"message\":\"Timeout waiting for IR signal.\"}";
}

void handleHealth() {
  String body = "{";
  body += "\"success\":true,";
  body += "\"ip\":\"" + WiFi.localIP().toString() + "\"";
  body += "}";
  server.send(200, "application/json", body);
}

void handleLearn() {
  uint32_t timeoutMs = LEARN_TIMEOUT_MS_DEFAULT;
  if (server.hasArg("timeoutMs")) {
    uint32_t requested = (uint32_t)server.arg("timeoutMs").toInt();
    if (requested > 0) {
      timeoutMs = requested > LEARN_TIMEOUT_MS_MAX ? LEARN_TIMEOUT_MS_MAX : requested;
    }
  }

  bool ok = false;
  String response = runLearnOnce(timeoutMs, ok);
  if (!ok) {
    sendError(response.indexOf("Timeout") >= 0 ? 408 : 422, "Learn failed.");
    return;
  }
  server.send(200, "application/json", response);
}

void handleSend() {
  if (!server.hasArg("plain")) {
    sendError(400, "Missing JSON body.");
    return;
  }

  String body = server.arg("plain");
  DynamicJsonDocument doc(32768);
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    sendError(400, "Invalid JSON body.");
    return;
  }

  String protocol = doc["protocol"] | "";
  uint64_t value = doc["value"] | 0;
  uint16_t bits = doc["bits"] | 0;

  JsonArray raw = doc["raw"].as<JsonArray>();
  size_t rawLen = raw.size();

  bool sent = false;

  if (rawLen > 0) {
    if (rawLen > RAW_MAX_SAMPLES) {
      sendError(400, "Raw sample array is too long.");
      return;
    }

    uint16_t *rawBuffer = (uint16_t *)malloc(rawLen * sizeof(uint16_t));
    if (!rawBuffer) {
      sendError(500, "Failed to allocate raw buffer.");
      return;
    }

    size_t i = 0;
    for (JsonVariant v : raw) {
      rawBuffer[i++] = (uint16_t)(v.as<uint32_t>());
    }

    irsend.sendRaw(rawBuffer, rawLen, IR_SEND_FREQUENCY_KHZ);
    free(rawBuffer);
    sent = true;
  } else {
    decode_type_t proto = protocolFromString(protocol);
    sent = sendByProtocol(proto, value, bits);
  }

  if (!sent) {
    sendError(400, "Could not send IR. Provide valid raw or protocol/value/bits.");
    return;
  }

  String response = "{";
  response += "\"success\":true,";
  response += "\"message\":\"IR signal sent.\"";
  response += "}";
  server.send(200, "application/json", response);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.println("[WIFI] Connecting...");
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 60) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WIFI] Connected: " + WiFi.localIP().toString());
  } else {
    Serial.println("[WIFI] Failed to connect.");
  }
}

void wsSendJson(const String &json) {
  String payload = json;
  ws.sendTXT(payload);
}

void wsHello() {
  String msg = "{";
  msg += "\"type\":\"hello\",";
  msg += "\"espId\":\"" + ESP_ID + "\"";
  msg += "}";
  wsSendJson(msg);
}

void onWsEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[WS] Connected.");
      logHeap("ws connected");
      wsHello();
      break;
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected.");
      logHeap("ws disconnected");
      break;
    case WStype_TEXT: {
      String text = String((const char *)payload).substring(0, length);
      DynamicJsonDocument doc(32768);
      DeserializationError err = deserializeJson(doc, text);
      if (err) return;

      String msgType = doc["type"] | "";
      String requestId = doc["requestId"] | "";

      if (msgType == "send") {
        bool ok = false;
        if (doc.containsKey("irData")) {
          ok = sendIrFromJson(doc["irData"]);
        }
        String resp = "{";
        resp += "\"type\":\"send_result\",";
        resp += "\"requestId\":\"" + escapeJson(requestId) + "\",";
        resp += "\"success\":" + String(ok ? "true" : "false") + ",";
        resp += "\"message\":\"" + escapeJson(ok ? "IR signal sent." : "Failed to send IR.") + "\"";
        resp += "}";
        wsSendJson(resp);
        return;
      }

      if (msgType == "learn") {
        uint32_t timeoutMs = doc["timeoutMs"] | LEARN_TIMEOUT_MS_DEFAULT;
        if (timeoutMs > LEARN_TIMEOUT_MS_MAX) timeoutMs = LEARN_TIMEOUT_MS_MAX;
        bool ok = false;
        String learned = runLearnOnce(timeoutMs, ok);
        DynamicJsonDocument out(32768);
        DeserializationError outErr = deserializeJson(out, learned);
        if (outErr) {
          String resp = "{";
          resp += "\"type\":\"learn_result\",";
          resp += "\"requestId\":\"" + escapeJson(requestId) + "\",";
          resp += "\"success\":false,";
          resp += "\"message\":\"Invalid learn payload.\"";
          resp += "}";
          wsSendJson(resp);
          return;
        }

        out["type"] = "learn_result";
        out["requestId"] = requestId;
        String resp;
        serializeJson(out, resp);
        wsSendJson(resp);
        return;
      }
      break;
    }
    default:
      break;
  }
}

void connectWsIfNeeded() {
  if (WiFi.status() != WL_CONNECTED) return;

  // Start the websocket client once, then let the library handle reconnects.
  if (wsInitialized) return;
  if (millis() - lastWsReconnectAttemptMs < 2000) return;
  lastWsReconnectAttemptMs = millis();

  Serial.printf("[WS] Connecting to %s:%u%s (ssl=%s)\n", BACKEND_HOST, BACKEND_PORT, BACKEND_PATH, BACKEND_SSL ? "true" : "false");
  logHeap("before ws begin");

  if (BACKEND_SSL) {
    ws.beginSSL(BACKEND_HOST, BACKEND_PORT, BACKEND_PATH);
  } else {
    ws.begin(BACKEND_HOST, BACKEND_PORT, BACKEND_PATH);
  }
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(3000);
  wsInitialized = true;
}

void setup() {
  Serial.begin(115200);
  delay(200);

  ESP_ID = getEspId();
  Serial.println("[ESP] ID: " + ESP_ID);

  connectWiFi();
  logHeap("after wifi");

  irrecv.enableIRIn();
  irsend.begin();

  server.on("/health", HTTP_GET, handleHealth);
  server.on("/learn", HTTP_GET, handleLearn);
  server.on("/send", HTTP_POST, handleSend);
  server.begin();

  Serial.println("[BOOT] ESP32 IR API started.");
  logHeap("boot complete");
}

void loop() {
  connectWsIfNeeded();
  ws.loop();
  server.handleClient();
}

