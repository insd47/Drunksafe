#ifndef DEVICE_H
#define DEVICE_H

// Arduino setup()에서 호출
void setupDevice();

// 백그라운드 작업 (센서 업데이트, 알림 업데이트, 데이터 스트리밍 등)
void runBackgroundTasks();

// Arduino loop()에서 호출
void loopDevice();

#endif
