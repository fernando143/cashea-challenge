export function createMoneyFormatter(locale = globalThis.navigator?.language) {
  const formatters = new Map();

  return (cents, currency) => {
    if (!Number.isSafeInteger(cents)) throw new TypeError("Money must use integer cents");
    if (typeof currency !== "string" || currency.length !== 3) throw new TypeError("Currency must be an ISO 4217 code");

    let formatter = formatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
      formatters.set(currency, formatter);
    }
    return formatter.format(cents / 100);
  };
}
