"""Calculate BPM from Arduino Uno PPG Serial samples without Butterworth.

Install: pip install pyserial
Run:     python ppg_serial_analyzer.py COM3
Save:    python ppg_serial_analyzer.py COM3 --csv ppg_capture.csv
"""

from __future__ import annotations

import argparse
import csv
import math
import statistics
import sys
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

import serial


SERIAL_BAUD = 115_200
SAMPLE_RATE_HZ = 100
BASELINE_SAMPLES = SAMPLE_RATE_HZ
WINDOW_MS = 20_000
START_DELAY_MS = 20_000
ANALYSIS_INTERVAL_MS = 5_000
PEAK_THRESHOLD = 13.0  # Uno 10-bit ADC; tune 13 -> 10 -> 7 if needed.
MIN_PEAK_DISTANCE_MS = 300
IBI_STDEV_UNSTABLE_MS = 300.0
MIN_STABLE_PEAKS = 8
MIN_STABLE_SPAN_MS = 6_000
MIN_BPM = 40.0
MAX_BPM = 180.0


@dataclass(frozen=True)
class Sample:
    elapsed_ms: int
    raw: int
    centered: float

@dataclass(frozen=True)
class Peak:
    elapsed_ms: int
    amplitude: float


class MovingBaseline:
    def __init__(self, size: int) -> None:
        self._values: deque[int] = deque(maxlen=size)
        self._sum = 0

    def center(self, raw: int) -> float:
        if len(self._values) == self._values.maxlen:
            self._sum -= self._values[0]
        self._values.append(raw)
        self._sum += raw
        return raw - self._sum / len(self._values)


def find_peaks(samples: list[Sample]) -> list[Peak]:
    candidates: list[Peak] = []
    for previous, current, following in zip(samples, samples[1:], samples[2:]):
        if (
            current.centered > previous.centered
            and current.centered >= following.centered
            and current.centered >= PEAK_THRESHOLD
        ):
            candidates.append(Peak(current.elapsed_ms, current.centered))

    retained: list[Peak] = []
    for candidate in sorted(candidates, key=lambda peak: peak.amplitude, reverse=True):
        if all(
            abs(candidate.elapsed_ms - existing.elapsed_ms) >= MIN_PEAK_DISTANCE_MS
            for existing in retained
        ):
            retained.append(candidate)
    return sorted(retained, key=lambda peak: peak.elapsed_ms)


def analyze(samples: deque[Sample], elapsed_ms: int) -> None:
    window = [sample for sample in samples if elapsed_ms - sample.elapsed_ms <= WINDOW_MS]
    peaks = find_peaks(window)
    latest_raw = window[-1].raw if window else 0

    if len(peaks) < 2:
        print(
            f"BPM=NA  peaks={len(peaks)}  IBI_stddev=NA  "
            f"stable=false  raw={latest_raw}"
        )
        return

    ibis = [
        following.elapsed_ms - previous.elapsed_ms
        for previous, following in zip(peaks, peaks[1:])
    ]
    mean_ibi = statistics.fmean(ibis)
    bpm = 60_000.0 / mean_ibi if mean_ibi > 0 else 0.0
    ibi_stddev = math.sqrt(
        sum((ibi - mean_ibi) ** 2 for ibi in ibis) / len(ibis)
    )
    observation_ms = peaks[-1].elapsed_ms - peaks[0].elapsed_ms
    stable = (
        len(peaks) >= MIN_STABLE_PEAKS
        and observation_ms >= MIN_STABLE_SPAN_MS
        and MIN_BPM <= bpm <= MAX_BPM
        and ibi_stddev <= IBI_STDEV_UNSTABLE_MS
    )
    print(
        f"BPM={bpm:.1f}  peaks={len(peaks)}  "
        f"IBI_stddev={ibi_stddev:.1f}ms  stable={str(stable).lower()}  "
        f"raw={latest_raw}"
    )


def parse_sample(line: str) -> tuple[int, int] | None:
    try:
        elapsed_text, raw_text = line.split(",", maxsplit=1)
        elapsed_ms = int(elapsed_text)
        raw = int(raw_text)
    except (ValueError, TypeError):
        return None
    if elapsed_ms < 0 or not 0 <= raw <= 1023:
        return None
    return elapsed_ms, raw


def open_csv(path: Path | None) -> tuple[TextIO | None, csv.writer | None]:
    if path is None:
        return None, None
    file = path.open("w", newline="", encoding="utf-8")
    writer = csv.writer(file)
    writer.writerow(("elapsed_ms", "raw"))
    return file, writer


def run(port: str, csv_path: Path | None) -> None:
    baseline = MovingBaseline(BASELINE_SAMPLES)
    samples: deque[Sample] = deque(maxlen=WINDOW_MS // 8)
    csv_file, csv_writer = open_csv(csv_path)
    last_analysis_ms = START_DELAY_MS

    try:
        with serial.Serial(port, SERIAL_BAUD, timeout=1) as connection:
            time.sleep(2.0)  # Uno resets when Serial is opened.
            connection.reset_input_buffer()
            print(f"Connected to {port} at {SERIAL_BAUD} baud")
            print("Collecting 20 seconds of PPG samples...")

            while True:
                line = connection.readline().decode("ascii", errors="ignore").strip()
                parsed = parse_sample(line)
                if parsed is None:
                    continue

                elapsed_ms, raw = parsed
                samples.append(Sample(elapsed_ms, raw, baseline.center(raw)))
                if csv_writer is not None:
                    csv_writer.writerow((elapsed_ms, raw))

                if elapsed_ms >= START_DELAY_MS and elapsed_ms - last_analysis_ms >= ANALYSIS_INTERVAL_MS:
                    last_analysis_ms = elapsed_ms
                    analyze(samples, elapsed_ms)
    except KeyboardInterrupt:
        print("\nStopped by user.")
    finally:
        if csv_file is not None:
            csv_file.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze Arduino Uno PPG samples.")
    parser.add_argument("port", help="Serial port, for example COM3")
    parser.add_argument("--csv", type=Path, help="Optional raw sample CSV output path")
    args = parser.parse_args()
    try:
        run(args.port, args.csv)
    except serial.SerialException as error:
        print(f"Serial error: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
