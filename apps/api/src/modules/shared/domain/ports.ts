/** Ports vers l'extérieur (ADR-0001) : une interface, des adaptateurs interchangeables par configuration. */

export interface SmsMessage {
  to: string;
  body: string;
  /** Référence métier pour corréler l'accusé de réception. */
  reference?: string;
}
export interface SmsGateway {
  send(message: SmsMessage): Promise<{ providerMessageId: string }>;
}
export const SMS_GATEWAY = Symbol('SMS_GATEWAY');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  reference?: string;
}
export interface EmailGateway {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}
export const EMAIL_GATEWAY = Symbol('EMAIL_GATEWAY');

export interface Clock {
  now(): Date;
}
export const CLOCK = Symbol('CLOCK');
export const systemClock: Clock = { now: () => new Date() };
