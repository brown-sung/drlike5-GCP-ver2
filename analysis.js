// 파일: analysis.js
function judgeAsthma(data) {
  if (!data || typeof data !== 'object') {
    return { possibility: '정보 부족', reason: '분석할 증상 정보가 충분하지 않습니다.' };
  }
  const hasAsthmaSymptoms =
    data.쌕쌕거림 === 'Y' ||
    data.호흡곤란 === 'Y' ||
    data['가슴 답답'] === 'Y' ||
    data.야간 === 'Y';
  const isFrequent =
    data['증상 지속']?.includes('3개월') || data['기관지확장제 사용']?.includes('3_개월');

  if (data['증상 완화 여부'] === 'Y' || data.발열 === 'Y' || data.인후통 === 'Y') {
    return {
      possibility: '낮음',
      reason: '증상이 완화되고 있거나, 감기를 시사하는 증상(발열, 인후통)이 동반됩니다.',
    };
  }

  if (!hasAsthmaSymptoms || !isFrequent) {
    return {
      possibility: '낮음',
      reason: '천식을 의심할 만한 특징적인 증상이나 발생 빈도가 확인되지 않았습니다.',
    };
  }

  const majorCriteriaCount = (data.가족력 === 'Y' ? 1 : 0) + (data['아토피 병력'] === 'Y' ? 1 : 0);
  const minorCriteriaCount =
    (data['공중 항원'] === 'Y' ? 1 : 0) + (data['식품 항원'] === 'Y' ? 1 : 0);

  if (majorCriteriaCount >= 1 || minorCriteriaCount >= 2) {
    return {
      possibility: '있음',
      reason: '천식 예측지수(API) 평가 결과, 주요 인자 또는 부가 인자 조건을 충족합니다.',
    };
  }

  return {
    possibility: '낮음',
    reason: '천식 의심 증상은 있으나, 천식 예측지수(API)의 위험인자 조건을 충족하지 않습니다.',
  };
}

function formatResult(judgement) {
  let mainText;
  let quickReplies;

  if (judgement.possibility === '있음') {
    mainText = `상담 결과, 현재 증상이 천식으로 인한 가능성이 높아 보입니다.\n\n정확한 진단과 적절한 치료를 위해 소아청소년과 전문의와 상담할 것을 권장드립니다.\n\n😷 실내를 깨끗하게 유지하고, 대기 오염이 심한 날에는 외출을 자제하거나 마스크를 착용해 주세요.\n\n🚿 외출 후에는 손과 얼굴을 깨끗이 씻고, 감기에 걸리지 않도록 주의해 주세요.\n\n🦠 알레르기를 유발하는 물질을 찾아 피하는 것이 중요해요. 알레르기 검사를 통해 원인을 정확히 파악하면 도움이 될 거예요.\n\n✅ 기관지 확장제를 가지고 계신 경우, 사용법을 정확히 숙지하고, 필요할 때 올바르게 사용해 주세요.\n\n\n⚠️ 제공하는 결과는 참고용이며, 의학적인 진단을 대신할 수 없습니다. 서비스 내용만으로 취한 조치에 대해서는 책임을 지지 않습니다.`;
    quickReplies = ['소아 천식이란?', '기구 사용 방법', '다시 검사하기', '처음으로'];
  } else {
    mainText = `상담 결과, 현재 증상이 천식으로 인한 가능성은 높지 않은 것으로 보입니다.\n\n다만, 정확한 진단과 안심을 위해 소아청소년과 전문의와 상담해 보시는 것을 추천합니다. 아이의 건강을 위해 예방적 관리가 중요하지만, 과도하게 걱정하지 않으셔도 됩니다.\n\n😷 실내를 깨끗하게 유지하고, 대기 오염이 심한 날에는 외출을 자제하거나 마스크를 착용해 주세요.\n\n🚿 외출 후에는 손과 얼굴을 깨끗이 씻고, 감기에 걸리지 않도록 주의해 주세요.\n\n🚭 아이의 호흡기 질환을 악화시킬 수 있는 간접흡연은 반드시 피해주세요.\n\n🏃🏻‍♀️ 규칙적인 가벼운 운동은 천식 예방에 도움이 되며, 찬 공기에서는 실내 운동을 추천해요.\n\n\n⚠️ 제공하는 결과는 참고용이며, 의학적인 진단을 대신할 수 없습니다. 서비스 내용만으로 취한 조치에 대해서는 책임을 지지 않습니다. \n test 텍스트 추가 제한 테스트 \n test 텍스트 추가 제한 테스트 \n test 텍스트 추가 제한 테스트 \n test 텍스트 추가 제한 테스트 \n test 텍스트 추가 제한 테스트 \n test 텍스트 추가 제한 테스트`;
    quickReplies = ['천식 예방 방법', '다시 검사하기', '처음으로'];
  }

  return { mainText, quickReplies };
}

module.exports = { judgeAsthma, formatResult };
