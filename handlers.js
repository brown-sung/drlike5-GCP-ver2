// 파일: handlers.js
const {
  setFirestoreData,
  generateNextQuestion,
  createAnalysisTask,
  generateWaitMessage,
  archiveToBigQuery,
  deleteFirestoreData,
  resetUserData,
  analyzeConversation,
  extractSymptomDataFromResponse,
} = require('./services');
const { createResponseFormat, createCallbackWaitResponse } = require('./utils');
const {
  TERMINATION_PHRASES,
  AFFIRMATIVE_PHRASES,
  ALL_SYMPTOM_FIELDS,
  convertInitialsToKorean,
} = require('./prompts');
const { judgeAsthma, formatDetailedResult } = require('./analysis');

async function handleInit(userKey, utterance) {
  console.log(`[Handle Init] user: ${userKey} - Starting new session with utterance: ${utterance}`);

  // 초성체 변환
  const convertedUtterance = convertInitialsToKorean(utterance);
  console.log(`[Handle Init] user: ${userKey} - Converted utterance: ${convertedUtterance}`);

  // 완전히 새로운 빈 extracted_data 생성 (기존 데이터 완전 초기화)
  const initialData = ALL_SYMPTOM_FIELDS.reduce((acc, field) => ({ ...acc, [field]: null }), {});
  // _lastQuestion도 초기화
  initialData._lastQuestion = '';
  console.log(
    `[Handle Init] user: ${userKey} - Initial data created with ${
      Object.keys(initialData).length
    } fields (completely reset)`
  );

  // 디버깅: 초기 데이터 상태 확인
  const nonNullValues = Object.entries(initialData)
    .filter(([key, value]) => value !== null && value !== undefined && value !== '')
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
  console.log(`[Handle Init] user: ${userKey} - Non-null values in initialData:`, nonNullValues);

  // extracted_data의 깊은 복사 생성 (generateNextQuestion에서 수정되지 않도록)
  const safeInitialData = JSON.parse(JSON.stringify(initialData));

  const newHistory = [`사용자: ${convertedUtterance}`];
  console.log(`[Handle Init] user: ${userKey} - New history created:`, newHistory);

  console.log(`[Handle Init] user: ${userKey} - Generating first question`);
  const nextQuestion = await generateNextQuestion(newHistory, safeInitialData);
  console.log(`[Handle Init] user: ${userKey} - Generated question:`, nextQuestion);

  // 생성된 질문을 initialData에 저장 (키워드 매칭용)
  initialData._lastQuestion = nextQuestion;

  newHistory.push(`챗봇: ${nextQuestion}`);
  console.log(`[Handle Init] user: ${userKey} - Updated history:`, newHistory);

  console.log(`[Handle Init] user: ${userKey} - Saving to Firestore`);
  await setFirestoreData(userKey, {
    state: 'COLLECTING',
    history: newHistory,
    extracted_data: initialData, // 원본 initialData 사용 (깨끗한 상태)
  });
  console.log(`[Handle Init] user: ${userKey} - Data saved to Firestore`);

  const response = createResponseFormat(nextQuestion);
  console.log(
    `[Handle Init] user: ${userKey} - Created response:`,
    JSON.stringify(response, null, 2)
  );
  return response;
}

