#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <IRremoteESP8266.h>
#include <IRrecv.h>
#include <IRsend.h>
#include <IRutils.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>

const char *WIFI_SSID = "Xiaomi 15T Pro";
const char *WIFI_PASS = "d0ntc0nnect";

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

// This is for Local.
// const char *BACKEND_HOST = "10.122.130.58";
// const uint16_t BACKEND_PORT = 3000;
// const char *BACKEND_PATH = "/ws";
// const bool BACKEND_SSL = false;

String ESP_ID = "";
unsigned long lastWsReconnectAttemptMs = 0;
bool wsInitialized = false;

String escapeJson(String s);
void wsSendJson(const String &json);
bool buildLearnResponse(decode_results &decoded, String &responseBody);
bool sendIrCommand(const String &protocol, uint64_t value, uint16_t bits, const uint16_t *rawBuffer, size_t rawLen);

enum SystemState {
  IDLE,
  LEARNING,
  SENDING
};

SystemState currentSystemState = IDLE;
String currentRequestId = "";
unsigned long currentOperationStartMs = 0;
uint32_t currentOperationTimeoutMs = 0;
String pendingSendPayload = "";

void clearCurrentOperation() {
  currentSystemState = IDLE;
  currentRequestId = "";
  currentOperationStartMs = 0;
  currentOperationTimeoutMs = 0;
  pendingSendPayload = "";
}

bool startLearning(const String &requestId, uint32_t timeoutMs) {
  if (currentSystemState != IDLE) {
    return false;
  }

  currentSystemState = LEARNING;
  currentRequestId = requestId;
  currentOperationStartMs = millis();
  currentOperationTimeoutMs = timeoutMs;
  pendingSendPayload = "";

  String msg = "{";
  msg += "\"type\":\"learn_started\",";
  msg += "\"requestId\":\"" + escapeJson(requestId) + "\",";
  msg += "\"success\":true,";
  msg += "\"startedAt\":" + String(millis()) + "";
  msg += "}";
  wsSendJson(msg);
  return true;
}

void finishLearning(bool success, const String &payloadJson, const String &message) {
  String response;
  if (success) {
    DynamicJsonDocument doc(32768);
    DeserializationError error = deserializeJson(doc, payloadJson);
    if (!error) {
      doc["type"] = "learn_result";
      doc["requestId"] = currentRequestId;
      doc["learningTime"] = millis() - currentOperationStartMs;
      doc["message"] = message;
      serializeJson(doc, response);
    } else {
      response = "{";
      response += "\"type\":\"learn_result\",";
      response += "\"requestId\":\"" + escapeJson(currentRequestId) + "\",";
      response += "\"success\":false,";
      response += "\"message\":\"Invalid learn payload\"";
      response += "}";
    }
  } else {
    response = "{";
    response += "\"type\":\"learn_result\",";
    response += "\"requestId\":\"" + escapeJson(currentRequestId) + "\",";
    response += "\"success\":false,";
    response += "\"message\":\"" + escapeJson(message) + "\"";
    response += "}";
  }

  wsSendJson(response);
  Serial.printf("[TIMING] Total Learning Time: %lums\n", millis() - currentOperationStartMs);
  clearCurrentOperation();
}

bool startSending(const String &requestId, const String &payloadJson) {
  if (currentSystemState != IDLE) {
    return false;
  }

  currentSystemState = SENDING;
  currentRequestId = requestId;
  currentOperationStartMs = millis();
  currentOperationTimeoutMs = 0;
  pendingSendPayload = payloadJson;

  String msg = "{";
  msg += "\"type\":\"send_started\",";
  msg += "\"requestId\":\"" + escapeJson(requestId) + "\",";
  msg += "\"success\":true,";
  msg += "\"startedAt\":" + String(millis()) + "";
  msg += "}";
  wsSendJson(msg);
  return true;
}

void finishSending(bool success, const String &message) {
  String response = "{";
  response += "\"type\":\"send_result\",";
  response += "\"requestId\":\"" + escapeJson(currentRequestId) + "\",";
  response += "\"success\":" + String(success ? "true" : "false") + ",";
  response += "\"message\":\"" + escapeJson(message) + "\",";
  response += "\"sendTime\":" + String(millis() - currentOperationStartMs) + "";
  response += "}";

  wsSendJson(response);
  Serial.printf("[TIMING] Total Send Time: %lums\n", millis() - currentOperationStartMs);
  clearCurrentOperation();
}

void processLearning() {
  if (currentSystemState != LEARNING) {
    return;
  }

  if (millis() - currentOperationStartMs >= currentOperationTimeoutMs) {
    finishLearning(false, "", "Timeout waiting for IR signal.");
    return;
  }

  if (irrecv.decode(&results)) {
    if (results.repeat || results.overflow) {
      irrecv.resume();
      return;
    }

    String body;
    bool built = buildLearnResponse(results, body);
    irrecv.resume();

    if (!built) {
      finishLearning(false, "", "IR captured but could not convert.");
      return;
    }

    finishLearning(true, body, "IR signal learned.");
  }
}

