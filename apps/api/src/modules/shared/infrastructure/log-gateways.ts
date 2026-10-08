import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EmailGateway, EmailMessage, SmsGateway, SmsMessage } from '../domain/ports';

/** Adaptateurs « log » pour local, staging et tests : aucun envoi réel. */
@Injectable()
export class LogSmsGateway implements SmsGateway {
  private readonly logger = new Logger('SmsGateway(log)');
  readonly sent: SmsMessage[] = [];
  async send(message: SmsMessage) {
    this.sent.push(message);
    this.logger.log({
      msg: 'SMS (log)',
      to: message.to.replace(/\d(?=\d{4})/g, '*'),
      length: message.body.length,
    });
    return { providerMessageId: `log-${randomUUID()}` };
  }
}

@Injectable()
export class LogEmailGateway implements EmailGateway {
  private readonly logger = new Logger('EmailGateway(log)');
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    this.logger.log({ msg: 'E-mail (log)', to: message.to, subject: message.subject });
    return { providerMessageId: `log-${randomUUID()}` };
  }
}
