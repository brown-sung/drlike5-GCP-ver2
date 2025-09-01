// 파일: services.js (API 키 방식으로 전면 수정)
const { Firestore } = require('@google-cloud/firestore');
const { BigQuery } = require('@google-cloud/bigquery');
const { CloudTasksClient } = require('@google-cloud/tasks');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const {
  SYSTEM_PROMPT_GENERATE_QUESTION,
  SYSTEM_PROMPT_ANALYZE_COMPREHENSIVE,
  SYSTEM_PROMPT_WAIT_MESSAGE,
} = require('./prompts');

// --- 클라이언트 초기화 ---
const firestore = new Firestore();
const bigquery = new BigQuery();
const tasksClient = new CloudTasksClient();

// --- Firestore, BigQuery, Cloud Tasks 서비스 (변경 없음) ---
const getFirestoreData = async (userKey) =>
  (await firestore.collection('conversations').doc(userKey).get()).data();
const setFirestoreData = async (userKey, data) =>
  await firestore.collection('conversations').doc(userKey).set(data, { merge: true });
const deleteFirestoreData = async (userKey) =>
  await firestore.collection('conversations').doc(userKey).delete();
const createAnalysisTask = async (payload) => {
  const { GCP_PROJECT, GCP_LOCATION, TASK_QUEUE_NAME, CLOUD_RUN_URL } = process.env;
  const queuePath = tasksClient.queuePath(GCP_PROJECT, GCP_LOCATION, TASK_QUEUE_NAME);
  const url = `${CLOUD_RUN_URL}/process-analysis-callback`;
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
    },
  };
  await tasksClient.createTask({ parent: queuePath, task });
  console.log(`[Task Created] for user: ${payload.userKey}`);
};
const archiveToBigQuery = async (userKey, finalData) => {
  const { BIGQUERY_DATASET_ID, BIGQUERY_TABLE_ID } = process.env;
  const table = bigquery.dataset(BIGQUERY_DATASET_ID).table(BIGQUERY_TABLE_ID);
  const row = {
    /* ... 이전과 동일 ... */
  };
  await table.insert([row]);
  console.log(`[BigQuery] Archived data for user: ${userKey}`);
};

// ★★★ Gemini API 호출 함수 (API 키 방식으로 재작성) ★★★
async function callGeminiWithApiKey(
  systemPrompt,
  context,
  modelName,
  isJson = false,
  timeout = 25000
) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'OK' }] },
    { role: 'user', parts: [{ text: context }] },
  ];

  const body = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  };
  if (isJson) {
    body.generationConfig.responseMimeType = 'application/json';
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Invalid response from Gemini API.');
    return text;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Gemini API call timed out after ${timeout}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 대기 메시지 생성 함수 (API 키 방식)
async function generateWaitMessage(history) {
  const context = `---대화 기록---\n${history.join('\n')}`;
  try {
    const resultText = await callGeminiWithApiKey(
      SYSTEM_PROMPT_WAIT_MESSAGE,
      context,
      'gemini-2.5-flash-lite',
      true,
      3800
    );
    return JSON.parse(resultText).wait_text;
  } catch (error) {
    console.warn('Wait message generation failed. Using default.', error.message);
    return '네, 말씀해주신 내용을 분석하고 있어요. 잠시만 기다려주세요! 🤖';
  }
}

// 다음 질문 생성 함수 (API 키 방식)
const generateNextQuestion = async (history, extracted_data) => {
  const context = `---대화 기록 시작---\n${history.join(
    '\n'
  )}\n---대화 기록 끝---\n\n[현재까지 분석된 환자 정보]\n${JSON.stringify(
    extracted_data,
    null,
    2
  )}`;
  return await callGeminiWithApiKey(
    SYSTEM_PROMPT_GENERATE_QUESTION,
    context,
    'gemini-2.5-flash-lite'
  );
};

// 종합 분석 함수 (API 키 방식)
const analyzeConversation = async (history) => {
  const context = `다음은 분석할 대화록입니다:\n\n${history.join('\n')}`;
  const resultText = await callGeminiWithApiKey(
    SYSTEM_PROMPT_ANALYZE_COMPREHENSIVE,
    context,
    'gemini-2.5-flash',
    true
  );
  return JSON.parse(resultText);
};

module.exports = {
  getFirestoreData,
  setFirestoreData,
  deleteFirestoreData,
  createAnalysisTask,
  archiveToBigQuery,
  generateWaitMessage,
  generateNextQuestion,
  analyzeConversation,
};
