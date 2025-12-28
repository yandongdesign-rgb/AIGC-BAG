
import { GoogleGenAI } from "@google/genai";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const enhanceAndCleanImage = async (base64Image: string): Promise<string> => {
  const ai = getAI();
  
  // Clean the data URL prefix if it exists
  const base64Data = base64Image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Data,
            mimeType: 'image/png',
          },
        },
        {
          text: `Please perform two actions on this image slice:
          1. Upscale and enhance it to ultra-high definition, making textures sharper and clearer.
          2. Detect and cleanly remove any text or watermarks, especially those located in the corners of the image. 
          The final output should be a clean, high-resolution version of this image without any added elements.`,
        },
      ],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  throw new Error("No image data returned from Gemini API");
};
