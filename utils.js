// 파일: utils.js
const IMAGE_URL_HIGH_RISK =
  'https://github.com/brown-sung/drlike5-GCP/blob/main/asthma_high2.png?raw=true';
const IMAGE_URL_LOW_RISK =
  'https://github.com/brown-sung/drlike5-GCP/blob/main/asthma_low2.png?raw=true';

const createResponseFormat = (mainText, questions = []) => {
  // 텍스트에서 불필요한 쌍따옴표 제거
  const cleanText = mainText
    .replace(/^"|"$/g, '') // 앞뒤 쌍따옴표 제거
    .replace(/\\"/g, '"') // 이스케이프된 쌍따옴표를 일반 쌍따옴표로 변환
    .replace(/\n\s*\n/g, '\n') // 연속된 줄바꿈 정리
    .trim();

  console.log(`[Response Format] Original text: "${mainText}"`);
  console.log(`[Response Format] Cleaned text: "${cleanText}"`);

  const safeQuestions = Array.isArray(questions) ? questions.slice(0, 10) : [];
  const response = {
    version: '2.0',
    template: {
      outputs: [{ simpleText: { text: cleanText } }],
    },
  };

  if (safeQuestions.length > 0) {
    response.template.quickReplies = safeQuestions.map((q) => ({
      label: q,
      action: 'message',
      messageText: q,
    }));
  }

  console.log(`[Response Format] Final response:`, JSON.stringify(response, null, 2));
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
            buttons: safeButtons.map((btnLabel) => ({
              action: 'message',
              label: btnLabel,
              messageText: btnLabel,
            })),
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
};
