/**
 * Narrow interfaces so SlackAdapter can be unit-tested without a real workspace.
 * Production wires these to @slack/web-api and @slack/socket-mode.
 */

export interface SlackAuthTestResult {
  ok?: boolean;
  user_id?: string;
  team_id?: string;
  team?: string;
  error?: string;
}

export interface SlackConversationsListResult {
  ok?: boolean;
  channels?: Array<{
    id?: string;
    name?: string;
    is_channel?: boolean;
    is_group?: boolean;
    is_private?: boolean;
    is_member?: boolean;
    is_archived?: boolean;
  }>;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

export interface SlackPostMessageResult {
  ok?: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

export interface SlackWebApi {
  auth: {
    test: () => Promise<SlackAuthTestResult>;
  };
  conversations: {
    list: (args: {
      types?: string;
      exclude_archived?: boolean;
      limit?: number;
      cursor?: string;
    }) => Promise<SlackConversationsListResult>;
  };
  chat: {
    postMessage: (args: {
      channel: string;
      text: string;
    }) => Promise<SlackPostMessageResult>;
  };
}

export type SlackSocketAck = (response?: unknown) => Promise<void>;

export interface SlackSocketMessageArgs {
  ack: SlackSocketAck;
  event: Record<string, unknown>;
}

export type SlackSocketMessageHandler = (
  args: SlackSocketMessageArgs,
) => void | Promise<void>;

export interface SlackSocketClient {
  on(event: "message", handler: SlackSocketMessageHandler): void;
  start(): Promise<unknown>;
  disconnect(): Promise<void>;
}

export type CreateWebClient = (botToken: string) => SlackWebApi;
export type CreateSocketClient = (appToken: string) => SlackSocketClient;
