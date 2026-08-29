#include <cassert>
#include <cstdio>
#include "Arduino.h"
uint32_t testMillis = 0, testMicros = 0;
uint16_t testRaw = 512;
TestSerial Serial;
#ifdef TEST_EMA
#include "../../drunksafe_pulse_sensor_uno/drunksafe_pulse_sensor_uno.ino"
#else
#include "../../ppg_butterworth_uno_test/ppg_butterworth_uno_test.ino"
#endif

static void collecting(PulseTracker& t, uint32_t now = 0) {
  t.loseSignal(now, BOOT);
  t.state = COLLECTING;
  t.warmupStartedMs = now;
}
static bool near(float a, float b, float tolerance = 1.0F) {
  return fabsf(a - b) <= tolerance;
}
static void regular(PulseTracker& t, uint32_t start, uint16_t ibi, uint8_t n) {
  t.acceptPeak(start);
  for (uint8_t i = 1; i <= n; ++i) t.acceptPeak(start + uint32_t(i) * ibi);
}
static void feed(PulseTracker& t, uint32_t start, uint32_t duration, float bpm) {
  for (uint32_t offset = 0; offset < duration; offset += 10) {
    const float phase = float(offset) * bpm / 60000.0F * 6.283185307F;
    const uint16_t raw = bpm > 0 ? uint16_t(512 + 30 * sinf(phase)) : 512;
    t.process(raw, start + offset);
  }
  t.refreshLive(start + duration - 10);
}

static uint16_t minuteWithBins(uint8_t mask) {
  PulseTracker t;
  collecting(t);
  for (uint8_t bin = 0; bin < 6; ++bin) {
    if (mask & (1 << bin)) {
      for (uint8_t i = 1; i <= 9; ++i) {
        t.intervalEnd[t.head] = uint32_t(bin) * 10000 + uint32_t(i) * 1000;
        t.intervals[t.head] = 1000;
        t.head = (t.head + 1) % IBI_CAPACITY;
        if (t.count < IBI_CAPACITY) ++t.count;
      }
    }
    t.advanceMinute(uint32_t(bin + 1) * 10000);
  }
  return t.minuteBpm10;
}

