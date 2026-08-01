import { z } from "zod";

export const clientIntegrityEventTypes = [
  "visibility_hidden",
  "visibility_visible",
  "window_blur",
  "window_focus",
  "fullscreen_exit",
  "fullscreen_enter",
  "fullscreen_error",
  "restricted_shortcut",
  "context_menu_attempt",
  "clipboard_copy_attempt",
  "clipboard_cut_attempt",
  "clipboard_paste_attempt",
  "drag_start_attempt",
  "drop_attempt",
  "viewport_resize",
  "devtools_dimension_suspected",
  "page_hidden",
  "page_shown",
  "page_frozen",
  "page_resumed",
  "network_online",
  "network_offline",
  "duplicate_attempt_context",
  "attempt_storage_changed",
  "history_navigation_attempt",
  "print_attempt",
  "print_dialog_closed",
  "csp_violation",
  "media_device_changed",
  "listener_registry_restored",
] as const;

export const serverIntegrityEventTypes = [
  "channel_open",
  "channel_close",
  "heartbeat_ok",
  "heartbeat_missed",
  "heartbeat_invalid",
  "telemetry_gap",
] as const;

export const integrityEventTypes = [
  ...clientIntegrityEventTypes,
  ...serverIntegrityEventTypes,
] as const;

export const integrityEventTypeSchema = z.enum(integrityEventTypes);
export const clientIntegrityEventTypeSchema = z.enum(clientIntegrityEventTypes);
export type IntegrityEventType = z.infer<typeof integrityEventTypeSchema>;

const detailsSchema = z
  .record(
    z.string().max(80),
    z.union([
      z.string().max(240),
      z.number().finite(),
      z.boolean(),
      z.null(),
    ]),
  )
  .refine((details) => JSON.stringify(details).length <= 2_048, {
    message: "Integrity event details are too large",
  });

export const integrityAuthenticateSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("authenticate"),
    token: z.string().min(20).max(512).optional(),
    dev_token: z.string().min(20).max(512).optional(),
    client_build: z.string().min(1).max(120),
  })
  .strict()
  .refine((message) => Boolean(message.token || message.dev_token), {
    message: "An exam token is required",
  });

export const integrityEventMessageSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("event"),
    event_id: z.string().uuid(),
    sequence: z.number().int().positive(),
    occurred_at: z.string().datetime({ offset: true }),
    event_type: clientIntegrityEventTypeSchema,
    details: detailsSchema.default({}),
  })
  .strict();

export const integrityHeartbeatSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("heartbeat"),
    challenge_token: z.string().min(40).max(2_048),
    heartbeat_sequence: z.number().int().positive(),
    last_event_sequence: z.number().int().min(0),
    registry_version: z.string().min(1).max(120),
    registry_digest: z.string().min(1).max(128),
    listener_count: z.number().int().min(0).max(100),
    visibility_state: z.enum(["visible", "hidden", "prerender", "unknown"]),
    lifecycle_state: z.enum(["active", "passive", "hidden", "frozen", "unknown"]),
    client_build: z.string().min(1).max(120),
  })
  .strict();

export const integrityClientMessageSchema = z.discriminatedUnion("type", [
  integrityAuthenticateSchema,
  integrityEventMessageSchema,
  integrityHeartbeatSchema,
]);

export type IntegrityClientMessage = z.infer<typeof integrityClientMessageSchema>;

const evidenceValues: Record<IntegrityEventType, 0 | 1 | 2 | 3 | 4> = {
  visibility_hidden: 2,
  visibility_visible: 0,
  window_blur: 1,
  window_focus: 0,
  fullscreen_exit: 2,
  fullscreen_enter: 0,
  fullscreen_error: 0,
  restricted_shortcut: 3,
  context_menu_attempt: 2,
  clipboard_copy_attempt: 3,
  clipboard_cut_attempt: 3,
  clipboard_paste_attempt: 3,
  drag_start_attempt: 1,
  drop_attempt: 2,
  viewport_resize: 1,
  devtools_dimension_suspected: 1,
  page_hidden: 2,
  page_shown: 0,
  page_frozen: 0,
  page_resumed: 0,
  network_online: 0,
  network_offline: 0,
  duplicate_attempt_context: 3,
  attempt_storage_changed: 1,
  history_navigation_attempt: 2,
  print_attempt: 3,
  print_dialog_closed: 0,
  csp_violation: 3,
  media_device_changed: 1,
  listener_registry_restored: 2,
  channel_open: 0,
  channel_close: 1,
  heartbeat_ok: 0,
  heartbeat_missed: 2,
  heartbeat_invalid: 4,
  telemetry_gap: 2,
};

export function evidenceValueFor(type: IntegrityEventType): 0 | 1 | 2 | 3 | 4 {
  return evidenceValues[type];
}

export function parseSocketPayload(value: unknown): IntegrityClientMessage {
  if (typeof value !== "string") throw new Error("Integrity message must be text JSON");
  if (Buffer.byteLength(value, "utf8") > 64 * 1024) {
    throw new Error("Integrity message is too large");
  }
  return integrityClientMessageSchema.parse(JSON.parse(value));
}
