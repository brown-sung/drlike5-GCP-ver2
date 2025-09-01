// 파일: index.js
const express = require('express');
const { getFirestoreData, setFirestoreData, analyzeConversation } = require('./services');
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

    if (!userKey || !utterance) {
      return res.status(400).json(createResponseFormat('잘못된 요청입니다.'));
    }
    console.log(`[Request] user: ${userKey}, utterance: "${utterance}"`);

    let userData = await getFirestoreData(userKey);
    if (utterance === '다시 검사하기' || utterance === '처음으로') {
      userData = { state: 'INIT', history: [] };
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

    const { mainText, quickReplies } = formatResult(judgement);

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
    finalResponse = createResponseFormat(errorText, ['다시 검사하기', '처음으로']);
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
