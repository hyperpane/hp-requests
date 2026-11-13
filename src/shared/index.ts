// What both parts agree on, by domain: requests, collections and
// environments, responses, and the messages of a WebSocket or an event
// stream. The pure helpers (variables, cURL, Postman, URLs) are beside
// these files, so the window and the server part read and write them the
// same way.

export const ID = 'requests';

export * from './requests.ts';
export * from './collections.ts';
export * from './responses.ts';
export * from './messages.ts';
