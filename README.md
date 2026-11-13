# Requests

A Postman alternative: send requests and read their answers, in one
window laid out as Postman is: a sidebar (the environment, your collections, the history), a strip of
open tabs, and the open request with its answer below or beside it.

Every request goes from the server, not from the window: no CORS, the
server's own `localhost` in reach, and certificates checked or not, as
each request says.

## HTTP

- **Any method** (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, or one of
  your own), the URL with `{{variables}}` colored (red when they aren't
  set), **Send** with ⌘↵ (Ctrl+Enter), **Save** with ⌘S (Ctrl+S).
- **Params**, kept in step with the URL's query; **Headers**, sent as typed
  (their case, repeated ones too), with the common names suggested.
- **Body**: JSON (with Beautify), text, XML, HTML or JavaScript, a
  URL-encoded form, a multipart form (text fields and files on the server),
  a file as it is, or **GraphQL** (a query and its variables).
- **Auth**: a bearer token, Basic, an API key (in a header or the query),
  or inherited from the folder or the collection.
- **Settings**: the timeout, following redirects (up to 10), ignoring TLS
  errors.
- **The answer**: the status, time and size; the body pretty (a JSON tree
  to search), raw, or previewed (images, HTML); copied or saved to a file;
  the headers in order; the cookies it set; **timings** as a waterfall
  (lookup, connect, TLS, first byte, download) with the redirects, the
  address and the certificate; and the request as a **cURL** command.
  gzip, deflate and Brotli are decompressed; bodies over 50 MB are cut.

## WebSocket

Headers, subprotocols, ignoring TLS errors, and reconnecting when it
drops. The messages show two ways, switched with one click:

- **Chat**: what you send on the right, what comes on the left; JSON laid
  out as a tree, binary as hex; a line for connecting, closing (with the
  code and who closed it) and errors.
- **Log**: a line a message, with its direction, time and size; filter,
  copy, clear.

The composer sends text, JSON, or bytes as hex or base64: Enter sends,
Shift+Enter is a new line. Keep a message as a template (it's saved with
the request) and click it to send it again. Ping, and disconnect with the
closing handshake.

## Event streams (SSE)

A request whose answer is `text/event-stream`: connect, and its events
come as they're sent (the name, the id, the data).

## Collections, environments, history

- **Collections** (folders, requests, their own variables and auth) are
  kept in the project, in `.hyperpane/requests/collections.json`: commit them
  and your team has them.
- **Environments** are sets of variables, chosen in the sidebar; they win
  over a collection's. They're kept in the project too, except the values
  of **secret** variables (the lock), which stay on this machine.
- **History**: the last 300 requests sent, on this machine. Click one to
  open it again.

## Import and export

Paste a **cURL** command (as a browser's “Copy as cURL” gives it) to open
it as a request, or a **Postman** collection (v2.1) or environment to add
it to the project. Any request copies as cURL; a collection exports as a
Postman v2.1 file.
