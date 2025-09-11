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

function formatResult(judgement, extractedData = null) {
  let mainText;
  let quickReplies;

  if (judgement.possibility === '있음') {
    mainText =
      `상담 결과, 현재 증상이 천식으로 인한 가능성이 높아 보입니다.\n\n` +
      `정확한 진단과 적절한 치료를 위해 소아청소년과 전문의 상담을 권장드립니다.\n\n` +
      `⚠️ 제공하는 결과는 참고용이며, 의학적 진단을 대신할 수 없습니다. 서비스 내용만으로 취한 조치에 대해서는 책임을 지지 않습니다.`;
    quickReplies = ['왜 천식 가능성이 있나요?', '천식 도움되는 정보', '병원 진료 예약하기'];
  } else {
    mainText =
      `상담 결과, 현재 증상이 천식으로 인한 가능성은 높지 않은 것으로 보입니다.\n` +
      `다만, 정확한 진단과 안심을 위해 소아청소년과 전문의 상담을 추천드립니다. 아이의 건강을 위한 예방 관리가 중요하지만, 지나치게 걱정하지 않으셔도 됩니다.\n\n` +
      `⚠️ 제공하는 결과는 참고용이며, 의학적 진단을 대신할 수 없습니다. 서비스 내용만으로 취한 조치에 대해서는 책임을 지지 않습니다.`;
    quickReplies = ['왜 천식 가능성이 낮은가요?', '천식에 도움되는 정보', '병원 진료 예약하기'];
  }

  return { mainText, quickReplies };
}

// 상세 결과 보기 함수 추가
function formatDetailedResult(extractedData) {
  if (!extractedData || typeof extractedData !== 'object') {
    return '상세 정보를 불러올 수 없습니다.';
  }

  // 디버깅: extracted_data 상태 로깅
  console.log('[Detailed Result] extracted_data keys:', Object.keys(extractedData));
  console.log(
    '[Detailed Result] non-null values:',
    Object.entries(extractedData)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
  );

  const sections = {
    '주요 증상': ['기침', '쌕쌕거림', '호흡곤란', '가슴 답답', '야간', '가래'],
    '감기 증상': [
      '발열',
      '콧물',
      '맑은 콧물',
      '코막힘',
      '코 가려움',
      '결막염',
      '두통',
      '인후통',
      '재채기',
      '후비루',
    ],
    '증상 지속': ['증상 지속', '기관지확장제 사용', '증상 완화 여부'],
    '가족력 및 병력': [
      '가족력',
      '천식 병력',
      '알레르기 비염 병력',
      '모세기관지염 병력',
      '아토피 병력',
    ],
    알레르기: ['공중 항원', '공중 항원 상세', '식품 항원', '식품 항원 상세', '총 IgE'],
    기타: ['운동시 이상', '계절', '기온', '복용중 약', '기존 진단명', '과거 병력'],
  };

  let result = '📋 상세 분석 결과\n\n';

  // 알레르기 검사 결과가 있으면 별도 섹션으로 표시
  if (extractedData['알레르기 검사 결과']) {
    try {
      const allergyTestData = JSON.parse(extractedData['알레르기 검사 결과']);
      result += '🔬 **알레르기 검사 결과 상세**\n\n';

      if (allergyTestData.test_type) {
        result += `**검사 종류:** ${allergyTestData.test_type}\n`;
      }

      if (allergyTestData.total_ige) {
        result += `**총 IgE:** ${allergyTestData.total_ige}\n\n`;
      }

      // 공중 알레르겐 상세 (단순화된 구조)
      if (allergyTestData.airborne_allergens && allergyTestData.airborne_allergens.length > 0) {
        result += '🌬️ **공중 알레르겐:**\n';
        allergyTestData.airborne_allergens.forEach((item) => {
          result += `✅ ${item}\n`;
        });
        result += '\n';
      }

      // 식품 알레르겐 상세 (단순화된 구조)
      if (allergyTestData.food_allergens && allergyTestData.food_allergens.length > 0) {
        result += '🍽️ **식품 알레르겐:**\n';
        allergyTestData.food_allergens.forEach((item) => {
          result += `✅ ${item}\n`;
        });
        result += '\n';
      }

      result += '---\n\n';
    } catch (e) {
      console.warn('Failed to parse allergy test data:', e);
    }
  }

  Object.entries(sections).forEach(([sectionName, fields]) => {
    const sectionData = fields
      .map((field) => {
        const value = extractedData[field];
        // null, undefined, 빈 문자열, "null" 문자열이 아닌 경우만 표시
        if (value === null || value === undefined || value === '' || value === 'null') return null;
        if (value === 'Y') return `✅ ${field}`;
        if (value === 'N') return `❌ ${field}`;
        return `📝 ${field}: ${value}`;
      })
      .filter((item) => item !== null);

    if (sectionData.length > 0) {
      result += `🔸 ${sectionName}\n`;
      result += sectionData.join('\n') + '\n\n';
    }
  });

  result += '⚠️ 제공하는 결과는 참고용이며, 의학적인 진단을 대신할 수 없습니다.';

  return result;
}

module.exports = { judgeAsthma, formatResult, formatDetailedResult };
