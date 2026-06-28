import serial
import collections
import numpy as np
import scipy.fft as fft
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import time
import csv
import os

# ==========================================
# 1. 설정 변수 정의
# ==========================================
PORT = 'COM4'
BAUD_RATE = 115200
WINDOW_SIZE = 512  # 실시간 연산 데이터 창 (5.12초)
FFT_SIZE = 4096  # FFT 크기
FS = 100.0

WARMUP_DURATION = 180.0  # 3분 안정화 기간 (180초)
REPORT_INTERVAL = 20.0  # 20초 주기 데이터 결산

# 기존 아두이노 알고리즘 파라미터 이식
TARGET_N = 20  # 20초 동안의 데이터 중 표준편차 최소화로 선별할 핵심 샘플 수

# AI 데이터셋 보관 파일명
CSV_FILENAME = f"alcohol_ai_dataset_{time.strftime('%Y-%m-%d-%H-%M-%S')}.csv"

# ==========================================
# 2. 전역 데이터 버퍼 초기화
# ==========================================
ppg_window = collections.deque(maxlen=WINDOW_SIZE)
for _ in range(WINDOW_SIZE): ppg_window.append(0)

# 실시간 모니터링용 이동 평균 버퍼
bpm_history = collections.deque(maxlen=8)

# 20초 연산용 축적 버퍼
bpm_20s_buffer = []

# 타이머 변수
start_program_time = time.time()
last_report_time = time.time()

# CSV 파일 초기화 (헤더 생성)
if not os.path.exists(CSV_FILENAME):
    with open(CSV_FILENAME, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['Timestamp', 'Stabilized', 'Final_BPM', 'HRV_StdDev', 'Peak_Magnitude', 'Alcohol_Label'])

print(f"[{PORT}] 시리얼 연결 시도 중...")
try:
    ser = serial.Serial(PORT, BAUD_RATE, timeout=0.1)
    print("연결 성공!")
except Exception as e:
    print(f"포트 연결 실패: {e}")
    exit()

# ==========================================
# 3. 실시간 UI 그래프 구성
# ==========================================
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 6))
fig.canvas.manager.set_window_title('AI-Ready PPG Integrated Processor')

line_time, = ax1.plot(np.arange(WINDOW_SIZE), list(ppg_window), color='blue')
ax1.set_title("Time Domain - Live PPG Signal (DC Removed)")
ax1.set_xlim(0, WINDOW_SIZE)
ax1.grid(True)

frequencies = fft.fftfreq(FFT_SIZE, 1 / FS)
half_N = FFT_SIZE // 2
positive_freqs = frequencies[:half_N]
valid_indices = np.where((positive_freqs >= 0.5) & (positive_freqs <= 3.5))[0]
filtered_freqs = positive_freqs[valid_indices]

line_freq, = ax2.plot(filtered_freqs, np.zeros(len(valid_indices)), color='red')
status_text = ax2.text(0.45, 0.85, '', transform=ax2.transAxes, fontsize=12, color='black', weight='bold')
bpm_text = ax2.text(0.45, 0.73, '', transform=ax2.transAxes, fontsize=15, color='darkred', weight='bold')
ax2.set_title("Frequency Domain - High Resolution Spectrum")
ax2.set_xlim(0.5, 3.5)
ax2.grid(True)
plt.tight_layout()


