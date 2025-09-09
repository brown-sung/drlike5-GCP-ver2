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
    const deleteResult = await deleteFirestoreData(userKey);
    if (deleteResult) {
      console.log(`[User Reset] user: ${userKey} - All data cleared successfully`);
      return true;
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
  timeout = 25000
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
  return '알레르기 검사결과지를 올려주셨네요. 잠시만 기다시리면 살펴보겠습니다.';
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

  const hasRepeatedQuestion =
    recentQuestions.length >= 2 &&
    recentQuestions[recentQuestions.length - 1] === recentQuestions[recentQuestions.length - 2];

  // 반복 질문이 있으면 분석 제안으로 전환
  if (hasRepeatedQuestion) {
    console.log(`[Question Generation] Detected repeated question, returning analysis suggestion`);
    return "혹시 더 말씀하고 싶은 다른 증상이 있으신가요? 없으시다면 '분석해줘'라고 말씀해주세요.";
  }

  // extracted_data에서 null이 아닌 값만 추출하여 컨텍스트에 포함
  const relevantData = Object.entries(extracted_data)
    .filter(([key, value]) => value !== null && value !== '')
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

  const context = `---최근 대화 기록---\n${recentHistory.join(
    '\n'
  )}\n---대화 기록 끝---\n\n[현재까지 수집된 증상 정보]\n${
    Object.keys(relevantData).length > 0
      ? JSON.stringify(relevantData, null, 2)
      : '아직 수집된 증상 정보가 없습니다.'
  }`;

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
const analyzeConversation = async (history) => {
  // 대화 기록에서 초성체를 한글로 변환
  const convertedHistory = history.map((entry) => {
    if (entry.startsWith('사용자: ')) {
      const userMessage = entry.slice('사용자: '.length);
      const convertedMessage = convertInitialsToKorean(userMessage);
      return `사용자: ${convertedMessage}`;
    }
    return entry;
  });

  const context = `다음은 분석할 대화록입니다:\n\n${convertedHistory.join('\n')}`;
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
  resetUserData,
  analyzeAllergyTestImage,
  extractTextFromImage,
  parseAllergyTestResults,
};
