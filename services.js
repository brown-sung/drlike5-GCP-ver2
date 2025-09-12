// 파일: services.js (API 키 방식으로 전면 수정)
const { Firestore } = require('@google-cloud/firestore');
const { BigQuery } = require('@google-cloud/bigquery');
const { CloudTasksClient } = require('@google-cloud/tasks');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const {
  SYSTEM_PROMPT_GENERATE_QUESTION,
  SYSTEM_PROMPT_ANALYZE_COMPREHENSIVE,
  SYSTEM_PROMPT_WAIT_MESSAGE,
  SYSTEM_PROMPT_EXTRACT_TEXT_FROM_IMAGE,
  SYSTEM_PROMPT_PARSE_ALLERGY_TEST,
  convertInitialsToKorean,
} = require('./prompts');

// --- 클라이언트 초기화 ---
const firestore = new Firestore();
const bigquery = new BigQuery();
const tasksClient = new CloudTasksClient();

// 세션 타임아웃 설정 (10분 = 600,000ms)
const SESSION_TIMEOUT = 10 * 60 * 1000;

// --- Firestore, BigQuery, Cloud Tasks 서비스 (변경 없음) ---
const getFirestoreData = async (userKey) => {
  try {
    console.log(`[Firestore Get] user: ${userKey} - Starting data retrieval`);
    const doc = await firestore.collection('conversations').doc(userKey).get();
    if (!doc.exists) {
      console.log(`[Firestore Get] user: ${userKey} - No document found`);
      return null;
    }

    const data = doc.data();
    console.log(
      `[Firestore Get] user: ${userKey} - Data retrieved:`,
      JSON.stringify(data, null, 2)
    );

    // 세션 타임아웃 체크
    if (data.lastActivity && Date.now() - data.lastActivity > SESSION_TIMEOUT) {
      console.log(
        `[Session Timeout] user: ${userKey}, lastActivity: ${new Date(data.lastActivity)}`
      );
      // 세션 만료 시 데이터 자동 삭제
      await deleteFirestoreData(userKey);
      return null;
    }

    console.log(`[Firestore Get] user: ${userKey} - Returning valid data`);
    return data;
  } catch (error) {
    console.error(`[Firestore Get Error] user: ${userKey}`, error);
    return null;
  }
};

const setFirestoreData = async (userKey, data) => {
  try {
    console.log(`[Firestore Set] user: ${userKey} - Starting data save`);
    console.log(`[Firestore Set] user: ${userKey} - Data to save:`, JSON.stringify(data, null, 2));

    // lastActivity 자동 업데이트
    const dataWithTimestamp = {
      ...data,
      lastActivity: Date.now(),
    };

    await firestore
      .collection('conversations')
      .doc(userKey)
      .set(dataWithTimestamp, { merge: true });
    console.log(
      `[Firestore Set] user: ${userKey} - Data saved successfully, state: ${
        data.state || 'unknown'
      }`
    );
  } catch (error) {
    console.error(`[Firestore Set Error] user: ${userKey}`, error);
    throw error;
  }
};

const deleteFirestoreData = async (userKey) => {
  try {
    console.log(`[Firestore Delete] user: ${userKey} - Starting data deletion`);
    await firestore.collection('conversations').doc(userKey).delete();
    console.log(`[Firestore Delete] user: ${userKey} - Data deleted successfully`);
    return true;
  } catch (error) {
    console.error(`[Firestore Delete Error] user: ${userKey}`, error);
    return false;
  }
};

// 사용자 데이터 완전 초기화 함수
const resetUserData = async (userKey) => {
  try {
    console.log(`[User Reset] user: ${userKey} - Starting complete data reset`);

    // 삭제 전 기존 데이터 확인
    const existingData = await getFirestoreData(userKey);
    if (existingData) {
      console.log(`[User Reset] user: ${userKey} - Found existing data before deletion:`, {
        state: existingData.state,
        extracted_data_keys: Object.keys(existingData.extracted_data || {}),
        history_length: existingData.history?.length || 0,
      });
    } else {
      console.log(`[User Reset] user: ${userKey} - No existing data found`);
    }

    const deleteResult = await deleteFirestoreData(userKey);
    if (deleteResult) {
      console.log(`[User Reset] user: ${userKey} - All data cleared successfully`);

      // 삭제 후 확인
      const verifyData = await getFirestoreData(userKey);
      if (verifyData) {
        console.error(`[User Reset] user: ${userKey} - WARNING: Data still exists after deletion!`);
        return false;
      } else {
        console.log(`[User Reset] user: ${userKey} - Verification successful: No data remains`);
        return true;
      }
    } else {
      console.error(`[User Reset] user: ${userKey} - Failed to delete data`);
      return false;
    }
  } catch (error) {
    console.error(`[Reset Error] user: ${userKey}`, error);
    return false;
  }
};