void processSending() {
  if (currentSystemState != SENDING) {
    return;
  }

  if (pendingSendPayload.length() == 0) {
    finishSending(false, "No IR payload was provided.");
    return;
  }

  DynamicJsonDocument doc(32768);
  DeserializationError error = deserializeJson(doc, pendingSendPayload);
  if (error) {
    finishSending(false, "Invalid send payload.");
    return;
  }

  String protocol = doc["protocol"] | "";
  uint64_t value = doc["value"] | 0;
  uint16_t bits = doc["bits"] | 0;
  JsonArray raw = doc["raw"].as<JsonArray>();
  size_t rawLen = raw.size();

  uint16_t *rawBuffer = nullptr;
  if (rawLen > 0) {
    if (rawLen > RAW_MAX_SAMPLES) {
      finishSending(false, "Raw sample array is too long.");
      return;
    }

    rawBuffer = (uint16_t *)malloc(rawLen * sizeof(uint16_t));
    if (!rawBuffer) {
      finishSending(false, "Failed to allocate raw buffer.");
      return;
    }

    size_t i = 0;
    for (JsonVariant v : raw) {
      rawBuffer[i++] = (uint16_t)(v.as<uint32_t>());
    }
  }

  bool sent = sendIrCommand(protocol, value, bits, rawBuffer, rawLen);
  if (rawBuffer) {
    free(rawBuffer);
  }

  if (!sent) {
    finishSending(false, "Could not send IR signal."); 
    return;
  }

  finishSending(true, "IR signal sent.");
}

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
  if (p == "MITSUBISHI") return MITSUBISHI;
  if (p == "GOODWEATHER") return GOODWEATHER;
  if (p == "SHARP") return SHARP;
  if (p == "FUJITSU_AC") return FUJITSU_AC;
  if (p == "HAIER_AC") return HAIER_AC;
  if (p == "HITACHI_AC") return HITACHI_AC;
  if (p == "TOSHIBA_AC") return TOSHIBA_AC;
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
      irsend.sendCOOLIX(value, bits);
      return true;
    case GREE:
      irsend.sendGree(value, bits);
      return true;
    case KELON:
      irsend.sendKelon(value, bits);
      return true;
    case TECO:
      irsend.sendTeco(value, bits, 2);
      return true;
    case GOODWEATHER:
      irsend.sendGoodweather(value, bits);
      return true;
    case SHARP:
      irsend.sendSharp(value, bits);
      return true;
    case DENON:
      irsend.sendDenon(value, bits);
      return true;
    case MITSUBISHI: 
      irsend.sendMitsubishi(value, bits);
      return true;
    default:
      return false;
  }
}

bool sendIrCommand(const String &protocol, uint64_t value, uint16_t bits, const uint16_t *rawBuffer, size_t rawLen) {
  unsigned long transmitStartMs = millis();
  bool sent = false;

  if (rawLen > 0 && rawBuffer != nullptr) {
    irsend.sendRaw(rawBuffer, rawLen, IR_SEND_FREQUENCY_KHZ);
    sent = true;
  } else {
    decode_type_t proto = protocolFromString(protocol);
    sent = sendByProtocol(proto, value, bits);
  }

  unsigned long transmitElapsedMs = millis() - transmitStartMs;
  Serial.printf("[TIMING] IR Transmission Time: %lums\n", transmitElapsedMs);
  return sent;
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
    bool sent = sendIrCommand(protocol, value, bits, rawBuffer, rawLen);
    free(rawBuffer);
    return sent;
  }

  return sendIrCommand(protocol, value, bits, nullptr, 0);
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

  String requestId = server.hasArg("requestId") ? server.arg("requestId") : "http-" + String(millis());
  bool started = startLearning(requestId, timeoutMs);
  if (!started) {
    sendError(409, "ESP is busy with another operation.");
    return;
  }

  String response = "{";
  response += "\"success\":true,";
  response += "\"message\":\"Learn started.\",";
  response += "\"requestId\":\"" + escapeJson(requestId) + "\"";
  response += "}";
  server.send(202, "application/json", response);
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

  String requestId = server.hasArg("requestId") ? server.arg("requestId") : "http-" + String(millis());
  String payloadJson;
  if (doc.containsKey("irData")) {
    serializeJson(doc["irData"], payloadJson);
  } else {
    payloadJson = body;
  }

  bool started = startSending(requestId, payloadJson);
  if (!started) {
    sendError(409, "ESP is busy with another operation.");
    return;
  }

  String response = "{";
  response += "\"success\":true,";
  response += "\"message\":\"Send started.\",";
  response += "\"requestId\":\"" + escapeJson(requestId) + "\"";
  response += "}";
  server.send(202, "application/json", response);
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
        if (requestId.length() == 0) {
          requestId = "ws-send-" + String(millis());
        }

        String payloadJson = "";
        if (doc.containsKey("irData")) {
          serializeJson(doc["irData"], payloadJson);
        } else {
          payloadJson = text;
        }

        bool started = startSending(requestId, payloadJson);
        if (!started) {
          String resp = "{";
          resp += "\"type\":\"send_result\",";
          resp += "\"requestId\":\"" + escapeJson(requestId) + "\",";
          resp += "\"success\":false,";
          resp += "\"message\":\"ESP is busy with another operation.\"";
          resp += "}";
          wsSendJson(resp);
        }
        return;
      }

      if (msgType == "learn") {
        if (requestId.length() == 0) {
          requestId = "ws-learn-" + String(millis());
        }

        uint32_t timeoutMs = doc["timeoutMs"] | LEARN_TIMEOUT_MS_DEFAULT;
        if (timeoutMs > LEARN_TIMEOUT_MS_MAX) timeoutMs = LEARN_TIMEOUT_MS_MAX;

        bool started = startLearning(requestId, timeoutMs);
        if (!started) {
          String resp = "{";
          resp += "\"type\":\"learn_result\",";
          resp += "\"requestId\":\"" + escapeJson(requestId) + "\",";
          resp += "\"success\":false,";
          resp += "\"message\":\"ESP is busy with another operation.\"";
          resp += "}";
          wsSendJson(resp);
        }
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
  processLearning();
  processSending();
}
