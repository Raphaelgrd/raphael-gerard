
import { GoogleGenAI } from "@google/genai";

export async function summarizeFolderContent(folderName: string, items: string[]) {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  const model = 'gemini-3-flash-preview';
  
  const prompt = `I have a folder named "${folderName}" containing the following items:
${items.join('\n')}

Please provide a very brief, professional 2-sentence summary of what this folder seems to be about and one tip for organizing it better.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Could not generate summary at this time.";
  }
}

export async function enhanceNote(content: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  const model = 'gemini-3-flash-preview';
  
  const prompt = `Act as a productivity assistant. Enhance the following note to be more structured, clear, and professional. Keep it concise.
  
Note content:
${content}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return content;
  }
}
