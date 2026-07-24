export default async function handler(req, res) {
  console.log("--- INICIANDO AUDITORÍA DE API GEMINI ---");
  
  try {
    if (req.method !== 'POST') {
      console.log("✖ Error: El método no es POST. Es:", req.method);
      return res.status(405).json({ error: 'Método no permitido' });
    }

    console.log("1. Analizando los datos que llegaron del cotizador...");
    let body = req.body;
    
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.log("✖ Error al traducir el texto (JSON.parse):", e.message);
        return res.status(500).json({ error: 'Formato de datos inválido' });
      }
    }

    const prompt = body?.prompt;
    if (!prompt) {
      console.log("✖ Error: El texto a cotizar (prompt) viene vacío o indefinido.");
      return res.status(400).json({ error: 'Falta el texto' });
    }

    console.log("2. Revisando la bóveda de Vercel (API KEY)...");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log("✖ ERROR FATAL: La llave GEMINI_API_KEY no existe o Vercel no la está leyendo.");
      return res.status(500).json({ error: 'Falta llave secreta' });
    }

    console.log("3. Bóveda abierta. Armando ruta oficial v1...");
    const urlGemini = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    let data;
    let response;

    for (let intento = 0; intento < 3; intento++) {
      console.log(`-> Disparando intento de conexión #${intento + 1} con Google...`);
      response = await fetch(urlGemini, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      data = await response.json();
      
      if (response.ok) {
        console.log("✔ ¡Google autorizó y respondió con éxito!");
        break;
      }

      console.log("✖ Google rechazó la entrada. Código de error:", response.status);
      console.log("✖ Motivo de Google:", data?.error?.message);

      if (response.status === 503) {
        console.log("Google saturado. Esperando 2 segundos...");
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      throw new Error(data?.error?.message || 'Error interno de Gemini');
    }

    if (!response.ok) throw new Error(data?.error?.message || 'Fallo IA');

    const textoFinal = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log("✔ Todo perfecto. Mandando texto a la pantalla de AMACSA.");
    return res.status(200).json({ text: textoFinal });

  } catch (error) {
    console.log("✖ COLAPSO TOTAL DEL SERVIDOR:", error.message);
    return res.status(500).json({ error: error.message || 'El servidor colapsó' });
  }
}