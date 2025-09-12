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
  let title;
  let description;
  let quickReplies;

  if (judgement.possibility === '있음') {
    title = '상담 결과, 현재 증상이 천식으로 인한 가능성이 높아 보입니다.';
    description =
      `정확한 진단과 적절한 치료를 위해 소아청소년과 전문의 상담을 권장드립니다.\n\n` +
      `⚠️ 제공하는 결과는 참고용이며, 의학적 진단을 대신할 수 없습니다. 서비스 내용만으로 취한 조치에 대해서는 책임을 지지 않습니다.`;
    quickReplies = ['왜 천식 가능성이 있나요?', '천식 도움되는 정보', '병원 진료 예약하기'];
  } else {
    title = '상담 결과, 현재 증상이 천식으로 인한 가능성은 높지 않은 것으로 보입니다.';
    description =
      `다만, 정확한 진단과 안심을 위해 소아청소년과 전문의 상담을 추천드립니다. 아이의 건강을 위한 예방 관리가 중요하지만, 지나치게 걱정하지 않으셔도 됩니다.\n\n` +
      `⚠️ 제공하는 결과는 참고용이며, 의학적 진단을 대신할 수 없습니다. 서비스 내용만으로 취한 조치에 대해서는 책임을 지지 않습니다.`;
    quickReplies = ['왜 천식 가능성이 낮은가요?', '천식 도움되는 정보', '병원 진료 예약하기'];
  }

  return { title, description, quickReplies };
}

