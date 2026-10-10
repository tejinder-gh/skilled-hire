export type Channel = "IN_APP" | "EMAIL" | "SMS" | "PUSH" | "PHONE";
export interface MessagingProvider { send(input: { channel: Channel; recipient: string; template: string; variables: Record<string, string>; correlationId: string }): Promise<{ providerMessageId: string }>; }
export interface DomainNotification { eventType: string; recipientUserId: string; preferredChannels: readonly Channel[]; payload: Record<string, string>; }
