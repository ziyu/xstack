export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type Mailer = {
  send(message: EmailMessage): Promise<void>;
};

/** Implemented once per provider in `providers/`. */
export type Transport = {
  send(message: EmailMessage & { from: string }): Promise<void>;
};
