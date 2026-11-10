/** A real HTTP server on a free local port that plays the provider in tests. */
import http from "node:http";
import type { AddressInfo } from "node:net";

/** One request the fake provider received, body fully read. */
export interface Received {
  method: string;
  /** Path and query string. */
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export type Handler = (req: Received, res: http.ServerResponse) => void;

export interface FakeServer {
  url: string;
  requests: Received[];
  /** Decides how requests are answered from now on. */
  answer(handler: Handler): void;
  close(): Promise<void>;
}

export async function fakeServer(): Promise<FakeServer> {
  const requests: Received[] = [];
  let handler: Handler = (_req, res) => void res.writeHead(500).end();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const received = {
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(received);
      handler(received, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    answer: (next) => void (handler = next),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** An address where nothing listens. */
export async function deadAddress(): Promise<string> {
  const server = await fakeServer();
  await server.close();
  return server.url;
}

/** Reads a multipart body the way a real server would. */
export function formOf(req: Received): Promise<FormData> {
  const headers = { "content-type": req.headers["content-type"] ?? "" };
  return new Response(new Uint8Array(req.body), { headers }).formData();
}

/** Answers with a JSON body. */
export function json(status: number, body: unknown): Handler {
  return (_req, res) => void res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

export const firstPart = Buffer.from("first part of the audio ");
export const secondPart = Buffer.from("second part of the audio");

/**
 * Answers with audio in two parts and holds the second back until `release()`.
 * `closed` tells whether the whole answer had been sent when the connection ended.
 */
export function audioInTwoParts(contentType = "audio/mpeg") {
  let release = (): void => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  let close = (_finished: boolean): void => {};
  const closed = new Promise<boolean>((resolve) => (close = resolve));
  const handler: Handler = (_req, res) => {
    res.on("close", () => close(res.writableFinished));
    res.writeHead(200, { "content-type": contentType });
    res.write(firstPart);
    void released.then(() => res.end(secondPart));
  };
  return { handler, release, closed };
}

/** Never answers. `arrived` resolves once the request is in, `closed` when the caller hangs up. */
export function silence() {
  let arrive = (): void => {};
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  let close = (): void => {};
  const closed = new Promise<void>((resolve) => (close = resolve));
  const handler: Handler = (_req, res) => {
    res.on("close", close);
    arrive();
  };
  return { handler, arrived, closed };
}

/** Drains a stream into one buffer. */
export async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    chunks.push(value);
  }
}
