export type OpenAIMessageRole = "system" | "user" | "assistant" | "tool";

export interface OpenAIToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenAITool {
  type: "function";
  function: OpenAIToolFunction;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatMessage {
  role: OpenAIMessageRole;
  content:
    | string
    | null
    | Array<{
        type?: string;
        text?: string;
        input_text?: string;
        content?: string;
        [key: string]: unknown;
      }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIChatCompletionRequest {
  model?: string;
  messages: OpenAIChatMessage[];
  tools?: OpenAITool[];
  tool_choice?: "none" | "auto" | "required" | Record<string, unknown>;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
    [key: string]: unknown;
  };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface ChatJimmyModel {
  id: string;
  created?: number;
  owned_by?: string;
  [key: string]: unknown;
}

export interface ChatJimmyModelsResponse {
  data?: ChatJimmyModel[];
  [key: string]: unknown;
}

export interface UpstreamChatOptions {
  selectedModel: string;
  systemPrompt: string;
  topK: number;
}

export interface UpstreamChatRequest {
  messages: Array<Record<string, unknown>>;
  chatOptions: UpstreamChatOptions;
  tools?: OpenAITool[];
  tool_choice?: OpenAIChatCompletionRequest["tool_choice"];
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