const createAnalysisTask = async (payload) => {
  try {
    console.log(`[Cloud Task] user: ${payload.userKey} - Starting task creation`);
    const { GCP_PROJECT, GCP_LOCATION, TASK_QUEUE_NAME, CLOUD_RUN_URL } = process.env;

    console.log(
      `[Cloud Task] user: ${payload.userKey} - Environment: PROJECT=${GCP_PROJECT}, LOCATION=${GCP_LOCATION}, QUEUE=${TASK_QUEUE_NAME}`
    );

    const queuePath = tasksClient.queuePath(GCP_PROJECT, GCP_LOCATION, TASK_QUEUE_NAME);
    const url = `${CLOUD_RUN_URL}/process-analysis-callback`;

    console.log(`[Cloud Task] user: ${payload.userKey} - Queue path: ${queuePath}`);
    console.log(`[Cloud Task] user: ${payload.userKey} - Callback URL: ${url}`);

    const task = {
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      },
    };

    console.log(
      `[Cloud Task] user: ${payload.userKey} - Task payload:`,
      JSON.stringify(payload, null, 2)
    );

    const result = await tasksClient.createTask({ parent: queuePath, task });
    console.log(`[Cloud Task] user: ${payload.userKey} - Task created successfully:`, result.name);
  } catch (error) {
    console.error(`[Cloud Task Error] user: ${payload.userKey}`, error);
    throw error;
  }
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
  timeout = 40000
) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('[Gemini API Error] GEMINI_API_KEY environment variable is not set.');
    throw new Error('GEMINI_API_KEY environment variable is not set.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

  console.log(`[Gemini API Call] Model: ${modelName}, IsJson: ${isJson}, Timeout: ${timeout}ms`);
  console.log(
    `[Gemini API Call] SystemPrompt length: ${systemPrompt.length} chars, Context length: ${context.length} chars`
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[Gemini API Timeout] Model: ${modelName}, Timeout: ${timeout}ms`);
    controller.abort();
  }, timeout);

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
    console.log(`[Gemini API Request] Sending request to: ${url}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    console.log(`[Gemini API Response] Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Gemini API Error] ${response.status}: ${errorBody}`);
      throw new Error(`Gemini API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error(
        '[Gemini API Error] Invalid response structure:',
        JSON.stringify(data, null, 2)
      );
      throw new Error('Invalid response from Gemini API.');
    }

    console.log(
      `[Gemini API Success] Model: ${modelName}, Response length: ${text.length} characters`
    );
    console.log(`[Gemini API Response] First 200 chars: ${text.substring(0, 200)}...`);
    return text;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`[Gemini API Timeout] Model: ${modelName}, Timeout: ${timeout}ms`);
      throw new Error(`Gemini API call timed out after ${timeout}ms.`);
    }
    console.error(`[Gemini API Error] Model: ${modelName}, Error:`, error);
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

// 대기 메시지 생성 함수 (API 키 방식)
async function generateWaitMessage(history) {
  const context = `---대화 기록---\n${history.join('\n')}`;
  try {
    let resultText = await callGeminiWithApiKey(
      SYSTEM_PROMPT_WAIT_MESSAGE,
      context,
      'gemini-2.5-flash-lite',
      true,
      3800
    );

    // 마크다운 코드 블록 제거
    if (resultText.startsWith('```json') && resultText.endsWith('```')) {
      resultText = resultText.substring(7, resultText.length - 3).trim();
    } else if (resultText.startsWith('```') && resultText.endsWith('```')) {
      resultText = resultText.substring(3, resultText.length - 3).trim();
    }

    // JSON 파싱을 더 안전하게 처리
    let parsed;
    try {
      parsed = JSON.parse(resultText);
    } catch (parseError) {
      console.warn('JSON parsing failed, trying to extract text directly:', parseError.message);
      // JSON이 아닌 경우 직접 텍스트 반환
      return (
        resultText.replace(/^["']|["']$/g, '').trim() ||
        '네, 말씀해주신 내용을 분석하고 있어요. 잠시만 기다려주세요! 🤖'
      );
    }

    return parsed.wait_text || '네, 말씀해주신 내용을 분석하고 있어요. 잠시만 기다려주세요! 🤖';
  } catch (error) {
    console.warn('Wait message generation failed. Using default.', error.message);
    return '네, 말씀해주신 내용을 분석하고 있어요. 잠시만 기다려주세요! 🤖';
  }
}

// 알레르기 검사결과지 전용 대기 메시지 생성
async function generateAllergyTestWaitMessage() {
  return '📊 네, 보내주신 알레르기 검사결과 내용을 살펴보고 있어요. 잠시만 기다려주세요.';
}

// 1단계: 이미지에서 텍스트 추출
async function extractTextFromImage(imageUrl) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set.');
  }

  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
  const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(
      `Unsupported MIME type for Gemini Vision: ${mimeType}. Please upload JPEG, PNG, or WEBP images.`
    );
  }

  console.log('[Text Extraction] Requesting text extraction...');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT_EXTRACT_TEXT_FROM_IMAGE },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 0.8,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini Vision API error: ${response.status}`);
  }

  const data = await response.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text extracted from image');
  }

  // 마크다운 코드 블록 제거
  if (text.startsWith('```json') && text.endsWith('```')) {
    text = text.substring(7, text.length - 3).trim();
  } else if (text.startsWith('```') && text.endsWith('```')) {
    text = text.substring(3, text.length - 3).trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.warn('[Text Extraction] Non-JSON response, using raw text');
    parsed = { extracted_text: text };
  }

  console.log('[Text Extraction] Completed, text length:', parsed.extracted_text?.length || 0);
  return parsed.extracted_text;
}