// 상세 결과 보기 함수 추가 (basicCard 형식)
function formatDetailedResult(extractedData) {
  if (!extractedData || typeof extractedData !== 'object') {
    return {
      version: '2.0',
      template: {
        outputs: [
          {
            basicCard: {
              title: '상세 분석 결과',
              description: '상세 정보를 불러올 수 없습니다.',
            },
          },
        ],
        quickReplies: [
          {
            action: 'message',
            label: '다시 검사하기',
            messageText: '다시 검사하기',
          },
        ],
      },
    };
  }

  // 디버깅: extracted_data 상태 로깅
  console.log('[Detailed Result] extracted_data keys:', Object.keys(extractedData));
  console.log(
    '[Detailed Result] non-null values:',
    Object.entries(extractedData)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
  );

  // 🩺 증상 관련 섹션
  const symptomData = [];
  const symptomFields = [
    '기침',
    '쌕쌕거림',
    '호흡곤란',
    '가슴 답답',
    '야간',
    '가래',
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
    '증상 지속',
    '기관지확장제 사용',
    '증상 완화 여부',
    '운동시 이상',
    '계절',
    '기온',
  ];

  symptomFields.forEach((field) => {
    const value = extractedData[field];
    if (value === null || value === undefined || value === '' || value === 'null') return;

    if (value === 'Y') {
      // 증상이 있는 경우 구체적인 설명 생성
      if (field === '기침') {
        const duration = extractedData['증상 지속'] || '지속';
        symptomData.push(`•기침이 ${duration}`);
      } else if (field === '쌕쌕거림') {
        const night = extractedData['야간'] === 'Y' ? '밤에 ' : '';
        symptomData.push(`•${night}쌕쌕거림과 함께 기침이 심해짐`);
      } else if (field === '야간') {
        // 이미 쌕쌕거림에서 처리됨
      } else if (field === '발열') {
        symptomData.push(`•열이 있음`);
      } else if (field === '콧물' || field === '맑은 콧물') {
        symptomData.push(`•콧물이 있음`);
      } else if (field === '계절') {
        const season = extractedData['계절'] || '특정 계절';
        symptomData.push(`•계절이 바뀔 때(${season}) 증상 심해짐`);
      } else {
        symptomData.push(`•${field} 증상 있음`);
      }
    } else if (value === 'N') {
      // 증상이 없는 경우
      if (field === '발열') {
        symptomData.push(`•열이나 콧물은 없음, 주로 마른 기침`);
      } else if (field === '콧물' || field === '맑은 콧물') {
        // 이미 발열에서 처리됨
      }
    } else if (typeof value === 'string' && value !== 'Y' && value !== 'N') {
      // 구체적인 값이 있는 경우
      if (field === '증상 지속') {
        symptomData.push(`•기침이 ${value}`);
      } else if (field === '계절') {
        symptomData.push(`•계절이 바뀔 때(${value}) 증상 심해짐`);
      }
    }
  });

  // 👨‍👩‍👧 가족/과거력 섹션
  const familyData = [];
  const familyFields = [
    '가족력',
    '천식 병력',
    '알레르기 비염 병력',
    '모세기관지염 병력',
    '아토피 병력',
    '기존 진단명',
    '과거 병력',
  ];

  familyFields.forEach((field) => {
    const value = extractedData[field];
    if (value === null || value === undefined || value === '' || value === 'null') return;

    if (value === 'Y') {
      if (field === '가족력') {
        familyData.push(`•가족 중 천식 진단 받은 분 있음`);
      } else if (field === '천식 병력') {
        familyData.push(`•아이가 천식 진단 받음`);
      } else if (field === '아토피 병력') {
        familyData.push(`•아이가 아토피 진단 받음`);
      } else if (field === '모세기관지염 병력') {
        familyData.push(`•모세기관지염 진단 받은 적 있음`);
      } else if (field === '알레르기 비염 병력') {
        familyData.push(`•알레르기 비염 진단 받은 적 있음`);
      }
    } else if (value === 'N') {
      if (field === '아토피 병력') {
        familyData.push(`•아이는 아토피 진단 없음`);
      } else if (field === '천식 병력') {
        familyData.push(`•아이는 천식 진단 없음`);
      }
    } else if (typeof value === 'string' && value !== 'Y' && value !== 'N') {
      if (field === '기존 진단명') {
        familyData.push(`•${value} 진단 받음`);
      } else if (field === '과거 병력') {
        familyData.push(`•${value} 경험 있음`);
      }
    }
  });

  // 🦠 알레르기 검사결과 섹션
  const allergyData = [];

  // 공중 항원 처리
  if (extractedData['공중 항원'] === 'Y' || extractedData['공중 항원 상세']) {
    const airborneDetail = extractedData['공중 항원 상세'] || '집먼지, 곰팡이, 꽃가루';
    allergyData.push(`•공기 (${airborneDetail}) 양성`);
  }

  // 식품 항원 처리
  if (extractedData['식품 항원'] === 'Y' || extractedData['식품 항원 상세']) {
    const foodDetail = extractedData['식품 항원 상세'] || '우유, 계란, 땅콩';
    allergyData.push(`•음식 (${foodDetail}) 양성`);
  }

  // 총 IgE 처리
  if (extractedData['총 IgE']) {
    allergyData.push(`•총 IgE: ${extractedData['총 IgE']}`);
  }

  // description 구성
  let description = '';

  if (symptomData.length > 0) {
    description += '🩺 증상 관련\n' + symptomData.join('\n') + '\n\n';
  }

  if (familyData.length > 0) {
    description += '👨‍👩‍👧 가족/과거력\n' + familyData.join('\n') + '\n\n';
  }

  if (allergyData.length > 0) {
    description += '🦠 알레르기 검사결과\n' + allergyData.join('\n') + '\n\n';
  }

  // 데이터가 없는 경우 안내 메시지 추가
  if (symptomData.length === 0 && familyData.length === 0 && allergyData.length === 0) {
    description += '📝 수집된 증상 정보가 없습니다.\n\n';
    description += '더 정확한 분석을 위해 증상에 대해 자세히 말씀해 주세요.\n\n';
  }

  description += '⚠️ 제공하는 결과는 참고용이며, 의학적인 진단을 대신할 수 없습니다.';

  return {
    version: '2.0',
    template: {
      outputs: [
        {
          basicCard: {
            title: '상세 분석 결과',
            description: description,
          },
        },
      ],
      quickReplies: [
        {
          action: 'message',
          label: '다시 검사하기',
          messageText: '다시 검사하기',
        },
      ],
    },
  };
}

module.exports = { judgeAsthma, formatResult, formatDetailedResult };
