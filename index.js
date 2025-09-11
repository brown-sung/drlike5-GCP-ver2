// 파일: index.js
const express = require('express');
const {
  getFirestoreData,
  setFirestoreData,
  analyzeConversation,
  resetUserData,
  generateNextQuestion,
  analyzeAllergyTestImage,
  generateWaitMessage,
  generateAllergyTestWaitMessage,
} = require('./services');
const stateHandlers = require('./handlers');
const { handleInit } = require('./handlers');
const {
  createResponseFormat,
  createResultCardResponse,
  createBasicCardResponse,
  createCallbackWaitResponse,
} = require('./utils'); // ★ createBasicCardResponse 임포트
const { judgeAsthma, formatResult } = require('./analysis');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('Asthma Consultation Bot is running!');
});

app.post('/skill', async (req, res) => {
  try {
    const userKey = req.body.userRequest?.user?.id;
    const utterance = req.body.userRequest?.utterance;
    const callbackUrl = req.body.userRequest?.callbackUrl;
    const mediaUrl = req.body.userRequest?.params?.media?.url;
    const mediaType = req.body.userRequest?.params?.media?.type;

    if (!userKey) {
      return res.status(400).json(createResponseFormat('잘못된 요청입니다.'));
    }
    console.log(
      `[Request] user: ${userKey}, utterance: "${utterance || ''}", mediaType: ${
        mediaType || 'none'
      }`
    );

    let userData = await getFirestoreData(userKey);

    // 이미지 업로드 처리 분기 (카카오 userRequest.params.media.url)
    if (mediaUrl && mediaType === 'image') {
      if (!callbackUrl) {
        return res
          .status(400)
          .json(createResponseFormat('콜백 URL이 없습니다. 다시 시도해주세요.'));
      }

      try {
        // 즉시 대기 메시지 응답 (알레르기 검사결과지 전용)
        const waitMessage = await generateAllergyTestWaitMessage();
        const waitResponse = createCallbackWaitResponse(waitMessage);

        // 백그라운드에서 새로운 2단계 이미지 분석 처리
        processAllergyTestAnalysis(userKey, mediaUrl, userData, callbackUrl).catch((error) => {
          console.error('[Background Allergy Test Analysis Error]', error);

          // 타임아웃 에러인지 확인
          let errorMessage = '알레르기 검사결과지 분석 중 오류가 발생했어요. 다시 시도해주세요.';
          if (error.message && error.message.includes('timed out')) {
            errorMessage = '분석 시간이 초과되었습니다. 다시 시도해주세요.';
          }

          // 에러 시에도 콜백으로 에러 메시지 전송
          const errorResponse = createResponseFormat(errorMessage);
          fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(errorResponse),
          }).catch((err) => console.error('Failed to send error callback:', err));
        });

        return res.status(200).json(waitResponse);
      } catch (e) {
        console.error('[Allergy Test Analysis Setup Error]', e);
        return res
          .status(200)
          .json(
            createResponseFormat(
              '알레르기 검사결과지 분석 설정 중 문제가 발생했어요. 다시 시도해 주세요.'
            )
          );
      }
    }

    if (!utterance) {
      return res.status(400).json(createResponseFormat('잘못된 요청입니다.'));
    }

    // 세션 리셋 키워드 먼저 체크 (데이터 조회 전에 처리)
    const { TERMINATION_PHRASES } = require('./prompts');
    if (TERMINATION_PHRASES.some((phrase) => utterance.includes(phrase))) {
      console.log(
        `[Session Reset] user: ${userKey}, reason: ${utterance} - Deleting all data and starting fresh`
      );
      const resetResult = await resetUserData(userKey);
      if (!resetResult) {
        console.error(
          `[Session Reset] user: ${userKey} - Failed to reset data, but continuing with new session`
        );
      }
      // 리셋 후 새로운 세션 시작
      const response = await handleInit(userKey, utterance);
      return res.status(200).json(response);
    }

    if (!userData) {
      userData = { state: 'INIT', history: [] };
    }

    console.log(`[State] current: ${userData.state}`);

    const handler = stateHandlers[userData.state] || stateHandlers['INIT'];
    const response = await handler(
      userKey,
      utterance,
      userData.history,
      userData.extracted_data,
      callbackUrl
    );

    return res.status(200).json(response);
  } catch (error) {
    console.error("'/skill' 처리 중 오류 발생:", error);
    return res
      .status(500)
      .json(createResponseFormat('시스템에 오류가 발생했어요. 잠시 후 다시 시도해주세요.'));
  }
});

