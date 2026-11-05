# Realtime: WebSockets And Server-Sent Events

## Use When

- the client needs low-latency updates without polling
- the primary consumer is browser or app UI, not a server-to-server callback target
- the product requires subscription-style delivery rather than request/response fetches

## Prefer SSE When

- the server only needs to push data one way to the client
- browser simplicity and ordinary HTTP behavior matter
- reconnect semantics can be handled with event IDs or replay cursors

## Prefer WebSockets When

- the client and server both need to send messages over the same long-lived channel
- the interaction is bidirectional, collaborative, or command/response-like
- higher connection complexity is justified by the interaction model

## Avoid As The Default When

- polling is operationally simpler and good enough
- webhooks solve the integration problem because the consumer is another server
- the system cannot define reconnect, replay, ordering, and backpressure expectations

## Contract Rules

- Define the subscription unit explicitly: channel, topic, room, resource, or filter scope.
- Define auth at connection time and for message-level access where scopes can change.
- Define reconnect behavior, replay window, and duplicate-delivery expectations.
- Define message shape/versioning rules the same way you would for any other contract.
- Define whether ordering is guaranteed, best-effort, or explicitly not guaranteed.
- Define keepalive, idle timeout, and disconnect behavior.

## Design Questions

- Is the flow one-way push or true bidirectional interaction?
- Does the client need replay after reconnect?
- What is the authorization model for channel or topic access?
- What happens when the client falls behind or reconnects after a long gap?

## References

- The WebSocket Protocol (RFC 6455): https://www.rfc-editor.org/rfc/rfc6455.html
- Server-sent events in the HTML Living Standard: https://html.spec.whatwg.org/multipage/server-sent-events.html
- OpenAPI Specification: https://spec.openapis.org/oas/latest.html