// 2단계: 알레르기 검사 결과 분석 (통합)
async function parseAllergyTestResults(extractedText) {
  console.log('[Allergy Test Analysis] Starting integrated analysis...');

  let resultText = await callGeminiWithApiKey(
    SYSTEM_PROMPT_PARSE_ALLERGY_TEST,
    extractedText,
    'gemini-2.5-flash',
    true,
    55000
  );

  // 마크다운 코드 블록 제거
  if (resultText.startsWith('```json') && resultText.endsWith('```')) {
    resultText = resultText.substring(7, resultText.length - 3).trim();
  } else if (resultText.startsWith('```') && resultText.endsWith('```')) {
    resultText = resultText.substring(3, resultText.length - 3).trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(resultText);
  } catch (e) {
    console.warn('[Allergy Test Analysis] Non-JSON response:', resultText.slice(0, 200));
    throw new Error('Failed to parse allergy test results');
  }

  console.log('[Allergy Test Analysis] Completed:', {
    testType: parsed.test_type,
    totalIge: parsed.total_ige,
    airborneCount: parsed.airborne_allergens?.length || 0,
    foodCount: parsed.food_allergens?.length || 0,
    asthmaHighRisk: parsed.asthma_high_risk?.length || 0,
    asthmaMediumRisk: parsed.asthma_medium_risk?.length || 0,
    totalPositive: parsed.total_positive,
    asthmaRelated: parsed.asthma_related,
    riskLevel: parsed.risk_level,
  });

  return parsed;
}

// 통합 이미지 분석 함수 (2단계)
async function analyzeAllergyTestImage(imageUrl) {
  try {
    console.log('[Allergy Test Analysis] Starting 2-step analysis...');

    // 1단계: 텍스트 추출
    const extractedText = await extractTextFromImage(imageUrl);

    // 2단계: 검사 결과 분석 (통합)
    const analysisResult = await parseAllergyTestResults(extractedText);

    console.log('[Allergy Test Analysis] All steps completed successfully');

    return {
      extractedText,
      analysisResult,
    };
  } catch (error) {
    console.error('[Allergy Test Analysis] Error:', error);
    throw error;
  }
}

