// 파일: index.js
const express = require('express');
const {
  getFirestoreData,
  setFirestoreData,
  analyzeConversation,
  resetUserData,
  generateNextQuestion,
  analyzeAllergyFromImage,
} = require('./services');
const stateHandlers = require('./handlers');
const { createResponseFormat, createResultCardResponse } = require('./utils'); // ★ createResultCardResponse 임포트
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
      try {
        const analysis = await analyzeAllergyFromImage(mediaUrl);

        // 기존 데이터 병합
        const history = Array.isArray(userData?.history) ? [...userData.history] : [];
        const extracted =
          typeof userData?.extracted_data === 'object' && userData.extracted_data !== null
            ? { ...userData.extracted_data }
            : {};

        if (analysis.airborneAllergens && analysis.airborneAllergens.length > 0) {
          extracted['공중 항원'] = 'Y';
          extracted['공중 항원 상세'] = analysis.airborneAllergens.join(', ');
        }
        if (analysis.foodAllergens && analysis.foodAllergens.length > 0) {
          extracted['식품 항원'] = 'Y';
          extracted['식품 항원 상세'] = analysis.foodAllergens.join(', ');
        }

        history.push('사용자: [이미지 업로드]');
        history.push('챗봇: 업로드하신 이미지에서 알레르기 관련 정보를 반영했습니다.');

        await setFirestoreData(userKey, {
          state: userData?.state || 'COLLECTING',
          history,
          extracted_data: extracted,
        });

        const nextQuestion = await generateNextQuestion(history, extracted);
        return res.status(200).json(createResponseFormat(nextQuestion));
      } catch (e) {
        console.error('[Image Analysis Error]', e);
        return res
          .status(200)
          .json(
            createResponseFormat(
              '이미지를 해석하는 중 문제가 발생했어요. 다른 이미지로 다시 시도해 주세요.'
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
