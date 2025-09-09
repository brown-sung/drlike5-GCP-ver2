// 파일: handlers.js
const {
  setFirestoreData,
  generateNextQuestion,
  createAnalysisTask,
  generateWaitMessage,
  archiveToBigQuery,
  deleteFirestoreData,
  resetUserData,
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

  const initialData = ALL_SYMPTOM_FIELDS.reduce((acc, field) => ({ ...acc, [field]: null }), {});
  console.log(
    `[Handle Init] user: ${userKey} - Initial data created with ${
      Object.keys(initialData).length
    } fields`
  );

  const newHistory = [`사용자: ${convertedUtterance}`];
  console.log(`[Handle Init] user: ${userKey} - New history created:`, newHistory);

  console.log(`[Handle Init] user: ${userKey} - Generating first question`);
  const nextQuestion = await generateNextQuestion(newHistory, initialData);
  console.log(`[Handle Init] user: ${userKey} - Generated question:`, nextQuestion);

  newHistory.push(`챗봇: ${nextQuestion}`);
  console.log(`[Handle Init] user: ${userKey} - Updated history:`, newHistory);

  console.log(`[Handle Init] user: ${userKey} - Saving to Firestore`);
  await setFirestoreData(userKey, {
    state: 'COLLECTING',
    history: newHistory,
    extracted_data: initialData,
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

  try {
    console.log(`[Handle Collecting] user: ${userKey} - Calling generateNextQuestion`);
    const nextQuestion = await generateNextQuestion(history, extracted_data);
    console.log(`[Handle Collecting] user: ${userKey} - Generated question:`, nextQuestion);

    history.push(`챗봇: ${nextQuestion}`);
    console.log(`[Handle Collecting] user: ${userKey} - Updated history length: ${history.length}`);

    // AI가 분석을 제안했는지 확인하고 상태 변경
    if (nextQuestion.includes('말씀하고 싶은 다른 증상')) {
      console.log(
        `[Handle Collecting] user: ${userKey} - Analysis suggestion detected, changing state to CONFIRM_ANALYSIS`
      );
      await setFirestoreData(userKey, { state: 'CONFIRM_ANALYSIS', history });
    } else {
      console.log(`[Handle Collecting] user: ${userKey} - Regular question, saving history only`);
      await setFirestoreData(userKey, { history });
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
  // "상세 결과 보기" 요청 처리
  if (utterance === '상세 결과 보기') {
    const detailedResult = formatDetailedResult(extracted_data);
    return createResponseFormat(detailedResult, ['다시 검사하기']);
  }

  // 세션 리셋 키워드 감지 (다시 검사하기, 처음으로, 천식일까요)
  if (TERMINATION_PHRASES.some((phrase) => utterance.includes(phrase))) {
    console.log(`[Session Reset] user: ${userKey}, reason: ${utterance}`);
    await resetUserData(userKey);
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