// 다음 질문 생성 함수 (API 키 방식)
const generateNextQuestion = async (history, extracted_data) => {
  console.log(`[Question Generation] Starting question generation`);
  console.log(`[Question Generation] History length: ${history.length}`);
  console.log(
    `[Question Generation] Extracted data fields: ${Object.keys(extracted_data).length} fields`
  );

  // 대화 기록에서 초성체를 한글로 변환
  const convertedHistory = history.map((entry) => {
    if (entry.startsWith('사용자: ')) {
      const userMessage = entry.slice('사용자: '.length);
      const convertedMessage = convertInitialsToKorean(userMessage);
      return `사용자: ${convertedMessage}`;
    }
    return entry;
  });

  // 최근 10턴만 사용하여 컨텍스트 길이 제한
  const recentHistory = convertedHistory.slice(-10);
  console.log(`[Question Generation] Recent history length: ${recentHistory.length}`);

  // 반복 질문 방지: 최근 3턴에서 같은 질문이 있는지 확인
  const recentQuestions = recentHistory
    .filter((entry) => entry.startsWith('챗봇:'))
    .slice(-3)
    .map((entry) => entry.replace('챗봇: ', ''));

  console.log(`[Question Generation] Recent questions:`, recentQuestions);

  const hasRepeatedQuestion =
    recentQuestions.length >= 2 &&
    recentQuestions[recentQuestions.length - 1] === recentQuestions[recentQuestions.length - 2];

  console.log(`[Question Generation] Has repeated question:`, hasRepeatedQuestion);

  // 반복 질문이 있으면 분석 제안으로 전환
  if (hasRepeatedQuestion) {
    console.log(`[Question Generation] Detected repeated question, returning analysis suggestion`);
    return '네, 알겠습니다. 지금까지 말씀해주신 내용을 종합하여 아이의 천식 가능성을 안내드릴까요? 🩺';
  }

  // 사용자가 최근에 "아니요", "없어요", "ㄴㄴ" 등으로 답변했는지 확인
  const recentUserResponses = recentHistory
    .filter((entry) => entry.startsWith('사용자:'))
    .slice(-3)
    .map((entry) => entry.replace('사용자: ', '').toLowerCase());

  const hasNegativeResponse = recentUserResponses.some(
    (response) =>
      response.includes('아니') ||
      response.includes('없어') ||
      response.includes('ㄴㄴ') ||
      response.includes('아니오') ||
      response.includes('없어요') ||
      response.includes('그렇지') ||
      response.includes('아니야') ||
      response.includes('아닙니다') ||
      response.includes('아니에요') ||
      response.includes('그렇지 않') ||
      response.includes('아닙니다') ||
      response.includes('아니요')
  );

  console.log(`[Question Generation] Recent user responses:`, recentUserResponses);
  console.log(`[Question Generation] Has negative response:`, hasNegativeResponse);

  // extracted_data에서 null이 아닌 값만 추출하여 컨텍스트에 포함
  const relevantData = Object.entries(extracted_data)
    .filter(([key, value]) => value !== null && value !== '')
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

  // 천식 진단 조건 체계적 확인
  const coreSymptoms = ['쌕쌕거림', '호흡곤란', '가슴 답답', '야간'];
  const frequencyQuestions = ['증상 지속', '기관지확장제 사용'];
  const riskFactors = ['가족력', '아토피 병력', '공중 항원', '식품 항원'];

  // 1단계: 천식 핵심 증상 질문 여부 확인 (extracted_data 우선 확인)
  const askedCoreSymptoms = coreSymptoms.filter((symptom) => {
    // extracted_data에서 먼저 확인 (Y 또는 N으로 답변된 경우)
    const symptomKey = symptom === '가슴 답답' ? '가슴 답답' : symptom;
    if (extracted_data[symptomKey] === 'Y' || extracted_data[symptomKey] === 'N') {
      return true;
    }

    // extracted_data에 없으면 대화 기록에서 확인
    const symptomKeywords = {
      쌕쌕거림: ['쌕쌕', '쌕쌕거리', 'wheezing', '휘파람'],
      호흡곤란: ['호흡곤란', '숨쉬기', '숨쉬는', '호흡', '숨'],
      '가슴 답답': ['가슴', '답답', '답답함', '가슴이'],
      야간: ['야간', '밤', '밤에', '밤중', '잠잘때', '잠들때'],
    };

    const keywords = symptomKeywords[symptom] || [];
    return recentHistory.some(
      (entry) =>
        entry.startsWith('챗봇:') &&
        keywords.some((keyword) => entry.toLowerCase().includes(keyword))
    );
  });

  // 2단계: 빈도 조건 질문 여부 확인 (extracted_data 우선 확인)
  const askedFrequencyQuestions = frequencyQuestions.filter((question) => {
    // extracted_data에서 먼저 확인 (값이 있는 경우)
    if (extracted_data[question] !== null && extracted_data[question] !== '') {
      return true;
    }

    // extracted_data에 없으면 대화 기록에서 확인
    const questionKeywords = {
      '증상 지속': ['얼마나', '오래', '지속', '3개월'],
      '기관지확장제 사용': ['기관지', '확장제', '약물', '사용'],
    };

    const keywords = questionKeywords[question] || [];
    return recentHistory.some(
      (entry) =>
        entry.startsWith('챗봇:') &&
        keywords.some((keyword) => entry.toLowerCase().includes(keyword))
    );
  });

  // 3단계: 위험인자 질문 여부 확인 (extracted_data 우선 확인)
  const askedRiskFactors = riskFactors.filter((factor) => {
    // extracted_data에서 먼저 확인 (Y 또는 N으로 답변된 경우)
    if (extracted_data[factor] === 'Y' || extracted_data[factor] === 'N') {
      return true;
    }

    // extracted_data에 없으면 대화 기록에서 확인
    const factorKeywords = {
      가족력: ['가족', '부모', '형제', '유전'],
      '아토피 병력': ['아토피', '피부염', '알레르기 비염'],
      '공중 항원': ['집먼지', '꽃가루', '곰팡이', '공중'],
      '식품 항원': ['우유', '계란', '땅콩', '음식', '식품'],
    };

    const keywords = factorKeywords[factor] || [];
    return recentHistory.some(
      (entry) =>
        entry.startsWith('챗봇:') &&
        keywords.some((keyword) => entry.toLowerCase().includes(keyword))
    );
  });

  console.log(`[Question Generation] Core symptoms asked: ${askedCoreSymptoms.length}/4`);
  console.log(
    `[Question Generation] Frequency questions asked: ${askedFrequencyQuestions.length}/2`
  );
  console.log(`[Question Generation] Risk factors asked: ${askedRiskFactors.length}/4`);
  console.log(`[Question Generation] Asked symptoms:`, askedCoreSymptoms);

  // 천식 진단 조건에 따른 질문 우선순위
  // 1단계: 천식 핵심 증상이 1개도 확인되지 않았으면 계속 질문
  if (askedCoreSymptoms.length === 0) {
    console.log(
      `[Question Generation] No core symptoms asked yet - continuing core symptom questions`
    );
    // 핵심 증상이 부족하면 부정적인 답변이 있어도 계속 질문해야 함
  }
  // 2단계: 핵심 증상이 1개 이상 확인되었고, 빈도 조건이 확인되지 않았으면 빈도 질문
  else if (askedCoreSymptoms.length >= 1 && askedFrequencyQuestions.length === 0) {
    console.log(
      `[Question Generation] Core symptoms confirmed (${askedCoreSymptoms.length}/4) but frequency not asked - asking frequency questions`
    );
    // 빈도 조건 질문 필요
  }
  // 3단계: 빈도 조건이 확인되었고, 위험인자가 2개 미만이면 위험인자 질문
  else if (askedFrequencyQuestions.length >= 1 && askedRiskFactors.length < 2) {
    console.log(
      `[Question Generation] Frequency confirmed but risk factors insufficient (${askedRiskFactors.length}/4) - asking risk factor questions`
    );
    // 위험인자 질문 필요
  }
  // 4단계: 모든 조건이 충분히 확인되었으면 분석 제안
  else if (
    askedCoreSymptoms.length >= 1 &&
    askedFrequencyQuestions.length >= 1 &&
    askedRiskFactors.length >= 2
  ) {
    console.log(`[Question Generation] All conditions sufficiently covered - suggesting analysis`);
    if (hasNegativeResponse && recentQuestions.length >= 2) {
      return '네, 알겠습니다. 지금까지 말씀해주신 내용을 종합하여 아이의 천식 가능성을 안내드릴까요? 🩺';
    }
  }
  // 5단계: 기본적으로 핵심 증상이 부족하면 계속 질문
  else if (askedCoreSymptoms.length < 4) {
    console.log(
      `[Question Generation] Need to ask more core symptoms (${askedCoreSymptoms.length}/4) - continuing questions regardless of negative response`
    );
    // 핵심 증상이 부족하면 부정적인 답변이 있어도 계속 질문해야 함
  }

  // 아직 질문하지 않은 핵심 증상 찾기 (extracted_data 우선 확인)
  const unaskedCoreSymptoms = coreSymptoms.filter((symptom) => {
    // extracted_data에서 먼저 확인 (Y 또는 N으로 답변된 경우)
    const symptomKey = symptom === '가슴 답답' ? '가슴 답답' : symptom;
    if (extracted_data[symptomKey] === 'Y' || extracted_data[symptomKey] === 'N') {
      return false; // 이미 답변됨
    }

    // extracted_data에 없으면 대화 기록에서 확인
    const symptomKeywords = {
      쌕쌕거림: ['쌕쌕', '쌕쌕거리', 'wheezing', '휘파람'],
      호흡곤란: ['호흡곤란', '숨쉬기', '숨쉬는', '호흡', '숨'],
      '가슴 답답': ['가슴', '답답', '답답함', '가슴이'],
      야간: ['야간', '밤', '밤에', '밤중', '잠잘때', '잠들때'],
    };

    const keywords = symptomKeywords[symptom] || [];
    return !recentHistory.some(
      (entry) =>
        entry.startsWith('챗봇:') &&
        keywords.some((keyword) => entry.toLowerCase().includes(keyword))
    );
  });

  const context = `---최근 대화 기록---\n${recentHistory.join(
    '\n'
  )}\n---대화 기록 끝---\n\n[현재까지 수집된 증상 정보]\n${
    Object.keys(relevantData).length > 0
      ? JSON.stringify(relevantData, null, 2)
      : '아직 수집된 증상 정보가 없습니다.'
  }

[천식 진단 조건 현황]
1단계 - 천식 핵심 증상 (4가지 중 최소 1개 필요):
- 질문 완료: ${askedCoreSymptoms.length}/4개 (${askedCoreSymptoms.join(', ') || '없음'})
- 아직 질문하지 않은 증상: ${
    unaskedCoreSymptoms.length > 0 ? unaskedCoreSymptoms.join(', ') : '없음'
  }

2단계 - 빈도 조건 (3개월 이상 필요):
- 질문 완료: ${askedFrequencyQuestions.length}/2개 (${askedFrequencyQuestions.join(', ') || '없음'})
- 필요: 증상 지속 3개월 이상 또는 기관지확장제 사용 3개월 이상

3단계 - 위험인자 (주요 1개 또는 부가 2개 필요):
- 질문 완료: ${askedRiskFactors.length}/4개 (${askedRiskFactors.join(', ') || '없음'})
- 주요 인자: 가족력, 아토피 병력 (1개 이상)
- 부가 인자: 공중 항원, 식품 항원 (2개 이상)

중요 지침:
1. 1단계에서 천식 핵심 증상이 1개도 확인되지 않았으면 계속 핵심 증상 질문을 하세요.
2. 1단계가 완료되면 2단계 빈도 조건을 질문하세요.
3. 2단계가 완료되면 3단계 위험인자를 질문하세요.
4. 모든 단계가 충분히 확인되면 분석을 제안하세요.
5. 사용자가 "아니요", "없어요", "ㄴㄴ" 등으로 답변한 질문은 절대 다시 묻지 마세요.
6. 반복 질문을 하지 마세요.`;

  console.log(`[Question Generation] Context length: ${context.length} characters`);
  console.log(`[Question Generation] Context preview: ${context.substring(0, 300)}...`);

  try {
    console.log(`[Question Generation] Calling Gemini API...`);
    const result = await callGeminiWithApiKey(
      SYSTEM_PROMPT_GENERATE_QUESTION,
      context,
      'gemini-2.5-flash-lite', // 더 빠른 모델 사용
      false, // JSON 응답 요청하지 않음
      4000 // 4초로 설정 (flash-lite는 더 빠름)
    );

    console.log(`[Question Generation] Gemini API response received:`, result);
    console.log(`[Question Generation] Response type: ${typeof result}, Length: ${result.length}`);

    // 생성된 질문을 로깅 (extracted_data는 직접 수정하지 않음)
    if (result && typeof result === 'string') {
      console.log(`[Question Generation] Generated question: ${result}`);
      // extracted_data._lastQuestion은 호출하는 쪽에서 설정하도록 변경
    }

    // JSON 응답인 경우 텍스트만 추출
    if (
      typeof result === 'string' &&
      (result.trim().startsWith('{') || result.trim().startsWith('['))
    ) {
      try {
        const parsed = JSON.parse(result);
        const extractedText =
          parsed.text ||
          parsed.message ||
          parsed.question ||
          parsed.content ||
          parsed.response ||
          parsed.answer ||
          result;
        console.log(`[Question Generation] Extracted text from JSON:`, extractedText);
        return extractedText;
      } catch (e) {
        console.log(`[Question Generation] JSON parsing failed, using raw result:`, result);
        return result;
      }
    }

    // JSON 형태의 문자열이 포함된 경우 처리
    if (
      typeof result === 'string' &&
      (result.includes('{"') ||
        result.includes("{'") ||
        result.includes('"response"') ||
        result.includes('"text"') ||
        result.includes('"message"') ||
        result.includes('"question"') ||
        result.includes('"content"'))
    ) {
      try {
        // JSON 부분만 추출하여 파싱 (더 강력한 정규식)
        const jsonMatch = result.match(
          /\{[^{}]*(?:"response"|"text"|"message"|"question"|"content")[^{}]*\}/
        );
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const extractedText =
            parsed.text ||
            parsed.message ||
            parsed.question ||
            parsed.content ||
            parsed.response ||
            parsed.answer ||
            result;
          console.log(`[Question Generation] Extracted text from embedded JSON:`, extractedText);
          return extractedText;
        }
      } catch (e) {
        console.log(
          `[Question Generation] Embedded JSON parsing failed, using raw result:`,
          result
        );
      }
    }

    // JSON이 아닌 경우에도 마크다운 코드 블록 제거
    let cleanResult = result;
    if (typeof result === 'string') {
      // 마크다운 코드 블록 제거
      if (result.startsWith('```json') && result.endsWith('```')) {
        cleanResult = result.substring(7, result.length - 3).trim();
        try {
          const parsed = JSON.parse(cleanResult);
          cleanResult =
            parsed.text ||
            parsed.message ||
            parsed.question ||
            parsed.content ||
            parsed.response ||
            cleanResult;
        } catch (e) {
          // JSON 파싱 실패 시 원본 사용
        }
      } else if (result.startsWith('```') && result.endsWith('```')) {
        cleanResult = result.substring(3, result.length - 3).trim();
      }

      // 앞뒤 쌍따옴표 제거
      cleanResult = cleanResult.replace(/^"|"$/g, '').trim();

      // JSON 형태의 문자열이 남아있으면 제거
      if (
        cleanResult.includes('{"text":') ||
        cleanResult.includes('{"message":') ||
        cleanResult.includes('{"response":')
      ) {
        try {
          const parsed = JSON.parse(cleanResult);
          cleanResult =
            parsed.text ||
            parsed.message ||
            parsed.question ||
            parsed.content ||
            parsed.response ||
            parsed.answer ||
            cleanResult;
        } catch (e) {
          // JSON 파싱 실패 시 원본 사용
        }
      }

      // 정규식을 사용한 JSON 제거 (더 강력한 처리)
      const jsonPatterns = [
        /\{[^{}]*"response"[^{}]*\}/g,
        /\{[^{}]*"text"[^{}]*\}/g,
        /\{[^{}]*"message"[^{}]*\}/g,
        /\{[^{}]*"question"[^{}]*\}/g,
        /\{[^{}]*"content"[^{}]*\}/g,
      ];

      for (const pattern of jsonPatterns) {
        if (pattern.test(cleanResult)) {
          const jsonMatch = cleanResult.match(pattern);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              cleanResult =
                parsed.response ||
                parsed.text ||
                parsed.message ||
                parsed.question ||
                parsed.content ||
                parsed.answer ||
                cleanResult;
              break; // 첫 번째로 성공한 패턴 사용
            } catch (e) {
              // JSON 파싱 실패 시 다음 패턴 시도
              continue;
            }
          }
        }
      }
    }

    console.log(`[Question Generation] Using cleaned result:`, cleanResult);
    return cleanResult;
  } catch (error) {
    console.error(`[Question Generation Error]`, error);
    if (error.message && error.message.includes('timed out')) {
      // 타임아웃 시 대기 메시지 반환
      console.log(`[Question Generation] Timeout occurred, returning fallback message`);
      return '잠시만 기다려주세요. 질문을 준비하고 있어요...';
    }
    throw error;
  }
};

