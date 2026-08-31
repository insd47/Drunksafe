// algorithm1.ts
// Drunksafe: Algorithm 1 (표준 분해분석모델) 및 3D 스코어링 구현

export interface MeasurementPoint {
  t: number; // 시간 (시간 단위, ex: 0.5, 1.0)
  C: number; // 측정 수치 (BAC %)
}

export interface Algorithm1Result {
  k: number;
  C0: number;
  r2: number;
  targetR2: number;
  preservationRate: number;
  droppedPoints: number;
  riskLevel: string;
  totalScore: number;
}

export class DrunksafeAlgorithm1 {
  // 선형 회귀 (절편 고정)를 통한 k값 도출: ln(C/C0) = -k * t
  private static calculateK(data: MeasurementPoint[], C0: number): number {
    let sum_t2 = 0;
    let sum_t_lnC = 0;
    for (const p of data) {
      if (p.t === 0) continue;
      // C가 0 이하인 오류값은 무시
      if (p.C <= 0) continue; 
      
      const lnRatio = Math.log(p.C / C0);
      sum_t2 += p.t * p.t;
      sum_t_lnC += p.t * lnRatio;
    }
    if (sum_t2 === 0) return 0;
    return -(sum_t_lnC / sum_t2);
  }

  // R^2 계산 함수
  private static calculateR2(data: MeasurementPoint[], C0: number, k: number): number {
    if (data.length <= 1) return 1; // 점이 하나면 1로 취급
    
    let sumC = 0;
    for (const p of data) sumC += p.C;
    const meanC = sumC / data.length;

    let ssTot = 0;
    let ssRes = 0;

    for (const p of data) {
      const c_hat = C0 * Math.exp(-k * p.t);
      ssTot += Math.pow(p.C - meanC, 2);
      ssRes += Math.pow(p.C - c_hat, 2);
    }
    
    if (ssTot === 0) return 1;
    return 1 - (ssRes / ssTot);
  }

  // Algorithm 1 전체 파이프라인 수행
  public static analyze(rawData: MeasurementPoint[], frequency: number): Algorithm1Result {
    // 1. 최대값 C0 찾기
    let maxC0 = -1;
    let maxIndex = -1;
    for (let i = 0; i < rawData.length; i++) {
      if (rawData[i]!.C > maxC0) {
        maxC0 = rawData[i]!.C;
        maxIndex = i;
      }
    }

    if (maxIndex === -1 || maxC0 === 0) {
      throw new Error("유효한 측정 데이터가 없습니다.");
    }

    const t0 = rawData[maxIndex]!.t;

    // 2. 최대값 이전 데이터 삭제 및 t 재설정
    let data = rawData
      .filter(p => p.t >= t0)
      .map(p => ({ t: p.t - t0, C: p.C }));
    
    const initialDataCount = data.length;

    // 목표 R^2 단계
    const targetR2List = [0.90, 0.85, 0.80, 0.75, 0.70];
    
    let finalK = 0;
    let finalR2 = 0;
    let finalTargetR2 = 0;
    let currentData = [...data];

    // 목표 R^2를 단계적으로 낮추면서 시도
    for (const target of targetR2List) {
      currentData = [...data]; // 초기 데이터부터 다시 시작
      let k = this.calculateK(currentData, maxC0);
      let r2 = this.calculateR2(currentData, maxC0, k);
      

      // 상대오차 21% 초과점 제거 반복루프
      while (r2 < target) {
        let maxError = -1;
        let dropIndex = -1;

        // t=0(기준점)을 제외하고 가장 큰 상대오차(21% 초과) 찾기
        for (let i = 0; i < currentData.length; i++) {
          if (currentData[i]!.t === 0) continue;
          
          const c_hat = maxC0 * Math.exp(-k * currentData[i]!.t);
          const error = Math.abs((currentData[i]!.C - c_hat) / currentData[i]!.C);
          
          if (error > 0.21 && error > maxError) {
            maxError = error;
            dropIndex = i;
          }
        }

        // 더 이상 삭제할 이상치가 없으면 루프 탈출
        if (dropIndex === -1) break;

        // 데이터 삭제
        currentData.splice(dropIndex, 1);
        
        // 보존율 검사 (80% 미만이면 이 target 단계는 실패)
        if (currentData.length / initialDataCount < 0.80) {
          break; // 타겟 달성 실패, 다음 타겟(낮은 기준)으로 넘어감
        }

        // k와 R^2 다시 계산
        k = this.calculateK(currentData, maxC0);
        r2 = this.calculateR2(currentData, maxC0, k);
      }

      // 80% 보존율을 지키면서 타겟 R^2를 넘었는지 확인
      if (r2 >= target && (currentData.length / initialDataCount) >= 0.80) {
        finalK = k;
        finalR2 = r2;
        finalTargetR2 = target;
        
        break; // 찾았으므로 탈출!
      }
    }

    // 만약 0.70까지 낮췄는데도 실패했다면, 그냥 가장 마지막 상태 반환
    if (finalTargetR2 === 0) {
      finalK = this.calculateK(currentData, maxC0);
      finalR2 = this.calculateR2(currentData, maxC0, finalK);
      finalTargetR2 = 0.70;
    }

    // --- 3D 스코어링 평가 ---
    let scoreA = 0; // k 기울기
    if (finalK >= 0.35) scoreA = 1;
    else if (finalK >= 0.15) scoreA = 2;
    else scoreA = 3;

    let scoreB = 0; // 주간 빈도
    if (frequency <= 1) scoreB = 1;
    else if (frequency <= 3) scoreB = 2;
    else scoreB = 3;

    let scoreC = 0; // 최고 농도
    if (maxC0 < 0.03) scoreC = 1;
    else if (maxC0 < 0.08) scoreC = 2;
    else scoreC = 3;

    const totalScore = scoreA + scoreB + scoreC;
    let riskLevel = "";
    if (totalScore === 3) riskLevel = "Level 1 [매우 안전]";
    else if (totalScore <= 5) riskLevel = "Level 2 [주의 필요]";
    else if (totalScore === 6) riskLevel = "Level 3 [경고]";
    else if (totalScore <= 8) riskLevel = "Level 4 [위험]";
    else riskLevel = "Level 5 [초고위험]";

    return {
      k: finalK,
      C0: maxC0,
      r2: finalR2,
      targetR2: finalTargetR2,
      preservationRate: (currentData.length / initialDataCount) * 100,
      droppedPoints: initialDataCount - currentData.length,
      riskLevel: riskLevel,
      totalScore: totalScore
    };
  }
}
