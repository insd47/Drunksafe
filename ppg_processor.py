import serial
import time
import collections
import numpy as np
import matplotlib
matplotlib.use('TkAgg')  # GUI 강제 팝업
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import csv
import sys
from scipy.signal import butter, lfilter, lfilter_zi
 
# ==========================================
# 1. 설정 및 필터 설계
# ==========================================
PORT = "COM4"
BAUD = 115200
 
WINDOW_SIZE = 300          # 3초 (100Hz 기준) - 화면 표시용 창
UPDATE_INTERVAL = 50       # ms
FLUSH_INTERVAL = 100       # CSV 저장 주기
FS = 100.0                 # 아두이노 샘플링 주파수 (100Hz)
 
# 심박수 주파수 대역 설정 (약 42 BPM ~ 210 BPM)
LOWCUT = 0.7   # Hz
HIGHCUT = 3.5  # Hz
FILTER_ORDER = 2
 
def butter_bandpass(lowcut, highcut, fs, order=2):
    nyq = 0.5 * fs
    low = lowcut / nyq
    high = highcut / nyq
    b, a = butter(order, [low, high], btype='band')
    return b, a
 
# 필터 계수는 한 번만 설계 (매 프레임 재계산 방지)
FILT_B, FILT_A = butter_bandpass(LOWCUT, HIGHCUT, FS, order=FILTER_ORDER)
 
# 실시간 스트리밍 필터 상태 (zi) - filtfilt 대신 상태유지 lfilter 사용
# -> 매 프레임 윈도우 전체를 재필터링하지 않으므로 경계 왜곡(edge artifact)이 없고
#    가장 최근 샘플(그래프 오른쪽 끝, 지금 이 순간)의 필터 정확도가 떨어지는 문제가 해결됨
filter_state = lfilter_zi(FILT_B, FILT_A) * 0.0
 
def apply_filter_streaming(new_samples, zi):
    """새로 들어온 샘플들만 필터링하고, 다음 호출을 위한 상태(zi)를 반환한다."""
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
# 3. CSV 저장 준비 (원본 + 필터링 값 모두 저장)
# ==========================================
filename = f"PPG_Filtered_{time.strftime('%Y%m%d_%H%M%S')}.csv"
csv_file = open(filename, "w", newline="", encoding="utf-8")
writer = csv.writer(csv_file)
writer.writerow(["Timestamp_ms", "RawSignal", "FilteredSignal"])
save_count = 0
 
# ==========================================
# 4. 그래프 세팅 (원시 데이터 vs 필터 데이터, 이중 y축)
# ==========================================
y_raw = collections.deque([0] * WINDOW_SIZE, maxlen=WINDOW_SIZE)
y_filtered = collections.deque([0.0] * WINDOW_SIZE, maxlen=WINDOW_SIZE)
 
fig, ax = plt.subplots(figsize=(10, 5))
fig.canvas.manager.set_window_title('AI Filtered PPG Monitor (Wrist)')
 
# 회색 선: 노이즈가 낀 원본 데이터 (왼쪽 y축, ADC raw 스케일)
line_raw, = ax.plot(y_raw, color='lightgray', lw=1.0, label='Raw Noise')
ax.set_xlim(0, WINDOW_SIZE)
ax.set_ylim(0, 4095)
ax.set_title("Live PPG Signal (Wrist + Streaming Butterworth Filter)")
ax.set_xlabel("Samples")
ax.set_ylabel("Raw ADC")
ax.grid(True)
 
# 빨간 선: 필터링 된 심박 데이터 (오른쪽 y축, 자체 스케일)
# 손목 PPG는 맥파 진폭이 raw 신호 변동보다 훨씬 작아서 같은 축에 그리면
# 필터 선이 거의 평평하게 보일 수 있으므로 twin axis로 분리
ax2 = ax.twinx()
line_filtered, = ax2.plot(y_filtered, color='red', lw=2.0, label='Filtered Heartbeat')
ax2.set_ylabel("Filtered (a.u.)", color='red')
ax2.tick_params(axis='y', labelcolor='red')
 
# 범례는 두 축을 합쳐서 하나로 표시
lines = [line_raw, line_filtered]
labels = [l.get_label() for l in lines]
ax.legend(lines, labels, loc='upper right')
 
# ==========================================
# 5. 업데이트 루프
# ==========================================
def update(frame):
    global save_count, filter_state
 
    new_values = []
    new_rows_meta = []  # (timestamp, raw_value) - 필터 결과와 매칭용
 
    for _ in range(30):
        if ser.in_waiting == 0:
            break
        try:
            s = ser.readline().decode(errors="ignore").strip()
            if not s or not s[0].isdigit():
                continue
 
            t_str, value_str = s.split(",")
            t, value = int(t_str), int(value_str)
 
            y_raw.append(value)
            new_values.append(value)
            new_rows_meta.append(t)
        except Exception:
            continue
 
    if new_values:
        # 새로 들어온 샘플만 스트리밍 필터에 통과시킴 (상태 zi 유지)
        filtered_new, filter_state = apply_filter_streaming(np.array(new_values, dtype=float), filter_state)
 
        for t, raw_v, filt_v in zip(new_rows_meta, new_values, filtered_new):
            y_filtered.append(filt_v)
            writer.writerow([t, raw_v, round(float(filt_v), 3)])
            save_count += 1
 
        if save_count >= FLUSH_INTERVAL:
            csv_file.flush()
            save_count = 0
 
    raw_array = np.array(y_raw)
    filtered_array = np.array(y_filtered)
 
    # 원본 데이터 그리기
    line_raw.set_ydata(raw_array)
 
    # 필터링 데이터 그리기 (DC 오프셋 제거된 신호이므로 0 근처에서 진동)
    line_filtered.set_ydata(filtered_array)
 
    # 원본 신호 동적 스케일링 (왼쪽 축)
    ymin = np.min(raw_array)
    ymax = np.max(raw_array)
    margin = 100
    if ymax > ymin:
        ax.set_ylim(max(0, ymin - margin), min(4095, ymax + margin))
 
    # 필터 신호 동적 스케일링 (오른쪽 축) - 별도 스케일이라 진폭이 작아도 잘 보임
    f_min = np.min(filtered_array)
    f_max = np.max(filtered_array)
    if f_max > f_min:
        f_margin = (f_max - f_min) * 0.2 + 1e-6
        ax2.set_ylim(f_min - f_margin, f_max + f_margin)
 
    return line_raw, line_filtered
 
# ==========================================
# 6. 실행
# ==========================================
ani = animation.FuncAnimation(fig, update, interval=UPDATE_INTERVAL, blit=False, cache_frame_data=False)
 
try:
    plt.show()
finally:
    csv_file.flush()
    csv_file.close()
    ser.close()
    print("저장 완료 :", filename)
 