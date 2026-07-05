import serial
import time
import collections
import numpy as np
import tkinter as tk
import matplotlib

matplotlib.use('TkAgg')
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import csv
import sys
from scipy.signal import butter, lfilter, lfilter_zi, find_peaks

# ==========================================
# 1. 설정 및 필터 설계
# ==========================================
PORT = "COM5"
BAUD = 115200

WINDOW_SIZE = 300
UPDATE_INTERVAL = 50
FS = 100.0

LOWCUT = 0.7
HIGHCUT = 3.5
FILTER_ORDER = 2
PEAK_THRESHOLD = 50.0


def butter_bandpass(lowcut, highcut, fs, order=2):
    nyq = 0.5 * fs
    low = lowcut / nyq
    high = highcut / nyq
    b, a = butter(order, [low, high], btype='band')
    return b, a


FILT_B, FILT_A = butter_bandpass(LOWCUT, HIGHCUT, FS, order=FILTER_ORDER)
filter_state = lfilter_zi(FILT_B, FILT_A) * 0.0


def apply_filter_streaming(new_samples, zi):
    if len(new_samples) == 0:
        return np.array([]), zi
    y, zi_next = lfilter(FILT_B, FILT_A, new_samples, zi=zi)
    return y, zi_next


# ==========================================
# 2. 시리얼 연결
# ==========================================
try:
    ser = serial.Serial(PORT, BAUD, timeout=0.05)
    ser.setDTR(False)
    ser.setRTS(False)
    time.sleep(2)
    ser.reset_input_buffer()
    print("ESP32 연결 및 필터 엔진 가동 완료")
except Exception as e:
    print(e)
    sys.exit()

# ==========================================
# 3. 데이터 기록용 전역 변수 및 CSV 준비
# ==========================================
filename = f"PPG_Data_{time.strftime('%Y%m%d_%H%M%S')}.csv"
csv_file = open(filename, "w", newline="", encoding="utf-8")
writer = csv.writer(csv_file)
writer.writerow([
    "time", "time_", "bpm", "IBI_stdev", "peak_amp",
    "bpm_20s", "bpm_20s_d", "bpm_1m", "bpm_1m_d",
    "bpm_5m", "bpm_5m_d", "alc", "S_alc", "stabilized"
])

raw_filename = f"PPG_Raw_{time.strftime('%Y%m%d_%H%M%S')}.csv"
raw_csv_file = open(raw_filename, "w", newline="", encoding="utf-8")
raw_writer = csv.writer(raw_csv_file)
raw_writer.writerow(["time", "raw_value"])

total_samples_processed = 0
START_DELAY_SAMPLES = int(10 * FS)
samples_since_last_calc = 0

buffer_5s_filt = collections.deque(maxlen=int(5 * FS))
buffer_5s_t = collections.deque(maxlen=int(5 * FS))

first_valid_bpm_found = False
time_counter = 0

last_valid_bpm = 0.0
last_valid_ibi_stdev = 0.0
last_valid_peak_amp = 0.0
S_alc = 0.0

# 20초(4개), 1분(12개), 5분(60개) 이동평균 큐
q_20s = collections.deque(maxlen=4)
q_1m = collections.deque(maxlen=12)
q_5m = collections.deque(maxlen=60)

prev_bpm_20s = 0.0
prev_bpm_1m = 0.0
prev_bpm_5m = 0.0

# 불안정(stabilized=1) 연속 카운트
consecutive_unstabilized = 0

# ==========================================
# 4. GUI 비동기 입력을 위한 팝업 로직 (이전과 동일)
# ==========================================
input_active = False
popup_window = None
input_start_time = 0
pending_alc = 0


def open_input_popup(root):
    global input_active, popup_window, input_start_time
    if input_active: return

    input_active = True
    input_start_time = time.time()

    popup_window = tk.Toplevel(root)
    popup_window.title("ALC 입력")
    popup_window.geometry("320x130")
    popup_window.attributes('-topmost', True)

    tk.Label(popup_window, text="버튼 눌림 감지!\n알코올 값을 입력하세요 (정수) - 30초 제한:").pack(pady=5)

    entry = tk.Entry(popup_window)
    entry.pack(pady=5)
    entry.focus()

    def submit():
        global pending_alc, input_active, popup_window
        val = entry.get()
        try:
            pending_alc = int(val)
            print(f"[{time.strftime('%H:%M:%S')}] ALC 값 {pending_alc} 대기 중.")
        except ValueError:
            pending_alc = 0
            print("유효한 정수가 아닙니다. 0으로 처리됩니다.")
        close_popup()

    def cancel():
        global pending_alc
        pending_alc = 0
        close_popup()

    def close_popup():
        global input_active, popup_window
        if popup_window:
            popup_window.destroy()
            popup_window = None
        input_active = False

    btn_frame = tk.Frame(popup_window)
    btn_frame.pack(pady=5)
    tk.Button(btn_frame, text="확인", command=submit).pack(side=tk.LEFT, padx=10)
    tk.Button(btn_frame, text="취소", command=cancel).pack(side=tk.RIGHT, padx=10)

    popup_window.bind('<Return>', lambda e: submit())
    popup_window.protocol("WM_DELETE_WINDOW", cancel)


