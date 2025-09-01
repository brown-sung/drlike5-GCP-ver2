// 파일: services.js (API 키 방식으로 전면 수정)
const { Firestore } = require('@google-cloud/firestore');
const { BigQuery } = require('@google-cloud/bigquery');
const { CloudTasksClient } = require('@google-cloud/tasks');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const {
  SYSTEM_PROMPT_GENERATE_QUESTION,
  SYSTEM_PROMPT_ANALYZE_COMPREHENSIVE,
  SYSTEM_PROMPT_WAIT_MESSAGE,
  SYSTEM_PROMPT_ANALYZE_IMAGE_ALLERGY,
} = require('./prompts');

// --- 클라이언트 초기화 ---
const firestore = new Firestore();
const bigquery = new BigQuery();
const tasksClient = new CloudTasksClient();

// 세션 타임아웃 설정 (10분 = 600,000ms)
const SESSION_TIMEOUT = 10 * 60 * 1000;

// --- Firestore, BigQuery, Cloud Tasks 서비스 (변경 없음) ---
const getFirestoreData = async (userKey) => {
  const doc = await firestore.collection('conversations').doc(userKey).get();
  if (!doc.exists) return null;

  const data = doc.data();

  // 세션 타임아웃 체크
  if (data.lastActivity && Date.now() - data.lastActivity > SESSION_TIMEOUT) {
    console.log(`[Session Timeout] user: ${userKey}, lastActivity: ${new Date(data.lastActivity)}`);
    // 세션 만료 시 데이터 자동 삭제
    await deleteFirestoreData(userKey);
    return null;
  }

  return data;
};

const setFirestoreData = async (userKey, data) => {
  // lastActivity 자동 업데이트
  const dataWithTimestamp = {
    ...data,
    lastActivity: Date.now(),
  };

  await firestore.collection('conversations').doc(userKey).set(dataWithTimestamp, { merge: true });
  console.log(`[Data Updated] user: ${userKey}, state: ${data.state || 'unknown'}`);
};

const deleteFirestoreData = async (userKey) => {
  try {
    await firestore.collection('conversations').doc(userKey).delete();
    console.log(`[Data Deleted] user: ${userKey}`);
    return true;
  } catch (error) {
    console.error(`[Delete Error] user: ${userKey}`, error);
    return false;
  }
};

// 사용자 데이터 완전 초기화 함수
const resetUserData = async (userKey) => {
  try {
    await deleteFirestoreData(userKey);
    console.log(`[User Reset] user: ${userKey} - all data cleared`);
    return true;
  } catch (error) {
    console.error(`[Reset Error] user: ${userKey}`, error);
    return false;
  }
};

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

// --- 이미지 다운로드(Base64) ---
function normalizeMimeType(originalMime, url) {
  const mime = (originalMime || '').toLowerCase().trim();
  if (mime === 'image/jpg' || mime === 'image/pjpg') return 'image/jpeg';
  if (mime === 'image/x-png') return 'image/png';
  if (mime === '' || mime === 'application/octet-stream') {
    try {
      const lower = String(url || '').toLowerCase();
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
      if (lower.endsWith('.png')) return 'image/png';
      if (lower.endsWith('.webp')) return 'image/webp';
    } catch (_) {}
    return 'image/jpeg';
  }
  return mime;
}

async function fetchImageAsBase64(imageUrl) {
  console.log(`[Image Fetch] GET ${imageUrl}`);
  const resp = await fetch(imageUrl, {
    method: 'GET',
    headers: {
      Accept: 'image/*,*/*;q=0.8',
      'User-Agent': 'asthma-bot/1.0 (+server)',
    },
  });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    throw new Error(`Failed to fetch image: ${resp.status} ${errTxt}`);
  }
  const rawContentType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const contentType = normalizeMimeType(rawContentType, imageUrl);
  const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);
  if (contentLength > 15 * 1024 * 1024) {
    throw new Error(`Image too large: ${contentLength} bytes (>15MB)`);
  }
  const arrayBuf = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString('base64');
  console.log(
    `[Image Fetch] content-type=${contentType} (raw=${rawContentType}), bytes=${
      (base64.length * 0.75) | 0
    }`
  );
  return { base64, mimeType: contentType };
}

// --- 이미지 기반 알레르기 분석 (Gemini 2.5 Flash) ---
async function analyzeAllergyFromImage(imageUrl) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set.');
  }
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);

  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(mimeType)) {
    throw new Error(
      `Unsupported image mime after normalization: ${mimeType}. Please upload JPG/PNG/WEBP.`
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: SYSTEM_PROMPT_ANALYZE_IMAGE_ALLERGY },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  };

  console.log('[Gemini Vision] Requesting analysis...');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[Gemini Vision] Error body:', errorBody?.slice(0, 500));
    throw new Error(`Gemini Image API Error (${response.status})`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.warn('[Gemini Vision] Non-JSON response snippet:', String(text).slice(0, 200));
    parsed = {};
  }

  const airborneAllergens = Array.isArray(parsed.airborne_allergens)
    ? parsed.airborne_allergens
    : [];
  const foodAllergens = Array.isArray(parsed.food_allergens) ? parsed.food_allergens : [];
  const notes = typeof parsed.notes === 'string' ? parsed.notes : '';

  console.log('[Gemini Vision] Parsed:', {
    airborneLen: airborneAllergens.length,
    foodLen: foodAllergens.length,
  });
  return { airborneAllergens, foodAllergens, notes };
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
  resetUserData,
  analyzeAllergyFromImage,
};