// 백그라운드 알레르기 검사결과지 분석 처리 함수 (3단계)
async function processAllergyTestAnalysis(userKey, mediaUrl, userData, callbackUrl) {
  try {
    console.log(`[Background Allergy Test Analysis] Starting for user: ${userKey}`);

    // 새로운 2단계 분석 실행
    const analysisResult = await analyzeAllergyTestImage(mediaUrl);
    const { analysisResult: allergyTestData } = analysisResult;

    const history = Array.isArray(userData?.history) ? [...userData.history] : [];
    const extracted =
      typeof userData?.extracted_data === 'object' && userData.extracted_data !== null
        ? { ...userData.extracted_data }
        : {};

    // 알레르기 정보 추출 및 저장 (단순화된 구조)
    if (allergyTestData.airborne_allergens && allergyTestData.airborne_allergens.length > 0) {
      extracted['공중 항원'] = 'Y';
      extracted['공중 항원 상세'] = allergyTestData.airborne_allergens.join(', ');
    }

    if (allergyTestData.food_allergens && allergyTestData.food_allergens.length > 0) {
      extracted['식품 항원'] = 'Y';
      extracted['식품 항원 상세'] = allergyTestData.food_allergens.join(', ');
    }

    if (allergyTestData.total_ige) {
      extracted['총 IgE'] = allergyTestData.total_ige;
    }

    // 상세 검사 결과 저장 (상세 결과 보기용)
    extracted['알레르기 검사 결과'] = JSON.stringify(allergyTestData);

    // 사용자에게 분석 결과 요약 메시지 생성 (단순화)
    let analysisSummary = `📋 ${allergyTestData.test_type || '알레르기 검사'} 결과 분석 완료\n\n`;

    analysisSummary += `🔍 검사 개요:\n`;
    analysisSummary += `• 양성 반응: ${allergyTestData.total_positive || 0}개\n`;

    if (allergyTestData.asthma_related > 0) {
      analysisSummary += `• 천식 관련 항목: ${allergyTestData.asthma_related}개\n`;
    }

    if (allergyTestData.total_ige) {
      analysisSummary += `• 총 IgE: ${allergyTestData.total_ige}\n`;
    }

    // 천식 관련 항목 요약 (통합된 구조)
    if (
      allergyTestData.asthma_high_risk?.length > 0 ||
      allergyTestData.asthma_medium_risk?.length > 0
    ) {
      analysisSummary += `\n⚠️ 천식 관련 알레르기 항목:\n`;

      if (allergyTestData.asthma_high_risk?.length > 0) {
        analysisSummary += `\n🔴 고위험:\n`;
        allergyTestData.asthma_high_risk.forEach((item) => {
          analysisSummary += `• ${item}\n`;
        });
      }

      if (allergyTestData.asthma_medium_risk?.length > 0) {
        analysisSummary += `\n🟡 중위험:\n`;
        allergyTestData.asthma_medium_risk.forEach((item) => {
          analysisSummary += `• ${item}\n`;
        });
      }

      analysisSummary += `\n💡 천식 위험도: ${allergyTestData.risk_level}\n`;
    }

    analysisSummary += `\n이 정보가 증상 분석에 반영됩니다. 다른 증상에 대해서도 말씀해 주세요.`;

    history.push('사용자: [알레르기 검사결과지 업로드]');
    history.push(`챗봇: ${analysisSummary}`);

    await setFirestoreData(userKey, {
      state: userData?.state || 'COLLECTING',
      history,
      extracted_data: extracted,
    });

    const nextQuestion = await generateNextQuestion(history, extracted);

    // 콜백으로 최종 응답 전송
    const finalResponse = createResponseFormat(nextQuestion);
    await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalResponse),
    });

    console.log(`[Background Allergy Test Analysis] Completed for user: ${userKey}`);
  } catch (error) {
    console.error(`[Background Allergy Test Analysis] Error for user: ${userKey}`, error);
    throw error;
  }
}

