// 파일: index.js
const express = require('express');
const {
  getFirestoreData,
  setFirestoreData,
  analyzeConversation,
  resetUserData,
  generateNextQuestion,
  analyzeAllergyFromImage,
  analyzeAllergyTestImage,
  generateWaitMessage,
  generateAllergyTestWaitMessage,
} = require('./services');
const stateHandlers = require('./handlers');
const {
  createResponseFormat,
  createResultCardResponse,
  createCallbackWaitResponse,
} = require('./utils'); // ★ createResultCardResponse 임포트
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

        // 백그라운드에서 새로운 3단계 이미지 분석 처리
        processAllergyTestAnalysis(userKey, mediaUrl, userData, callbackUrl).catch((error) => {
          console.error('[Background Allergy Test Analysis Error]', error);
          // 에러 시에도 콜백으로 에러 메시지 전송
          const errorResponse = createResponseFormat(
            '알레르기 검사결과지 분석 중 오류가 발생했어요. 다시 시도해주세요.'
          );
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

    // '다시 검사하기' 또는 '처음으로' 시 기존 데이터 완전 삭제
    if (utterance === '다시 검사하기' || utterance === '처음으로') {
      console.log(`[Session Reset] user: ${userKey}, reason: ${utterance}`);
      await resetUserData(userKey);
      userData = null;
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

    // 새로운 3단계 분석 실행
    const analysisResult = await analyzeAllergyTestImage(mediaUrl);
    const { allergyTestData, asthmaAnalysis } = analysisResult;

    const history = Array.isArray(userData?.history) ? [...userData.history] : [];
    const extracted =
      typeof userData?.extracted_data === 'object' && userData.extracted_data !== null
        ? { ...userData.extracted_data }
        : {};

    // 알레르기 정보 추출 및 저장
    const allAllergens = [
      ...(allergyTestData.airborne_allergens || []),
      ...(allergyTestData.food_allergens || []),
      ...(allergyTestData.other_allergens || []),
    ];

    const positiveAllergens = allAllergens.filter(
      (item) => item.result === '양성' || (item.class && parseInt(item.class) >= 1)
    );

    if (positiveAllergens.length > 0) {
      const airbornePositive = positiveAllergens.filter((item) =>
        allergyTestData.airborne_allergens?.includes(item)
      );
      const foodPositive = positiveAllergens.filter((item) =>
        allergyTestData.food_allergens?.includes(item)
      );

      if (airbornePositive.length > 0) {
        extracted['공중 항원'] = 'Y';
        extracted['공중 항원 상세'] = airbornePositive
          .map((item) => `${item.name}(${item.class}, ${item.value})`)
          .join(', ');
      }

      if (foodPositive.length > 0) {
        extracted['식품 항원'] = 'Y';
        extracted['식품 항원 상세'] = foodPositive
          .map((item) => `${item.name}(${item.class}, ${item.value})`)
          .join(', ');
      }
    }

    if (allergyTestData.total_ige) {
      extracted['총 IgE'] = allergyTestData.total_ige;
    }

    // 상세 검사 결과 저장 (상세 결과 보기용)
    extracted['알레르기 검사 결과'] = JSON.stringify(allergyTestData);

    // 사용자에게 분석 결과 요약 메시지 생성
    let analysisSummary = `📋 **${
      allergyTestData.test_type || '알레르기 검사'
    } 결과 분석 완료**\n\n`;

    analysisSummary += `🔍 **검사 개요:**\n`;
    analysisSummary += `• 총 검사 항목: ${allAllergens.length}개\n`;
    analysisSummary += `• 양성 반응: ${
      asthmaAnalysis.total_positive_count || positiveAllergens.length
    }개\n`;

    if (asthmaAnalysis.asthma_related_count > 0) {
      analysisSummary += `• 천식 관련 항목: ${asthmaAnalysis.asthma_related_count}개\n`;
    }

    if (allergyTestData.total_ige) {
      analysisSummary += `• 총 IgE: ${allergyTestData.total_ige}\n`;
    }

    // 천식 관련 항목 요약
    if (
      asthmaAnalysis.asthma_related_high_risk?.length > 0 ||
      asthmaAnalysis.asthma_related_medium_risk?.length > 0
    ) {
      analysisSummary += `\n⚠️ **천식 관련 알레르기 항목:**\n`;

      if (asthmaAnalysis.asthma_related_high_risk?.length > 0) {
        analysisSummary += `\n🔴 **고위험:**\n`;
        asthmaAnalysis.asthma_related_high_risk.forEach((item) => {
          analysisSummary += `• ${item.name} (${item.class}, ${item.value})\n`;
        });
      }

      if (asthmaAnalysis.asthma_related_medium_risk?.length > 0) {
        analysisSummary += `\n🟡 **중위험:**\n`;
        asthmaAnalysis.asthma_related_medium_risk.forEach((item) => {
          analysisSummary += `• ${item.name} (${item.class}, ${item.value})\n`;
        });
      }

      analysisSummary += `\n💡 **천식 위험도:** ${asthmaAnalysis.asthma_risk_assessment}\n`;
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
  if (!userKey || !history || !callbackUrl) {
    console.error('Invalid callback request:', req.body);
    return res.status(400).send('Bad Request: Missing required fields.');
  }

  let finalResponse;
  try {
    console.log(`[Callback Processing] user: ${userKey}`);
    const updated_extracted_data = await analyzeConversation(history);
    const judgement = judgeAsthma(updated_extracted_data);

    const { mainText, quickReplies } = formatResult(judgement, updated_extracted_data);

    // ★★★ simpleText 대신 basicCard 형식으로 최종 응답 생성 ★★★
    finalResponse = createResultCardResponse(mainText, quickReplies, judgement.possibility);

    await setFirestoreData(userKey, {
      state: 'POST_ANALYSIS',
      extracted_data: updated_extracted_data,
      history,
    });
  } catch (error) {
    console.error(`[Callback Error] user: ${userKey}`, error);
    const errorText =
      '죄송합니다, 답변을 분석하는 중 오류가 발생했어요. 잠시 후 다시 시도해주세요. 😥';
    finalResponse = createResponseFormat(errorText, ['다시 검사하기']);
  }

  await fetch(callbackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finalResponse),
  }).catch((err) => console.error('Failed to send callback to Kakao:', err));

  return res.status(200).send('Callback job processed.');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Asthma Bot server listening on port ${PORT}`);
});
