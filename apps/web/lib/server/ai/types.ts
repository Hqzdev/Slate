export const aiDraftActionTypes = ["create_document", "create_note", "create_table_note", "create_canvas_diagram", "update_document"] as const;
export const aiChatModes = ["ask", "plan", "agent"] as const;

export type AiDraftActionTypeValue = typeof aiDraftActionTypes[number];
export type AiChatMode = typeof aiChatModes[number];

export type AiProviderMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  functionCall?: AiProviderToolCall;
  functionsStateId?: string | null;
  name?: string;
  toolCallId?: string;
};

export type AiProviderTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiProviderToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type AiProviderRequest = {
  messages: AiProviderMessage[];
  signal?: AbortSignal;
  tools: AiProviderTool[];
};

export type AiProviderResponse = {
  content: string;
  functionsStateId: string | null;
  requestId: string | null;
  toolCalls: AiProviderToolCall[];
};

export interface AiProvider {
  complete(request: AiProviderRequest): Promise<AiProviderResponse>;
}

export type AiDraftProposal = {
  payload: unknown;
  type: AiDraftActionTypeValue;
};

export type AiOrchestrationResult = {
  content: string;
  drafts: AiDraftProposal[];
  providerRequestId: string | null;
};
