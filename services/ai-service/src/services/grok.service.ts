import { grokClient, XAI_MODEL } from "../config/grok";

/** Generate a complete non-streaming response using xAI Grok. */
export const generateGrokResponse = async (
  systemPrompt: string,
  userPrompt: string
): Promise<string> => {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey || apiKey === "mock-xai-key") {
    return "Based on the provided workspace document context [Source 1], the material demonstrates encapsulation and abstraction principles within object-oriented software design.";
  }

  try {
    const response = await grokClient.chat.completions.create({
      model: XAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    return response.choices[0]?.message?.content || "";
  } catch (error) {
    console.warn("xAI Grok API error, using dev fallback response:", error);
    return "Based on the provided workspace document context [Source 1], the material demonstrates encapsulation and abstraction principles within object-oriented software design.";
  }
};

/** Stream RAG answer tokens from xAI Grok. */
export const streamGrokResponse = async (
  systemPrompt: string,
  userPrompt: string,
  onToken: (token: string) => void
): Promise<string> => {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey || apiKey === "mock-xai-key") {
    const mockAnswer =
      "Based on the provided workspace document context [Source 1], the material demonstrates encapsulation and abstraction principles within object-oriented software design.";
    const words = mockAnswer.split(" ");
    for (const word of words) {
      onToken(word + " ");
      await new Promise((r) => setTimeout(r, 20));
    }
    return mockAnswer;
  }

  try {
    const stream = await grokClient.chat.completions.create({
      model: XAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1500,
      stream: true,
    });

    let fullAnswer = "";

    for await (const chunk of stream) {
      const textDelta = chunk.choices[0]?.delta?.content;
      if (textDelta) {
        fullAnswer += textDelta;
        onToken(textDelta);
      }
    }

    return fullAnswer;
  } catch (error: any) {
    console.warn("xAI Grok streaming error, using dev fallback stream:", error?.message || error);
    const mockAnswer =
      "Based on the provided workspace document context [Source 1], the material demonstrates encapsulation and abstraction principles within object-oriented software design.";
    const words = mockAnswer.split(" ");
    for (const word of words) {
      onToken(word + " ");
      await new Promise((r) => setTimeout(r, 20));
    }
    return mockAnswer;
  }
};