# ==========================================
# 4. 핵심 데이터 처리 루프 함수
# ==========================================
def update(frame):
    global last_report_time, bpm_20s_buffer

    current_time = time.time()
    elapsed_since_start = current_time - start_program_time
    is_warmed_up = elapsed_since_start >= WARMUP_DURATION

    # 4-1. 아두이노 RAW 데이터 시리얼 수신
    while ser.in_waiting > 0:
        try:
            line = ser.readline().decode('utf-8').strip()
            data = line.split(',') # 아두이노 출력값에서 리스트 생성
            if len(data) == 2:
                ppg_window.append(int(data[1]))
        except (ValueError, IndexError):
            continue

    y = np.array(ppg_window)

    # 윈도우가 실제 데이터로 완전히 채워질 때까지 경과 경고 및 연산 유예
    if len(y) < WINDOW_SIZE or np.all(y == 0):
        return line_time, line_freq, bpm_text, status_text

    y_detrended = y - np.mean(y)

    # 시간 영역 업데이트
    line_time.set_ydata(y_detrended)
    ax1.set_ylim(np.min(y_detrended) - 15, np.max(y_detrended) + 15)

    # 4-2. [1차 필터] 실시간 고해상도 FFT 수행
    X = fft.fft(y_detrended, n=FFT_SIZE)
    magnitude = np.abs(X[:half_N]) * (2.0 / WINDOW_SIZE)
    filtered_magnitude = magnitude[valid_indices]

    # 주파수 영역 업데이트
    line_freq.set_ydata(filtered_magnitude)
    if len(filtered_magnitude) > 0:
        ax2.set_ylim(0, np.max(filtered_magnitude) * 1.2 + 0.05)

    # 4-3. 실시간 맥박 트래킹 및 수집
    raw_bpm = 0.0
    peak_mag = 0.0
    if len(filtered_magnitude) > 0 and (np.max(y) - np.min(y) > 15):
        max_idx = np.argmax(filtered_magnitude)
        peak_freq = filtered_freqs[max_idx]
        peak_mag = filtered_magnitude[max_idx]
        raw_bpm = peak_freq * 60

        if 45 < raw_bpm < 160:
            bpm_history.append(raw_bpm)
            bpm_20s_buffer.append((raw_bpm, peak_mag))

        smoothed_bpm = np.mean(bpm_history)
        bpm_text.set_text(f'Live Heart Rate: {smoothed_bpm:.1f} BPM')
    else:
        bpm_text.set_text('Signal Stabilizing...')

    # 상단 상태 메시지 출력 (3분 카운트다운 표시)
    if not is_warmed_up:
        remaining = WARMUP_DURATION - elapsed_since_start
        status_text.set_text(f'[WARM-UP STAGE] Logging begins in {remaining:.1f}s')
        status_text.set_color('blue')
    else:
        next_report = REPORT_INTERVAL - (current_time - last_report_time)
        status_text.set_text(f'[RECORDING ACTIVE] Next AI Feature Report in {next_report:.1f}s')
        status_text.set_color('green')

    # 4-4. [2차 필터 및 AI 피처 리포트] 20초 주기 타이머 발동
    if current_time - last_report_time >= REPORT_INTERVAL:
        if is_warmed_up:
            total_collected = len(bpm_20s_buffer)

            # 첫 측정(3분 종료 지점) 후 경과 시간 계산: 현재 누적 시간에서 워밍업 시간(180초)을 빼서 처리
            elapsed_recorded_time = int(round(elapsed_since_start - WARMUP_DURATION))

            # Case A: 데이터가 충분하여 정상 필터링을 수행하는 경우 (Stabilized = 1)
            if total_collected >= 5:
                bpm_20s_buffer.sort(key=lambda x: x[0])
                current_target_n = total_collected if total_collected < TARGET_N else TARGET_N

                min_std_dev = 999999.0
                final_avg_bpm = 0.0
                final_peak_mag = 0.0

                for start_idx in range(total_collected - current_target_n + 1):
                    window_samples = bpm_20s_buffer[start_idx: start_idx + current_target_n]
                    bpms = [x[0] for x in window_samples]
                    mags = [x[1] for x in window_samples]

                    avg_bpm = np.mean(bpms)
                    std_dev = np.std(bpms)
                    avg_mag = np.mean(mags)

                    if std_dev < min_std_dev:
                        min_std_dev = std_dev
                        final_avg_bpm = avg_bpm
                        final_peak_mag = avg_mag

                stabilized_flag = 1

                # 콘솔에 정제 보고서 출력
                local_time = time.strftime('%H:%M:%S', time.localtime(current_time))
                print("\n" + "=" * 50)
                print(f"           [AI 데이터셋 리포트] {local_time}")
                print("=" * 50)
                print(f"▶ 첫 측정 후 경과 시간       : {elapsed_recorded_time} 초")
                print(f"▶ 데이터 안정화 상태(Stabilized): {stabilized_flag} (정상 정제)")
                print(f"▶ ⭐ 최종 정제된 대표 BPM       : {final_avg_bpm:.1f} BPM")
                print(f"▶ ⭐ 심박변이도 피처(StdDev)    : {min_std_dev:.3f}")
                print(f"▶ 신호 강도 피처(Magnitude)    : {final_peak_mag:.3f}")
                print("-" * 50)

                with open(CSV_FILENAME, mode='a', newline='', encoding='utf-8') as f:
                    writer = csv.writer(f)
                    writer.writerow(
                        [elapsed_recorded_time, stabilized_flag, round(final_avg_bpm, 2), round(min_std_dev, 4),
                         round(final_peak_mag, 4), 'TODO_LABEL'])
                print(f"✔ [정상 수집] AI 피처 세트가 '{CSV_FILENAME}'에 저장되었습니다.\n")

            # Case B: 데이터 부족 시 (Stabilized = 0)
            else:
                stabilized_flag = 0

                # 파일이 이미 존재한다면 CSV 맨 마지막 줄을 열어 직전 값을 로드 (새 변수 선언 없이 파일 스트림으로 해결)
                try:
                    with open(CSV_FILENAME, mode='r', encoding='utf-8') as f:
                        last_row = list(csv.reader(f))[-1]
                        final_avg_bpm = float(last_row[2])
                        min_std_dev = float(last_row[3])
                        final_peak_mag = float(last_row[4])
                except Exception:
                    # 파일에 첫 데이터가 없거나 로드에 실패했을 때만 최하단 기본 세팅 적용
                    final_avg_bpm, min_std_dev, final_peak_mag = 75.0, 1.5, 1.0

                local_time = time.strftime('%H:%M:%S', time.localtime(current_time))
                print("\n" + "=" * 50)
                print(f"           [AI 데이터셋 리포트 - 경고] {local_time}")
                print("=" * 50)
                print(f"▶ 첫 측정 후 경과 시간       : {elapsed_recorded_time} 초")
                print(f"▶ 데이터 안정화 상태(Stabilized): {stabilized_flag} (데이터 부족으로 대체)")
                print(f"▶ ⚠ 복사된 직전 대표 BPM       : {final_avg_bpm:.1f} BPM")
                print(f"▶ ⚠ 복사된 직전 표준편차       : {min_std_dev:.3f}")
                print(f"▶ 복사된 직전 신호 강도        : {final_peak_mag:.3f}")
                print("-" * 50)

                with open(CSV_FILENAME, mode='a', newline='', encoding='utf-8') as f:
                    writer = csv.writer(f)
                    writer.writerow(
                        [elapsed_recorded_time, stabilized_flag, round(final_avg_bpm, 2), round(min_std_dev, 4),
                         round(final_peak_mag, 4), 'TODO_LABEL'])
                print(f"✔ [보간 수집] 노이즈 보간 피처 세트가 '{CSV_FILENAME}'에 저장되었습니다.\n")

        else:
            print(f"[{time.strftime('%H:%M:%S')}] 안정화(Warm-up) 중... 데이터 수집을 유예합니다.")

        # 버퍼 및 타이머 초기화
        last_report_time = current_time
        bpm_20s_buffer = []

    return line_time, line_freq, bpm_text, status_text


# ==========================================
# 5. 프로세스 구동
# ==========================================
ani = animation.FuncAnimation(fig, update, interval=100, blit=False)

try:
    plt.show()
finally:
    ser.close()
    print("시스템이 안전하게 종료되었습니다.")