# ==========================================
# 5. 그래프 세팅
# ==========================================
y_raw = collections.deque([0] * WINDOW_SIZE, maxlen=WINDOW_SIZE)
y_filtered = collections.deque([0.0] * WINDOW_SIZE, maxlen=WINDOW_SIZE)

fig, ax = plt.subplots(figsize=(10, 5))
fig.canvas.manager.set_window_title('AI Filtered PPG Monitor')

line_raw, = ax.plot(y_raw, color='lightgray', lw=1.0, label='Raw Noise')
ax.set_xlim(0, WINDOW_SIZE)
ax.set_ylim(0, 4095)
ax.set_title("Live PPG Signal")
ax.set_xlabel("Samples")
ax.set_ylabel("Raw ADC")
ax.grid(True)

ax2 = ax.twinx()
line_filtered, = ax2.plot(y_filtered, color='red', lw=2.0, label='Filtered Heartbeat')
ax2.set_ylabel("Filtered (a.u.)", color='red')
ax2.tick_params(axis='y', labelcolor='red')

lines = [line_raw, line_filtered]
labels = [l.get_label() for l in lines]
ax.legend(lines, labels, loc='upper right')


# ==========================================
# 6. 업데이트 루프
# ==========================================
def update(frame):
    global filter_state, total_samples_processed, samples_since_last_calc
    global first_valid_bpm_found, time_counter, consecutive_unstabilized
    global last_valid_bpm, last_valid_ibi_stdev, last_valid_peak_amp, S_alc, pending_alc
    global prev_bpm_20s, prev_bpm_1m, prev_bpm_5m
    global input_active, popup_window, input_start_time


    root_window = fig.canvas.manager.window

    if input_active and (time.time() - input_start_time > 30):
        print("입력 시간 초과. ALC 0 처리.")
        pending_alc = 0
        if popup_window:
            popup_window.destroy()
            popup_window = None
        input_active = False

    new_values = []
    new_rows_t = []

    for _ in range(30):
        if ser.in_waiting == 0:
            break
        try:
            s = ser.readline().decode(errors="ignore").strip()
            if not s or not s[0].isdigit():
                continue

            parts = s.split(",")
            if len(parts) >= 3:
                t, value, btn_flag = int(parts[0]), int(parts[1]), int(parts[2])
                if btn_flag == 1:
                    open_input_popup(root_window)
            else:
                continue

            y_raw.append(value)
            new_values.append(value)
            new_rows_t.append(t)

            raw_writer.writerow([t, value])
        except Exception:
            continue

    if new_values:
        filtered_new, filter_state = apply_filter_streaming(np.array(new_values, dtype=float), filter_state)

        for t, raw_v, filt_v in zip(new_rows_t, new_values, filtered_new):
            y_filtered.append(filt_v)

            buffer_5s_filt.append(filt_v)
            buffer_5s_t.append(t)
            total_samples_processed += 1

            if total_samples_processed < START_DELAY_SAMPLES:
                continue

            samples_since_last_calc += 1

            if samples_since_last_calc >= int(5 * FS):
                samples_since_last_calc = 0

                current_bpm = 0.0
                current_ibi_stdev = 0.0
                stabilized = 0

                filt_data = np.array(buffer_5s_filt)
                peaks, _ = find_peaks(filt_data, height=PEAK_THRESHOLD, distance=int(FS * 0.3))

                if len(peaks) >= 2:
                    peak_times = [buffer_5s_t[p] for p in peaks]
                    ibis = np.diff(peak_times)
                    mean_ibi = np.mean(ibis)

                    peak_amps = [filt_data[p] for p in peaks]
                    current_peak_amp = round(np.mean(peak_amps), 3)

                    current_ibi_stdev = round(np.std(ibis), 3)
                    current_bpm = round(60000.0 / mean_ibi, 2) if mean_ibi > 0 else 0.0

                    # IBI 표준편차가 200이 넘어가면 불안정으로 간주
                    if current_ibi_stdev > 200.0:
                        stabilized = 1

                    last_valid_bpm = current_bpm
                    last_valid_ibi_stdev = current_ibi_stdev
                    last_valid_peak_amp = current_peak_amp

                    if not first_valid_bpm_found and stabilized == 0:
                        first_valid_bpm_found = True
                        print(f"[{time.strftime('%H:%M:%S')}]  기록 시작.")
                else:
                    current_bpm = last_valid_bpm
                    current_ibi_stdev = last_valid_ibi_stdev
                    current_peak_amp = last_valid_peak_amp
                    stabilized = 1

                if not first_valid_bpm_found:
                    continue

                # 불안정 상태 전송 로직
                if stabilized == 1:
                    consecutive_unstabilized += 1
                else:
                    consecutive_unstabilized = 0

                if consecutive_unstabilized >= 3:
                    try:
                        ser.write(b'WARN\n')  # ESP32로 경고 문자열 전송
                        print(f"[{time.strftime('%H:%M:%S')}]  WARN")
                        consecutive_unstabilized = 0  # 전송 후 카운트 초기화
                    except Exception as e:
                        print("ESP32 통신 오류:", e)

                # 이동평균 큐 업데이트
                q_20s.append(current_bpm)
                q_1m.append(current_bpm)
                q_5m.append(current_bpm)

                # 20초 이동평균 계산 (데이터 4개)
                if len(q_20s) == 4:
                    bpm_20s = round(sum(q_20s) / 4, 2)
                    bpm_20s_d = round(bpm_20s - prev_bpm_20s, 2) if prev_bpm_20s > 0 else 0.0
                    prev_bpm_20s = bpm_20s
                else:
                    bpm_20s = 0.0
                    bpm_20s_d = 0.0

                # 1분 이동평균 계산 (데이터 12개)
                if len(q_1m) == 12:
                    bpm_1m = round(sum(q_1m) / 12, 2)
                    bpm_1m_d = round(bpm_1m - prev_bpm_1m, 2) if prev_bpm_1m > 0 else 0.0
                    prev_bpm_1m = bpm_1m
                else:
                    bpm_1m = 0.0
                    bpm_1m_d = 0.0

                # 5분 이동평균 계산 (데이터 60개)
                if len(q_5m) == 60:
                    bpm_5m = round(sum(q_5m) / 60, 2)
                    bpm_5m_d = round(bpm_5m - prev_bpm_5m, 2) if prev_bpm_5m > 0 else 0.0
                    prev_bpm_5m = bpm_5m
                else:
                    bpm_5m = 0.0
                    bpm_5m_d = 0.0

                current_alc_record = pending_alc
                S_alc += current_alc_record
                pending_alc = 0

                writer.writerow([
                    t, time_counter, current_bpm, current_ibi_stdev, current_peak_amp,
                    bpm_20s, bpm_20s_d, bpm_1m, bpm_1m_d,
                    bpm_5m, bpm_5m_d, current_alc_record, round(S_alc, 3), stabilized
                ])
                csv_file.flush()
                raw_csv_file.flush()

                time_counter += 5

    raw_array = np.array(y_raw)
    filtered_array = np.array(y_filtered)
    line_raw.set_ydata(raw_array)
    line_filtered.set_ydata(filtered_array)

    ymin = np.min(raw_array)
    ymax = np.max(raw_array)
    margin = 100
    if ymax > ymin:
        ax.set_ylim(max(0, ymin - margin), min(4095, ymax + margin))

    f_min = np.min(filtered_array)
    f_max = np.max(filtered_array)
    if f_max > f_min:
        f_margin = (f_max - f_min) * 0.2 + 1e-6
        ax2.set_ylim(f_min - f_margin, f_max + f_margin)

    return line_raw, line_filtered


# ==========================================
# 7. 실행
# ==========================================
ani = animation.FuncAnimation(fig, update, interval=UPDATE_INTERVAL, blit=False, cache_frame_data=False)

try:
    plt.show()
finally:
    csv_file.flush()
    csv_file.close()
    raw_csv_file.flush()
    raw_csv_file.close()
    ser.close()
    print("저장 완료 :", filename)