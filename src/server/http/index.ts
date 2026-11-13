// HTTP, from the server: a request made ready (request.ts), sent one
// exchange at a time (exchange.ts), its body read (decode.ts), its
// redirects followed (send.ts), and its failures said plainly (errors.ts).

export { readBody } from './decode.ts';
export { duration, failure } from './errors.ts';
export { type Exchange, type ExchangeOptions, exchange, pairs } from './exchange.ts';
export { MAX_BODY, MAX_REDIRECTS, type Part, type Prepared, USER_AGENT, applyAuth, mimeOf, prepare } from './request.ts';
export { nextHop, send } from './send.ts';
export { filePath, parseUrl } from './url.ts';