// 종합 분석 함수 (API 키 방식)
// 간단한 키워드 매칭으로 증상 데이터 추출 (빠른 처리)
function extractSymptomDataFromResponse(userResponse, currentData) {
  const response = userResponse.toLowerCase();
  const updatedData = { ...currentData };

  // _lastQuestion이 없으면 빈 문자열로 초기화
  if (!updatedData._lastQuestion) {
    updatedData._lastQuestion = '';
  }

  // 긍정/부정 키워드
  const positiveKeywords = [
    '네',
    '예',
    '맞아',
    '있어',
    '해요',
    '됩니다',
    '그래',
    '응',
    'ㅇㅇ',
    'ㅇ',
  ];
  const negativeKeywords = ['아니', '없어', '안해', '아닙니다', '아니에요', 'ㄴㄴ', 'ㄴ'];

  const isPositive = positiveKeywords.some((keyword) => response.includes(keyword));
  const isNegative = negativeKeywords.some((keyword) => response.includes(keyword));

  // 최근 질문에서 증상 키워드 추출
  const recentQuestion = currentData._lastQuestion || '';
  console.log(`[Symptom Extraction] Recent question: ${recentQuestion}`);
  console.log(`[Symptom Extraction] User response: ${userResponse}`);

  // 천식 핵심 증상 매칭
  if (recentQuestion.includes('쌕쌕') || recentQuestion.includes('휘파람')) {
    if (isPositive) updatedData['쌕쌕거림'] = 'Y';
    else if (isNegative) updatedData['쌕쌕거림'] = 'N';
  }

  if (recentQuestion.includes('숨쉬') || recentQuestion.includes('호흡')) {
    if (isPositive) updatedData['호흡곤란'] = 'Y';
    else if (isNegative) updatedData['호흡곤란'] = 'N';
  }

  if (recentQuestion.includes('가슴') || recentQuestion.includes('답답')) {
    if (isPositive) updatedData['가슴 답답'] = 'Y';
    else if (isNegative) updatedData['가슴 답답'] = 'N';
  }

  if (
    recentQuestion.includes('밤') ||
    recentQuestion.includes('야간') ||
    recentQuestion.includes('잠')
  ) {
    if (isPositive) updatedData['야간'] = 'Y';
    else if (isNegative) updatedData['야간'] = 'N';
  }

  // 빈도 조건 매칭
  if (
    recentQuestion.includes('얼마나') ||
    recentQuestion.includes('오래') ||
    recentQuestion.includes('지속')
  ) {
    if (isPositive) {
      // 3개월 이상 언급 확인
      if (response.includes('3개월') || response.includes('세달') || response.includes('3달')) {
        updatedData['증상 지속'] = '3개월 이상';
      } else {
        updatedData['증상 지속'] = '있음';
      }
    } else if (isNegative) {
      updatedData['증상 지속'] = '없음';
    }
  }

  if (recentQuestion.includes('기관지') || recentQuestion.includes('확장제')) {
    if (isPositive) {
      if (response.includes('3개월') || response.includes('세달') || response.includes('3달')) {
        updatedData['기관지확장제 사용'] = '3개월 이상';
      } else {
        updatedData['기관지확장제 사용'] = '있음';
      }
    } else if (isNegative) {
      updatedData['기관지확장제 사용'] = '없음';
    }
  }

  // 위험인자 매칭
  if (recentQuestion.includes('가족') || recentQuestion.includes('부모')) {
    if (isPositive) updatedData['가족력'] = 'Y';
    else if (isNegative) updatedData['가족력'] = 'N';
  }

  if (recentQuestion.includes('아토피') || recentQuestion.includes('알레르기')) {
    if (isPositive) updatedData['아토피 병력'] = 'Y';
    else if (isNegative) updatedData['아토피 병력'] = 'N';
  }

  if (
    recentQuestion.includes('집먼지') ||
    recentQuestion.includes('꽃가루') ||
    recentQuestion.includes('곰팡이')
  ) {
    if (isPositive) updatedData['공중 항원'] = 'Y';
    else if (isNegative) updatedData['공중 항원'] = 'N';
  }

  if (
    recentQuestion.includes('우유') ||
    recentQuestion.includes('계란') ||
    recentQuestion.includes('땅콩')
  ) {
    if (isPositive) updatedData['식품 항원'] = 'Y';
    else if (isNegative) updatedData['식품 항원'] = 'N';
  }

  return updatedData;
}