async function handleCollecting(userKey, utterance, history, extracted_data, callbackUrl) {
  // 초성체 변환
  const convertedUtterance = convertInitialsToKorean(utterance);

  // 사용자가 분석을 요청하는 키워드를 말했을 때
  if (convertedUtterance.includes('분석해') || convertedUtterance.includes('결과')) {
    await setFirestoreData(userKey, { state: 'CONFIRM_ANALYSIS' });
    return createResponseFormat(
      '알겠습니다. 그럼 지금까지 말씀해주신 내용을 바탕으로 분석을 진행해볼까요?'
    );
  }

  // AI가 분석을 제안했는데 사용자가 동의했을 때 (초성체 포함)
  const isAffirmative =
    AFFIRMATIVE_PHRASES.some((phrase) => convertedUtterance.includes(phrase)) ||
    ['응', '응응', '오케이', '그래', '괜찮아'].some((phrase) =>
      convertedUtterance.includes(phrase)
    ) ||
    ['ㅇ', 'ㅇㅇ', 'ㅇㅋ', 'ㄱㄹ', 'ㄱㅊ'].some((phrase) => utterance.includes(phrase));

  if (isAffirmative && history[history.length - 1].includes('분석을 진행해볼까요?')) {
    return handleConfirmAnalysis(userKey, convertedUtterance, history, extracted_data, callbackUrl);
  }

  history.push(`사용자: ${convertedUtterance}`);
  console.log(
    `[Handle Collecting] user: ${userKey} - Added to history: 사용자: ${convertedUtterance}`
  );
  console.log(`[Handle Collecting] user: ${userKey} - Current history length: ${history.length}`);

  // 사용자 답변을 간단한 키워드 매칭으로 추출하여 extracted_data 업데이트
  console.log(`[Handle Collecting] user: ${userKey} - Extracting symptom data from user response`);
  const updated_extracted_data = extractSymptomDataFromResponse(convertedUtterance, extracted_data);
  console.log(
    `[Handle Collecting] user: ${userKey} - Extraction completed, updated fields: ${
      Object.keys(updated_extracted_data).filter((key) => updated_extracted_data[key] !== null)
        .length
    } fields`
  );

  try {
    console.log(`[Handle Collecting] user: ${userKey} - Calling generateNextQuestion`);
    // extracted_data의 깊은 복사 생성 (generateNextQuestion에서 수정되지 않도록)
    const safeExtractedData = JSON.parse(JSON.stringify(updated_extracted_data));
    const nextQuestion = await generateNextQuestion(history, safeExtractedData);
    console.log(`[Handle Collecting] user: ${userKey} - Generated question:`, nextQuestion);

    // 생성된 질문을 updated_extracted_data에 저장 (키워드 매칭용)
    updated_extracted_data._lastQuestion = nextQuestion;

    history.push(`챗봇: ${nextQuestion}`);
    console.log(`[Handle Collecting] user: ${userKey} - Updated history length: ${history.length}`);

    // AI가 분석을 제안했는지 확인하고 상태 변경
    if (nextQuestion.includes('말씀하고 싶은 다른 증상')) {
      console.log(
        `[Handle Collecting] user: ${userKey} - Analysis suggestion detected, changing state to CONFIRM_ANALYSIS`
      );
      await setFirestoreData(userKey, {
        state: 'CONFIRM_ANALYSIS',
        history,
        extracted_data: updated_extracted_data,
      });
    } else {
      console.log(
        `[Handle Collecting] user: ${userKey} - Regular question, saving history and extracted_data`
      );
      await setFirestoreData(userKey, {
        history,
        extracted_data: updated_extracted_data,
      });
    }

    const response = createResponseFormat(nextQuestion);
    console.log(
      `[Handle Collecting] user: ${userKey} - Created response:`,
      JSON.stringify(response, null, 2)
    );
    return response;
  } catch (error) {
    console.error('[Question Generation Error]', error);
    // 에러 시 기본 질문 반환
    const fallbackQuestion = '혹시 아이에게 다른 증상이 있으신가요?';
    console.log(
      `[Handle Collecting] user: ${userKey} - Using fallback question:`,
      fallbackQuestion
    );

    history.push(`챗봇: ${fallbackQuestion}`);
    await setFirestoreData(userKey, { history });

    const response = createResponseFormat(fallbackQuestion);
    console.log(
      `[Handle Collecting] user: ${userKey} - Created fallback response:`,
      JSON.stringify(response, null, 2)
    );
    return response;
  }
}

async function handleConfirmAnalysis(userKey, utterance, history, extracted_data, callbackUrl) {
  if (!callbackUrl) {
    return createResponseFormat('오류: 콜백 URL이 없습니다. 다시 시도해주세요.');
  }

  // 초성체 변환 적용
  const convertedUtterance = convertInitialsToKorean(utterance);

  // 긍정 응답 체크 (초성체 포함)
  const isAffirmative =
    AFFIRMATIVE_PHRASES.some((phrase) => convertedUtterance.includes(phrase)) ||
    ['응', '응응', '오케이', '그래', '괜찮아'].some((phrase) =>
      convertedUtterance.includes(phrase)
    ) ||
    ['ㅇ', 'ㅇㅇ', 'ㅇㅋ', 'ㄱㄹ', 'ㄱㅊ'].some((phrase) => utterance.includes(phrase));

  if (isAffirmative) {
    console.log(
      `[Confirm Analysis] user: ${userKey} - Affirmative response detected: ${convertedUtterance}`
    );
    history.push(`사용자: ${convertedUtterance}`);

    console.log(`[Confirm Analysis] user: ${userKey} - Generating wait message`);
    const waitMessage = await generateWaitMessage(history);
    console.log(`[Confirm Analysis] user: ${userKey} - Wait message generated: ${waitMessage}`);

    console.log(`[Confirm Analysis] user: ${userKey} - Creating analysis task`);
    await createAnalysisTask({ userKey, history, extracted_data, callbackUrl });
    console.log(`[Confirm Analysis] user: ${userKey} - Analysis task created successfully`);

    const response = createCallbackWaitResponse(waitMessage);
    console.log(
      `[Confirm Analysis] user: ${userKey} - Returning callback wait response:`,
      JSON.stringify(response, null, 2)
    );
    return response;
  }

  history.push(`사용자: ${convertedUtterance}`);
  await setFirestoreData(userKey, { state: 'COLLECTING' });
  return createResponseFormat('알겠습니다. 더 말씀하고 싶은 증상이 있으신가요?');
}

