// 천식 가능성이 높은 사용자 응답 시나리오
// 천식 예측지수(API) 기준을 만족하는 응답들

const HIGH_RISK_ASTHMA_RESPONSES = {
  // 시나리오 1: 전형적인 천식 증상 + 가족력
  scenario1: [
    '아이가 밤에 자꾸 쌕쌕거려요',
    '숨쉬기가 어려워 보여요',
    '3개월 정도 계속 그래요',
    '가슴이 답답하다고 해요',
    '아버지가 천식이 있어요',
    '분석해줘',
  ],

  // 시나리오 2: 천식 증상 + 아토피 병력
  scenario2: [
    '기침이 심해요',
    '밤에 더 심해져요',
    '3개월 넘게 지속되고 있어요',
    '아토피 피부염이 있어요',
    '쌕쉬기가 어려워 보여요',
    '분석해줘',
  ],

  // 시나리오 3: 천식 증상 + 알레르기 항원 (부가 인자 2개)
  scenario3: [
    '꽃가루가 날리면 기침이 심해져요',
    '먼지가 많으면 숨쉬기가 어려워요',
    '계란을 먹으면 알레르기가 있어요',
    '우유도 알레르기가 있어요',
    '밤에 쌕쌕거려요',
    '3개월 정도 계속 그래요',
    '분석해줘',
  ],

  // 시나리오 4: 복합적 천식 증상 + 위험인자
  scenario4: [
    '아이가 운동할 때마다 숨이 차요',
    '밤에 자꾸 깨면서 기침해요',
    '가슴이 답답하다고 해요',
    '4개월 정도 지속되고 있어요',
    '기관지확장제를 3개월 넘게 사용하고 있어요',
    '할머니가 천식이 있어요',
    '분석해줘',
  ],

  // 시나리오 5: 계절성 천식 + 가족력
  scenario5: [
    '봄철에 꽃가루가 날리면 증상이 심해져요',
    '쌕쌕거림이 있어요',
    '야간에 더 심해져요',
    '3개월 이상 지속되고 있어요',
    '아버지가 알레르기 비염이 있어요',
    '분석해줘',
  ],

  // 시나리오 6: 영유아 천식 의심 + 아토피
  scenario6: [
    '아기가 밤에 자꾸 깨면서 기침해요',
    '쌕쉬기가 어려워 보여요',
    '가슴이 답답하다고 보여요',
    '3개월 넘게 계속 그래요',
    '아토피 피부염이 있어요',
    '분석해줘',
  ],

  // 시나리오 7: 운동 유발 천식 + 알레르기
  scenario7: [
    '운동할 때마다 기침이 심해져요',
    '쌕쉬기가 어려워요',
    '가슴이 답답해요',
    '3개월 정도 지속되고 있어요',
    '꽃가루 알레르기가 있어요',
    '견과류 알레르기도 있어요',
    '분석해줘',
  ],

  // 시나리오 8: 감기 후 지속 증상 + 가족력
  scenario8: [
    '감기는 나았는데 기침이 계속 돼요',
    '밤에 쌕쉬기가 어려워 보여요',
    '가슴이 답답하다고 해요',
    '3개월 넘게 지속되고 있어요',
    '어머니가 천식이 있어요',
    '분석해줘',
  ],
};

// 각 시나리오별 예상 결과
const EXPECTED_RESULTS = {
  scenario1: {
    possibility: '있음',
    reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    keyFactors: ['쌕쌕거림', '야간', '3개월 지속', '가족력'],
  },
  scenario2: {
    possibility: '있음',
    reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    keyFactors: ['야간', '3개월 지속', '아토피 병력'],
  },
  scenario3: {
    possibility: '있음',
    reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    keyFactors: ['야간', '3개월 지속', '공중항원', '식품항원'],
  },
  scenario4: {
    possibility: '있음',
    reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    keyFactors: ['운동시 이상', '야간', '4개월 지속', '기관지확장제 3개월', '가족력'],
  },
  scenario5: {
    possibility: '있음',
    reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    keyFactors: ['쌕쌕거림', '야간', '3개월 지속', '계절', '가족력'],
  },
  scenario6: {
    possibility: '있음',
    reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    keyFactors: ['야간', '3개월 지속', '아토피 병력'],
  },
  scenario7: {
    possibility: '있음',
    reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    keyFactors: ['운동시 이상', '3개월 지속', '공중항원', '식품항원'],
  },
  scenario8: {
    possibility: '있음',
    reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    keyFactors: ['야간', '3개월 지속', '가족력'],
  },
};

// 시나리오 실행 함수
function runScenario(scenarioName) {
  const responses = HIGH_RISK_ASTHMA_RESPONSES[scenarioName];
  const expected = EXPECTED_RESULTS[scenarioName];

  console.log(`\n=== ${scenarioName.toUpperCase()} ===`);
  console.log('사용자 응답:');
  responses.forEach((response, index) => {
    console.log(`${index + 1}. ${response}`);
  });

  console.log('\n예상 결과:');
  console.log(`- 천식 가능성: ${expected.possibility}`);
  console.log(`- 판정 이유: ${expected.reason}`);
  console.log(`- 주요 인자: ${expected.keyFactors.join(', ')}`);
}

// 모든 시나리오 실행
function runAllScenarios() {
  Object.keys(HIGH_RISK_ASTHMA_RESPONSES).forEach((scenario) => {
    runScenario(scenario);
  });
}

module.exports = {
  HIGH_RISK_ASTHMA_RESPONSES,
  EXPECTED_RESULTS,
  runScenario,
  runAllScenarios,
};

// 직접 실행 시
if (require.main === module) {
  console.log('천식 가능성이 높은 사용자 응답 시나리오\n');
  runAllScenarios();
}
