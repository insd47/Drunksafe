export type FittingDemoUser = {
  name: string;
  fittingSession: number;
  c0: number;
  k: number;
  kLow: number;
  kHigh: number;
  rSquare: number;
  rmse: number;
  grade: 'A' | 'B';
  validations: { session: number; points: [number, number][] }[];
};

// 2026-08-29: 첨부 측정데이터1~3에서 사람별 R²가 가장 좋은 세션을 한 번 fitting한 데모.
// points=[세션 첫 측정 이후 경과 분, 측정값]. 각 점은 독립적인 C0로 잔여시간을 계산한다.
export const fittingDemoUsers: FittingDemoUser[] = [
  {
    name: '김재영',
    fittingSession: 3,
    c0: 120,
    k: 0.003111609,
    kLow: 0.002938767,
    kHigh: 0.003221215,
    rSquare: 0.939861,
    rmse: 5.002,
    grade: 'A',
    validations: [
      {
        session: 1,
        points: [
          [0, 64],
          [15, 56],
          [30, 54],
          [45, 48],
          [60, 47],
          [75, 40],
          [90, 34],
          [105, 27],
          [120, 25],
          [135, 21],
          [150, 15],
          [165, 11],
          [180, 11],
          [195, 7],
          [210, 8],
          [225, 6],
        ],
      },
      {
        session: 2,
        points: [
          [0, 50],
          [10, 57],
          [20, 64],
          [30, 50],
          [40, 53],
          [50, 54],
          [60, 37],
          [70, 42],
          [80, 49],
          [91, 39],
          [100, 40],
          [110, 42],
          [120, 36],
          [130, 33],
          [140, 29],
          [150, 25],
          [160, 21],
          [170, 19],
          [180, 16],
          [190, 14],
          [200, 12],
          [210, 11],
          [220, 10],
          [230, 8],
          [240, 8],
          [250, 6],
          [260, 7],
        ],
      },
    ],
  },
  {
    name: '황인성',
    fittingSession: 2,
    c0: 53,
    k: 0.006677083,
    kLow: 0.006374022,
    kHigh: 0.007066174,
    rSquare: 0.964916,
    rmse: 2.416,
    grade: 'A',
    validations: [
      {
        session: 1,
        points: [
          [0, 9],
          [15, 110],
          [30, 44],
          [45, 45],
          [60, 41],
          [75, 39],
          [90, 34],
          [105, 30],
          [120, 26],
          [135, 22],
          [150, 18],
          [165, 14],
          [180, 11],
          [195, 9],
          [210, 8],
          [225, 6],
        ],
      },
    ],
  },
  {
    name: '김동완',
    fittingSession: 3,
    c0: 86,
    k: 0.006862055,
    kLow: 0.006427716,
    kHigh: 0.007015052,
    rSquare: 0.975252,
    rmse: 3.106,
    grade: 'A',
    validations: [
      {
        session: 1,
        points: [
          [0, 150],
          [15, 99],
          [30, 86],
          [45, 84],
          [60, 83],
          [75, 77],
          [90, 68],
          [105, 65],
          [120, 56],
          [135, 56],
          [150, 45],
          [165, 34],
          [180, 33],
          [195, 25],
          [210, 21],
          [225, 15],
          [240, 11],
          [245, 11],
          [252, 9],
        ],
      },
    ],
  },
  {
    name: '이준석',
    fittingSession: 3,
    c0: 107,
    k: 0.001532894,
    kLow: 0.001397507,
    kHigh: 0.001646801,
    rSquare: 0.870028,
    rmse: 3.496,
    grade: 'B',
    validations: [
      {
        session: 2,
        points: [
          [0, 29],
          [10, 29],
          [20, 47],
          [30, 44],
          [40, 45],
          [50, 46],
          [60, 28],
          [70, 57],
          [80, 40],
          [90, 39],
          [100, 47],
          [110, 45],
          [120, 46],
          [130, 37],
          [142, 25],
          [150, 27],
          [160, 36],
          [170, 27],
          [180, 27],
          [190, 32],
          [200, 28],
          [210, 21],
          [220, 19],
          [230, 20],
          [240, 18],
          [250, 13],
          [260, 16],
        ],
      },
    ],
  },
  {
    name: '염상오',
    fittingSession: 3,
    c0: 214,
    k: 0.0040645,
    kLow: 0.003893215,
    kHigh: 0.004348133,
    rSquare: 0.898737,
    rmse: 11.118,
    grade: 'B',
    validations: [
      {
        session: 2,
        points: [
          [0, 220],
          [10, 220],
          [20, 220],
          [30, 220],
          [40, 220],
          [50, 220],
          [60, 220],
          [70, 220],
          [80, 220],
          [90, 220],
          [100, 220],
          [110, 220],
          [120, 220],
          [130, 212],
          [142, 220],
          [150, 220],
          [160, 183],
          [170, 204],
          [180, 215],
          [190, 176],
          [200, 184],
          [210, 186],
          [220, 183],
          [230, 164],
          [240, 158],
          [250, 146],
          [260, 155],
        ],
      },
    ],
  },
];

export function demoPrediction(
  point: [number, number],
  pointIndex: number,
  validation: FittingDemoUser['validations'][number],
  user: FittingDemoUser
) {
  const [elapsed, value] = point;
  const actualPoint = validation.points.slice(pointIndex).find((candidate) => candidate[1] <= 10);
  const actualFinish = actualPoint?.[0] ?? null;
  const actualRemaining = actualFinish === null ? null : Math.max(0, actualFinish - elapsed);
  if (value <= 10) {
    return {
      remaining: 0,
      finish: elapsed,
      earliest: 0,
      latest: 0,
      actualFinish,
      actualRemaining,
      relativeErrorPercent: actualRemaining === 0 ? null : 0,
    };
  }
  const logRatio = Math.log(value / 10);
  const remaining = Math.ceil(logRatio / user.k);
  return {
    remaining,
    finish: elapsed + remaining,
    earliest: Math.ceil(logRatio / user.kHigh),
    latest: Math.ceil(logRatio / user.kLow),
    actualFinish,
    actualRemaining,
    relativeErrorPercent:
      actualRemaining === null || actualRemaining === 0
        ? null
        : (Math.abs(remaining - actualRemaining) / actualRemaining) * 100,
  };
}
