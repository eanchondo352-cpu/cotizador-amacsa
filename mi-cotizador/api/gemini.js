export default async function handler(req, res) {
  // 1. Validar que solo aceptemos peticiones seguras (POST)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // 2. Extracción ultra-segura del texto (Blindaje contra Vercel)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const prompt = body?.prompt;

    if (!prompt) {
      return res.status(400).json({ error: 'El sistema no recibió el texto para cotizar.' });
    }

    // 3. Validar nuestra bóveda secreta
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Falta la llave secreta en Vercel.' });
    }

    // 4. Ruta oficial v1 para tu llave AQ.
    const urlGemini = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    // 5. Conexión con Google
    let data;
    let response;

    for (let intento = 0; intento < 3; intento++) {
      response = await fetch(urlGemini, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      data = await response.json();
      
      if (response.ok) break;

      // Si Google está saturado, esperamos 2 segundos y reintentamos
      if (response.status === 503) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      throw new Error(data?.error?.message || 'Error interno de Google Gemini.');
    }

    if (!response.ok) throw new Error(data?.error?.message || 'Fallo la llamada a la Inteligencia Artificial.');

    // 6. Entregar el texto norteño
    const textoFinal = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return res.status(200).json({ text: textoFinal });

  } catch (error) {
    // Captura cualquier otro error sorpresivo
    return res.status(500).json({ error: error.message || 'El servidor colapsó por un error desconocido.' });
  }
}