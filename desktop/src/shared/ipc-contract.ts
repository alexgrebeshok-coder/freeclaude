import { z } from 'zod';

/**
 * Single source of truth for FreeClaude Desktop IPC.
 *
 * Imported from main, preload, and renderer. Channels are listed below as a
 * frozen tuple so they are visible at a glance and so tests can iterate them.
 *
 * Each schema validates the *payload arguments* of an `ipcMain.handle` call
 * (renderer → main) or the *payload object* of an event push (main → renderer).
 * Validation is opt-in on the caller side via `parseInvoke` / `parseEvent`.
 */

// ---------------------------------------------------------------------------
// Channel names
// ---------------------------------------------------------------------------

export const InvokeChannels = {
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',

  appVersion: 'app:version',
  appRendererReady: 'app:rendererReady',
  appGetLogPath: 'app:getLogPath',
  appOpenLogFolder: 'app:openLogFolder',

  shellOpenExternal: 'shell:openExternal',

  pathsHome: 'paths:home',
  pathsUserData: 'paths:userData',

  freeclaudeSend: 'freeclaude:send',
  freeclaudeCancel: 'freeclaude:cancel',
  freeclaudeGetProviders: 'freeclaude:getProviders',
  freeclaudeGetModels: 'freeclaude:getModels',
  freeclaudeGetResolvedConfig: 'freeclaude:getResolvedConfig',

  providerSaveConfig: 'provider:saveConfig',
  providerSetApiKey: 'provider:setApiKey',
  providerClearApiKey: 'provider:clearApiKey',
  providerSetActive: 'provider:setActive',
  providerTestConnection: 'provider:testConnection',

  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalKill: 'terminal:kill',

  dialogOpenFile: 'dialog:openFile',
  dialogSaveFile: 'dialog:saveFile',

  fsReadFile: 'fs:readFile',
  fsWriteFile: 'fs:writeFile',
  fsStat: 'fs:stat',
  fsReaddir: 'fs:readdir',

  configGet: 'config:get',
  configSet: 'config:set',

  diagnosticsZip: 'diagnostics:zip'
} as const;

export const EventChannels = {
  freeclaudeMessage: 'freeclaude:message',
  freeclaudeError: 'freeclaude:error',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  updaterStatus: 'updater:status'
} as const;

export type InvokeChannel = (typeof InvokeChannels)[keyof typeof InvokeChannels];
export type EventChannel = (typeof EventChannels)[keyof typeof EventChannels];

// ---------------------------------------------------------------------------
// Common schemas
// ---------------------------------------------------------------------------

export const RequestIdSchema = z.string().min(1).max(128);
export const SessionIdSchema = z.string().min(1).max(256);

const SafeFilePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\u0000'), { message: 'path must not contain NUL bytes' });

const ChatRoleSchema = z.enum(['user', 'assistant', 'system']);

export const ChatHistoryEntrySchema = z.object({
  role: ChatRoleSchema,
  content: z.string()
});

export type ChatHistoryEntry = z.infer<typeof ChatHistoryEntrySchema>;

// ---------------------------------------------------------------------------
// freeclaude:* schemas
// ---------------------------------------------------------------------------

export const FreeClaudeSendRequestSchema = z.object({
  type: z.literal('user').optional(),
  requestId: RequestIdSchema.optional(),
  sessionId: SessionIdSchema.optional(),
  content: z.string().min(1).max(200_000),
  history: z.array(ChatHistoryEntrySchema).max(2000).optional()
});
export type FreeClaudeSendRequest = z.infer<typeof FreeClaudeSendRequestSchema>;

export const FreeClaudeProviderInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  short: z.string(),
  models: z.array(z.string()),
  configured: z.boolean(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  kind: z.string().optional(),
  modelSource: z.string().optional(),
  authRequired: z.boolean().optional(),
  price: z.object({
    inputPerMillion: z.number(),
    outputPerMillion: z.number()
  }).optional(),
  keyStatus: z.object({
    configured: z.boolean(),
    encrypted: z.boolean(),
    last4: z.string().optional(),
    updatedAt: z.number().optional()
  }).optional()
});

export const FreeClaudeProvidersPayloadSchema = z.object({
  configured: z.boolean(),
  activeProvider: z.string().nullable(),
  activeModel: z.string().nullable(),
  providers: z.array(FreeClaudeProviderInfoSchema),
  configPath: z.string(),
  localConfigPath: z.string().optional(),
  cliPath: z.string().nullable(),
  cliSource: z.string().nullable(),
  encryptionAvailable: z.boolean().optional()
});

export const FreeClaudeResolvedConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string().optional(),
  apiKeyConfigured: z.boolean().optional(),
  apiKeyLast4: z.string().optional(),
  providerShort: z.string().optional(),
  cliPath: z.string().nullable(),
  cliSource: z.string().nullable(),
  localConfigPath: z.string(),
  desktopConfigPath: z.string()
});

export const ProviderConfigUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  enabled: z.boolean().optional(),
  baseUrl: z.string().max(2048).optional(),
  defaultModel: z.string().max(256).optional(),
  customModels: z.array(z.string().max(256)).max(100).optional()
});