async function handlePostAnalysis(userKey, utterance, history, extracted_data) {
  // "왜 천식 가능성이 있나요?" 요청 처리
  if (utterance === '왜 천식 가능성이 있나요?') {
    console.log(
      `[Handle Post Analysis] user: ${userKey} - Requesting detailed result for high possibility`
    );
    console.log(
      `[Handle Post Analysis] user: ${userKey} - extracted_data keys:`,
      Object.keys(extracted_data)
    );
    const nonNullValues = Object.entries(extracted_data)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
    console.log(`[Handle Post Analysis] user: ${userKey} - Non-null values:`, nonNullValues);

    const detailedResult = formatDetailedResult(extracted_data);
    return detailedResult; // basicCard 형식으로 직접 반환
  }

  // "왜 천식 가능성이 낮은가요?" 요청 처리
  if (utterance === '왜 천식 가능성이 낮은가요?') {
    console.log(
      `[Handle Post Analysis] user: ${userKey} - Requesting detailed result for low possibility`
    );
    console.log(
      `[Handle Post Analysis] user: ${userKey} - extracted_data keys:`,
      Object.keys(extracted_data)
    );
    const nonNullValues = Object.entries(extracted_data)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
    console.log(`[Handle Post Analysis] user: ${userKey} - Non-null values:`, nonNullValues);

    const detailedResult = formatDetailedResult(extracted_data);
    return detailedResult; // basicCard 형식으로 직접 반환
  }

  // "천식 도움되는 정보" 요청 처리
  if (utterance === '천식 도움되는 정보' || utterance === '천식에 도움되는 정보') {
    const helpInfo = `🏥 천식 관리 도움 정보

일상 관리:
• 실내 공기질 개선 (공기청정기, 정기적 환기)
• 알레르기 유발 물질 제거 (먼지, 꽃가루, 애완동물 털)
• 적절한 습도 유지 (40-60%)

응급 상황 대처:
• 기관지확장제 사용법 숙지
• 증상 악화 시 즉시 병원 방문
• 응급상황 연락처 준비

예방 방법:
• 규칙적인 운동 (실내 운동 권장)
• 금연 및 간접흡연 피하기
• 감기 예방 (손씻기, 마스크 착용)

정기 관리:
• 소아청소년과 정기 검진
• 알레르기 검사 및 관리
• 약물 복용법 준수

⚠️ 개인별 상황에 따라 다를 수 있으니 전문의와 상담하세요.`;

    return createResponseFormat(helpInfo, ['다시 검사하기']);
  }

  // "병원 진료 예약하기" 요청 처리
  if (utterance === '병원 진료 예약하기') {
    const appointmentInfo = `🏥 병원 진료 예약 안내

소아청소년과 전문의 상담 권장:
• 정확한 진단을 위한 전문의 상담
• 개인별 맞춤 치료 계획 수립
• 정기적인 경과 관찰

진료 준비사항:
• 증상 기록 (언제, 어떤 상황에서 발생)
• 가족력 정보 정리
• 기존 복용 약물 목록
• 알레르기 검사 결과 (있는 경우)

응급상황 시:
• 호흡곤란이 심한 경우 즉시 응급실 방문
• 기관지확장제 사용 후에도 증상 지속 시 병원 방문

예약 방법:
• 가까운 소아청소년과 또는 호흡기내과
• 온라인 예약 또는 전화 예약
• 응급상황 시 119 신고

⚠️ 증상이 심하거나 지속될 경우 즉시 의료진과 상담하세요.`;

    return createResponseFormat(appointmentInfo, ['다시 검사하기']);
  }

  // 세션 리셋 키워드 감지 (다시 검사하기, 처음으로, 천식일까요)
  if (TERMINATION_PHRASES.some((phrase) => utterance.includes(phrase))) {
    console.log(`[Session Reset] user: ${userKey}, reason: ${utterance}`);
    const resetResult = await resetUserData(userKey);
    if (!resetResult) {
      console.error(
        `[Session Reset] user: ${userKey} - Failed to reset data, but continuing with new session`
      );
    }
    // 리셋 후 새로운 세션 시작
    return handleInit(userKey, utterance);
  }

  // 그 외 다른 대답은 추가 증상으로 간주하고 다시 수집 시작
  return handleCollecting(userKey, utterance, history, extracted_data);
}

async function handleTerminated(userKey, history, extracted_data) {
  const judgement = judgeAsthma(extracted_data);
  await archiveToBigQuery(userKey, { history, extracted_data, judgement });
  await resetUserData(userKey); // deleteFirestoreData 대신 resetUserData 사용
  return createResponseFormat('상담이 종료되었습니다. 이용해주셔서 감사합니다!');
}

const stateHandlers = {
  INIT: (userKey, utterance) => handleInit(userKey, utterance),
  COLLECTING: handleCollecting,
  CONFIRM_ANALYSIS: handleConfirmAnalysis,
  POST_ANALYSIS: handlePostAnalysis,
};

module.exports = {
  ...stateHandlers,
  handleInit,
};
