export default async function handler(req, res) {
  try {
    // 1. Recibir los datos
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const prompt = body?.prompt || "Sin texto";

    // 2. Revisar la llave
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Engañamos al sistema y mandamos el error como texto normal
      return res.status(200).json({ text: "🚨 ERROR AUDITOR: Vercel no está leyendo la llave secreta (GEMINI_API_KEY)." });
    }

    // 3. Conectar con Google
    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    
    // 4. Si Google nos rechaza, atrapamos su confesión y te la mandamos a WhatsApp
    if (!response.ok) {
       const motivo = data?.error?.message || 'Rechazo desconocido';
       return res.status(200).json({ text: `🚨 ERROR DE GOOGLE: ${motivo}` });
    }

    // 5. Si todo sale bien, mandamos el texto norteño real
    const textoFinal = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return res.status(200).json({ text: textoFinal });

  } catch (error) {
    // Si algo más explota, también te lo mandamos por WhatsApp
    return res.status(200).json({ text: `🚨 ERROR INTERNO DEL SERVIDOR: ${error.message}` });
  }
}