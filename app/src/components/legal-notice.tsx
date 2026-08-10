import { Text } from 'react-native';

export function LegalNotice() {
  return (
    <Text className="text-xs leading-5 text-gray-500">
      이 결과는 참고용 추정치이며, 법적·의료적 판단의 근거가 되지 않습니다. 음주 후에는 결과와
      무관하게 운전하지 마세요.
    </Text>
  );
}
