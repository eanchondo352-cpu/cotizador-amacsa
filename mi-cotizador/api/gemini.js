export default async function handler(req, res) {
  try {
    // 1. Recibir los datos
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const prompt = body?.prompt || "Sin texto";

    // 2. Revisar la llave
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ text: "🚨 ERROR AUDITOR: Vercel no está leyendo la llave secreta (GEMINI_API_KEY)." });
    }

    // 3. Conectar con Google
    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    
    // 4. Si Google nos rechaza o está saturado por alta demanda
    if (!response.ok) {
       const motivo = data?.error?.message || 'Rechazo desconocido';
       
       // Si es un error temporal de alta demanda (503/429), mandamos 'null' 
       // para que el frontend active automáticamente el mensaje corporativo estándar
       if (response.status === 503 || response.status === 429 || motivo.toLowerCase().includes('high demand')) {
           return res.status(200).json({ text: null });
       }
       
       return res.status(200).json({ text: `🚨 ERROR DE GOOGLE: ${motivo}` });
    }

    // 5. Si todo sale bien, mandamos el texto generado
    const textoFinal = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return res.status(200).json({ text: textoFinal });

  } catch (error) {
    // Si ocurre un fallo de red o del servidor
    return res.status(200).json({ text: null });
  }
}