export const ProviderSetApiKeyRequestSchema = z.object({
  providerId: z.string().min(1).max(128),
  apiKey: z.string().max(16_384)
});

export const ProviderIdRequestSchema = z.object({
  providerId: z.string().min(1).max(128)
});

export const ProviderSetActiveRequestSchema = z.object({
  providerId: z.string().min(1).max(128),
  model: z.string().max(256).optional()
});

export const ProviderConnectionTestRequestSchema = z.object({
  providerId: z.string().min(1).max(128),
  baseUrl: z.string().max(2048).optional(),
  apiKey: z.string().max(16_384).optional()
});

export const FreeClaudeMessageEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), requestId: RequestIdSchema.optional(), sessionId: z.string() }),
  z.object({ type: z.literal('content'), requestId: RequestIdSchema.optional(), content: z.string() }),
  z.object({ type: z.literal('done'), requestId: RequestIdSchema.optional(), done: z.literal(true) }),
  z.object({ type: z.literal('diagnostic'), requestId: RequestIdSchema.optional(), diagnostic: z.string() }),
  z.object({ type: z.literal('warning'), requestId: RequestIdSchema.optional(), warning: z.string() })
]);

export const FreeClaudeErrorEventSchema = z.object({
  requestId: RequestIdSchema.optional(),
  error: z.string()
});

// ---------------------------------------------------------------------------
// terminal:* schemas
// ---------------------------------------------------------------------------

export const TerminalCreateRequestSchema = z
  .object({
    cwd: SafeFilePathSchema.optional(),
    shell: z.string().min(1).max(512).optional(),
    cols: z.number().int().min(1).max(2000).optional(),
    rows: z.number().int().min(1).max(2000).optional()
  })
  .optional();

export const TerminalWriteRequestSchema = z.tuple([
  z.string().min(1).max(64),
  z.string().max(1_000_000)
]);

export const TerminalResizeRequestSchema = z.tuple([
  z.string().min(1).max(64),
  z.number().int().min(1).max(2000),
  z.number().int().min(1).max(2000)
]);

export const TerminalKillRequestSchema = z.tuple([z.string().min(1).max(64)]);

export const TerminalDataEventSchema = z.object({
  id: z.string(),
  data: z.string()
});

export const TerminalExitEventSchema = z.object({
  id: z.string(),
  code: z.number().nullable()
});

// ---------------------------------------------------------------------------
// fs:* schemas
// ---------------------------------------------------------------------------

export const FsReadFileRequestSchema = z.tuple([SafeFilePathSchema]);
export const FsWriteFileRequestSchema = z.tuple([SafeFilePathSchema, z.string().max(20_000_000)]);
export const FsStatRequestSchema = z.tuple([SafeFilePathSchema]);
export const FsReaddirRequestSchema = z.tuple([SafeFilePathSchema]);

export const FileStatSchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  isFile: z.boolean(),
  size: z.number(),
  mtime: z.number()
});

export const ReadDirResponseSchema = z.union([
  z.array(FileStatSchema),
  z.object({ error: z.string() }),
  // P1 hardening allows the response to flag truncation
  z.object({
    entries: z.array(FileStatSchema),
    truncated: z.boolean(),
    total: z.number()
  })
]);

// ---------------------------------------------------------------------------
// dialog:* schemas
// ---------------------------------------------------------------------------

const DialogFilterSchema = z.object({
  name: z.string(),
  extensions: z.array(z.string())
});

export const DialogOpenRequestSchema = z
  .object({
    title: z.string().optional(),
    defaultPath: z.string().optional(),
    buttonLabel: z.string().optional(),
    filters: z.array(DialogFilterSchema).optional(),
    properties: z
      .array(z.enum(['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles', 'createDirectory']))
      .optional()
  })
  .optional();

export const DialogSaveRequestSchema = z
  .object({
    title: z.string().optional(),
    defaultPath: z.string().optional(),
    buttonLabel: z.string().optional(),
    filters: z.array(DialogFilterSchema).optional()
  })
  .optional();

// ---------------------------------------------------------------------------
// config:* schemas
// ---------------------------------------------------------------------------

const ConfigKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/, 'config key must be alphanumeric with . _ -');

export const ConfigGetRequestSchema = z.tuple([ConfigKeySchema]);
export const ConfigSetRequestSchema = z.tuple([ConfigKeySchema, z.unknown()]);

// ---------------------------------------------------------------------------
// shell:* / paths:* schemas
// ---------------------------------------------------------------------------

export const ShellOpenExternalRequestSchema = z.tuple([
  z
    .string()
    .url()
    .max(8192)
    .refine(
      (value) => /^https?:\/\//i.test(value) || /^mailto:/i.test(value),
      { message: 'only http(s) and mailto URLs are allowed' }
    )
]);

// ---------------------------------------------------------------------------
// updater:* event schemas
// ---------------------------------------------------------------------------

