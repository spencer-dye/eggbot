import { yahooTransactionId } from './identifiers.js';
import { findFirstValue } from './yahoo-json.js';

export function extractYahooTransactionReference(
  body: unknown,
  location?: string,
): string | undefined {
  const fromBody = transactionKeyFromBody(body);
  const key = fromBody ?? transactionKeyFromText(location);
  return key === undefined ? undefined : yahooTransactionId(key);
}

function transactionKeyFromBody(body: unknown): string | undefined {
  if (typeof body === 'string') return transactionKeyFromText(body);
  const value = findFirstValue(body, 'transaction_key');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function transactionKeyFromText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const element = /<transaction_key>([^<]+)<\/transaction_key>/.exec(
    value,
  )?.[1];
  if (element !== undefined) return decodeXml(element.trim());
  return /(?:^|\/)([^/]+\.l\.[^/]+\.(?:tr\.[^/]+|w\.c\.[^/]+))(?:$|[/?#])/.exec(
    value,
  )?.[1];
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}
