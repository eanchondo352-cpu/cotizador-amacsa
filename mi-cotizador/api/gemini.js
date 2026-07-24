export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { prompt } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Falta la llave en Vercel' });
  }

  // VERSIÓN OFICIAL v1 PARA LLAVES AQ.
  const urlGemini = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  let data;
  let response;

  try {
    for (let intento = 0; intento < 3; intento++) {
      response = await fetch(urlGemini, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      data = await response.json();
      if (response.ok) break;

      if (response.status === 503) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      throw new Error(data?.error?.message || 'Error de Gemini');
    }

    if (!response.ok) throw new Error(data?.error?.message || 'Fallo IA');

    const textoFinal = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    res.status(200).json({ text: textoFinal });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}