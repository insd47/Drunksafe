import { DrunksafeAlgorithm1, MeasurementPoint } from './algorithm1';

console.log('=============================================');
console.log('🍺 Algorithm 1 (표준 분해분석모델) 시뮬레이션 🍺');
console.log('=============================================\n');

// 가상의 측정 데이터 (시간 t는 음주 후 시간 단위, C는 BAC %)
// 1. 이상적인 해독 곡선 (건강한 간, 오류 없음)
const data_good: MeasurementPoint[] = [
  { t: 0.0, C: 0.01 }, // 오르기 시작
  { t: 0.5, C: 0.05 }, // 상승
  { t: 1.0, C: 0.08 }, // 최고 수치! (C0) 여기서부터 t=0으로 잡힘
  { t: 2.0, C: 0.056 },
  { t: 3.0, C: 0.040 },
  { t: 4.0, C: 0.028 },
  { t: 5.0, C: 0.019 }
];

// 2. 오류가 섞인 느린 해독 곡선 (오류 제거 로직 테스트)
const data_bad: MeasurementPoint[] = [
  { t: 0.0, C: 0.04 },
  { t: 0.5, C: 0.10 }, // 최고 수치 (C0)
  { t: 1.5, C: 0.08 }, 
  { t: 2.5, C: 0.04 }, // 이상치! (정상 경로보다 갑자기 훅 떨어짐)
  { t: 3.5, C: 0.06 }, 
  { t: 4.5, C: 0.05 }, 
  { t: 5.5, C: 0.04 }
];

console.log('[👨 테스트 1] 건강한 간 (이상적인 곡선, 평소 주 2회 음주)');
const result1 = DrunksafeAlgorithm1.analyze(data_good, 2);
console.log(` - 발견된 최고 수치(C0): ${result1.C0.toFixed(3)}%`);
console.log(` - 도출된 분해능 상수(k): ${result1.k.toFixed(4)}`);
console.log(` - 반감기(Half-life): ${(Math.LN2 / result1.k).toFixed(2)} 시간`);
console.log(` - 달성된 목표 R^2: ${result1.targetR2.toFixed(2)} (실제 ${result1.r2.toFixed(4)})`);
console.log(` - 데이터 보존율: ${result1.preservationRate.toFixed(1)}% (삭제된 점: ${result1.droppedPoints}개)`);
console.log(` - 🚨 종합 판정: ${result1.riskLevel} (총점 ${result1.totalScore}점)\n`);

console.log('[👩 테스트 2] 오류가 섞인 느린 간 (21% 초과 이상치 자동 삭제, 평소 주 4회 음주)');
const result2 = DrunksafeAlgorithm1.analyze(data_bad, 4);
console.log(` - 발견된 최고 수치(C0): ${result2.C0.toFixed(3)}%`);
console.log(` - 도출된 분해능 상수(k): ${result2.k.toFixed(4)}`);
console.log(` - 반감기(Half-life): ${(Math.LN2 / result2.k).toFixed(2)} 시간`);
console.log(` - 달성된 목표 R^2: ${result2.targetR2.toFixed(2)} (실제 ${result2.r2.toFixed(4)})`);
console.log(` - 데이터 보존율: ${result2.preservationRate.toFixed(1)}% (삭제된 점: ${result2.droppedPoints}개)`);
console.log(` - 🚨 종합 판정: ${result2.riskLevel} (총점 ${result2.totalScore}점)\n`);

console.log('✅ 테스트 완료! 코드를 열어 배열 데이터를 수정하면 나만의 테스트가 가능합니다.');
