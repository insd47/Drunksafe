#include <Arduino.h>

// Arduino Uno samples PPG only. All signal processing runs in Python.
// Wiring: PPG OUT -> A0, GND -> GND, VCC -> sensor-supported voltage.
// Serial output at approximately 100 Hz: elapsed_ms,raw

constexpr uint8_t PPG_PIN = A0;
constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t SAMPLE_PERIOD_US = 10000UL;
constexpr uint8_t SAMPLE_AVERAGE_READS = 1;

uint32_t startedMs = 0;
uint32_t nextSampleUs = 0;

uint16_t readAveragedRaw() {
  uint16_t sum = 0;
  for (uint8_t i = 0; i < SAMPLE_AVERAGE_READS; ++i) {
    sum += analogRead(PPG_PIN);
  }
  return sum / SAMPLE_AVERAGE_READS;
}

void setup() {
  pinMode(PPG_PIN, INPUT);
  Serial.begin(SERIAL_BAUD);
  delay(500);
  startedMs = millis();
  nextSampleUs = micros();
  Serial.println(F("elapsed_ms,raw"));
}

void loop() {
  const uint32_t nowUs = micros();
  if (static_cast<int32_t>(nowUs - nextSampleUs) < 0) {
    return;
  }

  nextSampleUs += SAMPLE_PERIOD_US;
  if (static_cast<int32_t>(nowUs - nextSampleUs) >=
      static_cast<int32_t>(SAMPLE_PERIOD_US)) {
    nextSampleUs = nowUs + SAMPLE_PERIOD_US;
  }

  const uint16_t raw = readAveragedRaw();
  Serial.print(millis() - startedMs);
  Serial.print(',');
  Serial.println(raw);
}
