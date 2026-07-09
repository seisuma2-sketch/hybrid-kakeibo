// 💡 Vercel Serverless Function (Node.js)
export default async function handler(req, res) {
  // CORS通信の許可設定
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { imageBase64, expenseCategories } = req.body;
    
    // 💡 Vercelの管理画面に登録する環境変数（.env）からキーを取得！
    const apiKey = process.env.GEMINI_API_KEY; 
    
    if (!apiKey) {
      return res.status(500).json({ error: 'サーバーの環境変数が設定されていません。' });
    }

    // Google Gemini API への通信
    const googleResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: `このレシート画像を解析して、以下のJSONフォーマットのみを返してください。それ以外のテキスト（Markdownのバッククォートなど）は一切含めないでください。
              {"amount": 合計金額の数字のみ(カンマなし), "store": "店名(短い名前)", "category": "${expenseCategories.join(', ')}" の中から最も適切なものを1つ推測 }` 
            },
            { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }
          ]
        }]
      })
    });

    const data = await googleResponse.json();
    
    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    let aiText = data.candidates[0].content.parts[0].text;
    aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const parsed = JSON.parse(aiText);
    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({ error: 'サーバー内部エラー: ' + error.message });
  }
}