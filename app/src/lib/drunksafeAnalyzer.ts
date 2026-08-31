// drunksafeAnalyzer.ts
// Drunksafe: 개인 맞춤형 알코올 대사 능력 및 복합 위험도 판별 알고리즘

export type Gender = 'M' | 'F';

export interface UserSpecs {
  gender: Gender;
  age: number;      // 만 나이
  height: number;   // cm
  weight: number;   // kg
}

export interface RiskAssessmentResult {
  tbw: number;
  metabolicRate: number;
  totalScore: number;
  level: string;
  guideline: string;
}

export class DrunksafeAnalyzer {
  private gender: Gender;
  private age: number;
  private height: number;
  private weight: number;
  public tbw: number;

  constructor(specs: UserSpecs) {
    this.gender = specs.gender;
    this.age = specs.age;
    this.height = specs.height;
    this.weight = specs.weight;
    this.tbw = this.calculateTBW();
  }

  /**
   * Watson(1980)의 체수분량(TBW) 공식을 이용한 체수분량 도출 (단위: L)
   */
  private calculateTBW(): number {
    if (this.gender === 'M') {
      return 2.447 - (0.09156 * this.age) + (0.1074 * this.height) + (0.3362 * this.weight);
    } else {
      return -2.097 + (0.1069 * this.height) + (0.2466 * this.weight);
    }
  }

  /**
   * 혈중알코올농도를 바탕으로 체내에 보유한 알코올의 절대량(g)을 역산
   * @param maxBac 기기가 측정한 최고 혈중알코올농도 (단위: %)
   */
  private calculateAbsoluteAlcohol(maxBac: number): number {
    // BAC(%)를 g/L 단위로 변환 (0.10% = 1.0 g/L)
    const bacGPerL = maxBac * 10;
    // 혈액 내 수분 비중 약 0.8 (위드마크 기본 상수)
    return bacGPerL * this.tbw * 0.8;
  }

  /**
   * 절대 분해 능력(g/hr) 도출 및 지표 A 스코어링
   */
  private evaluateMetabolicRate(maxBac: number, totalActualTime: number): { rate: number; score: number } {
    const totalAlcoholG = this.calculateAbsoluteAlcohol(maxBac);
    const metabolicRateGHr = totalAlcoholG / totalActualTime;

    let score = 0;
    if (metabolicRateGHr >= 15) {
      score = 0;
    } else if (metabolicRateGHr >= 10) {
      score = 1;
    } else if (metabolicRateGHr >= 5) {
      score = 3;
    } else {
      score = 5;
    }

    return { rate: metabolicRateGHr, score };
  }

  /**
   * 주간 음주 횟수 기반 스코어링 (지표 B)
   */
  private evaluateFrequency(weeklyFrequency: number): number {
    if (weeklyFrequency <= 1) return 0;
    if (weeklyFrequency <= 3) return 2;
    return 5;
  }

  /**
   * 1회 평균 음주 강도 스코어링 (지표 C)
   */
  private evaluateIntensity(weeklyAvgMaxBac: number): number {
    if (weeklyAvgMaxBac < 0.05) return 0;
    if (weeklyAvgMaxBac < 0.10) return 2;
    return 4;
  }

  /**
   * 3D 변수 기반 종합 위험도 판별
   */
  public getRiskAssessment(
    maxBac: number,
    totalActualTime: number,
    weeklyFrequency: number,
    weeklyAvgMaxBac: number
  ): RiskAssessmentResult {
    const { rate, score: scoreA } = this.evaluateMetabolicRate(maxBac, totalActualTime);
    const scoreB = this.evaluateFrequency(weeklyFrequency);
    const scoreC = this.evaluateIntensity(weeklyAvgMaxBac);

    const totalScore = scoreA + scoreB + scoreC;

    let level = "";
    let guideline = "";

    if (totalScore <= 2) {
      level = "Level 1 [안전]";
      guideline = "완벽합니다! 지금의 건강한 음주 습관을 계속 유지해 주세요.";
    } else if (totalScore <= 5) {
      level = "Level 2 [주의]";
      guideline = "간에 가벼운 피로가 쌓이고 있습니다. 음주 후 최소 48시간의 간 휴식기를 가져주세요.";
    } else if (totalScore <= 8) {
      level = "Level 3 [경고]";
      guideline = "경고! 본인의 대사 능력에 비해 음주량이 과도합니다. 익일 오전 운전 시 각별한 주의가 필요합니다.";
    } else if (totalScore <= 11) {
      level = "Level 4 [위험]";
      guideline = "위험 수준입니다! 체내에 독성 물질이 상시 축적되어 있습니다. 당분간 금주를 강력히 권장합니다.";
    } else {
      level = "Level 5 [초고위험]";
      guideline = "초고위험군! 간 질환 발병 위험이 극도로 높으며, 언제 운전대를 잡아도 단속에 적발될 수 있습니다. 즉각적인 습관 개선이 필요합니다.";
    }

    return {
      tbw: Number(this.tbw.toFixed(2)),
      metabolicRate: Number(rate.toFixed(2)),
      totalScore,
      level,
      guideline,
    };
  }
}
