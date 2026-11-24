/**
 * Access-log format for every service (morgan). Includes the gateway's
 * request id (`X-Request-ID`, ISS-044) so one request can be followed from
 * the gateway log into the service log.
 */
export const ACCESS_LOG_FORMAT =
  ":method :url :status :res[content-length] - :response-time ms rid=:req[x-request-id]";
