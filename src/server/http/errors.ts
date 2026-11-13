// Failures, and times, as they're said to the person.

import { PluginError } from '@hyperpane/sdk/server';

/** What's left to say about a failure, in plain words. */
export function failure(e: unknown, url: URL): PluginError {
  if (e instanceof PluginError) return e;
  const err = e as NodeJS.ErrnoException & { reason?: string };
  const where = url.host;
  switch (err.code) {
    case 'ECONNREFUSED':
      return new PluginError(`Couldn’t connect to ${where}: nothing is listening there.`);
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new PluginError(`Couldn’t find ${url.hostname}: no such host${err.code === 'EAI_AGAIN' ? ' (the lookup failed; is the network up?)' : ''}.`);
    case 'ECONNRESET':
      return new PluginError(`${where} closed the connection before answering.`);
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return new PluginError(`Couldn’t reach ${where}: there’s no route to it.`);
    case 'ETIMEDOUT':
      return new PluginError(`Couldn’t connect to ${where}: it didn’t answer.`);
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
      return new PluginError(`${where} didn’t speak TLS: is it http:// rather than https://?`);
    case 'HPE_INVALID_CONSTANT':
    case 'HPE_INVALID_STATUS':
      return new PluginError(`${where} didn’t answer in HTTP: is it https:// rather than http://?`);
    case 'ERR_INVALID_HTTP_TOKEN':
    case 'ERR_INVALID_CHAR':
      return new PluginError(`A header can’t be sent: ${err.message}`);
  }
  if (err.code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|HOSTNAME|ERR_TLS_CERT/.test(err.code)) {
    return new PluginError(`${where}’s certificate isn’t trusted (${err.code}): ${err.message}. Turn on “Ignore TLS errors” in Settings to send anyway.`);
  }
  return new PluginError(`Couldn’t send to ${where}: ${err.message}`);
}

/** A time as it's said: `150 ms`, `30 s`. */
export const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${Math.round(ms / 100) / 10} s`);