app.post('/process-analysis-callback', async (req, res) => {
  const { userKey, history, callbackUrl } = req.body;

  console.log(`[Callback Start] user: ${userKey}, callbackUrl: ${callbackUrl}`);
  console.log(
    `[Callback History] user: ${userKey}, history length: ${history ? history.length : 0}`
  );

  if (!userKey || !history || !callbackUrl) {
    console.error('[Callback Error] Invalid request:', {
      userKey: !!userKey,
      history: !!history,
      callbackUrl: !!callbackUrl,
    });
    return res.status(400).send('Bad Request: Missing required fields.');
  }

  let finalResponse;
  try {
    console.log(`[Callback Step 1] user: ${userKey} - Starting conversation analysis`);
    const updated_extracted_data = await analyzeConversation(history);
    console.log(
      `[Callback Step 2] user: ${userKey} - Analysis completed, extracted_data fields: ${
        Object.keys(updated_extracted_data).length
      } fields`
    );

    console.log(`[Callback Step 3] user: ${userKey} - Starting asthma judgement`);
    const judgement = judgeAsthma(updated_extracted_data);
    console.log(
      `[Callback Step 4] user: ${userKey} - Judgement completed: possibility=${judgement.possibility}, score=${judgement.score}`
    );

    console.log(`[Callback Step 5] user: ${userKey} - Formatting result`);
    const { title, description, quickReplies } = formatResult(judgement, updated_extracted_data);
    console.log(
      `[Callback Step 6] user: ${userKey} - Result formatted - title: ${title}, quickReplies:`,
      quickReplies
    );

    // ★★★ basicCard 형식으로 최종 응답 생성 (title과 description 분리) ★★★
    console.log(`[Callback Step 7] user: ${userKey} - Creating final response card`);
    finalResponse = createBasicCardResponse(
      title,
      description,
      quickReplies,
      judgement.possibility
    );
    console.log(
      `[Callback Step 8] user: ${userKey} - Final response created: ${
        finalResponse.template?.outputs?.[0]?.simpleText?.text?.substring(0, 50) || 'No text'
      }...`
    );

    console.log(`[Callback Step 9] user: ${userKey} - Saving to Firestore`);
    await setFirestoreData(userKey, {
      state: 'POST_ANALYSIS',
      extracted_data: updated_extracted_data,
      history,
    });
    console.log(`[Callback Step 10] user: ${userKey} - Firestore save completed`);
  } catch (error) {
    console.error(`[Callback Error] user: ${userKey} - Error occurred:`, error);
    console.error(`[Callback Error] user: ${userKey} - Error stack:`, error.stack);
    const errorText =
      '죄송합니다, 답변을 분석하는 중 오류가 발생했어요. 잠시 후 다시 시도해주세요. 😥';
    finalResponse = createResponseFormat(errorText, ['다시 검사하기']);
    console.log(
      `[Callback Error Response] user: ${userKey} - Error response created:`,
      JSON.stringify(finalResponse, null, 2)
    );
  }

  try {
    console.log(`[Callback Sending] user: ${userKey}, callbackUrl: ${callbackUrl}`);
    const callbackResponse = await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalResponse),
    });

    if (!callbackResponse.ok) {
      console.error(
        `[Callback Failed] Status: ${
          callbackResponse.status
        }, Response: ${await callbackResponse.text()}`
      );
    } else {
      console.log(`[Callback Success] user: ${userKey}`);
    }
  } catch (err) {
    console.error(`[Callback Error] user: ${userKey}`, err);
  }

  return res.status(200).send('Callback job processed.');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Asthma Bot server listening on port ${PORT}`);
});
