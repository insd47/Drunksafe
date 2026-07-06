import serial
import csv
import re
from datetime import datetime

# ==========================================
# 🛠️ 설정 부분 (자신의 환경에 맞게 수정하세요)
# ==========================================
COM_PORT = 'COM4'  # 아두이노 IDE 우측 하단에 뜨는 포트 번호로 바꿔주세요 (예: COM4, COM5)
BAUD_RATE = 115200 # 아두이노 코드의 속도와 동일해야 합니다.
EXCEL_FILENAME = 'Alcohol_Test_Data.csv' # 생성될 엑셀(CSV) 파일 이름

# ==========================================
# 🧮 데이터 변환 함수 (원하는 계산식이 있다면 여기에 추가하세요)
# ==========================================
def process_data(mg_val, bac_val):
    """
    센서의 측정값을 받아 원하는 방식(함수)으로 변환하는 곳입니다.
    현재는 아두이노가 보낸 값을 그대로 넘겨주지만, 
    만약 값에 1.5를 곱하거나 단위를 바꾸고 싶다면 이 안에서 수정하면 됩니다!
    """
    final_mg = float(mg_val)
    final_bac = float(bac_val)
    return final_mg, final_bac

def main():
    print(f"[{COM_PORT}] 포트로 보드와 연결을 시도합니다...")
    try:
        # 아두이노와 시리얼 통신 연결
        ser = serial.Serial(COM_PORT, BAUD_RATE, timeout=1)
        print("✅ 연결 성공! 센서의 측정을 기다리는 중...\n(종료하려면 창을 닫거나 Ctrl+C를 누르세요)")
    except Exception as e:
        print("\n❌ 포트 연결 실패!")
        print("1. 아두이노 IDE의 '시리얼 모니터'가 켜져있다면 반드시 [X]를 눌러 꺼주세요! (동시에 두 프로그램이 접속할 수 없습니다)")
        print(f"2. COM_PORT 번호가 맞는지 확인해주세요. (현재 설정: {COM_PORT})")
        return

    # 엑셀 파일(CSV) 생성 및 첫 줄(제목) 쓰기
    # utf-8-sig 인코딩을 써야 한국어 엑셀에서 한글이 깨지지 않습니다.
    with open(EXCEL_FILENAME, mode='a', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        if f.tell() == 0:
            writer.writerow(['측정시간', '농도(mg/100ml)', '혈중알코올농도(BAC %)', '상태판정'])

    current_mg = None
    current_bac = None
    
    try:
        while True:
            if ser.in_waiting > 0:
                # 보드에서 날아오는 글자를 한 줄씩 읽기
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if not line:
                    continue
                
                print(line) # 파이썬 검은 창에도 똑같이 출력 보여주기
                
                # 1. 'mg/100ml' 데이터 추출
                mg_match = re.search(r'측정된 알코올 농도:\s*([\d\.]+)', line)
                if mg_match:
                    current_mg = mg_match.group(1)
                
                # 2. 'BAC' 데이터 추출
                bac_match = re.search(r'혈중 알코올 농도\(BAC\):\s*([\d\.]+)', line)
                if bac_match:
                    current_bac = bac_match.group(1)
                    
                # 3. '판정 결과'가 뜨면, 모아둔 데이터를 변환 함수 거쳐서 엑셀에 저장!
                status_match = re.search(r'결과:\s*(.+)', line)
                if status_match and current_mg is not None and current_bac is not None:
                    raw_status = status_match.group(1).strip()
                    
                    # 위에서 만든 변환 함수 적용
                    final_mg, final_bac = process_data(current_mg, current_bac)
                    
                    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    
                    # 엑셀(CSV) 파일에 한 줄(행) 추가
                    with open(EXCEL_FILENAME, mode='a', newline='', encoding='utf-8-sig') as f:
                        writer = csv.writer(f)
                        writer.writerow([now, final_mg, final_bac, raw_status])
                        
                    print(f"\n💾 엑셀 파일({EXCEL_FILENAME})에 데이터 1줄이 자동 저장되었습니다! [{now}]\n")
                    
                    # 다음 측정을 위해 임시 변수 비우기
                    current_mg = None
                    current_bac = None

    except KeyboardInterrupt:
        print("\n데이터 수집을 안전하게 종료합니다.")
    finally:
        if 'ser' in locals() and ser.is_open:
            ser.close()

if __name__ == '__main__':
    main()
