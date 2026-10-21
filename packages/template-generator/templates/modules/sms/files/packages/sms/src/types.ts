export type OtpMessage = {
  /** E.164: a leading + and country code, with no spaces or punctuation. */
  phoneNumber: string;
  code: string;
};

export type Sms = {
  /** Resolves on provider API acceptance, not confirmed handset delivery. */
  sendOtp(message: OtpMessage): Promise<void>;
};