export const UpdaterStatusEventSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checking') }),
  z.object({ status: z.literal('available'), version: z.string() }),
  z.object({ status: z.literal('not-available') }),
  z.object({ status: z.literal('downloading'), percent: z.number() }),
  z.object({ status: z.literal('downloaded'), version: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() })
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export class IpcContractError extends Error {
  channel: string;
  zod: z.ZodError;
  constructor(channel: string, error: z.ZodError) {
    super(`Invalid IPC payload for ${channel}: ${error.issues.map((i) => `${i.path.join('.') || '<root>'} ${i.message}`).join('; ')}`);
    this.channel = channel;
    this.zod = error;
    this.name = 'IpcContractError';
  }
}

/**
 * Safely parse renderer→main invoke args. Throws `IpcContractError` on failure.
 * The main process should wrap its handlers with this to refuse malformed
 * payloads without crashing the whole process.
 */
export function parseInvoke<T extends z.ZodTypeAny>(channel: InvokeChannel, schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new IpcContractError(channel, parsed.error);
  }
  return parsed.data;
}

/**
 * Validate an outgoing event payload from main→renderer. Returns either the
 * parsed value or the original value plus a logged warning, since we never
 * want to crash the main process on event emission.
 */
export function validateEvent<T extends z.ZodTypeAny>(
  channel: EventChannel,
  schema: T,
  value: unknown,
  onError?: (err: IpcContractError) => void
): unknown {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const err = new IpcContractError(channel, parsed.error);
    if (onError) {
      onError(err);
    } else {
      console.warn('[ipc-contract]', err.message);
    }
    return value;
  }
  return parsed.data;
}

export const InvokeSchemas = {
  [InvokeChannels.windowMinimize]: z.tuple([]).optional(),
  [InvokeChannels.windowMaximize]: z.tuple([]).optional(),
  [InvokeChannels.windowClose]: z.tuple([]).optional(),

  [InvokeChannels.appVersion]: z.tuple([]).optional(),
  [InvokeChannels.appRendererReady]: z.tuple([]).optional(),
  [InvokeChannels.appGetLogPath]: z.tuple([]).optional(),
  [InvokeChannels.appOpenLogFolder]: z.tuple([]).optional(),

  [InvokeChannels.shellOpenExternal]: ShellOpenExternalRequestSchema,

  [InvokeChannels.pathsHome]: z.tuple([]).optional(),
  [InvokeChannels.pathsUserData]: z.tuple([]).optional(),

  [InvokeChannels.freeclaudeSend]: z.tuple([FreeClaudeSendRequestSchema]),
  [InvokeChannels.freeclaudeCancel]: z.tuple([]).optional(),
  [InvokeChannels.freeclaudeGetProviders]: z.tuple([]).optional(),
  [InvokeChannels.freeclaudeGetModels]: z.tuple([z.string().optional()]).optional(),
  [InvokeChannels.freeclaudeGetResolvedConfig]: z.tuple([]).optional(),

  [InvokeChannels.providerSaveConfig]: z.tuple([ProviderConfigUpdateSchema]),
  [InvokeChannels.providerSetApiKey]: z.tuple([ProviderSetApiKeyRequestSchema]),
  [InvokeChannels.providerClearApiKey]: z.tuple([ProviderIdRequestSchema]),
  [InvokeChannels.providerSetActive]: z.tuple([ProviderSetActiveRequestSchema]),
  [InvokeChannels.providerTestConnection]: z.tuple([ProviderConnectionTestRequestSchema]),

  [InvokeChannels.terminalCreate]: z.tuple([TerminalCreateRequestSchema]).optional(),
  [InvokeChannels.terminalWrite]: TerminalWriteRequestSchema,
  [InvokeChannels.terminalResize]: TerminalResizeRequestSchema,
  [InvokeChannels.terminalKill]: TerminalKillRequestSchema,

  [InvokeChannels.dialogOpenFile]: z.tuple([DialogOpenRequestSchema]).optional(),
  [InvokeChannels.dialogSaveFile]: z.tuple([DialogSaveRequestSchema]).optional(),

  [InvokeChannels.fsReadFile]: FsReadFileRequestSchema,
  [InvokeChannels.fsWriteFile]: FsWriteFileRequestSchema,
  [InvokeChannels.fsStat]: FsStatRequestSchema,
  [InvokeChannels.fsReaddir]: FsReaddirRequestSchema,

  [InvokeChannels.configGet]: ConfigGetRequestSchema,
  [InvokeChannels.configSet]: ConfigSetRequestSchema,

  [InvokeChannels.diagnosticsZip]: z.tuple([]).optional()
} as const;

export const EventSchemas = {
  [EventChannels.freeclaudeMessage]: FreeClaudeMessageEventSchema,
  [EventChannels.freeclaudeError]: FreeClaudeErrorEventSchema,
  [EventChannels.terminalData]: TerminalDataEventSchema,
  [EventChannels.terminalExit]: TerminalExitEventSchema,
  [EventChannels.updaterStatus]: UpdaterStatusEventSchema
} as const;

export type InvokePayload<C extends keyof typeof InvokeSchemas> = z.infer<(typeof InvokeSchemas)[C]>;
export type EventPayload<C extends keyof typeof EventSchemas> = z.infer<(typeof EventSchemas)[C]>;
