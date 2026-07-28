import { GoogleGenerativeAI } from '@google/generative-ai';

// Instanciamos el cliente de Gemini usando la llave de las variables de entorno de Vercel
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  // Verificamos que sea una petición por POST y que traiga el 'prompt'
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'No se envió ningún prompt en la petición.' });
  }

  try {
    // Usamos el modelo más rápido y recomendado para textos cortos
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Enviamos el prompt a la IA
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Si todo sale bien, devolvemos el texto puro al frontend
    res.status(200).json({ text: text });
  } catch (error) {
    // Si falla la IA o la red, lo imprimimos en la consola de Vercel y se lo avisamos al frontend
    console.error('Error al conectar con Gemini:', error);
    res.status(500).json({ 
      error: 'Error interno al generar contenido con la IA', 
      details: error.message 
    });
  }
}