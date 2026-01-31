import { Injectable } from '@nestjs/common';

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

export interface ModelsResponse {
  result: string;
  data: unknown[];
}

@Injectable()
export class AppService {
  private readonly baseUrl = `https://api.infomaniak.com/1/ai/${process.env.INFOMANIAK_PRODUCT_ID}/openai/chat/completions`;

  async getModels(): Promise<ModelsResponse> {
    const response = await fetch('https://api.infomaniak.com/1/ai/models', {
      headers: {
        Authorization: `Bearer ${process.env.INFOMANIAK_API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Infomaniak API error: ${response.status} - ${errorBody}`,
      );
    }

    return response.json() as Promise<ModelsResponse>;
  }

  async move(message: string): Promise<string> {
    console.log('Calling Infomaniak API:', this.baseUrl);

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.INFOMANIAK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral3',
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Infomaniak API error body:', errorBody);
      throw new Error(
        `Infomaniak API error: ${response.status} ${response.statusText} - ${errorBody}`,
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return data.choices[0]?.message?.content ?? '';
  }
}
