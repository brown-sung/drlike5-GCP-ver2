// 파일: utils.js
const IMAGE_URL_HIGH_RISK =
  'https://github.com/brown-sung/drlike5-GCP-ver2/blob/main/asthma_high2.png?raw=true';
const IMAGE_URL_LOW_RISK =
  'https://github.com/brown-sung/drlike5-GCP-ver2/blob/main/asthma_low2.png?raw=true';

const createResponseFormat = (mainText, questions = []) => {
  // 텍스트에서 JSON 형태 제거 및 정리
  let cleanText = mainText;

  // JSON 형태의 문자열 제거
  if (typeof cleanText === 'string') {
    // JSON 객체 형태 제거 (더 강력한 처리)
    const jsonPatterns = [
      /\{[^{}]*"response"[^{}]*\}/g,
      /\{[^{}]*"text"[^{}]*\}/g,
      /\{[^{}]*"message"[^{}]*\}/g,
      /\{[^{}]*"question"[^{}]*\}/g,
      /\{[^{}]*"content"[^{}]*\}/g,
    ];

    for (const pattern of jsonPatterns) {
      if (pattern.test(cleanText)) {
        const jsonMatch = cleanText.match(pattern);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            cleanText =
              parsed.response ||
              parsed.text ||
              parsed.message ||
              parsed.question ||
              parsed.content ||
              parsed.answer ||
              cleanText;
            break; // 첫 번째로 성공한 패턴 사용
          } catch (e) {
            // JSON 파싱 실패 시 다음 패턴 시도
            continue;
          }
        }
      }
    }

    // 다른 JSON 형태들도 처리
    if (cleanText.includes('{"text":') || cleanText.includes('{"message":')) {
      try {
        const parsed = JSON.parse(cleanText);
        cleanText =
          parsed.text ||
          parsed.message ||
          parsed.question ||
          parsed.content ||
          parsed.response ||
          parsed.answer ||
          cleanText;
      } catch (e) {
        // JSON 파싱 실패 시 원본 사용
      }
    }

    // 마크다운 코드 블록 제거
    if (cleanText.startsWith('```json') && cleanText.endsWith('```')) {
      cleanText = cleanText.substring(7, cleanText.length - 3).trim();
      try {
        const parsed = JSON.parse(cleanText);
        cleanText =
          parsed.text ||
          parsed.message ||
          parsed.question ||
          parsed.content ||
          parsed.response ||
          parsed.answer ||
          cleanText;
      } catch (e) {
        // JSON 파싱 실패 시 원본 사용
      }
    } else if (cleanText.startsWith('```') && cleanText.endsWith('```')) {
      cleanText = cleanText.substring(3, cleanText.length - 3).trim();
    }
  }

  // 최종 정리
  cleanText = cleanText
    .replace(/^"|"$/g, '') // 앞뒤 쌍따옴표 제거
    .replace(/\\"/g, '"') // 이스케이프된 쌍따옴표를 일반 쌍따옴표로 변환
    .replace(/\n\s*\n/g, '\n') // 연속된 줄바꿈 정리
    .trim();

  console.log(`[Response Format] Original text length: ${mainText.length} characters`);
  console.log(`[Response Format] Cleaned text length: ${cleanText.length} characters`);

  const safeQuestions = Array.isArray(questions) ? questions.slice(0, 10) : [];
  const response = {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text: cleanText } }],
    },
  };

  if (safeQuestions.length > 0) {
    response.template.quickReplies = safeQuestions.map((q) => {
      // "병원 진료 예약하기" 버튼에 webLink 적용
      if (q === '병원 진료 예약하기') {
        return {
          label: q,
          action: 'webLink',
          webLinkUrl: 'https://pf.kakao.com/_wEhwxj',
        };
      }
      // 다른 버튼들은 기본 message 액션
      return {
        label: q,
        action: 'message',
        messageText: q,
      };
    });
  }

  console.log(
    `[Response Format] Final response created with ${
      response.template.outputs.length
    } outputs and ${response.template.quickReplies?.length || 0} quick replies`
  );
  return response;
};

const createCallbackWaitResponse = (text) => ({
  version: '2.0',
  useCallback: true,
  data: {
    text: text,
  },
});

const createResultCardResponse = (description, buttons, possibility) => {
  const imageUrl = possibility === '있음' ? IMAGE_URL_HIGH_RISK : IMAGE_URL_LOW_RISK;
  const safeButtons = Array.isArray(buttons) ? buttons : [];

  return {
    version: '2.0',
    template: {
      outputs: [
        {
          basicCard: {
            description: description,
            thumbnail: {
              imageUrl: imageUrl,
            },
            buttons: safeButtons.map((btnLabel) => {
              // "병원 진료 예약하기" 버튼에 webLink 적용
              if (btnLabel === '병원 진료 예약하기') {
                return {
                  action: 'webLink',
                  label: btnLabel,
                  webLinkUrl: 'https://pf.kakao.com/_wEhwxj',
                };
              }
              // 다른 버튼들은 기본 message 액션
              return {
                action: 'message',
                label: btnLabel,
                messageText: btnLabel,
              };
            }),
          },
        },
      ],
    },
  };
};

const createBasicCardResponse = (title, description, buttons, possibility) => {
  const imageUrl = possibility === '있음' ? IMAGE_URL_HIGH_RISK : IMAGE_URL_LOW_RISK;
  const safeButtons = Array.isArray(buttons) ? buttons : [];

  return {
    version: '2.0',
    template: {
      outputs: [
        {
          basicCard: {
            title: title,
            description: description,
            thumbnail: {
              imageUrl: imageUrl,
            },
            buttons: safeButtons.map((btnLabel) => {
              // "병원 진료 예약하기" 버튼에 webLink 적용
              if (btnLabel === '병원 진료 예약하기') {
                return {
                  action: 'webLink',
                  label: btnLabel,
                  webLinkUrl: 'https://pf.kakao.com/_wEhwxj',
                };
              }
              // 다른 버튼들은 기본 message 액션
              return {
                action: 'message',
                label: btnLabel,
                messageText: btnLabel,
              };
            }),
          },
        },
      ],
    },
  };
};

module.exports = {
  createResponseFormat,
  createCallbackWaitResponse,
  createResultCardResponse,
  createBasicCardResponse,
};
