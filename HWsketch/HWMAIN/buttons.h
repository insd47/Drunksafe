#ifndef BUTTONS_H
#define BUTTONS_H

// 버튼 핀을 INPUT_PULLUP으로 초기화합니다.
// 실제 핀 번호는 config.h의 BTN_* 상수를 사용합니다.
void initButtons();

// 지정한 버튼이 한 번 눌렸다가 떼어졌는지 확인합니다.
// true가 반환되는 순간을 "버튼 이벤트 1회"로 보면 됩니다.
bool isButtonPressed(int pin);

#endif