const analyzeConversation = async (history) => {
  // AI 질문과 사용자 응답을 매칭하여 분석
  const conversationPairs = [];

  for (let i = 0; i < history.length - 1; i++) {
    const currentEntry = history[i];
    const nextEntry = history[i + 1];

    // AI 질문 다음에 사용자 응답이 오는 경우
    if (currentEntry.startsWith('챗봇:') && nextEntry.startsWith('사용자:')) {
      const aiQuestion = currentEntry.slice('챗봇: '.length);
      const userResponse = nextEntry.slice('사용자: '.length);
      const convertedUserResponse = convertInitialsToKorean(userResponse);

      conversationPairs.push({
        question: aiQuestion,
        response: convertedUserResponse,
      });
    }
  }

  console.log('[Conversation Analysis] Found conversation pairs:', conversationPairs.length);
  console.log('[Conversation Analysis] Pairs:', conversationPairs);

  // 대화 쌍을 컨텍스트로 변환
  const contextPairs = conversationPairs
    .map(
      (pair, index) => `질문 ${index + 1}: ${pair.question}\n답변 ${index + 1}: ${pair.response}`
    )
    .join('\n\n');

  const context = `다음은 AI와 사용자의 질문-답변 쌍입니다. 각 질문에 대한 사용자의 답변을 분석하여 증상 정보를 추출하세요:

${contextPairs}

중요 지침:
1. AI가 질문한 내용이 아니라, 사용자가 실제로 답변한 내용만 분석하세요.
2. 사용자가 "네", "예", "있어요" 등으로 긍정 답변한 경우 "Y"로 표기하세요.
3. 사용자가 "아니요", "없어요", "아니" 등으로 부정 답변한 경우 "N"으로 표기하세요.
4. 사용자가 구체적인 정보를 제공한 경우 해당 텍스트를 그대로 사용하세요.
5. 질문에 대한 답변이 없거나 불명확한 경우 "null"로 표기하세요.`;

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
  generateAllergyTestWaitMessage,
  generateNextQuestion,
  analyzeConversation,
  extractSymptomDataFromResponse,
  resetUserData,
  analyzeAllergyTestImage,
  extractTextFromImage,
  parseAllergyTestResults,
};
