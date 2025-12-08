import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeHandGesture = async (imageBase64: string): Promise<AnalysisResult> => {
  // Strip prefix if present (e.g., "data:image/jpeg;base64,")
  const base64Data = imageBase64.split(',')[1] || imageBase64;

  const model = "gemini-2.5-flash";
  
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Data
          }
        },
        {
          text: "Analyze the hand gesture in this image. Describe what the hand is doing or representing (e.g., 'Peace Sign', 'Thumbs Up', 'Open Palm', 'Holding an object'). Keep the description brief."
        }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          gesture: { type: Type.STRING, description: "Name of the gesture" },
          confidence: { type: Type.STRING, description: "High, Medium, or Low" },
          description: { type: Type.STRING, description: "A short, one-sentence description of the visual details." }
        },
        required: ["gesture", "confidence", "description"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");

  return JSON.parse(text) as AnalysisResult;
};