int main() {
  // Two peaks are not enough. Eight valid intervals and eight seconds are.
  PulseTracker t;
  collecting(t);
  regular(t, 0, 1000, 1);
  assert(t.live.bpm == 0);
  for (uint32_t at = 2000; at <= 8000; at += 1000) t.acceptPeak(at);
  assert(near(t.live.bpm, 60) && t.live.valid == 8);

  // A removal gap must not become a huge IBI or retain the old displayed BPM.
  t.acceptPeak(20000);
  assert(t.state == COLLECTING && t.count == 0 && !t.hasPeak && t.live.bpm == 0);
  collecting(t, 21000);
  regular(t, 21000, 1000, 9);
  assert(near(t.live.bpm, 60));
  assert(t.estimate(50000, LIVE_WINDOW_MS, 8, 8000).bpm == 0);
  t.refreshLive(50000);
  assert(t.live.bpm == 0);

  // Timeout and gross contact step reset all history, including the minute output.
  t.minuteBpm10 = 600;
  t.qualityStartedMs = 31601;
  t.process(512, 31601);
  assert(t.reason == NO_BEAT && t.minuteBpm10 == 0 && t.count == 0);
  collecting(t);
  t.hasRaw = true;
  t.rawPrevious = 512;
  t.process(800, 10);
  assert(t.state == WAITING && t.reason == RAW_STEP);

  // Reject too-short intervals without changing the anchor; long ones reset.
  collecting(t);
  t.acceptPeak(0);
  t.acceptPeak(200);
  assert(t.count == 0 && t.lastPeakMs == 0);
  t.acceptPeak(1000);
  assert(t.count == 1 && t.intervals[0] == 1000);
  t.acceptPeak(2600);
  assert(t.count == 0);

  // Robust median rejects isolated doubled/short beats without averaging them in.
  collecting(t);
  regular(t, 0, 1000, 10);
  t.acceptPeak(11500);
  t.acceptPeak(11900);
  assert(near(t.live.bpm, 60) && t.live.valid == 10 && t.live.total == 12);

  // A real 60 -> 90 change is not locked to the previous estimate.
  collecting(t);
  regular(t, 0, 1000, 20);
  for (uint8_t i = 1; i <= 24; ++i) t.acceptPeak(20000 + uint32_t(i) * 667);
  assert(near(t.live.bpm, 90));
  assert(t.live.coveredMs <= LIVE_WINDOW_MS);

  // Fixed minute bins do not repeatedly count overlapping live windows.
  collecting(t);
  t.acceptPeak(0);
  for (uint32_t at = 1000; at <= 60000; at += 1000) {
    t.advanceMinute(at);
    t.acceptPeak(at);
  }
  assert(t.minuteBpm10 == 600 && t.minuteCompletedMs == 60000);
  collecting(t);
  regular(t, 0, 1000, 9);
  t.advanceMinute(10000);
  for (uint32_t at = 20000; at <= 60000; at += 10000) t.advanceMinute(at);
  assert(t.minuteBpm10 == 0); // Ten good seconds cannot represent a minute.
  assert(minuteWithBins(0x2D) == 600); // Four spread-out valid bins.
  assert(minuteWithBins(0x33) == 0); // Two consecutive missing bins.
  assert(minuteWithBins(0x0F) == 0); // No valid data at the end.

  // The full configured range can pass with enough observation time.
  collecting(t);
  regular(t, 0, 1500, 8);
  assert(near(t.live.bpm, 40));
  collecting(t);
  regular(t, 0, 334, 25);
  assert(near(t.live.bpm, 180));

  // Wrap-safe interval ages, not absolute timestamp comparisons.
  collecting(t, UINT32_MAX - 4000);
  regular(t, UINT32_MAX - 4000, 1000, 10);
  assert(near(t.live.bpm, 60));

  // Exercise the actual selected filter and quality/contact state machine.
  PulseTracker waveform;
  waveform.loseSignal(0, BOOT);
  feed(waveform, 0, 22000, 60);
  assert(near(waveform.live.bpm, 60, 2));
  feed(waveform, 22000, 4000, 0);
  assert(waveform.state == WAITING && waveform.live.bpm == 0);
  feed(waveform, 26000, 90000, 90);
  assert(near(waveform.live.bpm, 90, 2));
  assert(near(waveform.minuteBpm10 / 10.0F, 90, 2));

  // Real sampling stalls must not manufacture catch-up samples.
  collecting(tracker);
  regular(tracker, 0, 1000, 8);
  nextSampleUs = 9000000;
  testMicros = 9020000;
  testMillis = 9020;
  loop();
  assert(missedDeadlines == 2 && tracker.reason != CADENCE_GAP);
  assert(nextSampleUs == testMicros + SAMPLE_PERIOD_US);
  // A long stall still invalidates all history.
  testMicros = nextSampleUs + 100000;
  testMillis = testMicros / 1000;
  loop();
  assert(tracker.reason == CADENCE_GAP && tracker.live.bpm == 0);

  // Weak but non-flat signals should reach acquisition, not reset every second.
  PulseTracker weak;
  weak.loseSignal(0, BOOT);
  for (uint32_t at = 0; at < 20000; at += 10)
    weak.process(uint16_t(512 + 2 * sinf(float(at) * 0.0062831853F)), at);
  assert(weak.state == COLLECTING && weak.qualityCode == QUALITY_OK);
  assert(weak.lastSamples >= 98 && weak.lastRange >= MIN_SIGNAL_RANGE);

  // Actual flat, clipped, and undersampled inputs remain distinguishable.
  PulseTracker diagnostic;
  diagnostic.loseSignal(0, BOOT);
  for (uint32_t at = 0; at <= 2000; at += 10) diagnostic.process(512, at);
  assert(diagnostic.qualityCode == FLAT_SIGNAL && diagnostic.live.bpm == 0);
  diagnostic.loseSignal(0, BOOT);
  for (uint32_t at = 0; at <= 1000; at += 10) diagnostic.process(1023, at);
  assert(diagnostic.qualityCode == CLIPPED_SIGNAL);
  diagnostic.loseSignal(0, BOOT);
  for (uint32_t at = 0; at <= 1000; at += 20)
    diagnostic.process(uint16_t(512 + 30 * sinf(float(at) * 0.0062831853F)), at);
  assert(diagnostic.qualityCode == SPARSE_SAMPLES);
  std::printf("PASS: %s - gap, reattach, IBI, median, rate change, minute, rollover, waveform, cadence\n",
              PPG_BUTTERWORTH ? "Butterworth" : "EMA");
}
