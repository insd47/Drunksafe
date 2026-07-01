/*

* ESP32 PPG Sender (Improved)

* Sampling Rate : 100 Hz

*/



const int pulsePin = 36; // GPIO36 (ADC1_CH0)

const uint32_t SAMPLE_INTERVAL = 10000; // 10,000us = 100Hz



uint32_t lastSampleTime = 0;



void setup() {



Serial.begin(115200);



pinMode(pulsePin, INPUT);



analogReadResolution(12); // 0~4095

analogSetPinAttenuation(pulsePin, ADC_11db); // 입력 범위 확장



delay(100);



Serial.println("time_ms,ppg");

lastSampleTime = micros();

}



void loop() {



uint32_t now = micros();



if ((uint32_t)(now - lastSampleTime) >= SAMPLE_INTERVAL) {



// 다음 샘플 시간을 고정 (드리프트 방지)

lastSampleTime += SAMPLE_INTERVAL;



// ADC 노이즈 감소 (4회 평균)

uint32_t sum = 0;



for (int i = 0; i < 4; i++) {

sum += analogRead(pulsePin);

}



uint16_t rawSignal = sum / 4;



// 현재 시간(ms)

uint32_t time_ms = now / 1000;



Serial.printf("%lu,%u\n", time_ms, rawSignal);

}



} 

