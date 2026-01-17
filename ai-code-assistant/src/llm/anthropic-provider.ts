/**
 * Anthropic LLM Provider - Integration with Claude API
 *
 * Uses the official Anthropic SDK to make requests to Claude models.
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

interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Anthropic LLM Provider using Claude API
 */
export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;
  private model: string;
  private defaultMaxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
    });
    this.model = options.model || 'claude-sonnet-4-20250514';
    this.defaultMaxTokens = options.maxTokens || 4096;
  }

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

  countTokens(text: string): number {
    // Approximate token count (Claude uses ~4 chars per token on average)
    return Math.ceil(text.length / 4);
  }

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
