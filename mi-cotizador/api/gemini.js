import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'No se envió ningún prompt en la petición.' });
  }

  try {
    // Aquí puedes colocar el nombre del modelo que confirmaste que soporta tu cuenta y versión
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    res.status(200).json({ text: text });
  } catch (error) {
    console.error('Error al conectar con Gemini:', error);
    res.status(500).json({ 
      error: 'Error interno al generar contenido con la IA', 
      details: error.message 
    });
  }
}