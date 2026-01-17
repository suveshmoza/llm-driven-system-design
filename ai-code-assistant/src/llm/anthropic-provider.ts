/**
 * Anthropic LLM Provider - Integration with Claude API.
 *
 * This provider implements the LLMProvider interface using the official
 * Anthropic SDK to communicate with Claude models. It handles message
 * conversion, tool definition formatting, and response parsing to bridge
 * the gap between the evylcode internal format and Anthropic's API format.
 *
 * @module llm/anthropic-provider
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  Message,
} from '../types/index.js';

/**
 * Configuration options for the Anthropic provider.
 */
interface AnthropicProviderOptions {
  /** Anthropic API key for authentication */
  apiKey: string;
  /** Model to use (defaults to claude-sonnet-4-20250514) */
  model?: string;
  /** Default max tokens for responses (defaults to 4096) */
  maxTokens?: number;
}

/**
 * Anthropic LLM Provider using the Claude API.
 *
 * This provider enables evylcode to use Claude models for:
 * - Natural language understanding of user requests
 * - Intelligent tool selection and parameter generation
 * - Contextual responses based on tool execution results
 *
 * Supports both synchronous and streaming completions.
 */
export class AnthropicProvider implements LLMProvider {
  /** Provider identifier */
  name = 'anthropic';
  /** Anthropic SDK client instance */
  private client: Anthropic;
  /** Model ID to use for requests */
  private model: string;
  /** Default maximum tokens for responses */
  private defaultMaxTokens: number;

  /**
   * Creates a new AnthropicProvider.
   * @param options - Configuration including API key and optional model/token settings
   */
  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
    });
    this.model = options.model || 'claude-sonnet-4-20250514';
    this.defaultMaxTokens = options.maxTokens || 4096;
  }

  /**
   * Generate a complete response synchronously.
   * @param request - The completion request with messages and options
   * @returns The complete response with content and any tool calls
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const messages = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens || this.defaultMaxTokens,
      messages,
      tools,
      temperature: request.temperature ?? 0.7,
    });

    return this.parseResponse(response);
  }

  /**
   * Stream a response chunk by chunk.
   * Yields text deltas and tool call events as they arrive from the API.
   * @param request - The completion request with messages and options
   * @yields Stream chunks containing text or tool call information
   */
  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const messages = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens || this.defaultMaxTokens,
      messages,
      tools,
      temperature: request.temperature ?? 0.7,
    });

    let currentToolCallId: string | undefined;
    let currentToolName: string | undefined;
    let currentToolInput = '';

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          // Text block starting
        } else if (event.content_block.type === 'tool_use') {
          currentToolCallId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolInput = '';
          yield {
            type: 'tool_call_start',
            toolCall: {
              id: currentToolCallId,
              name: currentToolName,
              parameters: {},
            },
          };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield {
            type: 'text',
            content: event.delta.text,
          };
        } else if (event.delta.type === 'input_json_delta') {
          currentToolInput += event.delta.partial_json;
          yield {
            type: 'tool_call_delta',
            content: event.delta.partial_json,
          };
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolCallId && currentToolName) {
          let parameters: Record<string, unknown> = {};
          try {
            parameters = JSON.parse(currentToolInput || '{}');
          } catch {
            // If parsing fails, use empty object
          }
          yield {
            type: 'tool_call_end',
            toolCall: {
              id: currentToolCallId,
              name: currentToolName,
              parameters,
            },
          };
          currentToolCallId = undefined;
          currentToolName = undefined;
          currentToolInput = '';
        }
      }
    }
  }

  /**
   * Estimate token count for text.
   * Uses a simple approximation since exact tokenization requires the model.
   * @param text - The text to count tokens for
   * @returns Approximate token count (based on ~4 chars per token)
   */
  countTokens(text: string): number {
    // Approximate token count (Claude uses ~4 chars per token on average)
    return Math.ceil(text.length / 4);
  }

  /**
   * Convert internal message format to Anthropic API format.
   * Handles role conversion and content block structure.
   * @param messages - Internal message array
   * @returns Anthropic-formatted message array
   */
  private convertMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // System messages are handled separately in Anthropic API
        continue;
      }

      if (msg.role === 'user') {
        result.push({
          role: 'user',
          content: msg.content,
        });
      } else if (msg.role === 'assistant') {
        const content: (Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam)[] = [];

        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content,
          });
        }

        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.parameters,
            });
          }
        }

        if (content.length > 0) {
          result.push({
            role: 'assistant',
            content,
          });
        }
      } else if (msg.role === 'tool') {
        // Tool results go in user messages
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        if (msg.toolResults) {
          for (const tr of msg.toolResults) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tr.toolId,
              content: tr.success ? (tr.output || 'Success') : `Error: ${tr.error}`,
              is_error: !tr.success,
            });
          }
        }

        if (toolResults.length > 0) {
          result.push({
            role: 'user',
            content: toolResults,
          });
        }
      }
    }

    return result;
  }

  /**
   * Convert internal tool definitions to Anthropic API format.
   * Maps the JSONSchema parameters to Anthropic's input_schema format.
   * @param tools - Internal tool definition array
   * @returns Anthropic-formatted tool array
   */
  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.parameters.properties || {},
        required: tool.parameters.required || [],
      },
    }));
  }

  /**
   * Parse Anthropic API response into internal format.
   * Extracts text content, tool calls, and stop reason.
   * @param response - Raw Anthropic API response
   * @returns Internal completion response format
   */
  private parseResponse(response: Anthropic.Message): CompletionResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          parameters: block.input as Record<string, unknown>,
        });
      }
    }

    const stopReason = response.stop_reason === 'tool_use'
      ? 'tool_use'
      : response.stop_reason === 'max_tokens'
        ? 'max_tokens'
        : 'end_turn';

    return {
      content,
      toolCalls,
      stopReason,
    };
  }
}
