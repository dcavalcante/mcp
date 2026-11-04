import { HttpException } from '@nestjs/common';
import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  type CallToolResult,
} from '@modelcontextprotocol/server';

/** What a client is told about an error that is not meant for it. */
export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * The message of an `HttpException`, as its response body carries it: a string response, the body's `message`
 * (`ValidationPipe`'s list joined), else the exception's own.
 */
export function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  const message = (response as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) {
    return message.map(String).join('; ');
  }
  return typeof message === 'string' ? message : exception.message;
}

/** The URL elicitation error is the one error a tool propagates as a JSON-RPC error, as the spec requires. */
function isUrlElicitationRequired(error: unknown): boolean {
  return error instanceof ProtocolError && error.code === ProtocolErrorCode.UrlElicitationRequired;
}

/**
 * A tool's failure, as the result the model reads (`isError: true`): an `HttpException`'s or a `ProtocolError`'s
 * message, `Internal server error` for anything else (Nest's exception handler has logged it).
 */
export function toolErrorResult(error: unknown): CallToolResult {
  if (isUrlElicitationRequired(error)) {
    throw error;
  }
  const text =
    error instanceof HttpException
      ? httpExceptionMessage(error)
      : error instanceof ProtocolError
        ? error.message
        : INTERNAL_ERROR_MESSAGE;
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * A resource's or prompt's failure, as the JSON-RPC error the client gets: a `ProtocolError` as thrown; a 404 as the
 * spec's resource-not-found error for a resource (invalid params for a prompt); a 400 or 422 as invalid params; any
 * other `HttpException` as an internal error with its message and status; anything else as `Internal server error`.
 */
export function toProtocolError(error: unknown, uri?: URL): ProtocolError {
  if (error instanceof ProtocolError) {
    return error;
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const message = httpExceptionMessage(error);
    if (status === 404 && uri) {
      return new ResourceNotFoundError(uri.href);
    }
    if (status === 400 || status === 404 || status === 422) {
      return new ProtocolError(ProtocolErrorCode.InvalidParams, message);
    }
    return new ProtocolError(ProtocolErrorCode.InternalError, message, { status });
  }
  return new ProtocolError(ProtocolErrorCode.InternalError, INTERNAL_ERROR_MESSAGE);
}
