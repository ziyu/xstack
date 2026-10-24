/** Formats an amount in the currency's minor unit, e.g. `1900` USD as `$19.00`. */
export function formatMoney(amount: number, currency: string, locale: string): string {
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}
