import { DrunksafeAnalyzer } from './app/src/lib/drunksafeAnalyzer';

console.log('=============================================');
console.log('🍺 Drunksafe 3D 위험도 판별 알고리즘 테스트 🍺');
console.log('=============================================\n');

// 1. 건장하고 간 튼튼한 신입사원 (위험도 낮음 예상)
const shin = new DrunksafeAnalyzer({ gender: 'M', age: 26, height: 180, weight: 80 });
const shinResult = shin.getRiskAssessment(0.04, 3, 1, 0.04);
console.log('[👨 신입사원] (26세/180cm/80kg/주1회 음주)');
console.log(` - 측정 수치: BAC 0.04% (해독 3시간 경과)`);
console.log(` - 판정 결과: ${shinResult.level} (총점 ${shinResult.totalScore}점)`);
console.log(` - 상세 설명: ${shinResult.description}\n`);

// 2. 평범한 김대리 (위험도 중간 예상)
const kim = new DrunksafeAnalyzer({ gender: 'M', age: 35, height: 175, weight: 75 });
const kimResult = kim.getRiskAssessment(0.06, 5, 3, 0.06);
console.log('[👨 김대리] (35세/175cm/75kg/주3회 음주)');
console.log(` - 측정 수치: BAC 0.06% (해독 5시간 경과)`);
console.log(` - 판정 결과: ${kimResult.level} (총점 ${kimResult.totalScore}점)`);
console.log(` - 상세 설명: ${kimResult.description}\n`);

// 3. 체구 작고 술 자주 마시는 이부장 (위험도 높음 예상)
const lee = new DrunksafeAnalyzer({ gender: 'F', age: 50, height: 155, weight: 55 });
const leeResult = lee.getRiskAssessment(0.08, 4, 5, 0.07);
console.log('[👩 이부장] (50세/155cm/55kg/주5회 음주)');
console.log(` - 측정 수치: BAC 0.08% (해독 4시간 경과)`);
console.log(` - 판정 결과: ${leeResult.level} (총점 ${leeResult.totalScore}점)`);
console.log(` - 상세 설명: ${leeResult.description}\n`);

console.log('=============================================');
console.log('✅ 테스트 완료! 깃허브에는 아무것도 안 올라갔습니다.');
