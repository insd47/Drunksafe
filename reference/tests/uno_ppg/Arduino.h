#pragma once
// Host-only Arduino shim. Never copy this into an Arduino sketch folder.
#include <cstdint>
#include <cmath>
#include <cstdlib>
using std::isfinite;
constexpr uint8_t A0 = 14;
constexpr int INPUT = 0;
#define F(value) (value)
extern uint32_t testMillis, testMicros;
extern uint16_t testRaw;
inline uint32_t millis() { return testMillis; }
inline uint32_t micros() { return testMicros; }
inline uint16_t analogRead(uint8_t) { return testRaw; }
inline void pinMode(uint8_t, int) {}
struct TestSerial {
  void begin(uint32_t) {}
  void flush() {}
  template <class T> void print(T) {}
  template <class T> void print(T, int) {}
  template <class T> void println(T) {}
  template <class T> void println(T, int) {}
};
extern TestSerial Serial;
